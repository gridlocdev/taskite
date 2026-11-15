// Copies the built web client into out/web, where the app:// protocol serves it from.
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../web/dist');
const dest = path.resolve(here, '../out/web');
if (!existsSync(src)) {
  console.error('apps/web/dist is missing — run `pnpm --filter @taskite/web build` first');
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`copied web client → ${path.relative(process.cwd(), dest)}`);
