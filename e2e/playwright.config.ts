// Browser scenarios: the built web client served by the NAS server, on fixture data in .e2e-data.
// Run with `just e2e` (builds the client first). Never point it at real data.
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, ROOT, SERVER_COMMAND, SERVER_ENV } from './server.ts';

export default defineConfig({
  testDir: '.',
  // One worker: every test resets the same fixture folder.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../.e2e-report' }]] : 'list',
  outputDir: '../.e2e-results',
  // Screenshots are compared on macOS only, against baselines made on the owner's Mac with `just e2e-update`.
  // Fonts render differently elsewhere; Linux runs (CI, containers) still run every behaviour check.
  ignoreSnapshots: process.platform !== 'darwin',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' } },
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'web', testIgnore: /desktop\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop', testMatch: /desktop\.spec\.ts/ },
  ],
  webServer: {
    command: `node ${SERVER_COMMAND.join(' ')}`,
    cwd: ROOT,
    url: BASE_URL,
    reuseExistingServer: false,
    env: SERVER_ENV,
  },
});
