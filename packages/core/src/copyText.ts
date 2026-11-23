/**
 * Copy (PRD §4.9): chosen tasks as a Markdown task list. Each line is the task as Quick Add would read it (title,
 * due date, repeat, priority, `#Project`, `@labels`), so it reads well in a note or a chat and pastes back into
 * Taskite's add row. Notes follow indented under their task, and a task's subtasks come along with it.
 */
import { INBOX_ID } from './model.ts';
import type { Task } from './model.ts';
import type { TaskList } from './taskList.ts';

const EVERY: Record<NonNullable<Task['recurrence']>, string> = {
  daily: 'every day',
  weekdays: 'every weekday',
  weekly: 'every week',
  monthly: 'every month',
  yearly: 'every year',
};

/** `#Name` for Quick Add: spaces become `-`, which Quick Add reads back as spaces. */
function projectTag(name: string): string {
  return `#${name.trim().replace(/\s+/g, '-')}`;
}

/** One task's line, without the list marker: the title, then what Quick Add would read from it. */
export function quickAddLine(list: TaskList, t: Task): string {
  const parts = [t.title.trim()];
  if (t.due) parts.push(t.due);
  if (t.recurrence) parts.push(EVERY[t.recurrence]);
  if (t.priority !== 4) parts.push(`p${t.priority}`);
  const project = t.projectId === INBOX_ID ? undefined : list.getProject(t.projectId);
  if (project && !t.parentId) parts.push(projectTag(project.name));
  for (const label of t.labels) parts.push(`@${label}`);
  return parts.join(' ');
}

function item(list: TaskList, t: Task, indent: string): string[] {
  const lines = [`${indent}- [${t.completed ? 'x' : ' '}] ${quickAddLine(list, t)}`];
  for (const line of t.description.trim().split('\n'))
    if (line.trim()) lines.push(`${indent}  ${line.trimEnd()}`);
  return lines;
}

/**
 * The tasks with `ids`, in that order, as Markdown. A chosen task brings its subtasks (as they move with it);
 * a subtask chosen without its parent is listed on its own. Trashed subtasks stay behind.
 */
export function tasksAsText(list: TaskList, ids: readonly string[]): string {
  const chosen = new Set(ids);
  const lines: string[] = [];
  for (const id of ids) {
    const t = list.getTask(id);
    if (!t || (t.parentId && chosen.has(t.parentId))) continue;
    lines.push(...item(list, t, ''));
    if (t.parentId) continue;
    for (const sub of list.getSubtasks(t.id))
      if (sub.deletedAt === null) lines.push(...item(list, sub, '  '));
  }
  return lines.join('\n');
}
