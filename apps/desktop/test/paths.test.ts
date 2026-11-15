import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appFile, dataPaths, isAppUrl } from '../src/paths.ts';

describe('dataPaths', () => {
  const appData = '/Users/me/Library/Application Support';

  it('reads the old Tasks app file only in the real setup', () => {
    expect(dataPaths({}, appData)).toEqual({ userData: null, legacyFile: `${appData}/Tasks/tasks.json` });
    expect(dataPaths({ TASKITE_USER_DATA: '/tmp/check' }, appData)).toEqual({
      userData: '/tmp/check',
      legacyFile: null,
    });
  });

  it('lets a check name an old file on purpose', () => {
    const env = { TASKITE_USER_DATA: '/tmp/check', TASKITE_LEGACY_FILE: '/tmp/old/tasks.json' };
    expect(dataPaths(env, appData).legacyFile).toBe('/tmp/old/tasks.json');
  });
});

describe('app:// files', () => {
  const root = path.resolve('/app/web');

  it('serves only inside the web build', () => {
    expect(appFile(root, '/')).toBe(path.join(root, 'index.html'));
    expect(appFile(root, '/assets/index.js')).toBe(path.join(root, 'assets/index.js'));
    expect(appFile(root, '/../main.js')).toBeNull();
    expect(appFile(root, '/%2e%2e/main.js')).toBeNull();
    expect(appFile(root, '/%E0%A4%A')).toBeNull();
  });

  it('trusts only our own page', () => {
    expect(isAppUrl('app://taskite/index.html')).toBe(true);
    expect(isAppUrl('app://taskite.evil/index.html')).toBe(false);
    expect(isAppUrl('https://example.com/')).toBe(false);
    expect(isAppUrl(undefined)).toBe(false);
  });
});
