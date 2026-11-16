# Development

Taskite is a TypeScript pnpm workspace. One Preact build runs in the browser, in the NAS server's client and inside the Electron app; the CLI uses the same engine. [Architecture](architecture.md) explains the layout, and the [product requirements](plans/prd.md) say exactly how everything behaves.

## Getting set up

You need Node 22.18 or later, pnpm (through corepack) and [just](https://github.com/casey/just). Run `just` on its own to list every recipe.

```bash
just setup   # corepack enable, then pnpm install
```

### Running it

| Recipe                      | What it runs                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `just run-web`              | The web client on http://localhost:5173 with hot reload, plus the NAS server on :8788 serving `./.nas-data`           |
| `just run-server`           | The NAS server only, on http://localhost:8788, restarting when its source changes                                     |
| `just preview-web`          | The built web client served by the NAS server, as it runs on a NAS                                                    |
| `just run-desktop`          | The desktop app in dev mode (builds the web client first)                                                             |
| `just run-desktop-headless` | The desktop app with no window or Dock icon, on `./.headless-data`, with DevTools on port 9334 (for automated checks) |
| `just cli <args>`           | The `taskite` CLI from source, for example `just cli list upcoming`                                                   |

The desktop app in dev mode uses your real tasks file. To try it on throwaway data, set `TASKITE_USER_DATA` to another folder:

```bash
TASKITE_USER_DATA=/tmp/taskite-try just run-desktop
```

## Checking your work

```bash
just check        # everything CI runs: format, lint, typecheck, tests, build
just test         # the tests once (pass a file or -t "name" to narrow them)
just test-watch   # the tests in watch mode
just lint         # ESLint
just typecheck    # tsc -b
just fmt          # format every file with Prettier
just fmt-check    # check formatting without changing anything
just fuzz         # the random-edit tests on 500 seeds (FUZZ_SEED=<n> replays one)
just diagram      # redraw the save diagram in architecture.md from its table
just e2e          # browser scenarios in headless Chromium (pass a file or -g "name")
just e2e-update   # accept new screenshots, after looking at the diff in .e2e-results
just e2e-desktop  # the built desktop app starts headless on a throwaway folder
just drive aria   # a quick headless look: cmd:"Go to Work" key:KeyQ type:"Buy milk" shot:after aria
```

Tests live in each package's `test/` folder and run in Node with Vitest. `apps/web/test/controls.test.ts` fails when [Controls](controls.md) and the command catalog disagree, so update that page with any shortcut you add or change.

Browser scenarios live in `e2e/`, one `test.describe` per `##` heading of [Features](features.md); `apps/web/test/features.test.ts` fails when a feature has no scenarios. They run against the built client and the NAS server on a copy of `e2e/fixtures/basic`, with the page clock fixed at 15 January 2027. `random-ui.spec.ts` runs a few seeds of random commands, typing and keys; a failure prints `FUZZ_SEED=<n> just e2e -g random` to replay it. Screenshots are compared on macOS only.

Check UI changes without a visible window: `just drive`, the scenarios, or the desktop app started with `just run-desktop-headless`. Never point a check at your real tasks: use `TASKITE_USER_DATA` for the desktop app and `--file` for the CLI.

## The spec

[docs/plans/prd.md](plans/prd.md) is the spec, in numbered sections. Code cites it (`// PRD §4.6`). When you change a behaviour, change its section in the same commit. If a behaviour isn't in the PRD, decide it and write it down there first.

## Adding a command

Every action is a command in `apps/web/src/app/commands.ts`: an id, a title, a one-sentence description, a group, its shortcuts and what it runs. From that one entry it appears in the command menu, the menu bar, the Keyboard Shortcuts window and, if it acts on tasks, the right-click menu (`TASK_MENU`). Don't wire a key or a menu item anywhere else. Then add the shortcut to [Controls](controls.md).

## The NAS server

`apps/server` is a `node:http` server with no framework. It serves the built web client and the tasks file at `/api/data`, with an `ETag` per version so two browsers can't overwrite each other. Its settings are environment variables, listed in [Getting started](getting-started.md#run-it-on-a-nas-docker).

```bash
just build-docker   # build the image as taskite:latest
just run-docker     # run it on http://localhost:8788 against ./.nas-data, without a token
```

## The CLI

`apps/cli` is the `taskite` command line. It depends on `packages/core` and `packages/node-files` only, and saves the same way the desktop app does (atomic, and refusing if the file changed since it was read). `apps/cli/skill/SKILL.md` is an agent skill that explains it to an AI coding agent. To put `taskite` on your `PATH`, link `apps/cli/bin/taskite.mjs` there.

## Building and packaging the desktop app

```bash
just build                # the web client and the desktop main process
just build-desktop        # the desktop app only, into apps/desktop/out
just package-desktop      # a .dmg and .zip (macOS), AppImage (Linux) or installer (Windows)
just package-desktop-dir  # an unpacked app only, faster for local testing
just install-desktop      # macOS: package and install into /Applications
```

- The package is signed ad hoc so it runs on Apple silicon. Swap the identity in `apps/desktop/electron-builder.yml` for a Developer ID to distribute it.
- `just install-desktop` moves an existing copy to the Trash first, and refuses while the app is running.

### The app icon

The icon is drawn by hand in `apps/desktop/assets/icon.svg`: a 1024 canvas on Apple's grid, with the 824-unit tile at (100, 100). After editing it, render the platform files and commit them, so builds don't need Inkscape:

```bash
just icons  # icon.icns (macOS), icon.ico (Windows) and icon.png (Linux window) in apps/desktop/build
```

It needs Inkscape (`brew install --cask inkscape`) and, for the `.icns`, macOS. If the Dock still shows the old icon after a rebuild, that is the macOS icon cache: move the app, or log out and back in.

## Releasing

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`. It packages the desktop app on macOS (Apple silicon and Intel), Windows and Linux, and publishes them on a GitHub release. The NAS image isn't published: people build it from the repository.

1. Set the same version in every `package.json` under `apps/` and `packages/`. The workflow stops if the tag doesn't match `apps/desktop/package.json`.
2. Add a `## X.Y.Z` section to `CHANGELOG.md`. It becomes the release notes.
3. Run `just check`, commit ("Version X.Y.Z"), then tag and push:

   ```bash
   git tag -a vX.Y.Z -m "Taskite X.Y.Z"
   git push origin main vX.Y.Z
   ```

`.github/workflows/check.yml` runs `pnpm check` on Linux, macOS and Windows for every pull request. Run it by hand from the repository's **Actions** tab, or with `gh workflow run check.yml`.

## Cleaning up

```bash
just clean        # remove build output
just clean-all    # also remove every node_modules (run just setup after)
```
