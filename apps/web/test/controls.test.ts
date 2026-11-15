// Keeps docs/controls.md in step with the command catalog.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatSequence } from '@taskite/ui';
import { makeApp } from './helpers.ts';

const doc = readFileSync(new URL('../../../docs/controls.md', import.meta.url), 'utf8');

/** Each table row: its label, and every **bold** key in the macOS and Windows/Linux columns. */
function rows(): { label: string; mac: string[]; other: string[] }[] {
  const bold = (cell: string) => [...cell.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1] ?? '');
  return doc
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|\s*-/.test(line))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells.length >= 3)
    .map(([label = '', mac = '', other = '']) => ({ label, mac: bold(mac), other: bold(other) }));
}

/** Keys in the doc that aren't catalog shortcuts on purpose (mouse clicks, keys inside the composer). */
const NOT_COMMANDS = new Set(['⌘-click', 'Ctrl-click', 'Shift-click']);

describe('docs/controls.md', () => {
  for (const mac of [true, false]) {
    const column = mac ? 'mac' : 'other';
    const name = mac ? 'macOS' : 'Windows/Linux';

    it(`lists every shortcut (${name})`, async () => {
      const { catalog } = await makeApp();
      const documented = new Set(rows().flatMap((r) => r[column]));
      const missing = catalog.all
        .flatMap((c) => c.sequences.map((seq) => ({ id: c.id, keys: formatSequence(seq, mac) })))
        .filter(({ keys }) => keys.some((k) => !documented.has(k)))
        .map(({ id, keys }) => `${id} ${keys.join(' ')}`);
      expect(missing).toEqual([]);
    });

    it(`lists no ⌘/Ctrl shortcut the catalog doesn't have (${name})`, async () => {
      const { catalog } = await makeApp();
      const known = new Set(
        catalog.all.flatMap((c) => c.sequences.flatMap((seq) => formatSequence(seq, mac))),
      );
      const looksLikeChord = mac ? /[⌘⌃⌥]/ : /^(Ctrl|Alt)\+/;
      const stale = rows()
        .flatMap((r) => r[column].map((key) => ({ key, label: r.label })))
        .filter(({ key }) => looksLikeChord.test(key) && !known.has(key) && !NOT_COMMANDS.has(key))
        .map(({ key, label }) => `${label}: ${key}`);
      expect(stale).toEqual([]);
    });
  }
});
