# Changelog

## Unreleased

### What's new

- **Workspaces.** Keep separate sets of tasks, projects, labels and settings, such as one for work, one for the games you're making and one for home. Switch from the button at the top of the sidebar, with `⌃1` to `⌃9` (`Ctrl+1` to `Ctrl+9` on Windows and Linux), from ⌘K or from the Go menu. Each workspace has its own file, theme and undo, and Taskite opens the one you last had open. Deleting a workspace asks first and can be undone. Your existing tasks become the first workspace, with nothing moved. On the command line, `--workspace <name>` works on another workspace and `taskite workspaces` lists them.

- **Copy tasks.** `⌘C` (`Ctrl+C` on Windows and Linux) copies the chosen tasks as a Markdown task list, such as `- [ ] Pay rent 2026-12-01 every month p1 #Home @bills`, with notes and subtasks indented under them. Paste one into a note or a chat, or back into Taskite's add row.
- **Drag a stack.** Dragging several chosen tasks carries them as one stack with a count on it, so you can see how many are moving.
- **Breadcrumbs.** A project's title now reads Projects / Work.
- **Undo in the task editor.** `⌘Z` and `⇧⌘Z` now work while a task is open. Adding a field is a step of its own, so Undo hides it again, and taking a field away comes back with its value.
- **Taskite for iPhone and iPad.** Build it from source with your own Apple developer account and install it from Xcode; see [Development](docs/development.md#the-ios-app). Your tasks are kept in a `tasks.json` you can see in the Files app, under On My iPhone › Taskite.
- **Made for phones.** On a narrow screen a tab bar along the bottom holds Today, Upcoming, Inbox and Browse (search, projects, labels, Completed, Trash), and a round + button adds a task. With a finger, tap a task to open it, swipe right to complete it, swipe left to trash it, and hold it for its menu, which opens as a sheet along the bottom. This works in a phone's browser and in the iPhone app.
- **Within reach of your thumb.** On a phone, Browse's search box sits at the bottom, and the new-task box docks there too with a ✓ to add; both ride on top of the keyboard. Dialogs open from the bottom, with the due date's quick picks next to Set Date and no keyboard until you tap a field. Hold the tab you're on for the view's menu, pick a priority from one row of flags, and tap a little outside a check circle to complete a task.

## 1.0.0

### Before you update

- **Tasks is now Taskite.** The app keeps its tasks in a new folder (`Taskite` instead of `Tasks` in the app data folder). The first time Taskite starts, it reads your old tasks and shows them; the first change you make saves them to the new file. The old file is left as it was, so you can delete it once you're happy.
- **The NAS server moved to port 8788,** and its settings are now `TASKITE_DATA`, `TASKITE_TOKEN`, `TASKITE_HOST`, `TASKITE_PORT`, `TASKITE_NO_AUTH` and `TASKITE_HOSTS`. Update your `compose.yaml` from [compose.example.yaml](compose.example.yaml).

### What's new

- **Runs everywhere on one file.** Besides the desktop app, Taskite now runs in a browser and on your NAS from a small Docker image, behind a token. See [Getting started](docs/getting-started.md).
- **The `taskite` command line.** `list`, `add`, `done`, `reopen`, `trash`, `restore`, `projects` and `path` on the same tasks file, with `--json` for scripts and agents.
- **Changes made somewhere else are caught.** If the file changed in another window, on another computer or from the CLI while you had changes, Taskite asks whether to save yours as a copy, keep yours, or use theirs. Nothing is overwritten without asking.
- **Unsaved changes come back.** Changes that couldn't be saved are kept and offered back the next time Taskite starts.
- **New app icon.**
- **Sections and boards.** Split a project into named sections (**Add Section…** in its ⋯ menu), and show it as a board with a column per section (**View as Board**). Drag tasks between sections, or move them with `⌥←` and `⌥→`. `taskite add --section <name>` adds into one, and `taskite list --project` prints the sections.
- **A calendar for due dates.** The due date dialog (`D`) has a month calendar with today ringed. Pick a day with the mouse or the arrow keys. The dialog also takes short day names such as "fri" and "next tue".
- **Label colours and renaming.** Right-click a label and choose **Edit Label…** to rename it on every task or give it a colour, which shows on task rows and in the sidebar.
- **`taskite` knows tasks by name.** `taskite done call mum` works without looking up an id; when several tasks match, it lists them instead of guessing. New `taskite move <task> <project>` and `taskite due <task> <date>` commands.
- **Changes from elsewhere show up on their own.** A task added with the `taskite` command, or in another window or on another device, appears when you come back to the window (and every 15 seconds while it's in front), with Undo. Before, you only found out when your next change ran into it.
- **Move tasks up and down** with `⌥↑` and `⌥↓` (`Alt+Up` / `Alt+Down` on Windows and Linux). Choose one or several tasks; subtasks come along with their task.
- **Show completed tasks in any view.** **Show Completed Tasks** (View menu or ⌘K) lists finished tasks after the open ones in the Inbox, projects, labels, Today and Upcoming, so you can see what you've done and reopen it with Space.
- **More right-click menus.** The empty part of a list, sidebar projects and labels, Completed, the Trash and the Projects heading now have menus with the actions that fit them, such as **Add Task Here**, **Edit Project…** and **Empty Trash…**.
- **Jump between sections.** In a list, `⇧⌥↓` and `⇧⌥↑` go to the first task of the next or previous section. On a board, `→` and `←` go to the task beside this one in the next column, and `⇧⌥→` / `⇧⌥←` to the top of it. **Go to Section…** (`G` then `S`, or ⌘K and the section's name) goes straight to any section; in an empty one it opens the add-task row.

### Improvements

- **Enter renames a task in its row**, and ⌘Enter (Ctrl+Enter) opens the task editor, as **Rename Task** and **Edit Task…** in the right-click menu do. Double-clicking a task opens the editor too. The name field stays open with what you typed when you switch to another window.
- **↑ and ↓ reach the Add task button** after each section's tasks, so you can add a task without the mouse: press Enter on it, or just start typing the task. Tab onto it puts the cursor there too, and its highlight goes when the keyboard moves off it.
- **New Task adds beside the task you're on**: in its section or board column, or on its day in Upcoming. With no task chosen it adds at the end of the list (the first column on a board, today in Upcoming).
- **Tab reaches every board column.** Before, a board was one Tab stop, so the tasks in the other columns could only be reached with the mouse. Tab into a column chooses the task it lands on.
- **New Task is ⌘N** (Ctrl+N), and **New Project… is ⇧⌘N** (Ctrl+Shift+N). `N` still adds a task; `Q` no longer does.
- In the command menu (⌘K) and the **Move to** list, Tab and Shift+Tab move the highlight down and up, like the arrow keys.
- ⌘Enter (Ctrl+Enter on Windows and Linux) saves and closes the task editor from any field, the description included, like **Done**. It presses the main button in the other dialogs too.
- **Faster with many tasks.** Long lists build about 40 times faster: with a few thousand tasks, moving through the list with the arrow keys no longer stutters.
- **Dates read the way you mean them.** `next week` and `next month` are a week or a month from today, and `next monday` is the Monday after the coming one (on a Sunday, no longer tomorrow). New: `this friday`, `this weekend`, `next weekend`, `next year`, `day after tomorrow`, `end of month`, `in a week`, `in two months` and `3 days from now`.
- **A lighter task editor.** Changes apply as you make them, with no Save button, and each one can be undone. Only the fields a task uses are shown; add others from **+ Add**.
- **Upcoming follows the calendar week.** It lists the rest of this week day by day, then Next Week as one group, then Later, so "this week" means the same thing as on your calendar. The week starts on the day your region uses.
- **Safe with newer versions.** Taskite keeps parts of the tasks file it doesn't understand, and won't open a file saved by a newer Taskite, so running an older copy (an old Docker image, say) can't damage it.
- **On macOS the title bar is gone.** The window buttons sit in the sidebar, and the top of the window still drags it.
- **Less traffic to the NAS.** Checking for changes made elsewhere downloads the tasks file only when it changed, and the server sends a Content-Security-Policy header that also stops other sites framing it.
- **The command menu (`⌘K`) finds more.** Spaces don't matter (`newtask` finds **New Task**), the closest matches come first, and commands answer to other words for them, such as `preferences`, `deadline` or `reorder`.
- **Text fields have a right-click menu** in the desktop app: Cut, Copy, Paste, Select All, and spelling suggestions.
- **New look** across the sidebar, lists, dialogs and menus. The theme button moved into **Settings** (`⌘,`).
- **Safer saving.** Saves are atomic, a failed save is retried, and **Try again** stays in the status bar until it works. A file that can't be read is copied aside, never deleted.
- **The window remembers its size and place.**

### Bugs fixed

- **New Task works on a board** whose tasks are all in sections; before, nothing happened.
- **Emptying the Trash could delete a subtask that wasn't in it.** A subtask restored on its own, whose parent was later trashed and deleted, went with it. Subtasks in the Trash now also move with their parent, so a restored one comes back beside it.
- **Unsaved changes from last time could be lost at start-up.** When Taskite started with old tasks to empty from the Trash, that save replaced the copy of your unsaved changes before it was offered back.
- The task editor saves only the fields you typed in, so it no longer puts back a change made elsewhere (the CLI, another window) to the task's other fields. Text you typed is saved before ⌘K, another dialog, a save conflict or closing the window replaces the editor, and the editor closes when its task is deleted elsewhere.
- The desktop app's window closes when a save has failed or is in conflict; before, it ignored the close button. Unsaved changes are kept in the recovery snapshot and offered at the next start.
- Keep Mine in a save conflict no longer overwrites a tasks file that a newer Taskite saved in the meantime; it says to update Taskite instead. An error from Keep Mine now shows as a notice.
- A tasks file saved with a byte-order mark opens instead of being treated as unreadable, and a file holding JSON that isn't an object (`[]`, `null`) is kept as a copy instead of being replaced by an empty list.
- A notice's **Undo** goes away once anything else changes your tasks, so it can no longer take back a different change than the one the notice names.
- ⌘Z pressed while a completed or trashed task is still fading out cancels that change; before, it undid the change before it and the task was completed anyway.
- A monthly or yearly task checked off weeks late keeps its day of the month: a task due on the 31st no longer moves to the 28th after catching up over February.
- A refresh that read the file just before one of this window's saves no longer puts the older file back over the change you just made. Requests to the NAS server give up after 20 seconds, so a server that stops answering shows "Couldn't save your tasks." instead of saving forever.
- Enter and Space on **Add task**, **Add section** or a section's ⋯ button press that button instead of opening or completing the task under the cursor.
- The task editor's subtask field reads Quick Add words as the PRD says: "Call mom tomorrow p1" adds a subtask named "Call mom", due tomorrow, priority 1.
- Quick Add: "Call mom on may 5" no longer leaves "on" in the name, and "feb 29" typed in a year before a non-leap year finds the next Feb 29 instead of being ignored.
- CLI: `taskite done bed` completes "Make bed" instead of whichever task's id happens to start with "bed". Ids now need at least 4 characters and are tried after titles, among the tasks the command can act on.
- Choosing tasks: ⇧↓ and ⇧-click grow a range again after you change view, the cursor moves to the next row when its own row goes away (Clear Completed, Undo, a change made elsewhere), and checking off a task outside your choice no longer clears the choice.
- A change that leaves everything as it was (the same priority again, a move to the project a task is already in, Move Up at the top of a section) no longer adds an undo step, so the next ⌘Z always undoes something you can see.
- Subtasks can't be dragged, as the PRD says; dragging one used to shuffle it among its siblings or pull it away from its parent. Dragging a parent with its subtasks chosen moves the parent, and the subtasks follow it.
- The right-click menu stays inside a short window and scrolls when it doesn't fit, so its last items are always within reach.
- The NAS server starts from a folder whose path has spaces in it.
- Saving through a symlinked `tasks.json` keeps the link instead of replacing it with a plain file, and on Windows a save waits briefly when another program has the file open.
- Two browser tabs, or the desktop app and the CLI, saving at the same moment can no longer both pass the version check and lose one of the changes.
- Enter and Esc while typing with an input method (Japanese, Chinese, Korean) pick or cancel the candidate instead of adding the task, closing the dialog or clearing the search.
- After a click on empty space inside a dialog, Esc still closes it and Tab stays inside, and closing a dialog puts focus back where it was before it opened.
- Priority keys 1–4 work on AZERTY keyboards, and pressing G in the list then typing I in the search box types the I instead of jumping to the Inbox.
- Deleting a project or removing a label from the sidebar while another view is open no longer jumps to the Inbox.
- A task dropped on the lower half of a row lands below it, and the drop line no longer flickers as the pointer crosses the row's title.
- On a phone-width screen the sidebar sits above the list instead of squeezing it, and a long section name no longer hides its ⋯ button.
- Completed shows each day's heading once, and the Trash lists a subtask whose parent no longer exists instead of hiding it.
- When the browser's storage is full, a failed save says there is no backup copy, and an older backup is removed instead of offering stale tasks to restore next time.
- A task that repeats monthly on the 29th, 30th or 31st no longer stays on an earlier day after it is checked off in a short month: a task due on the 31st goes to February 28, then back to March 31.
