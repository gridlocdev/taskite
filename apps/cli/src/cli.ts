/** The taskite command (PRD §11): reads tasks.json, makes one change through the engine, saves it. */
import { existsSync } from 'node:fs';
import {
  INBOX_ID,
  TaskList,
  addDraft,
  emptyData,
  formatDue,
  parseDataFile,
  resolveDraft,
  serialize,
  sidebarCounts,
  todayISO,
  viewContent,
  type Task,
  type View,
} from '@taskite/core';
import { readDataFile, writeDataFile } from '@taskite/node-files';
import { HELP, LIST_VIEWS, ProblemError, UsageError, parseArgs, type Args } from './args.ts';
import { chooseFile, legacyFile, type CliIo } from './io.ts';

export const EXIT_OK = 0;
export const EXIT_PROBLEM = 1;
export const EXIT_USAGE = 2;

/** The short id `list` prints. */
export const shortId = (id: string): string => id.slice(0, 8);

interface Loaded {
  readonly list: TaskList;
  readonly file: string;
  readonly version: string | null;
  readonly today: string;
}

async function load(args: Args, io: CliIo): Promise<Loaded> {
  const { file, isDefault } = chooseFile(args.file, io);
  const read = await readDataFile(file);
  // Making the desktop file now would hide the old app's tasks from the desktop app's one-time import.
  if (read.text === null && isDefault && existsSync(legacyFile(io)))
    throw new ProblemError(
      'open the Taskite app once first, so it can bring over your tasks from the old Tasks app',
    );
  let data = emptyData();
  if (read.text !== null) {
    const parsed = parseDataFile(read.text, io.now());
    if (!parsed.ok)
      throw new ProblemError(
        `${file} isn't valid JSON; open it in Taskite, which keeps a copy and starts over`,
      );
    data = parsed.data;
  }
  const list = new TaskList(data, { now: () => io.now() });
  return { list, file, version: read.version, today: todayISO(new Date(io.now())) };
}

async function save(l: Loaded): Promise<void> {
  const r = await writeDataFile(l.file, serialize(l.list.data), l.version);
  if (!r.ok)
    throw new ProblemError('the tasks file changed while this ran; nothing was saved, so run it again');
}

/** The one task whose id starts with `prefix` (PRD §11). */
function findTask(list: TaskList, prefix: string | undefined): Task {
  if (!prefix) throw new UsageError('give the id of a task (from taskite list)');
  const matches = list.data.tasks.filter((t) => t.id.startsWith(prefix));
  if (matches.length === 0) throw new ProblemError(`no task has an id starting with "${prefix}"`);
  if (matches.length > 1)
    throw new ProblemError(`${matches.length} tasks have ids starting with "${prefix}"; give more of the id`);
  return matches[0]!;
}

function listView(args: Args, list: TaskList): View {
  if (args.project) {
    const p = list.findProjectByName(args.project);
    if (!p) throw new ProblemError(`no project is called "${args.project}"`);
    return { type: 'project', id: p.id };
  }
  if (args.label) {
    const name = args.label.replace(/^@/, '');
    const found = list.getLabels().find((l) => l.toLowerCase() === name.toLowerCase());
    if (!found) throw new ProblemError(`no task has the label "${name}"`);
    return { type: 'label', name: found };
  }
  const [word = 'today', ...extra] = args.words;
  if (extra.length) throw new UsageError('list takes one view');
  if (!(LIST_VIEWS as readonly string[]).includes(word))
    throw new UsageError(`list shows ${LIST_VIEWS.join(', ')}; not "${word}"`);
  if (word === 'inbox') return { type: 'project', id: INBOX_ID };
  return { type: word } as View;
}

function taskJson(list: TaskList, t: Task) {
  return {
    id: t.id,
    shortId: shortId(t.id),
    title: t.title,
    project: list.getProject(t.projectId)?.name ?? null,
    parentId: t.parentId,
    labels: t.labels,
    priority: t.priority,
    due: t.due,
    recurrence: t.recurrence,
    completed: t.completed,
    deleted: t.deletedAt !== null,
  };
}

function taskLine(list: TaskList, t: Task, today: string): string {
  const due = t.due ? formatDue(t.due, today) : '';
  const project = list.getProject(t.projectId)?.name ?? '';
  const labels = t.labels.map((l) => ` @${l}`).join('');
  return `${shortId(t.id)}  ${due.padEnd(10)}  p${t.priority}  ${t.title}${labels}  (${project})`;
}

type Out = (value: unknown, text: string) => void;

async function run(args: Args, io: CliIo, out: Out): Promise<void> {
  if (args.command === 'path') {
    const { file } = chooseFile(args.file, io);
    return out({ ok: true, path: file }, file);
  }
  const l = await load(args, io);
  const { list, today } = l;
  switch (args.command) {
    case 'list': {
      const view = listView(args, list);
      const content = viewContent(list, view, today);
      const tasks = content.sections.flatMap((s) => s.rows.map((r) => r.task));
      return out(
        { ok: true, tasks: tasks.map((t) => taskJson(list, t)) },
        tasks.length ? tasks.map((t) => taskLine(list, t, today)).join('\n') : 'No tasks.',
      );
    }
    case 'projects': {
      const counts = sidebarCounts(list, today).projects;
      const rows = list.data.projects.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        open: counts.get(p.id) ?? 0,
      }));
      return out(
        { ok: true, projects: rows },
        rows.map((r) => `${String(r.open).padStart(4)}  ${r.name}`).join('\n'),
      );
    }
    case 'add': {
      const text = args.words.join(' ').trim();
      if (!text) throw new UsageError('give the task, e.g. taskite add "Call mum tomorrow p1"');
      const draft = resolveDraft(text, { type: 'project', id: INBOX_ID }, 'end', today);
      const { task, createdProject } = addDraft(list, draft);
      if (!task) throw new UsageError('the task needs a name, not only a date, priority, #project or @label');
      await save(l);
      const made = createdProject ? ` (made the project "${createdProject.name}")` : '';
      return out(
        { ok: true, task: taskJson(list, task), createdProject: createdProject?.name ?? null },
        `${shortId(task.id)}${made}`,
      );
    }
    case 'done': {
      const t = findTask(list, one(args));
      if (t.deletedAt !== null) throw new ProblemError(`"${t.title}" is in the Trash; restore it first`);
      if (t.completed) throw new ProblemError(`"${t.title}" is already done`);
      const [r] = list.completeTasks([t.id], today);
      await save(l);
      const next = r?.repeated && r.nextDue ? r.nextDue : null;
      return out(
        { ok: true, task: taskJson(list, list.getTask(t.id)!), nextDue: next },
        next
          ? `"${t.title}" is next due ${formatDue(next, today).toLowerCase()}.`
          : `Completed "${t.title}".`,
      );
    }
    case 'reopen': {
      const t = findTask(list, one(args));
      if (!t.completed) throw new ProblemError(`"${t.title}" isn't done`);
      list.reopenTasks([t.id]);
      await save(l);
      return out({ ok: true, task: taskJson(list, list.getTask(t.id)!) }, `Reopened "${t.title}".`);
    }
    case 'trash': {
      const t = findTask(list, one(args));
      if (t.deletedAt !== null) throw new ProblemError(`"${t.title}" is already in the Trash`);
      list.deleteTasks([t.id]);
      await save(l);
      return out({ ok: true, task: taskJson(list, list.getTask(t.id)!) }, `Moved "${t.title}" to the Trash.`);
    }
    case 'restore': {
      const t = findTask(list, one(args));
      if (t.deletedAt === null) throw new ProblemError(`"${t.title}" isn't in the Trash`);
      list.restoreTasks([t.id]);
      await save(l);
      return out({ ok: true, task: taskJson(list, list.getTask(t.id)!) }, `Restored "${t.title}".`);
    }
    case 'help':
      return;
  }
}

function one(args: Args): string | undefined {
  if (args.words.length > 1) throw new UsageError(`${args.command} takes one id`);
  return args.words[0];
}

/** Runs one command line; returns the exit code. A bug (not the user's mistake) is rethrown. */
export async function runCli(argv: readonly string[], io: CliIo, version: string): Promise<number> {
  let args: Args | null = null;
  try {
    args = parseArgs(argv);
    if (args.version) {
      io.stdout(`${version}\n`);
      return EXIT_OK;
    }
    if (args.help) {
      io.stdout(HELP);
      return EXIT_OK;
    }
    const json = args.json;
    await run(args, io, (value, text) =>
      io.stdout(json ? JSON.stringify(value, null, 2) + '\n' : `${text}\n`),
    );
    return EXIT_OK;
  } catch (e) {
    if (!(e instanceof UsageError || e instanceof ProblemError)) throw e;
    io.stderr(`taskite: ${e.message}\n`);
    if (args?.json ?? argv.includes('--json'))
      io.stdout(JSON.stringify({ ok: false, error: e.message }) + '\n');
    return e instanceof UsageError ? EXIT_USAGE : EXIT_PROBLEM;
  }
}
