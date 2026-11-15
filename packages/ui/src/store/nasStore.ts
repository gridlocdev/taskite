import type { CopyLabel } from '@taskite/core';
import { ConflictError, type StoredFile, type TaskStore } from './taskStore.ts';

/** The server wants a token we don't have, or the one we sent is wrong. */
export class AuthError extends Error {
  constructor() {
    super('The server needs a token.');
    this.name = 'AuthError';
  }
}

export interface NasInfo {
  readonly name: string;
  readonly version: string;
  readonly auth: boolean;
}

/** Keeps the token; `localStorage` in the browser. */
export interface TokenStorage {
  get(): string | null;
  set(token: string | null): void;
}

export function localTokenStorage(key = 'taskite.token'): TokenStorage {
  return {
    get: () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set: (token) => {
      try {
        if (token === null) localStorage.removeItem(key);
        else localStorage.setItem(key, token);
      } catch {
        // Storage blocked: the token lasts until the tab closes.
      }
    },
  };
}

/** Talks to the Taskite NAS server's /api (PRD §10). `base` is '' for the page's own server. */
export class NasClient {
  readonly base: string;
  readonly tokens: TokenStorage;

  /** How long a request may take before it counts as failed, so a hung server can't stall saving. */
  readonly timeoutMs: number;

  constructor(base: string, tokens: TokenStorage, timeoutMs = 20_000) {
    this.base = base.replace(/\/+$/, '');
    this.tokens = tokens;
    this.timeoutMs = timeoutMs;
  }

  /** Is this page served by a Taskite server? Null when not (a plain static host, or no answer in 5 s). */
  async info(): Promise<NasInfo | null> {
    try {
      const res = await fetch(`${this.base}/api/info`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const body = (await res.json()) as Partial<NasInfo>;
      return body.name === 'Taskite' ? (body as NasInfo) : null;
    } catch {
      return null;
    }
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const token = this.tokens.get();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      signal: init.signal ?? AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 401) throw new AuthError();
    return res;
  }
}

async function failure(res: Response): Promise<Error> {
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // not JSON
  }
  return new Error(`The server said: ${message}`);
}

function unquote(etag: string | null): string | null {
  if (etag === null) return null;
  const m = /^(?:W\/)?"([^"]*)"$/.exec(etag);
  return m ? (m[1] ?? null) : etag;
}

/** tasks.json on the NAS (PRD §10). */
export class NasStore implements TaskStore {
  readonly kind = 'nas';
  readonly client: NasClient;
  /** The text of the last version read or written, so a read of an unchanged file needs no download. */
  #last: { readonly text: string; readonly version: string } | null = null;

  constructor(client: NasClient) {
    this.client = client;
  }

  async load(): Promise<StoredFile> {
    const last = this.#last;
    const headers: Record<string, string> = last ? { 'If-None-Match': `"${last.version}"` } : {};
    const res = await this.client.request('/api/data', { headers });
    if (res.status === 304 && last) return { ...last };
    if (res.status === 404) {
      this.#last = null;
      return { text: null, version: null };
    }
    if (!res.ok) throw await failure(res);
    const text = await res.text();
    const version = unquote(res.headers.get('ETag'));
    this.#last = version ? { text, version } : null;
    return { text, version };
  }

  async save(text: string, expected: string | null): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (expected === null) headers['If-None-Match'] = '*';
    else headers['If-Match'] = `"${expected}"`;
    const res = await this.client.request('/api/data', { method: 'PUT', headers, body: text });
    if (res.status === 412) throw new ConflictError();
    if (!res.ok) throw await failure(res);
    const version = unquote(res.headers.get('ETag'));
    if (!version) throw new Error('The server sent no version.');
    this.#last = { text, version };
    return version;
  }

  async saveCopy(text: string, label: CopyLabel): Promise<string> {
    const res = await this.client.request(`/api/copies?label=${label}`, { method: 'POST', body: text });
    if (!res.ok) throw await failure(res);
    return ((await res.json()) as { name: string }).name;
  }

  location(): string {
    return `tasks.json on ${this.client.base || 'this server'}`;
  }
}
