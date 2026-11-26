# Taskite glossary

Taskite is a to-do list for one person: **tasks** in **projects**, shown in **views**, kept in one **tasks file** per **workspace** that the desktop app, the browser, the NAS server and the CLI all share.

## Language

### Tasks

**Task**: One thing to do: a **name**, and optionally a **description**, **due date**, **repeat**, **priority**, **labels**, **subtasks** and **attachments**. It sits in exactly one **project**. _Avoid_: item, to-do, todo, card (a board shows a task as a card, but it is still a task)

**Name**: The one line that says what a **task** is. `title` in the code. _Avoid_: title, text

**Description**: Longer text under a **task's** **name**, written in the task editor. _Avoid_: notes, body, details

**Due date**: The day a **task** is due, without a time of day. A task with a due date before today is **overdue**. _Avoid_: deadline, date (on its own), scheduled date

**Repeat**: A rule that brings a **task** back on a new **due date** when it is **completed**: every day, weekday, week, month or year. `recurrence` in the code. _Avoid_: recurrence, recurring rule, routine

**Priority**: How urgent a **task** is, from `p1` (urgent) to `p4` (normal, the default). _Avoid_: importance, urgency, flag (the flag is only its icon)

**Label**: A word attached to a **task**, written `@phone` in **Quick Add**. A task can have many; each label also has a **view** of its own. _Avoid_: tag, context, category

**Subtask**: A **task** inside another task, one level deep. Completing a task completes its subtasks. _Avoid_: child task, checklist item, step

**Attachment**: A file copied in beside the **tasks file** and linked to a **task**, up to 25 MB. _Avoid_: upload, file (on its own)

**Complete**: To mark a **task** finished. A completed task with a **repeat** moves to its next due date instead. Its opposite is **reopen**. _Avoid_: done, check off, finish, close

**Trash**: Where a **task** goes when it is deleted, for 30 days, until it is **restored** or deleted for good. _Avoid_: bin, archive, deleted items

**Quick Add**: Typing a whole **task** in one line, with its **due date**, **repeat**, **priority**, `#project` and `@labels` written inline. _Avoid_: natural language input, smart add

**Add row**: The **Add task** row at the end of a list, which turns into a one-line editor for **Quick Add**. Called the composer in the PRD and the code while it is open. _Avoid_: input box, new task field

### Organising

**Workspace**: A separate set of **tasks**, **projects**, **labels** and **settings** with its own **tasks file**, theme and undo, such as one for work and one for home. _Avoid_: profile, account, space, vault

**Project**: A named, coloured list of **tasks** in a **workspace**, written `#Home` in **Quick Add**. **Inbox** is the project every workspace starts with. _Avoid_: list, folder, area

**Inbox**: The **project** a **task** goes to when no other is given. It can't be deleted. _Avoid_: default project, unsorted

**Section**: A named group of **tasks** inside a **project**, such as To do, Doing and Done, shown as a column on a **board**. `ProjectSection` in the engine. _Avoid_: column (except on a board), group, heading, lane

**Automation**: A rule on a **section** that changes a **task** when it enters the section, leaves it, or is **completed** there. Edited in **Section Automations…**. _Avoid_: trigger, workflow, action (an action is one step of a rule)

**Board**: A **project** shown with its **sections** side by side as columns of cards, instead of as a list. _Avoid_: kanban

### Views

**View**: One screen of **tasks**: **Inbox**, a **project**, **Today**, **Upcoming**, a **label**, **Completed**, the **Trash**, or a search. _Avoid_: page, filter, perspective

**Today**: The **view** of what is due today, with anything **overdue** above it.

**Upcoming**: The **view** of what is due after today, one day at a time this week, then next week, then later. _Avoid_: calendar, agenda, schedule

**Completed**: The **view** of **completed** **tasks**, under the day each was completed. _Avoid_: done, archive, history, logbook

**Overdue**: A **task** whose **due date** has passed and that is not **completed**. Overdue tasks head **Today** and **Upcoming**, in red. _Avoid_: late, past due

### Working in the app

**Chosen**: The **tasks** an action applies to: the one you clicked, or several picked with Shift, ⌘-click or Shift-click. Shown with a tint. `selected` in the code. _Avoid_: selected, highlighted, marked, checked

**Cursor**: The **task** (or **add row**) the keyboard is on, shown with a ring. The arrow keys move it, and the keyboard focus always follows it. _Avoid_: focus (on its own), current task, caret

**Command**: One action the app can run, with a name and any shortcuts. Every way to run something (keys, the **command menu**, the right-click menu, the menu bar) comes from the one list of commands. _Avoid_: action (in the UI), function

**Command menu**: The searchable list of every **command**, **project** and **label**, opened with `⌘K`. _Avoid_: command palette, launcher, quick open

**Notice**: A short message in the status bar at the bottom of the window, often with **Undo**. _Avoid_: toast, snackbar, popup, alert

### Files and saving

**Tasks file**: The `tasks.json` that holds a **workspace's** **tasks**, **projects** and **settings**. Each host reaches it its own way: the app's data folder, the browser's storage, or the NAS. _Avoid_: database, store (the store is the code that reads and writes it), document

**Conflict**: When the **tasks file** changed somewhere else since Taskite last read it, and you had changes of your own. Taskite stops and asks: **Save Mine as a Copy**, **Keep Mine** or **Use Theirs**. _Avoid_: merge, collision, sync error

**Settings**: The choices kept with each **workspace** in its **tasks file**: the theme, whether **views** show **completed** **tasks**, and whether a **section** named Done gets its **automations**. _Avoid_: preferences, options

## Relationships

- A **workspace** has one **tasks file**, which holds its **projects**, **tasks**, **label** colours and **settings**.
- A **workspace** has one **Inbox** and any number of other **projects**.
- A **project** holds many **tasks** and any number of **sections**, in order; a **task** sits in at most one **section**, or above the first.
- A **section** holds up to 10 **automations** of up to 5 actions each.
- A **task** has any number of **labels**, **subtasks** (one level deep) and **attachments**, and at most one **due date**, **repeat** and **priority**.
- A **view** shows **tasks** from one or more **projects**; only **Inbox** and **project** views keep your order and allow **sections**.
- There is one **cursor** per **view**, and any number of **chosen** **tasks**; the **cursor** is usually one of them.

## Flagged ambiguities

- "Section" meant both a **project's** named group of tasks and any heading in a **view** (Overdue, a day in **Upcoming**). Resolved: **section** is only the project's group. The engine's view type `Section` is a heading group, and is not a section in this sense.
- "Done" meant completing a task, a **section** name, and the **Completed** view. Resolved: the action is **complete**, the view is **Completed**, and Done is only the name of a section the app gives **automations**.
- "Selected" and "chosen" both meant the tasks an action applies to. Resolved: the UI says **chosen** (Choose All, Choose None); the code's `selected` stays as it is.
- "Notes" and "description" both meant a task's longer text. Resolved: **description**, as the task editor labels it.
- "Focus" meant both the browser's keyboard focus and where the app draws the ring. Resolved: the app's own state is the **cursor** (and a menu's active item); keyboard focus follows it.
