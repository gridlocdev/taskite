---
name: taskite
description: >-
  Read and change someone's Taskite tasks from the terminal with the `taskite` command: list what is due today, upcoming, in the Inbox, in a project or with a label; add tasks with Quick Add text ("Call mum tomorrow p1 #Family @phone"); complete, reopen, trash and restore them, move them to a project or set their due date; attach files to them and find their attached files; list projects. Use it when a task involves their to-do list, Taskite, or "my tasks", or when a script needs to add or check tasks. Covers naming tasks by title or id, `--json` output, which file it uses, and the exit codes.
---

# Working with Taskite through `taskite`

`taskite` uses the same engine as the Taskite app and edits the same `tasks.json`, so a task added here looks exactly like one added in the app. Every change is saved at once, atomically, and only if the file hasn't changed since the command read it.

## Commands

| Command | Does |
| --- | --- |
| `taskite list [today\|upcoming\|inbox\|completed\|trash]` | Prints tasks. Default `today` (overdue and due today). |
| `taskite list --project <name>` / `--label <name>` | A project's or a label's open tasks; sections print as `## Name`. Names ignore case. |
| `taskite add <text...>` | Adds a task to the Inbox. Prints its short id. |
| `taskite add <text...> --section <name>` | Adds it into a section of its project (`#Work --section doing`). |
| `taskite done <task>` | Completes a task. A repeating task moves to its next date instead. |
| `taskite reopen <task>` | Marks a completed task not done. |
| `taskite trash <task>` / `taskite restore <task>` | Moves a task to the Trash, or back. |
| `taskite move <task> <project>` | Moves a task to a project (`#Name` or the name, ignoring case). |
| `taskite due <task> <date>` | Sets the due date (`tomorrow`, `fri`, `jan 5`); `none` clears it. |
| `taskite attach <task> <file...>` | Copies files (up to 25 MB each) into the `attachments` folder beside `tasks.json` and attaches them. A missing or too large file stops it before anything is attached. |
| `taskite attachments <task>` | A task's attachments: size, name and the path of the file to read. |
| `taskite projects` | Projects with their open task counts. |
| `taskite path` | The tasks file it uses. |

## Quick Add text

`add` reads the text like the app's add-task row: a date (`today`, `tomorrow`, `fri`, `next week`, `next month`, `in 3 days`, `mar 3`, `2026-04-01`), a repeat (`every day`, `every weekday`, `every week`, `every month`, `every year`, `every monday`), a priority (`p1` urgent to `p4` normal), `#Project` (made if it doesn't exist; `#Big-Plans` means "Big Plans") and `@labels`. What is left is the task's name. Quote the text if it has shell characters.

## Naming a task

A `<task>` is part of its title, ignoring case: `taskite done call mum`. `move`, `due` and `attach` take only the first word as the task, so quote a longer title there: `taskite due "call mum" fri`. A title that equals the words wins over titles that only contain them. When several tasks still match, taskite lists them with their short ids, exits 1 and changes nothing; run it again with more of the title or the id.

`list` prints each task's short id (the first 8 characters). Any start of an id that only one task has also works: `taskite done 9ac7`. Use ids from `list --json` when scripting, since titles can change.

## JSON

Add `--json` to any command. Successes print `{ "ok": true, ... }` with `tasks`, `task` or `projects`, and `attach` and `attachments` add `attachments` (`id`, `name`, `size`, `type`, `path`); each task has `id`, `shortId`, `title`, `project`, `parentId`, `labels`, `priority`, `due` (`YYYY-MM-DD` or null), `recurrence`, `completed` and `deleted`. Failures print `{ "ok": false, "error": "..." }` and still exit non-zero.

## Which file

`--file <path>`, else `$TASKITE_FILE`, else the desktop app's file (macOS `~/Library/Application Support/Taskite/tasks.json`, Windows `%APPDATA%\Taskite\tasks.json`, Linux `~/.config/Taskite/tasks.json`). Use `--file` with a copy when trying things out.

## Exit codes

`0` done. `1` a problem: no task or several tasks match, the file changed during the run (run it again), a file that isn't valid JSON (it is left alone), or a desktop app that hasn't brought over the old Tasks app's file yet. `2` a command-line mistake. Errors print one line, `taskite: <message>`, to stderr.
