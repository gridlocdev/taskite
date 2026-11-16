// The feature map: docs/features.md lists every feature the way a user names it, and each one has scenarios.
// Each "## " heading in docs/features.md is a feature; a scenario file covers it with test.describe('<the heading>', …).
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url);
const doc = readFileSync(new URL('docs/features.md', ROOT), 'utf8');
const features = [...doc.matchAll(/^## (.+)$/gm)].map((match) => (match[1] ?? '').trim());

const specs = readdirSync(new URL('e2e/', ROOT))
  .filter((file) => file.endsWith('.spec.ts'))
  .map((file) => readFileSync(new URL(`e2e/${file}`, ROOT), 'utf8'))
  .join('\n');
const described = [...specs.matchAll(/test\.describe\(\s*(['"`])(.+?)\1/g)].map((match) => match[2] ?? '');

/** Sections that aren't checked by a scenario, each with the reason (only by hand, not a feature). Keep it short. */
const NOT_SCENARIOS = new Map<string, string>([]);

describe('docs/features.md', () => {
  it('has a scenario for every feature', () => {
    const missing = features.filter((feature) => !NOT_SCENARIOS.has(feature) && !described.includes(feature));
    expect(missing).toEqual([]);
  });

  it('names a real feature in every scenario group', () => {
    const unknown = described.filter((name) => !features.includes(name));
    expect(unknown).toEqual([]);
  });

  it('lists no exemption for a feature that is gone', () => {
    expect([...NOT_SCENARIOS.keys()].filter((feature) => !features.includes(feature))).toEqual([]);
  });
});
