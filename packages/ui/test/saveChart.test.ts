import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SAVE_TRANSITIONS, step, toMermaid, type SaveEvent, type SaveState } from '../src/index.ts';
import { RANDOM_TIMEOUT, runRandomOps, type Op } from './support/randomOps.ts';

/** The chart's state, plus a model of the file and the user's typing around it. */
interface World {
  state: SaveState;
  /** Writes started and not yet answered. */
  writes: number;
  /** Writes that finished, so a read can tell one finished while it waited. */
  writesDone: number;
  /** Reads in progress, and how many writes had finished when each started. */
  reads: { valid: boolean; writesDone: number }[];
  /** Edits the file doesn't have yet. */
  unsaved: boolean;
  /** Edits made since the last write started. */
  editedSinceWrite: boolean;
  /** An edit that isn't in the recovery slot yet. */
  unkept: boolean;
  /** The conflict dialog is up and the user hasn't chosen. */
  asking: boolean;
}

function fire(w: World, event: SaveEvent): void {
  const from = w.state;
  const { to, effects } = step(from, event);
  const asking = (state: SaveState) => state === 'conflict' || state === 'choosing';
  if (asking(from) && !asking(to)) w.asking = false;
  w.state = to;
  for (const effect of effects) {
    switch (effect) {
      case 'snapshot':
        w.unkept = false;
        break;
      case 'writeFile':
        expect(w.writes, 'never two writes at once').toBe(0);
        expect(w.asking, 'no write while the conflict dialog waits for a choice').toBe(false);
        w.writes++;
        w.editedSinceWrite = false;
        break;
      case 'clearSnapshot':
        expect(w.unsaved, 'the recovery slot is emptied only when the file has it all').toBe(false);
        break;
      case 'readFile':
        w.reads.push({ valid: true, writesDone: w.writesDone });
        break;
      case 'dropRead':
        for (const r of w.reads) r.valid = false;
        break;
      case 'takeFile': {
        const read = w.reads.find((r) => r.valid);
        expect(read, 'a file is taken only from a read that is still wanted').toBeDefined();
        expect(w.unsaved || w.writes > 0, 'a refresh never replaces unsaved data').toBe(false);
        expect(read?.writesDone, 'a refresh never takes a read that a save finished during').toBe(
          w.writesDone,
        );
        break;
      }
      case 'showConflict':
        w.asking = true;
        break;
      case 'replaceWithFile':
        // The user chose to drop this window's changes.
        w.unsaved = false;
        w.editedSinceWrite = false;
        break;
    }
  }
}

const user = (event: SaveEvent): Op<World> => ({ name: event, run: (w) => fire(w, event) });

const ops: Op<World>[] = [
  {
    name: 'edit',
    weight: 3,
    run: (w) => {
      w.unsaved = true;
      w.editedSinceWrite = true;
      w.unkept = true;
      fire(w, 'edit');
      expect(w.unkept, 'every edit goes into the recovery slot at once').toBe(false);
    },
  },
  user('refresh'),
  user('retry'),
  user('choose'),
  {
    // The choice's read finishes: Keep Mine, Use Theirs, or a read that failed.
    name: 'choiceDone',
    when: (w) => w.state === 'choosing',
    run: (w, r) => {
      const event = r.pick(['keepMine', 'takeTheirs', 'chooseFailed'] as const);
      fire(w, event);
      return event;
    },
  },
  {
    name: 'saved',
    weight: 2,
    when: (w) => w.writes > 0,
    run: (w) => {
      w.writes--;
      w.writesDone++;
      w.unsaved = w.editedSinceWrite;
      fire(w, 'saved');
    },
  },
  {
    name: 'failed',
    when: (w) => w.writes > 0,
    run: (w) => {
      w.writes--;
      fire(w, 'failed');
    },
  },
  {
    name: 'versionChanged',
    when: (w) => w.writes > 0,
    run: (w) => {
      w.writes--;
      fire(w, 'versionChanged');
    },
  },
  {
    // A read finishes. The session ignores one it dropped; the others arrive as `refreshRead`.
    name: 'readDone',
    when: (w) => w.reads.length > 0,
    run: (w, r) => {
      const [read] = w.reads.splice(r.int(w.reads.length), 1);
      if (!read?.valid) return 'dropped';
      w.reads.push(read);
      fire(w, 'refreshRead');
      w.reads.splice(w.reads.indexOf(read), 1);
    },
  },
];

describe('the save chart', () => {
  it(
    'random events never write twice at once or during a conflict, keep every edit, and refresh only when saved',
    async () => {
      await runRandomOps<World>({
        steps: 200,
        setup: () => ({
          state: 'clean',
          writes: 0,
          writesDone: 0,
          reads: [],
          unsaved: false,
          editedSinceWrite: false,
          unkept: false,
          asking: false,
        }),
        ops,
        check: (w) => {
          if (w.state === 'clean' || w.state === 'refreshing')
            expect(w.unsaved, 'saved means the file has every edit').toBe(false);
          if (w.state === 'saving' || w.state === 'savingDirty')
            expect(w.writes, 'a write is running').toBe(1);
        },
      });
    },
    RANDOM_TIMEOUT,
  );

  it('lists each move once', () => {
    const keys = SAVE_TRANSITIONS.map((t) => `${t.from} ${t.on}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is drawn in docs/architecture.md', () => {
    const file = new URL('../../../docs/architecture.md', import.meta.url);
    const doc = readFileSync(file, 'utf8');
    const block = /```mermaid\n(stateDiagram-v2\n[\s\S]*?)\n```/;
    const drawn = block.exec(doc)?.[1];
    expect(drawn, 'docs/architecture.md needs a ```mermaid stateDiagram-v2 block').toBeDefined();
    // `just diagram` redraws it from the table.
    if (process.env.WRITE_DIAGRAM === '1' && drawn !== toMermaid())
      writeFileSync(
        file,
        doc.replace(block, () => '```mermaid\n' + toMermaid() + '\n```'),
      );
    else expect(drawn, 'the diagram is out of date: run `just diagram`').toBe(toMermaid());
  });
});
