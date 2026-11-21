/**
 * The Taskite NAS server (PRD §10): the built web client plus a small API over one tasks.json.
 * No framework: node:http only.
 */
import { timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import { isIP } from 'node:net';
import path from 'node:path';
import {
  MAX_ATTACHMENT_BYTES,
  deleteWorkspaceFolder,
  isAttachmentId,
  isWorkspaceId,
  readAttachment,
  readDataFile,
  removeUnusedAttachments,
  restoreWorkspaceFolder,
  workspaceFile,
  workspaceListFile,
  writeAttachment,
  writeCopy,
  writeDataFile,
} from '@taskite/node-files';

export interface ServerOptions {
  /** The tasks file the API reads and writes. */
  readonly file: string;
  /** The built web client (`apps/web/dist`); null serves the API only (dev, behind Vite). */
  readonly staticDir: string | null;
  /** When set, every /api request except /api/info needs `Authorization: Bearer <token>`. */
  readonly token: string | null;
  /** Shown by /api/info. */
  readonly version: string;
  /** Largest accepted body in bytes (default 10 MB). */
  readonly maxBytes?: number;
  /** Largest attached file in bytes (default MAX_ATTACHMENT_BYTES, 25 MB). */
  readonly maxFileBytes?: number;
  /** Extra `Host` names accepted when there is no token (`TASKITE_HOSTS`). */
  readonly allowedHosts?: readonly string[];
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Parse `TASKITE_HOSTS` (`nas.lan, tasks.example.com`) into lowercase host names. */
export function parseHosts(spec: string | undefined): string[] {
  return (spec ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/:\d+$/, ''))
    .filter(Boolean);
}

/** Is this `Host` header one we answer without a token? IP literals, localhost and the listed names. */
export function hostAllowed(hostHeader: string | undefined, allowed: readonly string[]): boolean {
  if (!hostHeader) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare) !== 0) return true;
  if (bare === 'localhost' || bare.endsWith('.localhost')) return true;
  return allowed.includes(bare);
}

/** Is this bind address reachable only from this machine? */
export function isLoopback(host: string): boolean {
  const bare = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (bare === 'localhost' || bare.endsWith('.localhost') || bare === '::1') return true;
  const v4 = bare.startsWith('::ffff:') ? bare.slice(7) : bare;
  return isIP(v4) === 4 && v4.startsWith('127.');
}

/** Why the server must not start, or null: a network bind without a token needs `TASKITE_NO_AUTH=1`. */
export function refuseWithoutToken(opts: {
  readonly host: string;
  readonly token: string | null;
  readonly noAuth: boolean;
}): string | null {
  if (opts.token !== null || opts.noAuth || isLoopback(opts.host)) return null;
  return [
    `Refusing to listen on ${opts.host} without TASKITE_TOKEN: anyone on the network could change your tasks.`,
    'Set TASKITE_TOKEN to a shared secret, or bind to 127.0.0.1 with TASKITE_HOST,',
    'or set TASKITE_NO_AUTH=1 if a reverse proxy in front of the server already authenticates.',
  ].join('\n');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  // The web build carries the same policy in a meta tag; only a header can say frame-ancestors.
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

const DEFAULT_MAX = 10 * 1024 * 1024;

export function createServer(opts: ServerOptions): http.Server {
  return http.createServer((req, res) => {
    handle(req, res, opts).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: e instanceof HttpError ? e.message : 'Server error' });
      else res.end();
    });
  });
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: ServerOptions,
): Promise<void> {
  if (opts.token === null && !hostAllowed(req.headers.host, opts.allowedHosts ?? []))
    throw new HttpError(421, 'Unknown host: add it to TASKITE_HOSTS or set TASKITE_TOKEN');
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    // /api/info stays public: it is how the client learns that a token is needed.
    const isInfo = req.method === 'GET' && url.pathname === '/api/info';
    if (!isInfo && !authorized(req, opts.token)) throw new HttpError(401, 'Unauthorized');
    if (req.method !== 'GET' && req.method !== 'HEAD' && crossSite(req))
      throw new HttpError(403, 'Cross-site request refused');
    return api(req, res, url, opts);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  if (!opts.staticDir) throw new HttpError(404, 'Not found');
  return serveStatic(res, opts.staticDir, url.pathname, req.method === 'HEAD');
}

/** `"abc"` or `W/"abc"` → `abc`. */
function etagValue(h: string | null): string | null {
  if (h === null) return null;
  const m = /^(?:W\/)?"([^"]*)"$/.exec(h.trim());
  return m ? (m[1] ?? null) : null;
}

/** The versions in an If-None-Match header (`"a", W/"b"`). */
function etagList(h: string | null): string[] {
  if (h === null) return [];
  return h.split(',').flatMap((part) => {
    const v = etagValue(part);
    return v === null ? [] : [v];
  });
}

/** The data file `?workspace=<id>` names (PRD §14.4); `main` when left out, 400 for an id that isn't one. */
function dataFileOf(url: URL, opts: ServerOptions): string {
  const id = url.searchParams.get('workspace') ?? 'main';
  if (!isWorkspaceId(id)) throw new HttpError(400, 'A workspace id is main or a UUID');
  return workspaceFile(opts.file, id);
}

/** `GET` of a versioned file, with `If-None-Match` answered by 304 (PRD §10). */
async function sendVersioned(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  file: string,
  missing: string,
) {
  const { text, version } = await readDataFile(file);
  if (text === null) throw new HttpError(404, missing);
  // The app reads every few seconds; an unchanged file costs a header, not the whole file (PRD §10).
  if (version && etagList(header(req, 'if-none-match')).includes(version)) {
    res.writeHead(304, { 'Cache-Control': 'no-store', ETag: `"${version}"`, ...SECURITY_HEADERS });
    return void res.end();
  }
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ETag: `"${version}"`,
    ...SECURITY_HEADERS,
  });
  res.end(text);
}

/** `PUT` of a versioned file: `If-Match`, or `If-None-Match: *` for a new one; 412 on a mismatch (PRD §10). */
async function putVersioned(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  file: string,
  opts: ServerOptions,
) {
  const text = await readJsonBody(req, opts.maxBytes ?? DEFAULT_MAX);
  const ifNoneMatch = header(req, 'if-none-match');
  const expected = ifNoneMatch?.trim() === '*' ? null : etagValue(header(req, 'if-match'));
  if (expected === null && ifNoneMatch?.trim() !== '*')
    throw new HttpError(428, 'Send If-Match with the version you read, or If-None-Match: * for a new file');
  const result = await writeDataFile(file, text, expected);
  if (!result.ok) {
    res.setHeader('ETag', result.version === null ? '' : `"${result.version}"`);
    throw new HttpError(412, 'The file changed since you read it');
  }
  res.writeHead(204, { ETag: `"${result.version}"`, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end();
}

/** `POST /api/workspaces/<id>/delete|restore?at=<epoch ms>`: moves a workspace's folder (PRD §14.3). */
async function moveWorkspace(
  res: http.ServerResponse,
  id: string,
  action: string,
  url: URL,
  opts: ServerOptions,
): Promise<void> {
  if (!isAttachmentId(id)) throw new HttpError(400, 'Only a workspace with a UUID id can be deleted');
  const at = Number(url.searchParams.get('at'));
  if (!Number.isSafeInteger(at) || at < 0) throw new HttpError(400, 'at must be a time in epoch ms');
  if (action === 'delete') await deleteWorkspaceFolder(opts.file, id, at);
  else await restoreWorkspaceFolder(opts.file, id, at);
  return send(res, 200, { id });
}

async function api(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  opts: ServerOptions,
): Promise<void> {
  const file = /^\/api\/attachments\/([^/]+)$/.exec(url.pathname)?.[1];
  if (file !== undefined && file !== 'clean') return attachment(req, res, file, dataFileOf(url, opts), opts);
  const move = /^\/api\/workspaces\/([^/]+)\/(delete|restore)$/.exec(url.pathname);
  if (move) {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    return moveWorkspace(res, decodeURIComponent(move[1] ?? ''), move[2] ?? '', url, opts);
  }
  switch (`${req.method} ${url.pathname}`) {
    case 'GET /api/info':
      return send(res, 200, { name: 'Taskite', version: opts.version, auth: opts.token !== null });
    case 'GET /api/workspaces':
      return sendVersioned(req, res, workspaceListFile(opts.file), 'No workspaces file yet');
    case 'PUT /api/workspaces':
      return putVersioned(req, res, workspaceListFile(opts.file), opts);
    case 'GET /api/data':
      return sendVersioned(req, res, dataFileOf(url, opts), 'No tasks file yet');
    case 'PUT /api/data':
      return putVersioned(req, res, dataFileOf(url, opts), opts);
    case 'POST /api/copies': {
      const label = url.searchParams.get('label');
      if (label !== 'copy' && label !== 'corrupt') throw new HttpError(400, 'label must be copy or corrupt');
      const text = (await readBody(req, opts.maxBytes ?? DEFAULT_MAX)).toString('utf8');
      const written = await writeCopy(dataFileOf(url, opts), text, label);
      return send(res, 201, { name: path.basename(written) });
    }
    case 'POST /api/attachments/clean':
      return send(res, 200, { removed: await removeUnusedAttachments(dataFileOf(url, opts)) });
    default:
      throw new HttpError(404, 'Not found');
  }
}

/** `PUT` and `GET /api/attachments/<id>`: an attached file, written once (PRD §4.8, §10). */
async function attachment(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string,
  dataFile: string,
  opts: ServerOptions,
): Promise<void> {
  if (!isAttachmentId(id)) throw new HttpError(400, 'An attachment id is a UUID');
  if (req.method === 'PUT') {
    const bytes = await readBody(req, opts.maxFileBytes ?? MAX_ATTACHMENT_BYTES);
    if ((await writeAttachment(dataFile, id, bytes)) === 'exists')
      throw new HttpError(409, 'That attachment already exists');
    return send(res, 201, { id });
  }
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
  const bytes = await readAttachment(dataFile, id);
  if (bytes === null) throw new HttpError(404, 'No such attachment');
  // Never shown as a page from this origin: the browser saves it, whatever it holds.
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': bytes.length,
    'Content-Disposition': 'attachment',
    'Cache-Control': 'private, max-age=31536000, immutable',
    ...SECURITY_HEADERS,
  });
  res.end(bytes);
}

async function readJsonBody(req: http.IncomingMessage, max: number): Promise<string> {
  const text = (await readBody(req, max)).toString('utf8');
  try {
    JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Body is not valid JSON');
  }
  return text;
}

async function serveStatic(
  res: http.ServerResponse,
  root: string,
  pathname: string,
  head: boolean,
): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Bad path');
  }
  const base = path.resolve(root);
  let file = path.resolve(base, decoded.replace(/^\/+/, '') || 'index.html');
  if (!file.startsWith(base + path.sep) && file !== base) throw new HttpError(403, 'Forbidden');
  let s = await stat(file).catch(() => null);
  if (!s || s.isDirectory()) {
    file = path.join(base, 'index.html');
    s = await stat(file).catch(() => null);
    if (!s) throw new HttpError(404, 'Web client not built — run `pnpm build`');
  }
  const hashed = path.relative(base, file).split(path.sep)[0] === 'assets';
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': s.size,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...SECURITY_HEADERS,
  });
  if (head) return void res.end();
  res.end(await readFile(file));
}

function authorized(req: http.IncomingMessage, token: string | null): boolean {
  if (token === null) return true;
  const got = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(got);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Did another site's page send this request? A form or `fetch` from any page can POST here without a CORS
 * preflight, so a request that changes data must come from our own page (`Sec-Fetch-Site`, else `Origin`).
 */
export function crossSite(req: http.IncomingMessage): boolean {
  const site = header(req, 'sec-fetch-site');
  if (site !== null) return site !== 'same-origin' && site !== 'none';
  const origin = header(req, 'origin');
  if (origin === null) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

function header(req: http.IncomingMessage, name: string): string | null {
  const v = req.headers[name];
  return typeof v === 'string' ? v : null;
}

function readBody(req: http.IncomingMessage, max: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? NaN);
  if (declared > max) {
    req.resume();
    return Promise.reject(new HttpError(413, 'Too large'));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (c: Buffer) => {
      if (over) return;
      size += c.length;
      if (size > max) {
        over = true;
        chunks.length = 0;
        reject(new HttpError(413, 'Too large'));
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!over) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
  });
  res.end(json);
}
