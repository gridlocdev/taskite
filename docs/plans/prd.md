# Taskite — product requirements

Taskite is a to-do list for one person. It runs as a desktop app (Electron), in the browser, from a self-hosted NAS server, and as a `taskite` command line, all on the same engine and the same data file. Code cites this document as `PRD §n`.

## §1 Goals

1. Capture a task in one line of text, with its date, priority, project and labels typed inline.
2. See what's due today and in the next week at a glance.
3. Do everything from the keyboard, and everything from the mouse.
4. Never lose a task: every change is saved at once, deletes go to a Trash, every change can be undone.

## §2 Non-goals for 2.0

- Accounts, sharing or sync between people. The NAS server serves one person's file.
- Reminders and notifications. Times of day (dates only).
- Update checks (the repo is private, so GitHub Releases can't be read without a token).
- Importing from other apps.

## §3 Data

### §3.1 The data file

All data is one JSON file, `tasks.json`, written pretty-printed (two-space indent) and UTF-8:

```json
{ "version": 1, "projects": [...], "tasks": [...], "settings": {...} }
```

- **Project**: `id`, `name`, `color` (one of `gray red orange yellow green teal blue purple magenta pink`). The Inbox has id `inbox`, is always present and is listed first.
- **Task**: `id` (UUID), `title`, `description`, `projectId`, `parentId` (null, or the id of its parent; subtasks are one level deep), `labels` (strings), `priority` (1 urgent … 4 normal), `due` (`YYYY-MM-DD` or null), `recurrence` (`daily`, `weekdays`, `weekly`, `monthly`, `yearly` or null), `completed`, `completedAt` (epoch ms or null), `createdAt` (epoch ms), `order` (position within its project), `deletedAt` (epoch ms or null).
- **Settings**: `theme` (`auto`, `light`, `dark`), `lastView` (§5.1, or null).

### §3.2 Reading

- Missing or wrong fields are filled with defaults (`normalize`), so older or hand-edited files load. A task whose project doesn't exist goes to the Inbox. A missing Inbox is added.
- A file that isn't valid JSON is copied to `tasks.corrupt-<epoch ms>.json` next to it (never deleted), then replaced with an empty file, and the app starts empty with a notice naming the copy.
- Desktop only: if there is no `tasks.json` but the old app's file exists (`<appData>/Tasks/tasks.json`, from when the app was called "Tasks"), it is read instead. The old file is left alone. The first save writes Taskite's own file.
- Tasks in the Trash for more than 30 days are removed for good when the file is loaded.

### §3.3 Saving

- Every change is saved immediately. Saves never overlap: a change during a save is saved right after it.
- Saves are atomic: write a temp file, flush it, rename it over `tasks.json`.
- A failed save is retried twice (after 300 ms and 600 ms). If it still fails, the status bar shows "Couldn't save your tasks." with **Try again** until a save works, then "Saved." Until then the unsaved data is also kept in the browser's storage (§3.5).
- Settings changes are saved but are not undo steps.

### §3.4 Versions and conflicts

- Every read returns a version: the SHA-256 of the file's bytes (hex). Every save sends the version it last read or wrote. If the file on disk has a different version, the save fails with a conflict instead of writing.
- On a conflict the app shows a dialog, "Your tasks changed somewhere else", which says how many tasks differ and offers three choices:
  - **Save Mine as a Copy** (default, the one that loses nothing): write this window's data to `tasks.copy-<YYYY-MM-DD-HHmmss>.json` next to the file, then load the file on disk.
  - **Keep Mine**: overwrite the file with this window's data.
  - **Use Theirs**: load the file on disk; this window's unsaved changes are lost.
- Nothing merges, and nothing overwrites without the user choosing it.
- The browser store has no other writers, so it never conflicts, but runs the same code.

### §3.5 Recovery

- Before each save, the data being saved is written to `localStorage` under `taskite.unsaved`; a successful save removes it.
- On start, if `taskite.unsaved` exists and differs from the loaded file, a dialog offers **Restore** (default; saves it over the file) or **Discard**.

### §3.6 Where the file lives

| Runs as | File |
|---|---|
| Desktop | `<userData>/tasks.json` (macOS `~/Library/Application Support/Taskite/`, Windows `%APPDATA%\Taskite\`, Linux `~/.config/Taskite/`) |
| Browser | `tasks.json` in the origin's private file system (OPFS) |
| NAS | `$TASKITE_DATA/tasks.json` on the server (§10) |
| CLI | `--file`, else `$TASKITE_FILE`, else the desktop location (§11) |

## §4 Tasks

### §4.1 Adding (Quick Add)

- An **Add task** row ends every list that can take new tasks (Inbox, projects, Today, labels, each day in Upcoming). Clicking it, or **New Task** (`Q`, `N`, ⌘N), turns it into a composer shaped like a task row.
- **Enter** adds the task and leaves an empty composer below it. Enter on an empty composer, **Esc**, or clicking away from an empty composer closes it. Text left in a closed composer is kept for next time.
- Text that parses to no title (only shortcuts) isn't added; the text stays.
- While typing, the row previews the parsed date, labels and project, and the circle takes the priority colour. A project that doesn't exist yet shows as "Name (new)".
- New tasks take defaults from where they're added: the viewed project (else the Inbox); due today in Today; that day in an Upcoming day; the viewed label in a label view.
- From Search, New Task returns to the view before the search; from Completed or Trash, it goes to the Inbox.
- A new task goes to the end of its project's order. The new row slides in (no motion with reduced motion).

### §4.2 Quick Add syntax

| Text | Meaning |
|---|---|
| `today`, `tomorrow`, `next week` (next Monday), `in N days/weeks/months`, a weekday (`friday`, `on friday`, `next friday`: the next one after today), `Dec 25`, `25 Dec`, `Dec 25th`, `2026-11-01` | due date. Month-day dates take this year, or next year if already past; an impossible date (`feb 31`) is ignored |
| `every day`, `every weekday`, `every week`, `every month`, `every year`, `every monday` | repeat; due defaults to today (the next weekday for `every weekday` on a weekend; the next such day for `every <weekday>`, or today if it is that day). An explicit date wins |
| `p1` … `p4` | priority |
| `#Name` | project, matched ignoring case, spaces, `-` and `_`; created if missing (with `-`/`_` turned into spaces, next colour in turn, notice "Created new project …") |
| `@name` | label; several allowed; duplicates (ignoring case) dropped |

Everything else, with spaces collapsed, is the title.

### §4.3 Completing

- Clicking the circle, or **Complete** (Space) on the chosen tasks, completes them. If every chosen task is already done, it reopens them.
- A repeating task with a due date isn't completed: its due date moves to the next occurrence after today (stepping from the current due date), with the notice `Nice! "<title>" is next due <when>.`
- Completing a task completes its open subtasks. Reopening a subtask reopens its parent.
- Completed rows show done for 350 ms, then leave the list (except in Completed and Search). Notice: "Task completed." / "N tasks completed.", with Undo.

### §4.4 Editing

- Clicking a task (not in the Trash) or **Edit…** (Enter, one task chosen) opens the task editor: name (required), description, due date, repeat, priority, project (not for subtasks), labels (comma-separated; a leading `@` is dropped, spaces become `-`, duplicates ignoring case dropped), and subtasks.
- Saving a repeating task with no date sets the date to today.
- Subtasks: a list with check circles and delete buttons, plus an input that takes Quick Add text (Enter adds). Subtasks can't have subtasks and always live in their parent's project.
- **Set Due Date…** (D) opens a small dialog: type a date in Quick Add words; the preview shows "Due friday (2026-11-20)", "No due date", or "Not a date I understand yet." Buttons: Today, Tomorrow, Next week, No date. Clearing the date of a repeating task stops it repeating.
- **Priority 1–4** (`1`–`4`) set priority on the chosen tasks.
- **Move to Project…** (M) opens the command menu filtered to "Move to "; only top-level tasks move (subtasks follow their parent).

### §4.5 Order and drag and drop

- In the Inbox and projects, top-level tasks can be dragged up and down to reorder.
- **Move Up** / **Move Down** (⌥↑ / ⌥↓, Alt+Up / Alt+Down elsewhere) move the chosen tasks one place, in the Inbox and projects only. A task moves with its subtasks. Chosen subtasks of one parent move among their siblings; a subtask chosen with other tasks moves its parent. Tasks already at the top or bottom stay; the rest keep their order. One undo step.
- A task dropped on a sidebar project or the Inbox moves there; on Today becomes due today; on Trash goes to the Trash; on a label gets that label.

### §4.6 Trash

- **Move to Trash** (Backspace, Delete) moves the chosen tasks and their subtasks to the Trash, with Undo. Rows slide out.
- The Trash lists top-level trashed tasks and subtasks whose parent isn't trashed, newest first, each with "Deleted N days ago · N days left".
- **Restore** (R) brings tasks back with the subtasks deleted alongside them; restoring a subtask restores its parent; a task whose project is gone goes to the Inbox.
- **Delete Forever** (Backspace, Delete in the Trash) and **Empty Trash…** remove tasks for good. Empty Trash asks first, with Cancel as the default button. Undo still works right after.
- Tasks in the Trash for 30 days are removed when the file loads (§3.2).

### §4.7 Undo

- Every change to tasks, projects and labels is one undo step, including multi-task changes. 100 steps. **Undo** ⌘Z, **Redo** ⇧⌘Z / ⌘Y. A new change clears redo. Undo never changes settings or the current view.
- While typing in a text field, ⌘Z belongs to the field.

## §5 Views

### §5.1 The sidebar

Add task; Inbox (open count); Today (count due today or overdue); Upcoming; Completed; Trash (count); **Projects** with a + button (each with colour dot and open count; "No projects yet." when none); **Labels** (every label used by a live task, alphabetical, ignoring case duplicates; hidden when none). A search box at the top.

The app opens on the view it showed last (`settings.lastView`), else Today. A project or label view whose project or label no longer exists falls back to the Inbox.

### §5.2 The lists

| View | Shows | Order |
|---|---|---|
| Inbox / project | open top-level tasks, each followed by its open subtasks | manual order |
| Today | open tasks due today or before: an **Overdue** section, then a heading for today | overdue by date, then priority, then order; today by priority, then order |
| Upcoming | Overdue; then each of the next 7 days with a heading ("Today · Sun Nov 15") and its own Add row; then **Later** | by date, priority, order |
| Label | open tasks with that label | date, priority, order |
| Completed | completed tasks (not trashed), grouped under the day they were completed | newest first |
| Trash | §4.6 | newest deleted first |
| Search | tasks whose title, description or a label contains the text (ignoring case), done ones included | open first, then date, priority, order |

Rows show: circle (priority colour, filled when done), title, first line of the description, and a meta line: Trash age; due date ("Today", "Tomorrow", "Yesterday", weekday within a week, "Nov 20", with the year if not this year; overdue red, today green, this week purple), repeat icon, subtasks done/total, labels, parent title (outside project views), project (outside project views).

Empty states: one line and a hint, e.g. "All clear! Nothing left to do here."

The list re-renders at midnight so Today stays right.

### §5.3 View actions

A ⋯ button by the title holds actions for the view: project → Edit Project…, Delete Project… (asks first; its tasks go to the Trash; Undo); Completed → Move Completed Tasks to Trash; Trash → Empty Trash…; label → Remove Label from All Tasks. All are commands too.

### §5.4 Search

Typing in the search box (`/`, ⌘F) shows Search results; clearing it, or Esc, returns to the previous view. ↓ or Enter moves into the results.

## §6 Projects and labels

- **New Project…** asks for a name (required, at most 80 characters) and a colour (swatches), then opens the project. **Edit Project…** changes both. **Delete Project…** §5.3. The Inbox can't be renamed or deleted.
- Labels exist while a task uses them. **Remove Label from All Tasks** removes it everywhere, with Undo.

## §7 Choosing tasks

- Arrow keys (and J/K) move the choice; Shift extends it; ⌘-click toggles one; Shift-click chooses a range; ⌘A chooses every task in the list; Esc clears the choice.
- Commands act on the chosen tasks. When chosen tasks leave the list, the next task below (else above) becomes chosen.
- The list is a `listbox` with `aria-multiselectable`; rows are `option`s with `aria-selected`; one row is in the tab order.

## §8 Commands and keys

Every action is a command in one catalog, which feeds the keyboard, the command menu, the right-click menu, the menu bar (desktop), the Keyboard Shortcuts window, and `docs/controls.md` (checked by a test).

- Single-key and Shift+key shortcuts only work outside text fields. Space and Enter only go to commands when a task row (or nothing) has focus.
- Two-key shortcuts (`G` then `I`) wait 1.5 s for the second key, and aren't shown in the menu bar.
- While a dialog is open, only commands marked global with a ⌘ chord run (and only those that make sense: the command menu and shortcuts window toggle closed).
- Groups and menu order: File, Edit, Task, Select, Go, View, Help.
- The command menu (⌘K, ⌘P) lists enabled commands, plus "Go to <project>", "Go to @<label>" and, with tasks chosen, "Move to <project>". Spaces don't count ("newtask" finds New Task). Best first: the title starts with what was typed, then contains it, then the group, keywords or description contain it (or every typed word appears somewhere), then the title holds the typed letters in order ("nwtk"). Within each rank, recently run commands lead. Each command has keywords: other words people type for it ("preferences" for Settings, "reorder" for Move Up). The 5 most recently run commands come first when nothing is typed.
- Right-click menus list only enabled commands, grouped by separators, with destructive commands last. A menu with nothing in it doesn't open, so the browser's own menu shows instead. Each surface has its own menu:
  - **A task:** Complete, Edit…, Set Due Date… | Priority 1–4 | Move to Project…, Move Up, Move Down | Restore, Move to Trash, Delete Forever. Right-clicking a task that isn't chosen chooses it alone; with several chosen, a header says "N tasks chosen".
  - **The empty part of a view:** New Task, Select All | Edit Project…, Move Completed Tasks to Trash, Empty Trash… | Delete Project…, Remove Label from All Tasks.
  - **A sidebar project:** Add Task Here | Edit Project… | Delete Project… (the Inbox: Add Task Here only). **A sidebar label:** Remove Label from All Tasks. **Completed:** Move Completed Tasks to Trash. **Trash:** Empty Trash…. **The Projects heading:** New Project….
  - A sidebar menu acts on the item right-clicked, not the open view.
  - Shift+F10 and the context-menu key open the menu for the focused task (or the view) and the focused sidebar item.
  - Text fields keep the system's edit menu (§12).
- **Keyboard Shortcuts** (`?`, ⌘/) is built from the catalog, grouped, with a filter box, plus the mouse gestures (⌘-click, Shift-click) and Enter/Esc in the composer.
- **Settings…** (⌘,): theme (System, Light, Dark).
- **About Taskite**: name, version, licence (in the app menu on macOS, Help elsewhere).

## §9 Look and feedback

- Plain CSS with `--tk-*` tokens, system font, Lucide-style icons; light and dark from the theme setting (System follows the OS). The accent is Taskite red (`#db4c3f`).
- Notices appear in a status bar at the bottom of the window, one at a time, for 5 s, with an optional action (Undo, Try again). A screen-reader live region reads them.
- Dialogs are modal, trap focus, close on Esc, and return focus to where it was. One dialog at a time.
- With `prefers-reduced-motion: reduce`, nothing animates.
- No welcome screen: first start opens Today with its empty state.

## §10 NAS server

- `node:http`, no framework. Serves the web client and:
  - `GET /api/info` → `{ "name": "Taskite", "version": "x.y.z" }`
  - `GET /api/data` → the file (200, `ETag: "<sha256>"`), or 404 when there's none yet.
  - `PUT /api/data` with `If-Match` (or `If-None-Match: *` for a new file) → 204 with the new `ETag`; 412 on a version mismatch; 428 with neither header; 400 for invalid JSON; body limit 10 MB.
  - `POST /api/copies?label=copy|corrupt` → 201 `{ "name": "tasks.copy-….json" }`: keeps the body as a dated copy next to the file (§3.2, §3.4).
  - `GET /api/info` also says whether a token is needed (`"auth": true`).
- Env vars: `TASKITE_DATA` (folder holding `tasks.json`, required), `TASKITE_STATIC` (the web build), `TASKITE_HOST` (default `127.0.0.1`), `TASKITE_PORT` (default `8788`), `TASKITE_TOKEN` (bearer token), `TASKITE_NO_AUTH=1` (allow no token on a non-loopback bind), `TASKITE_HOSTS` (extra allowed Host names).
- Without a token, a non-loopback bind is refused unless `TASKITE_NO_AUTH=1`, and requests whose `Host` isn't loopback or listed get 421.
- With a token, `/api` needs `Authorization: Bearer <token>`; the client asks for the token once and keeps it in `localStorage`.
- Static files are served only from inside `TASKITE_STATIC`.
- Docker: two-stage `node:22-alpine`, runs as `node`, `HEALTHCHECK` on `/api/info`, data in a `/data` volume.

## §11 CLI

`taskite <command> [options]`. Options: `--file <path>`, `--json`, `--help`.

| Command | Does |
|---|---|
| `list [today\|upcoming\|inbox\|completed\|trash]`, `list --project <name>`, `list --label <name>` | prints tasks: short id (first 8 characters), due, priority, title, project. Default `today` |
| `add <quick add text...>` | adds a task like the composer in the Inbox; prints its short id |
| `done <id>` | completes a task (repeating ones move on) |
| `reopen <id>` | |
| `trash <id>`, `restore <id>` | |
| `projects` | lists projects with open counts |
| `path` | prints the data file path |

- An id may be any unique prefix of a task id.
- Saves are atomic and check the version (the file mustn't have changed since it was read).
- A mistake the user can fix prints `taskite: <message>` and exits 2 for usage errors, 1 for others (unknown id, conflict). Success exits 0.

## §12 Desktop

- Electron, sandboxed with context isolation; the page loads from `app://taskite/`; the only native access is the `taskiteNative` bridge, which reads and writes the data file and carries menu commands. IPC is accepted only from `app://taskite/` frames. Links open in the default browser.
- The menu bar comes from the catalog (§8), with the standard app, Edit (clipboard roles) and Window menus.
- **macOS unified toolbar:** the window has no title bar (`titleBarStyle: 'hidden'`). The traffic lights sit in the sidebar's top row, which keeps room for them and hides the app name; a strip across the top of the task view stands in for the title bar. Both drag the window; their buttons don't. In full screen the room for the lights goes. Windows and Linux keep the standard frame and menu bar.
- Right-clicking text gets an edit menu: spelling suggestions and Learn Spelling for a misspelt word, then Cut, Copy, Paste, Select All (Copy only for selected text outside a field).
- On close, the app waits for a pending save (at most 3 s).
- The window's size and place are remembered.
- `TASKITE_HEADLESS=1` renders offscreen with no window or Dock icon (for automated checks); `TASKITE_USER_DATA=<dir>` uses another data folder.
- Packages: macOS dmg and zip (arm64 and x64, ad-hoc signed), Windows NSIS, Linux AppImage; app id `dev.gridloc.taskite`.
