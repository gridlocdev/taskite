// Drive the app from the command line for a quick look, instead of writing a one-off browser script.
// Starts the NAS server on a fixture, opens one headless browser, runs the steps, prints what happened.
//
//   just drive [--fixture basic] [--dark] <step>…
//
//   cmd:<command name>   run a command from the ⌘K menu       key:<chord>     press keys (ControlOrMeta+KeyS: key codes, not letters)
//   type:<text>          type text                           click:<text>    click the first element showing it
//   wait:<text>          wait until the text shows           shot:<name>     screenshot to .e2e-results/drive/
//   aria                 print the page's accessibility tree (cheap to read, names every control)
//   eval:<expression>    print the value of a JavaScript expression in the page
//
// Errors (uncaught, console, failed requests) are printed at the end. Fixture data only, never the owner's files.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { commandMenu, openApp, watchErrors } from './fixtures.ts';
import { BASE_URL, NOW, ROOT, SERVER_COMMAND, SERVER_ENV, seedData } from './server.ts';

const SHOTS = path.join(ROOT, '.e2e-results/drive');
const SERVER_START_MS = 15_000;
/**
 * The pause between steps on the page's clock, as in random use: a focus move the app makes a moment after a
 * key (a dialog taking the keyboard as it opens) lands before the next step, as it would for a person.
 */
const STEP_PAUSE_MS = 50;

function parseArgs(args: string[]): { fixture: string; dark: boolean; steps: string[] } {
  let fixture = 'basic';
  let dark = false;
  const steps: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--fixture') fixture = args[++i] ?? fixture;
    else if (arg === '--dark') dark = true;
    else steps.push(arg);
  }
  return { fixture, dark, steps };
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + SERVER_START_MS;
  while (Date.now() < deadline) {
    const up = await fetch(BASE_URL, { signal: AbortSignal.timeout(1000) }).then(
      (response) => response.ok,
      () => false,
    );
    if (up) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`the server did not answer on ${BASE_URL}; run \`just build-web\` first`);
}

const { fixture, dark, steps } = parseArgs(process.argv.slice(2));
if (steps.length === 0) {
  console.error(
    'usage: just drive [--fixture basic] [--dark] cmd:<name> key:<chord> type:<text> shot:<name> aria …',
  );
  process.exit(2);
}

seedData(fixture);
mkdirSync(SHOTS, { recursive: true });
const server = spawn(process.execPath, SERVER_COMMAND, {
  cwd: ROOT,
  env: { ...process.env, ...SERVER_ENV },
  stdio: ['ignore', 'ignore', 'inherit'],
});
// Stop the server however this ends: Ctrl+C, a kill, or output piped into `head` that closes early (EPIPE).
// Otherwise it keeps the port, and the next run or `just e2e` fails with EADDRINUSE.
const stop = (code: number) => {
  server.kill();
  process.exit(code);
};
process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') stop(0);
});

try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    colorScheme: dark ? 'dark' : 'light',
    reducedMotion: 'reduce',
    baseURL: BASE_URL,
  });
  const errors = watchErrors(page);
  // The same fixed clock as the scenarios, so the fixtures' dates read the same.
  await page.clock.install({ time: NOW });
  // The app picks its store before it draws; a key pressed sooner goes nowhere.
  await openApp(page);

  for (const step of steps) {
    const colon = step.indexOf(':');
    const kind = colon === -1 ? step : step.slice(0, colon);
    const value = colon === -1 ? '' : step.slice(colon + 1);
    await page.clock.runFor(STEP_PAUSE_MS);
    console.log(`> ${step}`);
    switch (kind) {
      case 'cmd':
        await page.keyboard.press('ControlOrMeta+KeyK');
        // Wait for focus in the menu's field: typing sooner is lost.
        await expect(commandMenu(page).getByRole('combobox')).toBeFocused({ timeout: 2000 });
        await page.keyboard.type(value);
        await page.keyboard.press('Enter');
        break;
      case 'key':
        await page.keyboard.press(value);
        break;
      case 'type':
        await page.keyboard.type(value);
        break;
      case 'click':
        await page.getByText(value).first().click();
        break;
      case 'wait':
        await page.getByText(value).first().waitFor({ timeout: 5000 });
        break;
      case 'shot': {
        const file = path.join(SHOTS, `${value || 'shot'}.png`);
        await page.screenshot({ path: file });
        console.log(`  ${file}`);
        break;
      }
      case 'aria':
        console.log(await page.locator('body').ariaSnapshot());
        break;
      case 'eval':
        console.log(`  ${JSON.stringify(await page.evaluate(value))}`);
        break;
      default:
        throw new Error(`unknown step "${kind}"`);
    }
  }
  console.log(errors.length > 0 ? `errors:\n${errors.join('\n')}` : 'no errors');
  await browser.close();
} finally {
  server.kill();
}
