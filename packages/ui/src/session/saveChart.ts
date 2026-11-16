/**
 * The rules for saving one open file, as a table (PRD §3.2–§3.5). `TaskSession` keeps the state and runs the
 * effects; every decision about what happens next is here. `docs/architecture.md` draws this table, and a
 * test checks the drawing matches.
 */

export type SaveState =
  /** Everything is saved, and nothing is being read. */
  | 'clean'
  /** Everything is saved; reading the file to look for a change made somewhere else. */
  | 'refreshing'
  /** Writing the file; nothing changed since the write started. */
  | 'saving'
  /** Writing the file; something changed since, so another write follows. */
  | 'savingDirty'
  /** A write failed three times; waiting for an edit or "Try again". */
  | 'failed'
  /** The file changed somewhere else; nothing is written until the user picks a conflict choice. */
  | 'conflict'
  /** The user picked a conflict choice and it is reading the file; another choice waits for this one. */
  | 'choosing';

export type SaveEvent =
  | 'edit'
  | 'refresh'
  | 'refreshRead'
  | 'saved'
  | 'failed'
  | 'versionChanged'
  | 'retry'
  | 'choose'
  | 'chooseFailed'
  | 'keepMine'
  | 'takeTheirs';

export type Effect =
  /** Keep the current data in the recovery slot, so a crash can't lose it (PRD §3.5). */
  | 'snapshot'
  /** Write the current data to the file. */
  | 'writeFile'
  /** Empty the recovery slot: the file has everything. */
  | 'clearSnapshot'
  /** Read the file to look for an outside change (PRD §3.4). */
  | 'readFile'
  /** Ignore the read in progress: the data here changed after it started. */
  | 'dropRead'
  /** Take the file just read, as one undo step. */
  | 'takeFile'
  /** Count what differs and ask the user (Use Theirs, Keep Mine, Save Mine as a Copy). */
  | 'showConflict'
  /** Replace the data here with the file's, with no undo. */
  | 'replaceWithFile';

export interface Transition {
  readonly from: SaveState;
  readonly on: SaveEvent;
  readonly to: SaveState;
  readonly effects: readonly Effect[];
}

/** Every allowed move. An event with no row for the state it arrives in changes nothing. */
export const SAVE_TRANSITIONS: readonly Transition[] = [
  { from: 'clean', on: 'edit', to: 'saving', effects: ['snapshot', 'writeFile'] },
  { from: 'clean', on: 'refresh', to: 'refreshing', effects: ['readFile'] },
  { from: 'refreshing', on: 'edit', to: 'saving', effects: ['snapshot', 'dropRead', 'writeFile'] },
  { from: 'refreshing', on: 'refreshRead', to: 'clean', effects: ['takeFile'] },
  { from: 'saving', on: 'edit', to: 'savingDirty', effects: ['snapshot'] },
  { from: 'saving', on: 'saved', to: 'clean', effects: ['clearSnapshot'] },
  { from: 'saving', on: 'failed', to: 'failed', effects: [] },
  { from: 'saving', on: 'versionChanged', to: 'conflict', effects: ['showConflict'] },
  { from: 'savingDirty', on: 'edit', to: 'savingDirty', effects: ['snapshot'] },
  { from: 'savingDirty', on: 'saved', to: 'saving', effects: ['writeFile'] },
  { from: 'savingDirty', on: 'failed', to: 'failed', effects: [] },
  { from: 'savingDirty', on: 'versionChanged', to: 'conflict', effects: ['showConflict'] },
  { from: 'failed', on: 'edit', to: 'saving', effects: ['snapshot', 'writeFile'] },
  { from: 'failed', on: 'retry', to: 'saving', effects: ['writeFile'] },
  { from: 'conflict', on: 'edit', to: 'conflict', effects: ['snapshot'] },
  { from: 'conflict', on: 'choose', to: 'choosing', effects: [] },
  { from: 'choosing', on: 'edit', to: 'choosing', effects: ['snapshot'] },
  { from: 'choosing', on: 'chooseFailed', to: 'conflict', effects: [] },
  { from: 'choosing', on: 'keepMine', to: 'saving', effects: ['writeFile'] },
  { from: 'choosing', on: 'takeTheirs', to: 'clean', effects: ['replaceWithFile', 'clearSnapshot'] },
];

const NONE: readonly Effect[] = [];

/** Where `event` takes `state`, and what to do on the way. */
export function step(state: SaveState, event: SaveEvent): { to: SaveState; effects: readonly Effect[] } {
  const row = SAVE_TRANSITIONS.find((t) => t.from === state && t.on === event);
  return row ? { to: row.to, effects: row.effects } : { to: state, effects: NONE };
}

/** The table as a Mermaid state diagram, for `docs/architecture.md`. */
export function toMermaid(): string {
  const lines = ['stateDiagram-v2', '  [*] --> clean'];
  for (const t of SAVE_TRANSITIONS) {
    const effects = t.effects.length ? ` / ${t.effects.join(', ')}` : '';
    lines.push(`  ${t.from} --> ${t.to} : ${t.on}${effects}`);
  }
  return lines.join('\n');
}
