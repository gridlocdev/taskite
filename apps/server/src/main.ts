import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer, parseHosts, refuseWithoutToken } from './server.ts';

/**
 * Taskite NAS server (PRD §10). Configuration is environment-only so it drops straight into Docker:
 *   TASKITE_DATA     folder holding tasks.json (required)
 *   TASKITE_STATIC   the built web client (default ../web/dist); empty = API only
 *   TASKITE_HOST     bind address (default 127.0.0.1)    TASKITE_PORT (default 8788)
 *   TASKITE_TOKEN    shared bearer token; needed for a non-loopback bind unless TASKITE_NO_AUTH=1
 *   TASKITE_NO_AUTH  1 = listen on the network without a token (a reverse proxy authenticates)
 *   TASKITE_HOSTS    extra Host names (comma-separated) served when there is no token
 */
const env = process.env;
const here = path.dirname(new URL(import.meta.url).pathname);
if (!env.TASKITE_DATA) {
  console.error('Set TASKITE_DATA to the folder that holds tasks.json, e.g. TASKITE_DATA=/data');
  process.exit(1);
}
const dataDir = path.resolve(env.TASKITE_DATA);
await mkdir(dataDir, { recursive: true });
const staticDir =
  env.TASKITE_STATIC === '' ? null : path.resolve(env.TASKITE_STATIC ?? path.join(here, '../../web/dist'));
const port = Number(env.TASKITE_PORT ?? 8788);
const host = env.TASKITE_HOST || '127.0.0.1';
const token = env.TASKITE_TOKEN || null;
const noAuth = env.TASKITE_NO_AUTH === '1';
const refusal = refuseWithoutToken({ host, token, noAuth });
if (refusal) {
  console.error(refusal);
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(path.join(here, '../package.json'), 'utf8')) as { version: string };

const server = createServer({
  file: path.join(dataDir, 'tasks.json'),
  staticDir,
  token,
  version: pkg.version,
  allowedHosts: parseHosts(env.TASKITE_HOSTS),
});

server.listen(port, host, () => {
  console.log(`Taskite listening on http://${host}:${port}`);
  console.log(`  tasks file: ${path.join(dataDir, 'tasks.json')}`);
  if (!token)
    console.log(
      noAuth
        ? '  no TASKITE_TOKEN: TASKITE_NO_AUTH=1 says a reverse proxy in front authenticates'
        : '  no TASKITE_TOKEN: answering this machine only',
    );
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => server.close(() => process.exit(0)));
