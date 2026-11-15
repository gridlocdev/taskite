---
name: taskite
description: >-
  Read and change someone's Taskite tasks from the terminal with the `taskite` command: list what is
  due today, upcoming, in the Inbox, in a project or with a label; add tasks with Quick Add text
  ("Call mum tomorrow p1 #Family @phone"); complete, reopen, trash and restore them; list projects.
  Use it when a task involves their to-do list, Taskite, or "my tasks", or when a script needs to add
  or check tasks. Covers ids, `--json` output, which file it uses, and the exit codes.
---

# Working with Taskite through `taskite`

`taskite` uses the same engine as the Taskite app and edits the same `tasks.json`, so a task added here
looks exactly like one added in the app. Every change is saved at once, atomically, and only if the file
hasn't changed since the command read it.

## Commands

| Command                                                   | Does                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `taskite list [today\|upcoming\|inbox\|completed\|trash]` | Prints tasks. Default `today` (overdue and due today).             |
| `taskite list --project <name>` / `--label <name>`        | A project's or a label's open tasks. Names ignore case.            |
| `taskite add <text...>`                                   | Adds a task to the Inbox. Prints its short id.                     |
| `taskite done <id>`                                       | Completes a task. A repeating task moves to its next date instead. |
| `taskite reopen <id>`                                     | Marks a completed task not done.                                   |
| `taskite trash <id>` / `taskite restore <id>`             | Moves a task to the Trash, or back.                                |
| `taskite projects`                                        | Projects with their open task counts.                              |
| `taskite path`                                            | The tasks file it uses.                                            |

## Quick Add text

`add` reads the text like the app's add-task row: a date (`today`, `tomorrow`, `fri`, `next week`,
`in 3 days`, `mar 3`, `2026-04-01`), a repeat (`every day`, `every weekday`, `every week`, `every month`, `every year`, `every monday`),
a priority (`p1` urgent to `p4` normal), `#Project` (made if it doesn't exist; `#Big-Plans` means
"Big Plans") and `@labels`. What is left is the task's name. Quote the text if it has shell characters.

## Ids

`list` prints each task's short id (the first 8 characters). Any start of an id that only one task has
works: `taskite done 9ac7`. Take ids from `list --json` when scripting.

## JSON

Add `--json` to any command. Successes print `{ "ok": true, ... }` with `tasks`, `task` or `projects`;
each task has `id`, `shortId`, `title`, `project`, `parentId`, `labels`, `priority`, `due`
(`YYYY-MM-DD` or null), `recurrence`, `completed` and `deleted`. Failures print
`{ "ok": false, "error": "..." }` and still exit non-zero.

## Which file

`--file <path>`, else `$TASKITE_FILE`, else the desktop app's file (macOS
`~/Library/Application Support/Taskite/tasks.json`, Windows `%APPDATA%\Taskite\tasks.json`, Linux
`~/.config/Taskite/tasks.json`). Use `--file` with a copy when trying things out.

## Exit codes

`0` done. `1` a problem: unknown or ambiguous id, the file changed during the run (run it again), a file
that isn't valid JSON (it is left alone), or a desktop app that hasn't brought over the old Tasks app's
file yet. `2` a command-line mistake. Errors print one line, `taskite: <message>`, to stderr.
