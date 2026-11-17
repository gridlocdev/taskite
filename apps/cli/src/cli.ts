/** The taskite command (PRD §11): reads tasks.json, makes one change through the engine, saves it. */
import { existsSync } from 'node:fs';
import {
  INBOX_ID,
  TaskList,
  addDraft,
  describeAutomations,
  emptyData,
  formatDue,
  parseDataFile,
  parseDueText,
  projectNameFromTag,
  resolveDraft,
  serialize,
  sidebarCounts,
  todayISO,
  viewContent,
  type Draft,
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
    if (!parsed.ok && parsed.reason === 'newer')
      throw new ProblemError(
        `${file} was saved by a newer Taskite (format ${parsed.version}); update taskite`,
      );
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

/** Which tasks a command can name: `done` looks among open tasks, `restore` in the Trash. */
type Scope = 'open' | 'completed' | 'live' | 'trash';

const inScope: Record<Scope, (t: Task) => boolean> = {
  open: (t) => t.deletedAt === null && !t.completed,
  completed: (t) => t.deletedAt === null && t.completed,
  live: (t) => t.deletedAt === null,
  trash: (t) => t.deletedAt !== null,
};

/**
 * The one task `ref` names (PRD §11), looking only among the tasks the command can act on: a title that
 * equals `ref` (ignoring case), else titles that contain it, else an id start of at least 4 characters
 * that only one task has. Short words like "bed" are valid hex, so ids come last. Several matches are
 * listed, never guessed between.
 */
function findTask(l: Loaded, ref: string, scope: Scope): Task {
  const { list, today } = l;
  const needle = ref.toLowerCase();
  const pool = list.data.tasks.filter(inScope[scope]);
  const byTitle = pool.filter((t) => t.title.toLowerCase().includes(needle));
  const exact = byTitle.filter((t) => t.title.toLowerCase() === needle);
  const matches = exact.length ? exact : byTitle;
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    const byId = needle.length >= 4 ? pool.filter((t) => t.id.startsWith(needle)) : [];
    if (byId.length === 1) return byId[0]!;
    if (byId.length > 1)
      throw new ProblemError(`${byId.length} tasks have ids starting with "${ref}"; give more of the id`);
    throw new ProblemError(`no task matches "${ref}"`);
  }
  const lines = matches.slice(0, 10).map((t) => `  ${taskLine(list, t, today)}`);
  if (matches.length > 10) lines.push(`  …and ${matches.length - 10} more`);
  throw new ProblemError(
    `${matches.length} tasks match "${ref}"; give more of the title, or the id:\n${lines.join('\n')}`,
  );
}

/** The task a command names: all its words (`done call mum`), or the first one when more follow. */
function taskRef(args: Args, rest: boolean): string {
  const words = rest ? args.words.slice(0, 1) : args.words;
  const ref = words.join(' ').trim();
  if (!ref) throw new UsageError(`give a task's title or id (from taskite list) to ${args.command}`);
  return ref;
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
    section: t.sectionId ? (list.getSection(t.projectId, t.sectionId)?.name ?? null) : null,
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

/** What section automations did in the last change, or null when none ran (PRD §6.1). */
function automated(list: TaskList): string | null {
  return describeAutomations(list, list.automated) || null;
}

/** The id of the section `name` (ignoring case) in the project a draft goes to. */
function sectionNamed(list: TaskList, draft: Draft, name: string): string {
  const project = draft.projectName
    ? list.findProjectByName(draft.projectName)
    : list.getProject(draft.projectId);
  const sections = project?.sections ?? [];
  const found = sections.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
  if (found) return found.id;
  const where = project ? `"${project.name}"` : `"${draft.projectName ?? ''}"`;
  throw new ProblemError(
    sections.length
      ? `${where} has no section "${name}"; its sections are ${sections.map((s) => `"${s.name}"`).join(', ')}`
      : `${where} has no sections`,
  );
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
      // A project's sections print as headings, each with its tasks under it.
      const text = content.sections
        .flatMap((s) => [
          ...(s.sectionId && s.heading ? [`\n## ${s.heading}`] : []),
          ...s.rows.map((r) => taskLine(list, r.task, today)),
        ])
        .join('\n')
        .trim();
      return out({ ok: true, tasks: tasks.map((t) => taskJson(list, t)) }, tasks.length ? text : 'No tasks.');
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
      if (args.section) draft.sectionId = sectionNamed(list, draft, args.section);
      const { task, createdProject } = addDraft(list, draft);
      if (!task) throw new UsageError('the task needs a name, not only a date, priority, #project or @label');
      const automation = automated(list);
      await save(l);
      const made = createdProject ? ` (made the project "${createdProject.name}")` : '';
      return out(
        { ok: true, task: taskJson(list, task), createdProject: createdProject?.name ?? null, automation },
        `${shortId(task.id)}${made}${automation ? `\nAutomation: ${automation}.` : ''}`,
      );
    }
    case 'done': {
      const t = findTask(l, taskRef(args, false), 'open');
      if (t.deletedAt !== null) throw new ProblemError(`"${t.title}" is in the Trash; restore it first`);
      if (t.completed) throw new ProblemError(`"${t.title}" is already done`);
      const [r] = list.completeTasks([t.id], today);
      const automation = automated(list);
      await save(l);
      const next = r?.repeated && r.nextDue ? r.nextDue : null;
      return out(
        { ok: true, task: taskJson(list, list.getTask(t.id)!), nextDue: next, automation },
        (next
          ? `"${t.title}" is next due ${formatDue(next, today).toLowerCase()}.`
          : `Completed "${t.title}".`) + (automation ? ` Automation: ${automation}.` : ''),
      );
    }
    case 'reopen': {
      const t = findTask(l, taskRef(args, false), 'completed');
      if (!t.completed) throw new ProblemError(`"${t.title}" isn't done`);
      list.reopenTasks([t.id]);
      await save(l);
      return out({ ok: true, task: taskJson(list, list.getTask(t.id)!) }, `Reopened "${t.title}".`);
    }
    case 'trash': {
      const t = findTask(l, taskRef(args, false), 'live');
      if (t.deletedAt !== null) throw new ProblemError(`"${t.title}" is already in the Trash`);
      list.deleteTasks([t.id]);
      await save(l);
      return out({ ok: true, task: taskJson(list, list.getTask(t.id)!) }, `Moved "${t.title}" to the Trash.`);
    }
    case 'restore': {
      const t = findTask(l, taskRef(args, false), 'trash');
      if (t.deletedAt === null) throw new ProblemError(`"${t.title}" isn't in the Trash`);
      list.restoreTasks([t.id]);
      await save(l);
      return out({ ok: true, task: taskJson(list, list.getTask(t.id)!) }, `Restored "${t.title}".`);
    }
    case 'move': {
      const t = findTask(l, taskRef(args, true), 'live');
      const name = args.words.slice(1).join(' ').trim().replace(/^#/, '');
      if (!name) throw new UsageError('give the project to move to, e.g. taskite move "Call mum" Family');
      // "#Home_Repairs" names "Home Repairs", as in Quick Add.
      const project = list.findProjectByName(name) ?? list.findProjectByName(projectNameFromTag(name));
      if (!project) throw new ProblemError(`no project is called "${name}" (see taskite projects)`);
      if (t.projectId === project.id && !t.parentId)
        throw new ProblemError(`"${t.title}" is already in ${project.name}`);
      // A subtask moved on its own leaves its parent, as in the app.
      list.updateTasks(
        t.id,
        t.parentId ? { projectId: project.id, parentId: null } : { projectId: project.id },
      );
      await save(l);
      return out(
        { ok: true, task: taskJson(list, list.getTask(t.id)!) },
        `Moved "${t.title}" to ${project.name}.`,
      );
    }
    case 'due': {
      const t = findTask(l, taskRef(args, true), 'live');
      const text = args.words.slice(1).join(' ');
      if (!text.trim()) throw new UsageError('give a date, e.g. taskite due "Call mum" fri, or none');
      const { due, ok } = parseDueText(text, today);
      if (!ok)
        throw new UsageError(`"${text}" isn't a date taskite knows (try tomorrow, fri, jan 5, 2026-12-01)`);
      list.updateTasks(t.id, { due });
      await save(l);
      return out(
        { ok: true, task: taskJson(list, list.getTask(t.id)!) },
        due ? `"${t.title}" is due ${formatDue(due, today).toLowerCase()}.` : `"${t.title}" has no due date.`,
      );
    }
    case 'help':
      return;
  }
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
