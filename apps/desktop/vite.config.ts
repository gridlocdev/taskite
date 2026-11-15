import { defineConfig } from 'vite';

// The main process is bundled into one file, out/main.js, so the workspace packages it imports
// (@taskite/node-files) travel inside the app; Electron and Node's own modules stay imports. The sandboxed
// preload is compiled on its own by tsc (tsconfig.build.json), and scripts/copy-web.mjs adds the web client.
export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'out',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rolldownOptions: { output: { format: 'es', entryFileNames: 'main.js' } },
  },
  ssr: { external: ['electron'], noExternal: ['@taskite/node-files'] },
});
