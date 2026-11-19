# Taskite

Taskite is a to-do list for one person. Type a task in one line, with its date, priority, project and labels written inline, and see what's due today and this week at a glance. Run it as a desktop app, in a browser, on your NAS, or from the terminal, all on the same `tasks.json` file.

![Taskite on macOS in the dark theme, showing the Today view. The sidebar on the left has a search box, Add task, and the views Inbox (2), Today (6, selected), Upcoming, Completed and Trash; then the projects Home, Garden, Lisbon trip and Work, each with a coloured dot and a count, and the labels errand, outside and phone. The main list starts with an Overdue section holding "Renew library books", due yesterday in red with the label errand. Under the heading "Today · Sun, Nov 15" are five tasks due today: "Send the quarterly report to Priya" (chosen, with a red priority circle, the description "Numbers are in the shared sheet" and 1 of 2 subtasks done), "Book the airport transfer" with the label phone, "Pay the electricity bill" and "Water the tomatoes", both repeating, and "Pick up dry cleaning". Each row shows its project on the right. An Add task row ends the list.](docs/images/today.webp)

- **Quick Add.** `Call mum friday p1 #Home @phone` becomes a task due Friday, priority 1, in Home, labelled phone. Repeats too: `every weekday`.
- **Works from the keyboard.** `⌘K` runs any command, `N` adds a task, `G` then `T` goes to Today, and `?` lists every shortcut.
- **Never loses a task.** Every change saves at once and can be undone, deleted tasks wait 30 days in the Trash, and a change made somewhere else is never overwritten without asking.

## Getting started

Download the desktop app for macOS, Windows or Linux from the [Releases page](https://github.com/gridlocdev/taskite/releases/latest), or run it on your NAS with Docker:

```bash
docker build -t taskite . && docker run -d -p 8788:8788 -e TASKITE_TOKEN=change-me -v /volume1/taskite:/data taskite
```

See [Getting started](docs/getting-started.md) for the first-launch warnings, the NAS settings and the `taskite` command line.

## Learn more

- [Features](docs/features.md) · [Controls](docs/controls.md) · [Credits](docs/credits.md)
- [All documentation](docs/README.md) · [Working on the code](docs/development.md)

## License

[MIT](LICENSE)
