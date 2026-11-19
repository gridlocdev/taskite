import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.gridloc.taskite',
  appName: 'Taskite',
  // Filled by `pnpm build`: the web client plus the bridge script (scripts/assemble.mjs).
  webDir: 'www',
  ios: {
    // Keeps the page out from under the notch and the home bar.
    contentInset: 'always',
  },
};

export default config;
