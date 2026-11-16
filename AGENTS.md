# Taskite — agent guide

Taskite is a to-do list for one person. One UI runs in the browser, in the NAS server's client and in the Electron app; a CLI works on the same `tasks.json` with the same engine. The spec is [docs/plans/prd.md](docs/plans/prd.md), the code layout is [docs/architecture.md](docs/architecture.md), and the commands are in [docs/development.md](docs/development.md).

## Gates

- `just check` (= `pnpm check`) must pass before you commit: Prettier check, ESLint, `tsc -b`, Vitest (including the architecture rules in `test/architecture.test.ts`), and the build.
- When the owner corrects something, turn the correction into a rule in `test/architecture.test.ts` or a test, not a comment or a line here.
- Never add to `test/architecture-baseline.json`. Fix the violation; lower or delete its entry when you do. A comment is never permission: a deliberate exception (`ignoreError(promise, 'why')`, an `eslint-disable`, a `@ts-expect-error`) goes in `test/architecture-exceptions.json` only after the owner agrees.
- Page timers go through `packages/ui/src/schedule.ts` (`wait`, `after`, `every`, `debounce`), never `setTimeout` directly.
- When you change behaviour, add or update a test in the package's `test/` folder, and update the PRD section the code cites (`PRD §n`).
- Check UI changes headlessly (a browser driven in the background, or the desktop app with `TASKITE_HEADLESS=1`). Never open a visible window to check your work.
- Never point a check at the real data file. Use `TASKITE_USER_DATA=<temp dir>` for the desktop app and `--file <temp file>` for the CLI.

## Layout

| Path            | What it is                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core` | The pure engine: the task model, `tasks.json` reading and writing, Quick Add parsing, dates, recurrence, undo. No DOM or Node (ESLint enforces it). |
| `packages/ui`   | Preact and signals: the command catalog, dialogs, ⌘K, icons, and the `TaskStore` adapters.                                                          |
| `apps/web`      | The app shell, the list of commands and the Vite entry point. One static build serves the browser, the NAS server and the desktop app.              |
| `apps/server`   | The NAS server (`node:http`): serves the client and `/api/data`. No framework.                                                                      |
| `apps/desktop`  | The Electron shell: main process, sandboxed preload bridge, native menu.                                                                            |
| `apps/cli`      | The `taskite` CLI, run from source. It depends on `packages/core` only.                                                                             |

## Golden rules

1. **The engine stays pure.** It has no UI, DOM or Node APIs, and runs the same in a browser, a worker or Node tests.
2. **The file is the source of truth.** No database. A save writes exactly what the user has, in the 1.x format (PRD §3.1).
3. **One command catalog.** The command menu, shortcuts, context menus, the Electron menu bar, the Keyboard Shortcuts window and `docs/controls.md` all read it. Don't wire a key or a menu item past it.
4. **The UI reaches the file only through `TaskStore`.** It never knows whether data is in memory, in the browser, on the NAS or on disk.
5. **Never lose data.** Saves are atomic everywhere. A conflict is shown and the user chooses; nothing merges or overwrites silently. Deleting goes to the Trash.
6. **Security.** The Electron renderer is sandboxed with context isolation; its only native access is the `taskiteNative` bridge, which reaches only the data file. The server serves only its data file and static folder, and checks `Host` when there is no token.
7. **Dependencies.** The runtime dependencies are Preact and `@preact/signals`. Don't add a package without the owner's approval. Pin versions exactly.
8. **Nothing left to interpretation.** If a behaviour isn't in the PRD, stop and ask, then record the answer in the PRD.

## TypeScript conventions

- Strict mode with `noUncheckedIndexedAccess` and `erasableSyntaxOnly`: no enums, parameter properties or namespaces. Use union types and `const` objects.
- Relative imports end in `.ts`. Use `import type` for types only.
- Each package's `src/index.ts` names its exports one by one. Other packages import only through `@taskite/<package>`; ESLint and the architecture test reject deep imports.

## Git workflow

- Keep commits small and coherent. Write the message as a plain sentence about the user-visible effect.
- Commit only when `just check` is green and no questions are outstanding.
