# Taskite

A simple to-do list app for your computer. It helps you write down things you need to do, give them dates, sort them into groups, and check them off when you're done.

Everything is saved automatically on your own computer. You don't need an account or an internet connection.

---

## Getting started

You only need to do this once.

1. Install **Node.js** (the "LTS" version) from <https://nodejs.org>.
2. Open a terminal in this folder and type:

   ```
   npm install
   ```

3. To open the app, type:

   ```
   npm start
   ```

From then on, `npm start` is all you need.

---

## A quick tour

The window has two parts:

- **The sidebar** on the left, where you choose what to look at.
- **The task list** on the right.

The sidebar has these places:

| Place | What it shows |
|---|---|
| **Inbox** | The default spot for new tasks. Put things here when you're not sure where they belong. |
| **Today** | Everything due today, plus anything overdue (shown at the top in red). |
| **Upcoming** | Your next 7 days, one day at a time, then anything due later. |
| **Completed** | Tasks you've checked off, newest first. |
| **Trash** | Deleted tasks. They stay for 30 days, then go for good. |
| **Projects** | Your own groups, such as "Work", "Home" or "Holiday plans". |
| **Labels** | Tags that can go across projects, such as `@phone` or `@errands`. |

---

## Adding a task

There are a few ways to start a new task. Use whichever is handiest:

- Click **+ Add task** at the bottom of any list.
- Click **Add task** at the top of the sidebar.
- Press **Q** (or **N**) on your keyboard.
- Press **⌘N** on a Mac or **Ctrl+N** on Windows/Linux. This works even while you're typing somewhere else.

A new blank row appears right where your task will go. Type what you need to do and press **Enter**. The task is saved, and a fresh blank row opens just below it, so you can keep typing your whole list without reaching for the mouse.

**When you're done adding**, press **Enter** on the empty row, press **Esc**, or just click somewhere else. Empty rows disappear on their own. If you press **Esc** halfway through typing, your words are kept and will be there the next time you add a task.

You can also type a few shortcuts in the same sentence and the app sorts them out for you. As you type, the row updates to show the date, labels and project it understood, and the circle changes color to match the priority.

**Example:** `Call the dentist friday p1 #Health @phone`

This creates a task called **"Call the dentist"**, due **Friday**, marked **urgent**, in the **Health** project, with the label **phone**.

### Shortcuts you can type

| Type this | What it does | Examples |
|---|---|---|
| A day or date | Sets the due date | `today`, `tomorrow`, `friday`, `next week`, `in 3 days`, `in 2 weeks`, `Dec 25`, `3 Jan`, `2026-11-01` |
| `every …` | Makes the task repeat | `every day`, `every weekday`, `every week`, `every monday`, `every month`, `every year` |
| `p1` to `p4` | Sets the priority | `p1` = urgent (red), `p2` = high (orange), `p3` = medium (blue), `p4` = normal |
| `#Name` | Puts it in a project | `#Work`, `#Home`. If the project doesn't exist yet, it is created for you. |
| `@name` | Adds a label | `@phone`, `@errands`. You can add more than one. |

**Good to know:**

- If you add a task while looking at a project, it goes into that project.
- If you add a task while looking at **Today**, it's due today unless you type another date.
- In **Upcoming**, every day has its own **+ Add task** row, and tasks added there are due that day.
- If you add a task while looking at a label, it gets that label.

---

## Working with tasks

- **Finish a task:** click the circle next to it. The circle's color shows its priority.
- **Change a task:** click on it. A window opens where you can change the name, add notes, pick a date, set it to repeat, change its priority, move it to another project, or edit its labels.
- **Delete a task:** hover over it and click the 🗑 bin icon, or use the **Delete** button in the edit window. It goes to the **Trash**.
- **Made a mistake?** After you finish or delete something, a message pops up in the bottom corner. Click **Undo** to bring it back. You can also press **Ctrl+Z** (**⌘Z** on a Mac), and **Ctrl+Shift+Z** (**⇧⌘Z**) to redo.
- **Right-click a task** for a menu of everything you can do to it.

### Working with several tasks at once

Use **↓** and **↑** to move through the list, and hold **Shift** to choose more than one. With the mouse, **⌘-click** (**Ctrl-click**) adds or removes a task and **Shift-click** chooses a range. Then press **Space** to complete them, **D** to set a due date, **1** to **4** for priority, **M** to move them to a project, or **Delete** to move them to the Trash. Right-click shows the same actions.

### The Trash

Deleted tasks go to the **Trash** in the sidebar, where each one shows how long ago it was deleted and how many days it has left. Click **Restore** to bring a task back, or **Delete forever** to remove it now. To clear everything, open the Trash and choose **⋯ → Empty the Trash**. Tasks are deleted for good after 30 days.

### Repeating tasks

When you check off a repeating task, it isn't removed. It just moves to its next date. For example, "Water plants every day" checked off today will be back tomorrow.

### Subtasks

Big jobs are easier in small steps. Open a task and type steps into the **Subtasks** box at the bottom. Subtasks appear indented under the main task, and the main task shows how many are done (for example `2/5`). Checking off the main task checks off all of its steps too.

### Reordering and moving

In the Inbox or a project, you can **drag tasks up and down** to put them in the order you like.

You can also drag a task onto something in the sidebar:

- onto a **project** or the **Inbox** to move it there
- onto **Today** to make it due today
- onto a **label** to add that label

---

## Projects

- **Add a project:** click the **+** next to "Projects" in the sidebar, give it a name and pick a color.
- **Rename it, change its color, or delete it:** open the project and click the **⋯** button in the top-right corner.

Deleting a project moves its tasks to the Trash. You'll be asked to confirm, and you can still undo it right afterwards. A task restored from a deleted project goes to the Inbox.

## Labels

Labels let you find related tasks across all your projects, like everything you can do by phone. Add them with `@name` when you type a task, or in the **Labels** box when editing one (separate several with commas).

Labels show up in the sidebar automatically once a task uses them. Click one to see every open task with that label. To remove a label from all tasks, open it and choose **⋯ → Remove label from all tasks**.

## Searching

Click the search box at the top of the sidebar (or press **/**) and start typing. It searches task names, notes and labels, including finished tasks. Press **Esc** to clear it.

## Light and dark mode

Click the half-circle button at the top of the sidebar to switch between **Match system**, **Light** and **Dark**.

---

## Keyboard shortcuts and the command menu

Press **?** in the app to see every shortcut, or **⌘K** (**Ctrl+K**) to open the command menu: type a few letters of any action, project or label and press **Enter**. Commands you use often move to the top.

The full list for macOS, Windows and Linux is in [docs/controls.md](docs/controls.md).

The app opens on the list you were last looking at.

---

## Where your tasks are saved

Your tasks are kept in a single file called `tasks.json` on your computer:

| System | Location |
|---|---|
| macOS | `~/Library/Application Support/Taskite/tasks.json` |
| Windows | `%APPDATA%\Taskite\tasks.json` |
| Linux | `~/.config/Taskite/tasks.json` |

**To back up your tasks**, copy that file somewhere safe. **To restore them**, close the app and put the copy back.

If the file ever gets damaged, the app won't delete it. It renames it to `tasks.corrupt-….json` and starts with an empty list, so your old data is still there to recover.

---

## For developers

- **Stack:** Electron, Bootstrap 5 (loaded from `node_modules`, no CDN), and plain JavaScript (ES modules) with JSDoc types. No frameworks and no build step.
- **Dependencies:** `bootstrap` (runtime) and `electron` (dev). That's it.
- **Tests:** `npm test` runs the parser, date, data, shortcut and selection tests with Node's built-in test runner.
- **Type checking (optional):** every file has `// @ts-check`, so editors like VS Code flag type errors as you work.

```
main.js               Electron main process: window, menu bar, reading and saving tasks.json
preload.js            Exposes a small, safe save/load API to the page (window.api)
src/index.html        Page layout and dialogs
src/styles.css        App styles on top of Bootstrap
src/renderer/
  app.js              The interface: sidebar, views, editors, and the command list
                      that feeds the keyboard, command menu, right-click menu,
                      menu bar and Keyboard Shortcuts window
  commands.js         Shortcut matching, key caps and command menu search
  selection.js        Choosing tasks with the keyboard and mouse
  store.js            Data model and every change to it (undo, redo, Trash)
  parser.js           Quick Add text parsing ("tomorrow p1 #Work @phone")
  dates.js            Date helpers and repeat rules
  dom.js              Tiny element builder and inline SVG icons
test/                 Unit tests (node --test)
docs/controls.md      Every control, for macOS and Windows/Linux
```

The page runs with `contextIsolation`, `sandbox` and a strict Content Security Policy. Only the main process touches the file system, and it saves with a write-then-rename so a crash mid-save can't leave a half-written file. If a save fails, the app tries again and then shows a message with **Try again** until it works.
