# Changelog

## Unreleased

### What's new

- **Sections and boards.** Split a project into named sections (**Add Section…** in its ⋯ menu), and show it as a board with a column per section (**View as Board**). Drag tasks between sections, or move them with `⌥←` and `⌥→`. `taskite add --section <name>` adds into one, and `taskite list --project` prints the sections.
- **A calendar for due dates.** The due date dialog (`D`) has a month calendar with today ringed. Pick a day with the mouse or the arrow keys. The dialog also takes short day names such as "fri" and "next tue".
- **Label colours and renaming.** Right-click a label and choose **Edit Label…** to rename it on every task or give it a colour, which shows on task rows and in the sidebar.
- **`taskite` knows tasks by name.** `taskite done call mum` works without looking up an id; when several tasks match, it lists them instead of guessing. New `taskite move <task> <project>` and `taskite due <task> <date>` commands.
- **Changes from elsewhere show up on their own.** A task added with the `taskite` command, or in another window or on another device, appears when you come back to the window (and every 15 seconds while it's in front), with Undo. Before, you only found out when your next change ran into it.
- **Move tasks up and down** with `⌥↑` and `⌥↓` (`Alt+Up` / `Alt+Down` on Windows and Linux). Choose one or several tasks; subtasks come along with their task.
- **More right-click menus.** The empty part of a list, sidebar projects and labels, Completed, the Trash and the Projects heading now have menus with the actions that fit them, such as **Add Task Here**, **Edit Project…** and **Empty Trash…**.

### Improvements

- **Dates read the way you mean them.** `next week` and `next month` are a week or a month from today, and `next monday` is the Monday after the coming one (on a Sunday, no longer tomorrow). New: `this friday`, `this weekend`, `next weekend`, `next year`, `day after tomorrow`, `end of month`, `in a week`, `in two months` and `3 days from now`.
- **A lighter task editor.** Changes apply as you make them, with no Save button, and each one can be undone. Only the fields a task uses are shown; add others from **+ Add**.
- **Upcoming follows the calendar week.** It lists the rest of this week day by day, then Next Week as one group, then Later, so "this week" means the same thing as on your calendar. The week starts on the day your region uses.
- **Safe with newer versions.** Taskite keeps parts of the tasks file it doesn't understand, and won't open a file saved by a newer Taskite, so running an older copy (an old Docker image, say) can't damage it.
- **On macOS the title bar is gone.** The window buttons sit in the sidebar, and the top of the window still drags it.
- **The command menu (`⌘K`) finds more.** Spaces don't matter (`newtask` finds **New Task**), the closest matches come first, and commands answer to other words for them, such as `preferences`, `deadline` or `reorder`.
- **Text fields have a right-click menu** in the desktop app: Cut, Copy, Paste, Select All, and spelling suggestions.

### Bugs fixed

- **Emptying the Trash could delete a subtask that wasn't in it.** A subtask restored on its own, whose parent was later trashed and deleted, went with it. Subtasks in the Trash now also move with their parent, so a restored one comes back beside it.
- **Unsaved changes from last time could be lost at start-up.** When Taskite started with old tasks to empty from the Trash, that save replaced the copy of your unsaved changes before it was offered back.
- The task editor saves only the fields you typed in, so it no longer puts back a change made elsewhere (the CLI, another window) to the task's other fields. Text you typed is saved before ⌘K, another dialog, a save conflict or closing the window replaces the editor, and the editor closes when its task is deleted elsewhere.
- The desktop app's window closes when a save has failed or is in conflict; before, it ignored the close button. Unsaved changes are kept in the recovery snapshot and offered at the next start.
- Keep Mine in a save conflict no longer overwrites a tasks file that a newer Taskite saved in the meantime; it says to update Taskite instead. An error from Keep Mine now shows as a notice.
- A tasks file saved with a byte-order mark opens instead of being treated as unreadable, and a file holding JSON that isn't an object (`[]`, `null`) is kept as a copy instead of being replaced by an empty list.

## 2.0.0

### Before you update

- **Tasks is now Taskite.** The app keeps its tasks in a new folder (`Taskite` instead of `Tasks` in the app data folder). The first time Taskite starts, it reads your old tasks and shows them; the first change you make saves them to the new file. The old file is left as it was, so you can delete it once you're happy.
- **The NAS server moved to port 8788,** and its settings are now `TASKITE_DATA`, `TASKITE_TOKEN`, `TASKITE_HOST`, `TASKITE_PORT`, `TASKITE_NO_AUTH` and `TASKITE_HOSTS`. Update your `compose.yaml` from [compose.example.yaml](compose.example.yaml).

### What's new

- **Runs everywhere on one file.** Besides the desktop app, Taskite now runs in a browser and on your NAS from a small Docker image, behind a token. See [Getting started](docs/getting-started.md).
- **The `taskite` command line.** `list`, `add`, `done`, `reopen`, `trash`, `restore`, `projects` and `path` on the same tasks file, with `--json` for scripts and agents.
- **Changes made somewhere else are caught.** If the file changed in another window, on another computer or from the CLI while you had changes, Taskite asks whether to save yours as a copy, keep yours, or use theirs. Nothing is overwritten without asking.
- **Unsaved changes come back.** Changes that couldn't be saved are kept and offered back the next time Taskite starts.
- **New app icon.**

### Improvements

- **New look** across the sidebar, lists, dialogs and menus. The theme button moved into **Settings** (`⌘,`).
- **Safer saving.** Saves are atomic, a failed save is retried, and **Try again** stays in the status bar until it works. A file that can't be read is copied aside, never deleted.
- **The window remembers its size and place.**
