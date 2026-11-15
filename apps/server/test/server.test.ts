import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, hostAllowed, isLoopback, refuseWithoutToken } from '../src/index.ts';

let dir: string;
let base: string;
let close: () => Promise<void>;

async function start(token: string | null = null) {
  const server = createServer({
    file: path.join(dir, 'tasks.json'),
    staticDir: null,
    token,
    version: '9.9.9',
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((r) => server.close(() => r()));
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'taskite-server-'));
});
afterEach(async () => {
  await close();
  await rm(dir, { recursive: true, force: true });
});

describe('the data API', () => {
  it('creates, reads and updates the file with versions', async () => {
    await start();
    expect((await fetch(`${base}/api/data`)).status).toBe(404);
    const created = await fetch(`${base}/api/data`, {
      method: 'PUT',
      headers: { 'If-None-Match': '*' },
      body: '{"a":1}',
    });
    expect(created.status).toBe(204);
    const etag = created.headers.get('etag') ?? '';
    const got = await fetch(`${base}/api/data`);
    expect([got.status, got.headers.get('etag'), await got.text()]).toEqual([200, etag, '{"a":1}']);

    const again = await fetch(`${base}/api/data`, {
      method: 'PUT',
      headers: { 'If-None-Match': '*' },
      body: '{"a":2}',
    });
    expect(again.status).toBe(412);
    const ok = await fetch(`${base}/api/data`, {
      method: 'PUT',
      headers: { 'If-Match': etag },
      body: '{"a":2}',
    });
    expect(ok.status).toBe(204);
    expect(await readFile(path.join(dir, 'tasks.json'), 'utf8')).toBe('{"a":2}');
    const stale = await fetch(`${base}/api/data`, {
      method: 'PUT',
      headers: { 'If-Match': etag },
      body: '{}',
    });
    expect(stale.status).toBe(412);
  });

  it('answers a read of an unchanged file with 304 and no body', async () => {
    await start();
    const created = await fetch(`${base}/api/data`, {
      method: 'PUT',
      headers: { 'If-None-Match': '*' },
      body: '{"a":1}',
    });
    const etag = created.headers.get('etag') ?? '';
    const same = await fetch(`${base}/api/data`, { headers: { 'If-None-Match': etag } });
    expect([same.status, same.headers.get('etag'), await same.text()]).toEqual([304, etag, '']);
    const other = await fetch(`${base}/api/data`, { headers: { 'If-None-Match': '"something-else"' } });
    expect([other.status, await other.text()]).toEqual([200, '{"a":1}']);
  });

  it('sends a Content-Security-Policy that forbids framing', async () => {
    await start();
    const csp = (await fetch(`${base}/api/info`)).headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('refuses bodies that are not JSON, and saves without a version', async () => {
    await start();
    const bad = await fetch(`${base}/api/data`, {
      method: 'PUT',
      headers: { 'If-None-Match': '*' },
      body: '{',
    });
    expect(bad.status).toBe(400);
    expect((await fetch(`${base}/api/data`, { method: 'PUT', body: '{}' })).status).toBe(428);
  });

  it('writes dated copies', async () => {
    await start();
    const res = await fetch(`${base}/api/copies?label=copy`, { method: 'POST', body: 'mine' });
    expect(res.status).toBe(201);
    const { name } = (await res.json()) as { name: string };
    expect(name).toMatch(/^tasks\.copy-\d{4}-\d\d-\d\d-\d{6}\.json$/);
    expect(await readdir(dir)).toEqual([name]);
  });

  it('needs the token for everything but /api/info', async () => {
    await start('s3cret');
    expect(await (await fetch(`${base}/api/info`)).json()).toEqual({
      name: 'Taskite',
      version: '9.9.9',
      auth: true,
    });
    expect((await fetch(`${base}/api/data`)).status).toBe(401);
    expect((await fetch(`${base}/api/data`, { headers: { Authorization: 'Bearer s3cret' } })).status).toBe(
      404,
    );
  });

  it('refuses cross-site writes', async () => {
    await start();
    const res = await fetch(`${base}/api/data`, {
      method: 'PUT',
      headers: { 'If-None-Match': '*', 'Sec-Fetch-Site': 'cross-site' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });
});

describe('who the server answers', () => {
  it('knows loopback addresses and allowed hosts', () => {
    expect(['127.0.0.1', '::1', 'localhost', '[::1]'].every(isLoopback)).toBe(true);
    expect(isLoopback('0.0.0.0')).toBe(false);
    expect(hostAllowed('nas.lan:8788', ['nas.lan'])).toBe(true);
    expect(hostAllowed('evil.example', [])).toBe(false);
    expect(hostAllowed('192.168.1.5:8788', [])).toBe(true);
  });

  it('will not listen on the network without a token unless told to', () => {
    expect(refuseWithoutToken({ host: '0.0.0.0', token: null, noAuth: false })).toMatch(/TASKITE_TOKEN/);
    expect(refuseWithoutToken({ host: '0.0.0.0', token: null, noAuth: true })).toBeNull();
    expect(refuseWithoutToken({ host: '127.0.0.1', token: null, noAuth: false })).toBeNull();
  });
});
