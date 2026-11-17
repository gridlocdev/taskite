/**
 * Random runs of every edit the app and the CLI make, checked after each step: the task rules hold, the data
 * saves and reloads unchanged, and undoing every step gives back where the run started (settings aside).
 * `just fuzz` runs more seeds; a failure prints FUZZ_SEED=<n> to replay it.
 */
import { describe, expect, it } from 'vitest';
import {
  INBOX_ID,
  PROJECT_COLOR_NAMES,
  RECURRENCES,
  TaskList,
  emptyData,
  parseDataFile,
  serialize,
  todayISO,
  type AppData,
  type AutomationAction,
  type Priority,
  type SectionAutomation,
  type Task,
  type TaskPatch,
  attachmentIds,
} from '../src/index.ts';
import { checkInvariants } from './support/invariants.ts';
import { RANDOM_TIMEOUT, runRandomOps, type Op, type Random } from './support/randomOps.ts';

const DAY = 86_400_000;
const START = new Date(2026, 0, 1, 9).getTime();
const DATES = [null, '2026-01-01', '2026-01-31', '2026-02-28', '2026-03-31', '2026-12-31'];
const LABELS = ['work', 'Work', 'home', 'été', '漢字', 'a-b', 'שלום'];
const PRIORITIES: readonly Priority[] = [1, 2, 3, 4];

interface State {
  list: TaskList;
  clock: number;
  /** Where Undo can go back to: the start, or the last reload or outside change. Settings aside. */
  start: AppData;
  /** Counts tasks made by outside changes, so their ids never repeat. */
  outside: number;
  /** Attachment ids handed out so far. */
  files: number;
}

const copy = (data: AppData): AppData => JSON.parse(serialize(data)) as AppData;
/** Runs a purge and checks that every live task is still there. */
function keepsLiveTasks(s: State, purge: () => unknown): void {
  const live = s.list.liveTasks().map((t) => t.id);
  purge();
  for (const id of live) expect(s.list.getTask(id), 'a live task survives a purge').toBeDefined();
}
const withoutSettings = ({ settings: _settings, ...rest }: AppData) => rest;
const today = (s: State) => todayISO(new Date(s.clock));
const live = (s: State) => s.list.liveTasks();
const top = (s: State) => live(s).filter((t) => !t.parentId);
const trashed = (s: State) => s.list.trashedTasks();
const projects = (s: State) => s.list.data.projects;
const sectioned = (s: State) => projects(s).filter((p) => p.sections?.length);

/** One to three distinct tasks from the list, as the app's multi-select would pass them. */
function some(random: Random, tasks: readonly Task[]): string[] {
  const ids = new Set<string>();
  const n = 1 + random.int(3);
  for (let i = 0; i < n; i++) ids.add(random.pick(tasks).id);
  return [...ids];
}

function randomPatch(s: State, random: Random): TaskPatch {
  switch (random.int(7)) {
    case 0:
      return { title: random.text() };
    case 1:
      return { description: random.text(40) };
    case 2:
      return { priority: random.pick(PRIORITIES) };
    case 3:
      return { due: random.pick(DATES) };
    case 4:
      return { recurrence: random.chance(0.3) ? null : random.pick(RECURRENCES), due: random.pick(DATES) };
    case 5:
      return { labels: LABELS.filter(() => random.chance(0.3)) };
    default: {
      const project = random.pick(projects(s));
      const section = project.sections?.length && random.chance(0.6) ? random.pick(project.sections) : null;
      return section ? { projectId: project.id, sectionId: section.id } : { projectId: project.id };
    }
  }
}

/** Rules as the editor could save them, with now and then one it would refuse (no action, a bad value). */
function randomRules(s: State, random: Random): SectionAutomation[] {
  const action = (): AutomationAction => {
    switch (random.int(7)) {
      case 0:
        return { complete: random.chance(0.5) };
      case 1:
        return { due: random.pick(['today', 'tomorrow', 'nextWeek', '+3', null] as const) };
      case 2:
        return { priority: random.pick(PRIORITIES) };
      case 3:
        return { addLabel: random.pick(LABELS) };
      case 4:
        return { removeLabel: random.chance(0.8) ? random.pick(LABELS) : ' ' };
      default: {
        const project = random.pick(projects(s));
        const section = project.sections?.length && random.chance(0.7) ? random.pick(project.sections) : null;
        return { moveTo: { projectId: project.id, sectionId: section?.id ?? null } };
      }
    }
  };
  return Array.from({ length: random.int(4) }, () => ({
    on: random.chance(0.5) ? ('enter' as const) : ('complete' as const),
    do: Array.from({ length: random.int(4) }, action),
  }));
}

/** A project name as the app's dialog accepts it: never blank (it refuses those before the engine). */
function projectName(random: Random): string {
  const name = random.text();
  return name.trim() ? name : `P${name}`;
}

const ops: Op<State>[] = [
  {
    name: 'addProject',
    run: (s, r) => `"${s.list.addProject(projectName(r), r.pick(PROJECT_COLOR_NAMES)).name}"`,
  },
  {
    name: 'updateProject',
    when: (s) => projects(s).length > 1,
    run: (s, r) => {
      const p = r.pick(projects(s).filter((p) => p.id !== INBOX_ID));
      s.list.updateProject(
        p.id,
        r.chance(0.5) ? { name: projectName(r).trim() } : { color: r.pick(PROJECT_COLOR_NAMES) },
      );
      return p.id;
    },
  },
  {
    name: 'deleteProject',
    weight: 0.3,
    when: (s) => projects(s).length > 1,
    run: (s, r) => {
      const p = r.pick(projects(s).filter((p) => p.id !== INBOX_ID));
      s.list.deleteProject(p.id, s.clock);
      return p.id;
    },
  },
  {
    name: 'addSection',
    run: (s, r) => {
      const p = r.pick(projects(s));
      const after = p.sections?.length && r.chance(0.5) ? r.pick(p.sections).id : undefined;
      return `${p.id} ${s.list.addSection(p.id, r.text(), after)?.id ?? '(empty name)'}`;
    },
  },
  {
    name: 'renameSection',
    when: (s) => sectioned(s).length > 0,
    run: (s, r) => {
      const p = r.pick(sectioned(s));
      const section = r.pick(p.sections ?? []);
      s.list.renameSection(p.id, section.id, r.text());
      return section.id;
    },
  },
  {
    name: 'moveSection',
    when: (s) => sectioned(s).length > 0,
    run: (s, r) => {
      const p = r.pick(sectioned(s));
      const section = r.pick(p.sections ?? []);
      s.list.moveSection(p.id, section.id, r.chance(0.5) ? -1 : 1);
      return section.id;
    },
  },
  {
    name: 'deleteSection',
    weight: 0.3,
    when: (s) => sectioned(s).length > 0,
    run: (s, r) => {
      const p = r.pick(sectioned(s));
      const section = r.pick(p.sections ?? []);
      s.list.deleteSection(p.id, section.id, s.clock);
      return section.id;
    },
  },
  {
    name: 'setSectionAutomations',
    weight: 2,
    when: (s) => sectioned(s).length > 0,
    run: (s, r) => {
      const p = r.pick(sectioned(s));
      const section = r.pick(p.sections ?? []);
      s.list.setSectionAutomations(p.id, section.id, randomRules(s, r));
      return section.id;
    },
  },
  {
    name: 'applyEnterRules',
    weight: 0.3,
    when: (s) => sectioned(s).length > 0,
    run: (s, r) => {
      const p = r.pick(sectioned(s));
      const section = r.pick(p.sections ?? []);
      s.list.applyEnterRules(p.id, section.id);
      return section.id;
    },
  },
  {
    name: 'setProjectView',
    weight: 0.3,
    run: (s, r) => {
      const p = r.pick(projects(s));
      s.list.setProjectView(p.id, r.chance(0.5) ? 'board' : 'list');
      return p.id;
    },
  },
  {
    name: 'addTask',
    weight: 4,
    run: (s, r) => {
      const p = r.pick(projects(s));
      const task = s.list.addTask({
        title: r.text(),
        description: r.chance(0.3) ? r.text(40) : '',
        projectId: p.id,
        sectionId: p.sections?.length && r.chance(0.5) ? r.pick(p.sections).id : undefined,
        labels: LABELS.filter(() => r.chance(0.2)),
        priority: r.pick(PRIORITIES),
        due: r.pick(DATES),
        recurrence: r.chance(0.2) ? r.pick(RECURRENCES) : null,
      });
      return task.id;
    },
  },
  {
    name: 'addSubtask',
    weight: 2,
    when: (s) => top(s).length > 0,
    run: (s, r) => {
      const parent = r.pick(top(s));
      return `${s.list.addTask({ title: r.text(), parentId: parent.id }).id} under ${parent.id}`;
    },
  },
  {
    name: 'updateTasks',
    weight: 4,
    when: (s) => live(s).length > 0,
    run: (s, r) => {
      const ids = some(r, live(s));
      const patch = randomPatch(s, r);
      s.list.updateTasks(ids, patch);
      return `${ids.join(',')} ${JSON.stringify(patch)}`;
    },
  },
  {
    // A subtask moved on its own leaves its parent (PRD §6), as the app's Move to and the CLI do it.
    name: 'moveSubtaskOut',
    when: (s) => live(s).some((t) => t.parentId),
    run: (s, r) => {
      const sub = r.pick(live(s).filter((t) => t.parentId));
      s.list.updateTasks(sub.id, { projectId: r.pick(projects(s)).id, parentId: null });
      return sub.id;
    },
  },
  {
    name: 'completeTasks',
    weight: 2,
    when: (s) => live(s).some((t) => !t.completed),
    run: (s, r) => {
      const ids = some(
        r,
        live(s).filter((t) => !t.completed),
      );
      s.list.completeTasks(ids, today(s));
      return ids.join(',');
    },
  },
  {
    name: 'reopenTasks',
    when: (s) => live(s).some((t) => t.completed),
    run: (s, r) => {
      const ids = some(
        r,
        live(s).filter((t) => t.completed),
      );
      s.list.reopenTasks(ids);
      return ids.join(',');
    },
  },
  {
    name: 'deleteTasks',
    weight: 2,
    when: (s) => live(s).length > 0,
    run: (s, r) => {
      const ids = some(r, live(s));
      s.list.deleteTasks(ids, s.clock);
      return ids.join(',');
    },
  },
  {
    name: 'restoreTasks',
    weight: 2,
    when: (s) => trashed(s).length > 0,
    run: (s, r) => {
      const ids = some(r, s.list.trashList().length ? s.list.trashList() : trashed(s));
      s.list.restoreTasks(ids);
      return ids.join(',');
    },
  },
  {
    name: 'purgeTasks',
    when: (s) => trashed(s).length > 0,
    run: (s, r) => {
      const ids = some(r, trashed(s));
      s.list.purgeTasks(ids);
      return ids.join(',');
    },
  },
  {
    name: 'addAttachments',
    when: (s) => s.list.data.tasks.length > 0,
    run: (s, r) => {
      // Mostly new ids, sometimes one already used or one that isn't a UUID: the engine leaves those out.
      const used = [...attachmentIds(s.list.data)];
      const id = () => {
        if (used.length && r.chance(0.2)) return r.pick(used);
        if (r.chance(0.1)) return r.text();
        return `00000000-0000-4000-8000-${String(++s.files).padStart(12, '0')}`;
      };
      const task = r.pick(s.list.data.tasks);
      const files = Array.from({ length: 1 + r.int(2) }, () => ({
        id: id(),
        name: r.text(),
        size: r.int(5000),
        type: '',
      }));
      const added = s.list.addAttachments(task.id, files).map((a) => a.id);
      return `${task.id} ${added.join(',') || '(none)'}`;
    },
  },
  {
    name: 'removeAttachment',
    when: (s) => s.list.data.tasks.some((t) => t.attachments),
    run: (s, r) => {
      const task = r.pick(s.list.data.tasks.filter((t) => t.attachments));
      const id = r.pick(task.attachments ?? []).id;
      s.list.removeAttachment(task.id, id);
      return `${task.id} ${id}`;
    },
  },
  { name: 'emptyTrash', weight: 0.3, run: (s) => keepsLiveTasks(s, () => s.list.emptyTrash()) },
  { name: 'clearCompleted', weight: 0.3, run: (s) => s.list.clearCompleted() },
  {
    name: 'reorderTasks',
    when: (s) => top(s).length > 1,
    run: (s, r) => {
      const p = r.pick(projects(s));
      const ids = s.list
        .liveTasks()
        .filter((t) => t.projectId === p.id)
        .map((t) => t.id)
        .sort(() => (r.chance(0.5) ? -1 : 1));
      s.list.reorderTasks(ids);
      return p.id;
    },
  },
  {
    name: 'editLabel',
    when: (s) => s.list.getLabels().length > 0,
    run: (s, r) => {
      const label = r.pick(s.list.getLabels());
      const name = r.chance(0.5) ? r.pick(LABELS) : r.text();
      s.list.editLabel(label, name, r.chance(0.5) ? r.pick(PROJECT_COLOR_NAMES) : null);
      return `${label} -> "${name}"`;
    },
  },
  {
    name: 'deleteLabel',
    weight: 0.3,
    when: (s) => s.list.getLabels().length > 0,
    run: (s, r) => {
      const label = r.pick(s.list.getLabels());
      s.list.deleteLabel(label);
      return label;
    },
  },
  {
    name: 'batch',
    when: (s) => live(s).length > 0,
    run: (s, r) =>
      s.list.batch(() => {
        const ids = some(r, live(s));
        s.list.updateTasks(ids, randomPatch(s, r));
        s.list.completeTasks(ids, today(s));
        return ids.join(',');
      }),
  },
  { name: 'undo', weight: 2, run: (s) => s.list.undo() },
  { name: 'redo', run: (s) => s.list.redo() },
  {
    name: 'settings',
    weight: 0.5,
    run: (s, r) => {
      if (r.chance(0.5)) s.list.updateSettings({ theme: r.pick(['auto', 'light', 'dark'] as const) });
      else
        s.list.rememberView(
          r.chance(0.5) ? { type: 'today' } : { type: 'project', id: r.pick(projects(s)).id },
        );
    },
  },
  {
    name: 'nextDay',
    run: (s, r) => {
      s.clock += DAY * (1 + r.int(40));
      // Tasks gone for good are gone from every undo step, the start included.
      const start = new TaskList(s.start, { now: () => s.clock });
      start.purgeExpired(s.clock);
      s.start = copy(start.data);
      keepsLiveTasks(s, () => s.list.purgeExpired(s.clock));
    },
  },
  {
    // Another window or the CLI changed the file: Undo goes back to what this window showed, no further.
    name: 'takeOutside',
    weight: 0.3,
    run: (s, r) => {
      const other = new TaskList(copy(s.list.data), {
        now: () => s.clock,
        newId: () => `outside${++s.outside}`,
      });
      other.addTask({ title: r.text() });
      s.start = copy(s.list.data);
      s.list.takeOutside(copy(other.data));
    },
  },
  {
    name: 'reload',
    weight: 0.2,
    run: (s) => {
      const parsed = parseDataFile(serialize(s.list.data), s.clock);
      if (!parsed.ok) throw new Error(`the saved file doesn't load: ${parsed.reason}`);
      s.list.replace(parsed.data);
      s.start = copy(s.list.data);
    },
  },
  {
    name: 'undoEverything',
    weight: 0.3,
    run: (s) => {
      const before = copy(s.list.data);
      let undone = 0;
      while (s.list.canUndo) {
        s.list.undo();
        undone++;
      }
      expect(withoutSettings(copy(s.list.data)), 'undoing every step gives back the start').toEqual(
        withoutSettings(s.start),
      );
      for (let i = 0; i < undone; i++) s.list.redo();
      expect(withoutSettings(copy(s.list.data)), 'redoing every step comes back').toEqual(
        withoutSettings(before),
      );
      return `${undone} steps`;
    },
  },
];

describe('the engine', () => {
  it(
    'random edits keep the task rules, save and reload unchanged, and undo back to the start',
    async () => {
      let n = 0;
      await runRandomOps<State>({
        steps: 80,
        setup: () => {
          const state: State = {
            list: null as unknown as TaskList,
            clock: START,
            start: emptyData(),
            outside: 0,
            files: 0,
          };
          state.list = new TaskList(emptyData(), { now: () => state.clock, newId: () => `id${++n}` });
          state.start = copy(state.list.data);
          return state;
        },
        ops,
        check: (s) => {
          checkInvariants(s.list.data);
          const parsed = parseDataFile(serialize(s.list.data), s.clock);
          expect(parsed.ok && parsed.data, 'the saved file loads back the same').toEqual(copy(s.list.data));
        },
      });
    },
    RANDOM_TIMEOUT,
  );
});
