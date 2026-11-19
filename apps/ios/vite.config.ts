import { defineConfig } from 'vite';

// The bridge is a classic script, not a module: it has to put `window.taskiteNative` in place before the web
// client's module script runs.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: 'src/main.ts',
      formats: ['iife'],
      name: 'TaskiteIosBridge',
      fileName: () => 'taskite-ios-bridge.js',
    },
  },
});
