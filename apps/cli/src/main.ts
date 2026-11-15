import { readFileSync } from 'node:fs';
import os from 'node:os';
import { runCli } from './cli.ts';

/** The `taskite` executable: the real process streams, environment and clock. */
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
process.exitCode = await runCli(
  process.argv.slice(2),
  {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    env: process.env,
    cwd: process.cwd(),
    home: os.homedir(),
    platform: process.platform,
    now: () => Date.now(),
  },
  pkg.version,
);
