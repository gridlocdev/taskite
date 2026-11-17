// Seeded random-operation runs for engine and save-session tests.
// Copy to test/support/randomOps.ts in each package that uses it (a package's tests stay inside the package). Name every test that uses it "random …" so `just fuzz` finds it.
//
//   FUZZ_RUNS=<n>       how many seeds to try (default 20: quick enough for `just check`)
//   FUZZ_SEED=<n>       run just this seed (paste it from a failure to reproduce it); its failure prints every step
//   FUZZ_SEED_BASE=<n>  first seed of the run (`just soak` starts from the clock; default 1, so `just check` is repeatable)
//
// A failure throws with the seed and the last 30 steps (all of them under FUZZ_SEED). Pin a found seed as a plain test so it stays fixed.

export interface Random {
  /** Integer in [0, max). */
  int(max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Text that breaks naive code: empty, spaces, Unicode, emoji, right-to-left, tabs, CRLF, a byte-order mark. */
  text(maxLength?: number): string;
}

export interface Op<S> {
  name: string;
  /** Relative frequency (default 1). */
  weight?: number;
  /** Skip this op in the current state (for example nothing to restore). */
  when?(state: S): boolean;
  /** Do it; return a short description of what was chosen, for the failure log. */
  run(state: S, random: Random): void | string | Promise<void | string>;
}

export interface RandomRun<S> {
  setup(random: Random): S | Promise<S>;
  ops: readonly Op<S>[];
  /** The invariants: throw (or use expect) when one doesn't hold. Runs after every step. */
  check(state: S): void | Promise<void>;
  steps?: number;
  /** Checks that only make sense once, after the last step (for example: undoing every step gives back the start). */
  finish?(state: S): void | Promise<void>;
  /** Cleans up after each seed. An error here never hides the seed's own failure. */
  teardown?(state: S): void | Promise<void>;
}

const PIECES = [
  '',
  ' ',
  'a',
  'Z',
  '0',
  '-',
  '#',
  '[ ]',
  '\t',
  '\n',
  '\r\n',
  'é',
  'ß',
  '漢字',
  '👩‍👩‍👧',
  'שלום',
  '​',
  '﻿',
];

export function createRandom(seed: number): Random {
  let state = seed >>> 0 || 1;
  const next = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const random: Random = {
    int: (max) => Math.floor(next() * max),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('pick from an empty list');
      return items[random.int(items.length)] as (typeof items)[number];
    },
    text: (maxLength = 12) => {
      let out = '';
      const count = random.int(maxLength + 1);
      for (let i = 0; i < count; i++) out += random.pick(PIECES);
      return out;
    },
  };
  return random;
}

function seeds(): number[] {
  const one = process.env.FUZZ_SEED;
  if (one) return [Number(one)];
  const runs = Number(process.env.FUZZ_RUNS ?? 20);
  const base = Number(process.env.FUZZ_SEED_BASE ?? 1);
  return Array.from({ length: runs }, (_, i) => base + i);
}

function choose<S>(ops: readonly Op<S>[], state: S, random: Random): Op<S> | undefined {
  const ready = ops.filter((op) => op.when?.(state) ?? true);
  const total = ready.reduce((sum, op) => sum + (op.weight ?? 1), 0);
  let roll = random.int(total * 1000) / 1000;
  for (const op of ready) {
    roll -= op.weight ?? 1;
    if (roll < 0) return op;
  }
  return ready.at(-1);
}

/** Run random operation sequences for each seed, checking the invariants after every step. */
export async function runRandomOps<S>(run: RandomRun<S>): Promise<void> {
  for (const seed of seeds()) {
    const random = createRandom(seed);
    const state = await run.setup(random);
    const log: string[] = [];
    try {
      await run.check(state);
      for (let step = 0; step < (run.steps ?? 50); step++) {
        const op = choose(run.ops, state, random);
        if (!op) break;
        // Logged before it runs, so an op that throws is the last line.
        log.push(`${step}: ${op.name}`);
        const detail = await op.run(state, random);
        if (detail) log[log.length - 1] += ` ${detail}`;
        await run.check(state);
      }
      log.push('finish');
      await run.finish?.(state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `FUZZ_SEED=${seed} failed after:\n${(process.env.FUZZ_SEED ? log : log.slice(-30)).join('\n')}\n\n${message}`,
        { cause: error },
      );
    } finally {
      try {
        await run.teardown?.(state);
      } catch (error) {
        // Thrown from here, it would replace the failure above and lose the seed.
        console.error(`FUZZ_SEED=${seed} teardown failed:`, error);
      }
    }
  }
}

/**
 * The test's own timeout. Vitest's 5-second default fails 20 seeds in a loaded `just check`, but a timeout given
 * to the test beats `--testTimeout=0`, so with FUZZ_RUNS or FUZZ_SEED set (`just fuzz`, `just soak`, a replay)
 * there is none.
 */
export const RANDOM_TIMEOUT = process.env.FUZZ_RUNS || process.env.FUZZ_SEED ? 0 : 60_000;
