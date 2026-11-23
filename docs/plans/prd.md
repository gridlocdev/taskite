# Taskite — product requirements

Taskite is a to-do list for one person. It runs as a desktop app (Electron), in the browser, from a self-hosted NAS server, and as a `taskite` command line, all on the same engine and the same data file. Code cites this document as `PRD §n`.

## §1 Goals

1. Capture a task in one line of text, with its date, priority, project and labels typed inline.
2. See what's due today and in the next week at a glance.
3. Do everything from the keyboard, and everything from the mouse.
4. Never lose a task: every change is saved at once, deletes go to a Trash, every change can be undone.

## §2 Non-goals

- Accounts, sharing or sync between people. The NAS server serves one person's file.
- Reminders and notifications. Times of day (dates only).
- Importing from other apps.

## §3 Data

### §3.1 The data file

All data is one JSON file, `tasks.json`, written pretty-printed (two-space indent) and UTF-8:

```json
{ "version": 1, "projects": [...], "tasks": [...], "settings": {...} }
```

- **Project**: `id`, `name`, `color` (one of `gray red orange yellow green teal blue purple magenta pink`). The Inbox has id `inbox`, is always present and is listed first. Optional, left out until used: `sections` (`[{ id, name }]` in display order) and `view` (`board`; a list when absent).
- **Task**: `id` (UUID), `title`, `description`, `projectId`, `parentId` (null, or the id of its parent; subtasks are one level deep), `labels` (strings), `priority` (1 urgent … 4 normal), `due` (`YYYY-MM-DD` or null), `recurrence` (`daily`, `weekdays`, `weekly`, `monthly`, `yearly` or null), `completed`, `completedAt` (epoch ms or null), `createdAt` (epoch ms), `order` (position within its project), `deletedAt` (epoch ms or null), `sectionId` (optional: a section of its project; left out for tasks above the first section, and dropped on reading when it names no section of the task's project), `attachments` (optional, left out when empty: `[{ id, name, size, type }]`, §4.8).
- **Settings**: `theme` (`auto`, `light`, `dark`), `lastView` (§5.1, or null), and, once set, `showCompleted` (§5.2) and `doneRules` (§6.1).
- **labelColors** (optional): label in lower case → a project colour name. Left out until a label has a colour.

### §3.2 Reading

- Missing or wrong fields are filled with defaults (`normalize`), so older or hand-edited files load. Fields Taskite doesn't know are kept and written back unchanged, so a file from a newer Taskite loses nothing when an older one saves it.
- A file whose `version` is higher than this Taskite's is refused, never read or saved, also when it appears during a save conflict (**Keep mine** and **Reload** leave it alone): the app says to update Taskite, and the CLI exits 1. `version` goes up only for a change an older Taskite would misread; new fields alone don't raise it.
- A task whose project doesn't exist goes to the Inbox. A missing Inbox is added.
- A byte-order mark at the start is ignored. A file that isn't valid JSON, or whose JSON isn't an object, is copied to `tasks.corrupt-<epoch ms>.json` next to it (never deleted), then replaced with an empty file, and the app starts empty with a notice naming the copy.
- Desktop only: if there is no `tasks.json` but the old app's file exists (`<appData>/Tasks/tasks.json`, from when the app was called "Tasks"), it is read instead. The old file is left alone. The first save writes Taskite's own file.
- Tasks in the Trash for more than 30 days are removed for good when the file is loaded.

### §3.3 Saving

- Every change is saved immediately. Saves never overlap: a change during a save is saved right after it.
- Saves are atomic: write a temp file, flush it, rename it over `tasks.json`. A `tasks.json` that is a symlink stays one: the save replaces the file it points at. On Windows a rename refused because another program has the file open is retried a few times.
- The desktop app, the NAS server and the CLI hold a lock file (`.tasks.json.lock`, created exclusively next to the file) while they check the version and write, so two of them can't both pass the check. A lock older than 10 s is left from a crash and is taken over. Tabs in the browser hold a Web Lock instead.
- A failed save is retried twice (after 300 ms and 600 ms). If it still fails, the status bar shows "Couldn't save your tasks." with **Try again** until a save works, then "Saved." Until then the unsaved data is also kept in the browser's storage (§3.5).
- Settings changes are saved but are not undo steps.

### §3.4 Versions and conflicts

- Every read returns a version: the SHA-256 of the file's bytes (hex). Every save sends the version it last read or wrote. If the file on disk has a different version, the save fails with a conflict instead of writing.
- On a conflict the app shows a dialog, "Your tasks changed somewhere else", which says how many tasks differ and offers three choices:
  - **Save Mine as a Copy** (default, the one that loses nothing): write this window's data to `tasks.copy-<YYYY-MM-DD-HHmmss>.json` next to the file, then load the file on disk.
  - **Keep Mine**: overwrite the file with this window's data.
  - **Use Theirs**: load the file on disk; this window's unsaved changes are lost.
- Nothing merges, and nothing overwrites without the user choosing it.
- **Changes made elsewhere** (the CLI, another window or device): the app reads the file again when its window comes to the front and every 15 s while it is in front. If the file changed and this window has nothing unsaved, it takes the file's tasks as one undo step, with the notice "Updated with N changes made elsewhere." and Undo. Undo puts back what the window showed (and saves it); earlier undo steps are dropped, so Undo can't take back the other change along with one of this window's. With unsaved changes, it leaves the file alone and the save's conflict check asks, as above.
- In the browser, every tab of the app shares one file, so a second tab conflicts like a second window.

### §3.5 Recovery

- Before each save, the data being saved is written to `localStorage` under `taskite.unsaved`; a successful save removes it. If the browser has no room for it, any older copy there is removed too (it would offer stale data), and a failed save's notice says "Couldn't save your tasks, and this browser has no room to keep a copy. Keep this window open."
- On start, if `taskite.unsaved` exists and differs from the loaded file, a dialog offers **Restore** (default; saves it over the file) or **Discard**.

### §3.6 Where the file lives

| Runs as | File |
|---|---|
| iOS | `tasks.json` in the app's Documents folder, shown in the Files app under On My iPhone › Taskite (§13) |
| Desktop | `<userData>/tasks.json` (macOS `~/Library/Application Support/Taskite/`, Windows `%APPDATA%\Taskite\`, Linux `~/.config/Taskite/`) |
| Browser | `tasks.json` in the origin's private file system (OPFS) |
| NAS | `$TASKITE_DATA/tasks.json` on the server (§10) |
| CLI | `--file`, else `$TASKITE_FILE`, else the desktop location (§11) |

Attached files live in an `attachments/` folder beside `tasks.json`, wherever it is (§4.8). Other workspaces' files live in `workspaces/<id>/` beside it (§14).

## §4 Tasks

### §4.1 Adding (Quick Add)

- An **Add task** row ends every list that can take new tasks (Inbox, projects, Today, labels, each day in Upcoming). Clicking it, or **New Task** (`Q`, `N`, ⌘N), turns it into a composer shaped like a task row.
- **Enter** adds the task and leaves an empty composer below it. Enter on an empty composer, **Esc**, or clicking away from an empty composer closes it; switching to another window or browser tab doesn't. Text left in a closed composer is kept for next time.
- Text that parses to no title (only shortcuts) isn't added; the text stays.
- While typing, the row previews the parsed date, labels and project, and the circle takes the priority colour. A project that doesn't exist yet shows as "Name (new)".
- New tasks take defaults from where they're added: the viewed project (else the Inbox); due today in Today; that day in an Upcoming day (the first day of next week under Next Week); the viewed label in a label view.
- From Search, New Task returns to the view before the search; from Completed or Trash, it goes to the Inbox.
- A new task goes to the end of its project's order. The new row slides in (no motion with reduced motion).

### §4.2 Quick Add syntax

| Text | Meaning |
|---|---|
| `today`, `tomorrow`, `day after tomorrow`; `next week` / `next month` / `next year` (that long from today); `in N days/weeks/months/years` and `N days from now` (N a number, or `a`, `an`, `one` … `ten`); `end of month`; a weekday (`friday`, `on friday`: the next one after today); `this friday` (the coming one, today included); `next friday` (the one in the seven days that start a week from today, so never this week's: on a Sunday, `next monday` is eight days away); `this weekend` / `next weekend` (Saturday, the same way); `Dec 25`, `25 Dec`, `Dec 25th`, `2026-11-01` | due date. Month-day dates take this year, or next year if already past; an impossible date (`feb 31`) is ignored |
| `every day`, `every weekday`, `every week`, `every month`, `every year`, `every monday` | repeat; due defaults to today (the next weekday for `every weekday` on a weekend; the next such day for `every <weekday>`, or today if it is that day). An explicit date wins |
| `p1` … `p4` | priority |
| `#Name` | project, matched ignoring case, spaces, `-` and `_`; created if missing (with `-`/`_` turned into spaces, next colour in turn, notice "Created new project …") |
| `@name` | label; several allowed; duplicates (ignoring case) dropped |

Everything else, with spaces collapsed, is the title.

### §4.3 Completing

- Clicking the circle, or **Complete** (Space) on the chosen tasks, completes them. If every chosen task is already done, it reopens them.
- A repeating task with a due date isn't completed: its due date moves to the next occurrence after today (stepping from the current due date; monthly and yearly steps count whole months from it and keep the day of the month, falling on the month's last day when it is shorter: a task due on the 31st goes to Feb 28, then back to Mar 31. The file keeps that day in `repeatDay` only while the date sits off it, and setting the date or the repeat by hand forgets it), with the notice `Nice! "<title>" is next due <when>.`
- Completing a task completes its open subtasks. Reopening a subtask reopens its parent.
- Completed rows show done for 350 ms, then leave the list (except in Completed and Search). Notice: "Task completed." / "N tasks completed.", with Undo.

### §4.4 Editing

- **Rename Task** (Enter, one task chosen, not in the Trash) turns the task's name in its row into a text field with the caret at the end. Enter saves and closes it, Esc closes it and puts the name back, ⌘Enter (Ctrl+Enter) saves and opens the task editor, and a click elsewhere saves and closes it. An empty name goes back to the last one; an unchanged name records nothing. Switching to another window or browser tab leaves the field open with what was typed, and the keyboard is back in it on return. While it holds unsaved text, picking up changes made elsewhere waits; opening any dialog saves it first.
- Double-clicking a task (not in the Trash) or **Edit Task…** (⌘Enter, Ctrl+Enter on Windows and Linux, one task chosen) opens the task editor: the name and description as plain text at the top, then the project (not for subtasks). Due date, repeat, priority (when not 4), labels (comma-separated; a leading `@` is dropped, spaces become `-`, duplicates ignoring case dropped) and subtasks show only when the task has them. Under them, a row of buttons with icons, one for each field not shown, adds that field, focused. Each of these fields has × to take it away, clearing its value (subtasks: only while there are none); a field whose value is taken away, by × or by hand (no date, Doesn't repeat, priority 4, no labels, no subtasks left), hides and its button comes back, with the keyboard on it when the field had it.
- There is no Save. Each change applies as it's made, as its own undo step: pickers at once, text when its field loses focus or the editor closes. A change that leaves a field as it was records nothing. An empty name goes back to the last one. **Done**, ⌘Enter (Ctrl+Enter on Windows and Linux) from any field, the description included, Enter in a one-line field, Esc or a click outside closes the editor. Text is also saved before anything replaces the editor (another dialog, ⌘K, a save conflict, closing the window). Only fields typed in are saved, so a change made elsewhere to another field shows in the open editor and isn't overwritten; while a field holds unsaved text, picking up changes made elsewhere waits. If the task is deleted elsewhere, the editor closes with a notice.
- Making an undated task repeat dates it today. Clearing the date of a repeating task stops it repeating.
- Subtasks: a list with check circles and delete buttons, plus an input that takes Quick Add text (Enter adds). Subtasks can't have subtasks and always live in their parent's project.
- **Set Due Date…** (D) opens a small dialog: type a date in Quick Add words; the preview shows "Due friday (2026-11-20)", "No due date", or "Not a date I understand yet." Short weekday names (`fri`, `next tue`) work here, though not in Quick Add, where `sun` or `sat` may be words. Buttons: Today, Tomorrow, Next week, No date. Under them, a month calendar: the week starts where the system's locale starts it; today is ringed in the accent colour, the date in the field is filled, and typing a date turns to its month. ‹ › or Page Up/Down change month, arrow keys move a day or a week, and a click or Enter on a day sets it. Clearing the date of a repeating task stops it repeating.
- **Priority 1–4** (`1`–`4`) set priority on the chosen tasks.
- **Move to Project…** (M) opens the command menu filtered to "Move to ". A task's subtasks move with it. A subtask moved without its parent leaves the parent and becomes a task in that project, so this is also how a subtask is promoted (Undo puts it back).

### §4.5 Order and drag and drop

- In the Inbox and projects, top-level tasks can be dragged up and down to reorder. Dropped on a row in another section, or on a section's heading or empty space (to its end), they join that section. A drop on a row lands above or below it by which half of the row the pointer is over.
- **Move to Previous / Next Section** (⌥← / ⌥→, Alt+Left / Alt+Right) move the chosen top-level tasks (a chosen subtask counts as its parent) to the end of the section before or after the first one's. Above the first section counts as a place. One undo step.
- **Move Up** / **Move Down** (⌥↑ / ⌥↓, Alt+Up / Alt+Down elsewhere) move the chosen tasks one place, in the Inbox and projects only. A task moves with its subtasks. Chosen subtasks of one parent move among their siblings; a subtask chosen with other tasks moves its parent. Tasks already at the top or bottom stay; the rest keep their order. One undo step.
- A task dropped on a sidebar project or the Inbox moves there; on Today becomes due today; on Trash goes to the Trash; on a label gets that label.
- Dragging several chosen tasks carries them as one stack: the grabbed row on top of up to two cards, with an "N tasks" badge (N counts top-level tasks; a chosen subtask counts as its parent). The chosen rows fade while they're carried.

### §4.6 Trash

- **Move to Trash** (Backspace, Delete) moves the chosen tasks and their subtasks to the Trash, with Undo. Rows slide out.
- The Trash lists top-level trashed tasks and subtasks whose parent isn't trashed (or no longer exists), newest first, each with "Deleted N days ago · N days left".
- **Restore** (R) brings tasks back with the subtasks deleted alongside them; restoring a subtask restores its parent and puts it back in its parent's project and section; a task whose project is gone goes to the Inbox; a subtask whose parent no longer exists comes back as a task of its own. Subtasks in the Trash still move with their parent.
- **Delete Forever** (Backspace, Delete in the Trash) and **Empty Trash…** remove tasks for good, with their subtasks that are in the Trash too (a subtask restored on its own stays). Empty Trash asks first, with Cancel as the default button. Undo still works right after.
- Tasks in the Trash for 30 days are removed when the file loads (§3.2).

### §4.7 Undo

- Every change to tasks, projects and labels is one undo step, including multi-task changes. 100 steps. **Undo** ⌘Z, **Redo** ⇧⌘Z / ⌘Y. A new change clears redo. A change that leaves everything as it was records no step and shows no notice. Undo never changes settings or the current view.
- While typing in a text field, ⌘Z belongs to the field.
- Completing or trashing a task plays a short animation before the change is made; Undo during it cancels the change. A notice's **Undo** goes away once anything else changes the tasks.

### §4.8 Attachments

- A task can have files attached. The editor's button row has **Attachments** (paperclip); it opens the system's file picker, and files can also be dropped on the editor or pasted into it (a screenshot, or files copied in Finder or Explorer). A paste that also carries rich text (`text/html`), as a copy from a document or a page does, pastes as text instead. Each attachment shows its name and size, opens or downloads on click, and has × to remove it. A file over 25 MB is refused with a notice naming it.
- Rows and board cards show a paperclip chip with the count when a task has attachments.
- `tasks.json` keeps only `{ id, name, size, type }` per attachment (`id` a UUID, `type` the MIME type or ""). The bytes are in `attachments/<id>` beside `tasks.json`, written once and never changed, so they can't conflict (§3.4). The file is written before the task change that names it; if writing fails, the task is left as it was and a notice says so.
- Adding and removing an attachment are undo steps like any other change; removing one only drops the reference, so Undo brings it back. Subtasks can have attachments too. A task's attachments stay with it when it moves, is trashed or is restored.
- Files no task names (the Trash included) are deleted when the file loads, if they are more than a day old. So a task deleted for good (§4.6) loses its files at the next load after that, and Undo right after Delete Forever still works. Files in the folder that aren't attachment ids are left alone.
- A conflict choice (§3.4) never deletes files; the next load cleans up what no task names.

### §4.9 Copy

- **Copy** (⌘C, Ctrl+C; also in the task's right-click menu and ⌘K) puts the chosen tasks on the clipboard as a Markdown task list, in the order they're chosen, and a notice says "Copied N tasks." In a text field, or with text selected on the page, ⌘C copies that text instead.
- Each line is `- [ ]` (`- [x]` when done) and then the task as Quick Add writes it (§4.2), so a line pastes back into the add row: title, due date as `YYYY-MM-DD`, repeat (`every day`, `every weekday`, `every week`, `every month`, `every year`), `p1`–`p3` (p4 is left out), `#Project` (spaces as `-`; left out for the Inbox and for subtasks) and each `@label`.
- The description follows on the lines below, indented two spaces, blank lines dropped. A chosen task's subtasks (not trashed ones) follow it, indented two spaces, with their own descriptions under them. A subtask chosen with its parent comes once, under the parent; one chosen on its own is a line of its own.
- Attachments, sections and completion times aren't copied.

## §5 Views

### §5.1 The sidebar

Add task; Inbox (open count); Today (count due today or overdue); Upcoming; Completed; Trash (count); **Projects** with a + button (each with colour dot and open count; "No projects yet." when none); **Labels** (every label used by a live task, alphabetical, ignoring case duplicates; hidden when none). A search box at the top.

In a window narrower than 600 px (a phone), a tab bar replaces the sidebar (§5.5).

The app opens on the view it showed last (`settings.lastView`), else Today. A project or label view whose project or label no longer exists falls back to the Inbox.

### §5.2 The lists

| View | Shows | Order |
|---|---|---|
| Inbox / project | open top-level tasks, each followed by its open subtasks: unsectioned ones first with no heading, then a heading per section (§6) with a count and its own Add row | manual order |
| Today | open tasks due today or before: an **Overdue** section, then a heading for today | overdue by date, then priority, then order; today by priority, then order |
| Upcoming | Overdue; then each remaining day of this calendar week (from today; the week starts where the locale starts it) with a heading ("Today · Sun Nov 15") and its own Add row; then **Next Week · Nov 16 – 22** (always shown; its Add row dates new tasks the week's first day); then **Later** (when it has tasks) | by date, priority, order |
| Label | open tasks with that label | date, priority, order |
| Completed | completed tasks (not trashed), grouped under the day they were completed (the day they were made, for old tasks with no completion time); each day once | newest first |
| Trash | §4.6 | newest deleted first |
| Search | tasks whose title, description or a label contains the text (ignoring case), done ones included | open first, then date, priority, order |

Rows show: circle (priority colour, filled when done), title, first line of the description, and a meta line: Trash age; due date ("Today", "Tomorrow", "Yesterday", weekday within a week, "Nov 20", with the year if not this year; overdue red, today green, this week purple), repeat icon, subtasks done/total, labels, parent title (outside project views), project (outside project views).

A project's title reads as a breadcrumb, "Projects / ● Work": "Projects" and the slash in grey, then the project's colour dot and its name.

Empty states: one line and a hint, e.g. "All clear! Nothing left to do here."

The list re-renders at midnight so Today stays right.

### §5.3 View actions

A ⋯ button by the title holds actions for the view: Inbox and project → Add Section…, View as Board / View as List; project → Edit Project…, Delete Project… (asks first; its tasks go to the Trash; Undo); Completed → Move Completed Tasks to Trash; Trash → Empty Trash…; label → Edit Label…, Remove Label from All Tasks. All are commands too. Deleting a project, or removing a label, while its own view is shown goes to the Inbox; from anywhere else (the sidebar's right-click menu), the view on screen stays.

### §5.4 Search

Typing in the search box (`/`, ⌘F) shows Search results; clearing it, or Esc, returns to the previous view. ↓ or Enter moves into the results.

### §5.5 Phones and touch screens

- **Tab bar.** In a window narrower than 600 px, the sidebar gives way to a bar along the bottom with four tabs: **Today**, **Upcoming** and **Inbox** (Today and Inbox with their counts as badges), and **Browse**. Tapping a tab goes to that view. Browse fills the screen with the rest of the sidebar: Completed, Trash, Projects and Labels, listed from the bottom up and opened scrolled to the end, then one row along the bottom with the search box, Settings and New Project (+); picking one shows it, and Browse stays the lit tab. Typing in Browse's search box shows the results above the box, which stays at the bottom. Going to any view by any means leaves Browse. Search (`/`, ⌘F) opens Browse. Holding a finger on the lit tab (Today, Upcoming or Inbox) opens the view's menu, the same as the empty part of the list's right-click menu; the ⋯ at the top of the view stays.
- **Add button.** A round + button floats above the tab bar, bottom right, in every view but Browse. It does what New Task does (§4.1), and the keyboard comes up in the add-task row, which at phone width is a panel docked along the bottom of the screen: the name field with a round ✓ (Add) at its right, and the Quick Add chips in one row under it, shown only once there are some. ✓ adds the task like Enter and keeps the panel and keyboard up for the next one. The Add button hides while the panel is open.
- **On-screen keyboard.** At phone width the app fills only the part of the screen the keyboard leaves showing, so whatever is docked at the bottom (the search row, the add-task panel, a dialog) sits right above the keyboard and moves up and down with it. While the keyboard is up the tab bar and Add button hide.
- **Dialogs** at phone width are sheets along the bottom of the screen, with their buttons at the bottom. In the due date dialog (§9.2) the quick picks (Today, Tomorrow, Next week, No date) sit in one row under the calendar, next to Set Date. On a touch screen a dialog doesn't put the keyboard up when it opens: the dialog itself takes focus unless it names a control to start on, and tapping a field brings the keyboard.
- **Status bar.** On a phone it sits above the tab bar and takes no room while there's no notice and nothing is being saved.
- **Gestures.** These work wherever the pointer is a finger (phones and tablets, any width); a mouse keeps its clicks, drags and right-click menus.
  - Tapping a task opens the task editor (§4.4); in the Trash it chooses the task.
  - Holding a finger on a task for half a second opens its menu (§8); on a project, label, Completed or Trash in Browse, that item's menu. The press doesn't also open the task or the view. At phone width menus open as a sheet along the bottom of the screen, with a shade over the rest; a tap outside closes it. In a sheet the four priorities are one row of flags (P1–P4). Lifting the finger that opened a menu doesn't pick the item under it.
  - Sliding a list row sideways shows what letting go will do: right, a green band with a check (Complete, §4.3; Mark Not Done for a done task); left, a red band with a bin (Move to Trash, §4.6). Past a third of the row (at most 120 px) the band turns solid and letting go does it, with the usual notice and Undo; short of that the row slides back. Up-and-down movement scrolls instead. Board cards, rows in the Trash and a row being renamed don't slide.
  - Rows aren't dragged by finger; Move to Project…, Move Up / Down and the section commands in the menu do that job.
- **Fit.** The page runs to the edges of the screen and keeps clear of the notch, the rounded corners and the home indicator. Text fields use 16 px text so iOS doesn't zoom in on them. Rows and Browse items are at least 44 px tall, and a row's check circle answers to a tap 44 px across. The command menu button is hidden on touch screens.

## §6 Projects and labels

- **New Project…** asks for a name (required, at most 80 characters) and a colour (swatches), then opens the project. **Edit Project…** changes both. **Delete Project…** §5.3. The Inbox can't be renamed or deleted.
- Labels exist while a task uses them. **Remove Label from All Tasks** removes it everywhere, with Undo.
- **Edit Label…** (a label's right-click menu, its ⋯ button, ⌘K) renames a label on every task and gives it a colour from the project swatches, or none. Renaming onto a label a task already has leaves one copy. A coloured label shows its colour on rows and its sidebar tag. One undo step; a label view stays on the renamed label.

- **Sections** split a project (the Inbox too) into named groups. **Add Section…** (⋯, the list's right-click menu, ⌘K, or **Add section** under the last one) asks for a name (at most 80 characters). A section heading's ⋯ button and right-click menu hold **Add Task Here**, **Add Section…** (after it), **Rename Section…**, **Move Section Earlier / Later** and **Delete Section…**, which asks first and moves its tasks to the Trash; restored, they come back unsectioned. A task moved to another project leaves its section. Subtasks are always in their parent's section.
- **View as Board** shows a project as columns, one per section, side by side and scrolling sideways; **View as List** goes back. The choice is saved per project in the file. A **No section** column holds unsectioned tasks, and shows only while it has some or the project has no sections. Each is one undo step.
- On a board each column is as tall as its cards, and each task is a card: its name, the first line of its description, then chips for its due date (with ↻ when it repeats), priority (P1–P3), labels and subtasks done (2/5). Subtasks aren't cards of their own. Checked-off tasks stay on the board, struck through, at the bottom of their column, whether or not completed tasks are shown in lists; the count in a column's heading counts them too.

### §6.1 Section automations

- A project section can hold **automations**: rules that change a task when something happens to it in that section. **Section Automations…** opens the editor from the section heading's ⋯ button and right-click menu, and from ⌘K (for the section the cursor is in). Only project sections have them (not Today, Upcoming or the No section column).
- **The editor** is a dialog titled "Automations · <section>". Each rule is a sentence: **When a task** [enters this section ▾ | leaves this section ▾ | is completed here ▾] **then** one or more actions, each a dropdown plus its value, with ✕ to remove it and **+ Add action**. **+ Add rule** adds a rule; a rule with no actions is dropped on save. Cancel or Esc discards; **Save** (⌘Enter) saves all rules as one undo step. At most 10 rules per section and 5 actions per rule.
- **Triggers.** *Enters this section*: a task is created in it (Add task there, Quick Add, `taskite add --section`), dragged or moved into it (another section, another project's section, or by an automation). Reordering within the section and editing the task don't count. *Leaves this section*: a task in it is dragged or moved out (to another section, the project's top or another project, or by an automation); its leave rules run first, then the enter rules of where it went. Moving to the Trash or deleting the section doesn't count. *Is completed here*: a task in the section is completed (a repeating task that moves to its next date isn't completed, so it doesn't fire). Only top-level tasks trigger rules; subtasks follow their parent as usual (§6).
- **Actions**, run top to bottom: **Complete** / **Reopen** (with their usual subtask rules, §4.3); **Set due date** (Today, Tomorrow, In N days, Next week = the week's first day, No date); **Set priority** (1–4); **Add label** / **Remove label** (a label name, with the label list to pick from); **Move to** (a section of this or another project, or a project's top). An action that changes nothing is skipped.
- **Chaining.** A move by an automation into a section with *enters* rules runs them too, but a task never triggers the same section twice in one go, so rules can't loop.
- **One change.** The user's action and every automation it set off are one undo step. After them a notice says what happened, e.g. `Moved to Done. Automation: completed it, added @shipped.`, with Undo. When nothing ran, the usual notice shows.
- **Existing tasks.** Saving a rule with an *enters* trigger that's new or changed, in a section that already has tasks, asks "Apply to the N tasks already in <section>?" (**Apply** / **Not now**), counting the open top-level tasks there. Apply runs those rules on each, as part of the same undo step as the save.
- **Showing them.** A section with automations shows ⚡ and the rule count after its heading count; hovering it lists the rules in one line each, and clicking it opens the editor.
- **Done sections.** A section made or renamed **Done** (any capitals, spaces around ignored) gets two rules in the same undo step: *enters* → **Complete** and *leaves* → **Reopen**, added after any rules it has and only where the same rule isn't there already (within the 10-rule limit). They're ordinary rules: shown, editable and removable; renaming the section away from Done keeps them. Tasks already in a section renamed Done aren't changed. **Settings** has a checkbox for this, on by default; the file has `settings.doneRules: false` once it's turned off, and nothing before. It applies wherever sections are made or renamed (app, NAS server, CLI).
- **Where they run.** The engine runs them, so the app, the NAS server and the CLI behave the same (`taskite add --section`, `done`).
- **Broken targets.** A rule whose label is gone keeps it (labels exist while used, §6); **Edit Label…** renames it in rules too. Deleting a section or project drops rules that move tasks there; deleting a section drops its own rules. Undo brings them back.
- **In the file**: a section may have `automations: [{ "on": "enter" | "leave" | "complete", "do": [action…] }]`, left out when empty. Actions: `{ "complete": true | false }`, `{ "due": "today" | "tomorrow" | "+N" | "nextWeek" | null }`, `{ "priority": 1–4 }`, `{ "addLabel": "x" }`, `{ "removeLabel": "x" }`, `{ "moveTo": { "projectId": "…", "sectionId": "…" | null } }`. Reading drops actions it doesn't understand and rules left with none.

## §7 Choosing tasks

- Arrow keys (and J/K) move the choice; Shift extends it; ⌘-click toggles one; Shift-click chooses a range; ⌘A chooses every task in the list; Esc clears the choice. A range starts again in each view. When the row under the cursor goes away, the cursor moves to the next row below, else above. Checking off a task outside the choice leaves the choice as it was.
- ↑ and ↓ (not with Shift) also stop on each section's Add task button, after its last task; nothing is chosen there, Enter or Space opens the add-task row, and typing a character opens it starting with that character (letters type rather than run shortcuts there; ⌘/Ctrl shortcuts still work). Shift+arrows extend over tasks only, passing the buttons.
- **Going to a section.** In a list, ⇧⌥↓ / ⇧⌥↑ choose the first task of the next / previous section. On a board, → / ← choose the task or Add task button level with this one on screen in the next / previous column, and ⇧⌥→ / ⇧⌥← choose that column's first task; ⇧⌥↓ / ⇧⌥↑ do nothing there, and → / ← nothing in a list. An empty section isn't skipped: the cursor goes to its Add task button, with nothing chosen. Only a section with neither tasks nor an Add task button is skipped. **Go to Section…** (`G` then `S`) and the command menu's "Go to Section: <name>" go to any section with a heading in the view (project sections and board columns, Overdue, Upcoming's days, Completed's days): its first task, or, when it has none, the add-task row opens in it.
- Commands act on the chosen tasks. When chosen tasks leave the list, the next task below (else above) becomes chosen.
- The list is a `listbox` with `aria-multiselectable`; rows are `option`s with `aria-selected`; one row is in the tab order.

## §8 Commands and keys

Every action is a command in one catalog, which feeds the keyboard, the command menu, the right-click menu, the menu bar (desktop), the Keyboard Shortcuts window, and `docs/controls.md` (checked by a test).

- Single-key and Shift+key shortcuts only work outside text fields. Space and Enter only go to commands when a task row (or nothing) has focus.
- Two-key shortcuts (`G` then `I`) wait 1.5 s for the second key, and aren't shown in the menu bar. A second key typed in a text field is just typed.
- Digit shortcuts (Priority 1–4) go by the key cap on layouts whose digit keys type punctuation without Shift (AZERTY: `&` is 1).
- In any dialog with a main button, ⌘Enter (Ctrl+Enter) presses it from any field.
- While an input method is composing (Japanese, Chinese, Korean), Enter and Esc belong to it: they don't add a task, close a dialog or clear the search.
- While a dialog is open, only commands marked global with a ⌘ chord run (and only those that make sense: the command menu and shortcuts window toggle closed).
- Groups and menu order: File, Edit, Task, Select, Go, View, Help.
- The command menu (⌘K, ⌘P) lists enabled commands, plus "Go to <project>", "Go to @<label>", "Go to Section: <name>" for each section heading in the view and, with tasks chosen, "Move to <project>". Spaces don't count ("newtask" finds New Task). Best first: the title starts with what was typed, then contains it, then the group, keywords or description contain it (or every typed word appears somewhere), then the title holds the typed letters in order ("nwtk"). Within each rank, recently run commands lead. Each command has keywords: other words people type for it ("preferences" for Settings, "reorder" for Move Up). The 5 most recently run commands come first when nothing is typed. ↑ ↓, or Tab and Shift+Tab, move the highlight, stopping at the ends; Enter runs it; Esc closes.
- Right-click menus list only enabled commands, grouped by separators, with destructive commands last. A menu with nothing in it doesn't open, so the browser's own menu shows instead. Each surface has its own menu:
  - **A section heading:** Add Task Here, Add Section… | Rename Section…, Section Automations…, Move Section Earlier / Later | Delete Section….
  - **A task:** Complete, Rename Task, Edit Task…, Set Due Date… | Priority 1–4 | Move to Project…, Move Up, Move Down | Restore, Move to Trash, Delete Forever. Right-clicking a task that isn't chosen chooses it alone; with several chosen, a header says "N tasks chosen".
  - **The empty part of a view:** New Task, Select All | Edit Project…, Move Completed Tasks to Trash, Empty Trash… | Delete Project…, Edit Label…, Remove Label from All Tasks.
  - **A sidebar project:** Add Task Here | Edit Project… | Delete Project… (the Inbox: Add Task Here only). **A sidebar label:** Edit Label… | Remove Label from All Tasks. **Completed:** Move Completed Tasks to Trash. **Trash:** Empty Trash…. **The Projects heading:** New Project….
  - A sidebar menu acts on the item right-clicked, not the open view.
  - Shift+F10 and the context-menu key open the menu for the focused task (or the view) and the focused sidebar item.
  - Text fields keep the system's edit menu (§12).
- **Keyboard Shortcuts** (`?`, ⌘/) is built from the catalog, grouped, with a filter box, plus the mouse gestures (⌘-click, Shift-click) and Enter/Esc in the composer.
- **Settings…** (⌘,), for the open workspace (§14): theme (System, Light, Dark), and whether a new section named Done completes tasks moved in and reopens ones moved out (§6.1).
- **About Taskite**: name, version, licence (in the app menu on macOS, Help elsewhere).

## §9 Look and feedback

- Plain CSS with `--tk-*` tokens, system font, Lucide-style icons; light and dark from the theme setting (System follows the OS). The accent is Taskite red (`#db4c3f`).
- Notices appear in a status bar at the bottom of the window, one at a time, for 5 s, with an optional action (Undo, Try again). A screen-reader live region reads them.
- Dialogs are modal, trap focus, close on Esc, and return focus to where it was. A click on empty space inside a dialog keeps focus in it. One dialog at a time.
- With `prefers-reduced-motion: reduce`, nothing animates.
- No welcome screen: first start opens Today with its empty state.

## §10 NAS server

- `node:http`, no framework. Serves the web client and:
  - `GET /api/info` → `{ "name": "Taskite", "version": "x.y.z" }`
  - `GET /api/data` → the file (200, `ETag: "<sha256>"`), or 404 when there's none yet. With `If-None-Match` naming the current version, 304 and no body: the app's regular re-reads (§3.4) download the file only when it changed.
  - `PUT /api/data` with `If-Match` (or `If-None-Match: *` for a new file) → 204 with the new `ETag`; 412 on a version mismatch; 428 with neither header; 400 for invalid JSON; body limit 10 MB.
  - `POST /api/copies?label=copy|corrupt` → 201 `{ "name": "tasks.copy-….json" }`: keeps the body as a dated copy next to the file (§3.2, §3.4).
  - `PUT /api/attachments/<id>` → 201, keeps the body as `attachments/<id>` (409 if it exists; body limit 25 MB); `GET /api/attachments/<id>` → the bytes as `application/octet-stream` with `Content-Disposition: attachment`, or 404; `<id>` must be a UUID, else 400. `POST /api/attachments/clean` → `{ "removed": n }`: deletes the files no task names that are over a day old (§4.8).
  - `GET /api/info` also says whether a token is needed (`"auth": true`).
- Env vars: `TASKITE_DATA` (folder holding `tasks.json`, required), `TASKITE_STATIC` (the web build), `TASKITE_HOST` (default `127.0.0.1`), `TASKITE_PORT` (default `8788`), `TASKITE_TOKEN` (bearer token), `TASKITE_NO_AUTH=1` (allow no token on a non-loopback bind), `TASKITE_HOSTS` (extra allowed Host names).
- Without a token, a non-loopback bind is refused unless `TASKITE_NO_AUTH=1`, and requests whose `Host` isn't loopback or listed get 421.
- With a token, `/api` needs `Authorization: Bearer <token>`; the client asks for the token once and keeps it in `localStorage`.
- Static files are served only from inside `TASKITE_STATIC`.
- Every response carries a Content-Security-Policy (scripts only from the server itself, no framing). The web build also has the policy in a meta tag, for hosts that send no header.
- Docker: two-stage `node:22-alpine`, runs as `node`, `HEALTHCHECK` on `/api/info`, data in a `/data` volume.

## §11 CLI

`taskite <command> [options]`. Options: `--file <path>`, `--json`, `--help`.

| Command | Does |
|---|---|
| `list [today\|upcoming\|inbox\|completed\|trash]`, `list --project <name>`, `list --label <name>` | prints tasks: short id (first 8 characters), due, priority, title, project; a project's sections as `## Name` headings. JSON has each task's `section` name. Default `today` |
| `add <quick add text...>` | adds a task like the composer in the Inbox; prints its short id. `--section <name>` puts it in that section (ignoring case) of its project, or fails listing the sections |
| `done <task>` | completes a task (repeating ones move on). Like `add`, says what section automations did after it (`Automation: moved it to Done.`), and JSON has `automation` (null when none ran) |
| `reopen <task>` | |
| `trash <task>`, `restore <task>` | |
| `move <task> <project>` | moves a task to a project (`#Name` or the name, ignoring case); a subtask leaves its parent, as in the app |
| `due <task> <date>` | sets the due date from the words the Set Due Date dialog takes; `none` clears it |
| `projects` | lists projects with open counts |
| `attach <task> <file...>` | copies files into `attachments/` and attaches them as one change. Every file is checked first: one that is missing or over 25 MB stops the command and nothing is attached. The type comes from the file's extension, or "" |
| `attachments <task>` | lists a task's attachments: size, name and the path of its file. JSON has `attachments` with `id`, `name`, `size`, `type` and `path` |
| `path` | prints the data file path |

- A `<task>` is looked for only among the tasks the command can act on (`done` looks at open tasks, `reopen` at completed ones, `restore` in the Trash): a title equal to the words (ignoring case), else titles that contain them, else an id start of at least 4 characters that only one task has. Titles come first because short words like `bed` are also the start of some id. When several match, the CLI lists them (up to 10) and changes nothing.
- `done`, `reopen`, `trash`, `restore` and `attachments` take all their words as the task (`taskite done call mum`); `move`, `due` and `attach` take the first word, so a title of several words is quoted.
- Saves are atomic and check the version (the file mustn't have changed since it was read).
- A mistake the user can fix prints `taskite: <message>` and exits 2 for usage errors, 1 for others (no match, several matches, conflict). Success exits 0.

## §12 Desktop

- Electron, sandboxed with context isolation; the page loads from `app://taskite/`; the only native access is the `taskiteNative` bridge, which reads and writes the data file and carries menu commands. IPC is accepted only from `app://taskite/` frames. Links open in the default browser.
- The menu bar comes from the catalog (§8), with the standard app, Edit (clipboard roles) and Window menus.
- **macOS unified toolbar:** the window has no title bar (`titleBarStyle: 'hidden'`). The traffic lights sit in the sidebar's top row, which keeps room for them and hides the app name; a strip across the top of the task view stands in for the title bar. Both drag the window; their buttons don't. In full screen the room for the lights goes. Windows and Linux keep the standard frame and menu bar.
- Right-clicking text gets an edit menu: spelling suggestions and Learn Spelling for a misspelt word, then Cut, Copy, Paste, Select All (Copy only for selected text outside a field).
- On close, the app waits for a pending save (at most 3 s).
- The window's size and place are remembered.
- `TASKITE_HEADLESS=1` renders offscreen with no window or Dock icon (for automated checks); `TASKITE_USER_DATA=<dir>` uses another data folder.
- Packages: macOS dmg and zip (arm64 and x64, ad-hoc signed), Windows NSIS, Linux AppImage; app id `dev.gridloc.taskite`.

## §13 iOS

- Capacitor wraps the same web client for iPhone and iPad. A bridge script loads before the client and provides `taskiteNative` (§12), so the client uses the native store as it does on the desktop.
- The tasks file and `attachments/` live in the app's Documents folder, which the Files app shows under On My iPhone › Taskite. Saves follow §3.3 and §3.4: one at a time, refused if the file changed since it was read, and written to a temp file that is then renamed over `tasks.json`.
- The web client's phone and touch layout applies (§5.5); the page runs edge to edge under the status bar and home indicator.
- There is no menu bar or full screen. When iOS sends the app to the background, it finishes saving, as the desktop app does before a window closes.
- The app is built from source and installed with the builder's own Apple developer account; it isn't on the App Store. The Xcode project names no Apple team: the team ID goes in `apps/ios/ios/signing.local.xcconfig`, which git ignores. App id `dev.gridloc.taskite`.

## §14 Workspaces

A workspace is a whole separate set of tasks, projects, labels, Trash, attachments and settings (theme included), such as Work, Games and Personal. Nothing is shared between workspaces, and nothing in one workspace counts or shows in another.

### §14.1 Files

- Each workspace is its own data file with its own `attachments/` folder beside it. Every rule in §3 (reading, saving, versions, conflicts, recovery, the Trash's 30 days) applies to each file on its own.
- The first workspace is the existing `tasks.json` (§3.6), so a file from before workspaces opens as the only workspace with nothing moved. Its id is `main`, and it can't be deleted.
- Every other workspace lives in `workspaces/<id>/tasks.json` (and `workspaces/<id>/attachments/`) next to `tasks.json`. An id is a UUID.
- The list of workspaces is `workspaces.json` next to `tasks.json`, written pretty-printed and saved like the data file (atomic, versioned, refused on a conflict):

  ```json
  { "version": 1, "workspaces": [{ "id": "main", "name": "Personal" }, { "id": "<uuid>", "name": "Work" }] }
  ```

  The order of the list is the order in the switcher. Reading follows §3.2: a missing file is the single workspace `main` named "Tasks"; a missing `main` entry is put first; an entry without a UUID id or a name, or a repeated id, is dropped; unknown fields are kept. A `workspaces/<id>/` folder with no entry is left alone (never read, never deleted). A `workspaces.json` that isn't JSON, or one with a newer `version`, is left as it is: the app shows `main` alone, refuses to add, rename or delete workspaces, and says why in a notice.
- The recovery snapshot (§3.5) is kept per workspace: `main` keeps `taskite.unsaved`, and every other workspace uses `taskite.unsaved.<id>`.
- Which workspace is open is remembered per device (in `localStorage`, `taskite.workspace`), not in the files: two devices on one NAS can each show a different workspace. A remembered id that no longer exists falls back to `main`.

### §14.2 Switching

- A row near the top of the sidebar, under the app's name, shows the open workspace's name with a chevron. On a phone it is the first row of Browse. A click (or Enter on it) opens a menu: every workspace in order with a check on the open one and its shortcut, then **New Workspace…**, **Rename Workspace…**, **Delete Workspace…**.
- **Switch to <name>** for each workspace is in ⌘K and, on the desktop, in the Go menu. ⌃1 … ⌃9 switch to the first nine workspaces (Ctrl+1 … Ctrl+9 on Windows and Linux). A shortcut written `ctrl+` in the command list is ⌃ on macOS and Ctrl elsewhere.
- Switching first finishes any pending save of the open workspace (as when a window closes, §12). If that save fails or conflicts, the switch stops and the save's own notice or dialog shows. Then the other workspace's file loads and opens on its own `lastView` (§5.1). Undo history doesn't cross workspaces: switching clears it.
- The window title is "<workspace> — Taskite" when there is more than one workspace, and "Taskite" when there is one.
- With one workspace, the switcher row still shows its name, and the menu still offers New Workspace….

### §14.3 Managing

- **New Workspace…** asks for a name (required, at most 80 characters, not the same as another workspace's ignoring case), creates an empty workspace after the last one, and switches to it. It opens on Today with its empty state (§9); its settings start at the defaults.
- **Rename Workspace…** changes the open workspace's name (same rules).
- **Delete Workspace…** (not for `main`) asks first, naming the workspace and how many open tasks it has. It switches to `main` if the workspace is open, removes the entry from `workspaces.json` and moves the folder to `workspaces/.deleted/<id>-<epoch ms>/`, never deleting it for good, then shows the notice "Deleted workspace <name>." with Undo, which puts the folder and entry back and switches to it. A workspace that was never saved has no folder, and nothing is moved.
- Workspace changes aren't steps in a workspace's own undo history.
- If `workspaces.json` changed somewhere else, the app reads it again when its window comes to the front (as §3.4) and updates the switcher. A save that conflicts on it is read again and retried once, because its changes are small and named; if the open workspace was deleted elsewhere, the app switches to `main` with the notice "The workspace <name> was deleted elsewhere, so Taskite opened <main's name>."

### §14.4 Platforms

- **Desktop and iOS:** the bridge takes a workspace id with every data and attachment call, and the native side checks that it is `main` or a UUID before it builds any path.
- **Browser:** the same layout inside the origin's private file system. It can't rename a folder everywhere, so moving one to or from `.deleted` copies it, then deletes the original.
- **NAS:** `GET`/`PUT /api/workspaces` for `workspaces.json` (same `ETag`/`If-Match` rules as `/api/data`); a `GET` with no file yet gets 204, since that is the usual case. `/api/data`, `/api/copies` and `/api/attachments/…` take `?workspace=<id>` (`main` when left out, and the app leaves it out for `main`); an id that isn't `main` or a UUID gets 400. `POST /api/workspaces/<id>/delete` and `/restore` move the folder to and from `workspaces/.deleted/`.
- **CLI:** `--workspace <name>` (or `$TASKITE_WORKSPACE`) picks a workspace by name, ignoring case; without it the CLI uses `main`. An unknown name fails listing the workspaces (exit 2); a `workspaces.json` it can't read fails with exit 1 unless no workspace was named. `taskite workspaces` lists them in order with open counts (`--json`: `id`, `name`, `open`). `taskite path` prints the chosen workspace's file.
