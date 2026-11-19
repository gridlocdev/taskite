import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.gridloc.taskite',
  appName: 'Taskite',
  // Filled by `pnpm build`: the web client plus the bridge script (scripts/assemble.mjs).
  webDir: 'www',
  ios: {
    // The page runs edge to edge and keeps clear of the notch and the home bar itself (safe-area insets).
    contentInset: 'never',
  },
};

export default config;
