# Section automations (PRD §6.1)

Each slice leaves `just check` green and fits one session.

- [x] **1. Engine model.** `automations` on `ProjectSection`: types, reading (drop unknown actions and empty rules), writing (left out when empty), invariants (a section's rules name existing projects and sections; deleting a section or project drops rules that point at it). Unit tests and a random-operation seed.
- [x] **2. Engine runner.** Run _enters_ rules on create and on move into a section, and _complete_ rules on completing; actions in order; chaining with each section once per go; the result says which actions ran, for the notice. All inside the one change, so undo is one step. Tests for each trigger and action, chaining and loops. Waits on 1.
- [x] **3. App wiring.** Moves, drags, Add task in a section, Quick Add and completing go through the runner; the notice names what the automation did, with Undo. `taskite add --section` and `done` in the CLI run it too. Waits on 2.
- [x] **4. Editor dialog.** **Section Automations…** command (heading ⋯, right-click, ⌘K), the rule-builder dialog with its limits, Save as one undo step, the "Apply to the N tasks already here?" question. `docs/controls.md`, the features map, e2e scenario. Waits on 1 (and 2 for Apply).
- [x] **5. Heading badge.** ⚡ count on list headings and board columns, hover summary, click to edit. e2e screenshot check. Waits on 4.
