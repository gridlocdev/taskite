# Taskite — run `just` to list recipes.
set shell := ["bash", "-cu"]

app_name := "Taskite"
nas_data := justfile_directory() / ".nas-data"
release := "apps/desktop/release"

default:
    @just --list --unsorted

# ── Run (dev) ─────────────────────────────────────────────────────────────

# Web client dev server (http://localhost:5173) plus the NAS file server it talks to. Ctrl-C stops both.
[group('run')]
run-web:
    mkdir -p "{{ nas_data }}"
    pnpm --parallel --filter @taskite/server --filter @taskite/web run dev

# NAS file server only (http://localhost:8788), serving ./.nas-data; restarts when its source changes.
[group('run')]
run-server:
    mkdir -p "{{ nas_data }}"
    pnpm --filter @taskite/server dev

# Desktop app in dev mode (builds the web client first).
[group('run')]
run-desktop: build-web
    pnpm --filter @taskite/desktop start

# The built web client served by the NAS server, as it runs on a NAS (http://localhost:8788).
[group('run')]
preview-web: build-web
    mkdir -p "{{ nas_data }}"
    TASKITE_DATA="{{ nas_data }}" TASKITE_STATIC="{{ justfile_directory() }}/apps/web/dist" node apps/server/src/main.ts

# Desktop app with no window or Dock icon, on throwaway data, for automated checks (DevTools port 9334).
[group('run')]
run-desktop-headless dir=(justfile_directory() / ".headless-data"): build-desktop
    mkdir -p "{{ dir }}"
    cd apps/desktop && TASKITE_HEADLESS=1 TASKITE_USER_DATA="{{ dir }}" pnpm exec electron . --remote-debugging-port=9334

# Run the taskite CLI from source (paths resolve from where you run it; quoting is kept).
[group('run')]
[no-cd]
[positional-arguments]
cli *args:
    node "{{ justfile_directory() }}/apps/cli/src/main.ts" "$@"

# ── Build and package ─────────────────────────────────────────────────────

# Build everything: the web client and the desktop app.
[group('build')]
build:
    pnpm build

# Build the web client into apps/web/dist.
[group('build')]
build-web:
    pnpm --filter @taskite/web build

# Regenerate the app icon files in apps/desktop/build from assets/icon.svg (needs Inkscape; .icns needs macOS).
[group('build')]
icons:
    apps/desktop/scripts/make-icons.sh

# Build the desktop app's main process and copy the web client into apps/desktop/out.
[group('build')]
build-desktop: build-web
    pnpm --filter @taskite/desktop build

# Package the desktop app for this OS into apps/desktop/release (.dmg and .zip on macOS).
[group('build')]
package-desktop: build-web
    pnpm --filter @taskite/desktop package

# Package an unpacked app only (faster; for local testing).
[group('build')]
package-desktop-dir: build-web
    pnpm --filter @taskite/desktop package --dir

# Package and install into /Applications (macOS). The old copy goes to the Trash.
[group('build')]
[macos]
install-desktop: package-desktop-dir
    #!/usr/bin/env bash
    set -euo pipefail
    target="/Applications/{{ app_name }}.app"
    built=$(ls -d "{{ release }}"/mac*/"{{ app_name }}.app" | head -1)
    # Anchored, so a shell command that merely mentions the path does not count.
    if pgrep -f "^$target/Contents/MacOS/" >/dev/null; then
      echo "{{ app_name }} is running — quit it first, then run this again." >&2
      exit 1
    fi
    trashed=""
    if [ -d "$target" ]; then
      trashed="$HOME/.Trash/{{ app_name }} $(date '+%Y-%m-%d %H.%M.%S').app"
      mv "$target" "$trashed"
      echo "Moved the old app to the Trash."
    fi
    ditto "$built" "$target"
    lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
    # Only the installed copy should answer "Open With" for the app's file types.
    "$lsregister" -u "$PWD/$built" 2>/dev/null || true
    if [ -n "$trashed" ]; then "$lsregister" -u "$trashed" 2>/dev/null || true; fi
    "$lsregister" -f "$target"
    echo "Installed $target"

# Build the iOS app's web content and copy it into the Xcode project (apps/ios/ios).
[group('build')]
[macos]
build-ios: build-web
    pnpm --filter @taskite/ios build
    cd apps/ios && pnpm exec cap sync ios

# Build, then open the Xcode project: pick your iPhone or a simulator and press Run.
[group('build')]
[macos]
open-ios: build-ios
    cd apps/ios && pnpm exec cap open ios

# Build the NAS Docker image.
[group('build')]
build-docker tag="taskite:latest":
    docker build -t {{ tag }} .

# Run the NAS Docker image against ./.nas-data (http://localhost:8788).
[group('build')]
run-docker tag="taskite:latest":
    mkdir -p "{{ nas_data }}"
    docker run --rm -p 127.0.0.1:8788:8788 -e TASKITE_NO_AUTH=1 -v "{{ nas_data }}:/data" {{ tag }}

# ── Quality ───────────────────────────────────────────────────────────────

# Everything CI checks: format, lint, typecheck, tests, build.
[group('quality')]
check:
    pnpm check

# Architecture rules only: layers, entry points, platform APIs, swallowed errors, file size. Part of `check`.
[group('quality')]
check-arch:
    pnpm vitest run test/architecture.test.ts

# Record today's architecture violations and exceptions (once, when adopting the rules; refuses after that).
[group('quality')]
arch-baseline:
    ARCH_BASELINE=write pnpm vitest run test/architecture.test.ts

# Redraw the save-session diagram in docs/architecture.md from the table in saveChart.ts.
[group('quality')]
diagram:
    WRITE_DIAGRAM=1 pnpm vitest run packages/ui/test/saveChart.test.ts -t "is drawn"

# Random-operation tests on many seeds (FUZZ_SEED=<n> just fuzz repeats one; FUZZ_SEED_BASE picks where to start).
[group('quality')]
fuzz runs="500":
    FUZZ_RUNS={{ runs }} pnpm vitest run -t random --testTimeout=0

# Browser scenarios against the built client and the NAS server, on fixture data in ./.e2e-data.
[group('quality')]
[positional-arguments]
e2e *args: build-web
    pnpm exec playwright test -c e2e/playwright.config.ts --project=web "$@"

# Accept the current screenshots as the new baseline (macOS; look at the diff in .e2e-results first).
# Arguments filter the tests, as for `just e2e`: `just e2e-update look`.
[group('quality')]
[positional-arguments]
e2e-update *args: build-web
    pnpm exec playwright test -c e2e/playwright.config.ts --project=web --update-snapshots=changed "$@"

# Drive the app headlessly for a quick look: just drive cmd:"Go to Inbox" key:KeyQ type:"Buy milk" shot:after aria
[group('quality')]
[positional-arguments]
drive *steps: build-web
    node e2e/drive.ts "$@"

# Long random runs on new seeds, on this machine: before a release, or while you're away. No CI minutes.
[group('quality')]
soak runs="1000": build-web
    #!/usr/bin/env bash
    # Both halves run even when the first fails, and the recipe fails if either did.
    set -uo pipefail
    status=0
    base=$(date +%s)
    echo "Seeds start at $base (FUZZ_SEED=<n> replays one)."
    FUZZ_RUNS={{ runs }} FUZZ_SEED_BASE=$base pnpm vitest run -t random --testTimeout=0 --silent=passed-only || status=1
    # Its own folder: a replay or the next soak clears .e2e-results, not this run's screenshots and traces.
    echo "Random-use failures keep their screenshots and traces in .e2e-soak/$base."
    FUZZ_RUNS=25 FUZZ_SEED_BASE=$base pnpm exec playwright test -c e2e/playwright.config.ts --project=web -g random --output=".e2e-soak/$base" || status=1
    exit $status

# Desktop smoke test: the built Electron app, headless, with a throwaway data folder.
[group('quality')]
e2e-desktop: build-desktop
    pnpm exec playwright test -c e2e/playwright.config.ts --project=desktop

# Run the tests once (pass a file or -t "name" to narrow them).
[group('quality')]
test *args:
    pnpm vitest run {{ args }}

# Run the tests in watch mode.
[group('quality')]
test-watch *args:
    pnpm vitest {{ args }}

# Lint with ESLint.
[group('quality')]
lint:
    pnpm lint

# Typecheck every package.
[group('quality')]
typecheck:
    pnpm typecheck

# Format every file.
[group('quality')]
fmt:
    pnpm format

# Check formatting without changing anything.
[group('quality')]
fmt-check:
    pnpm format:check

# ── Housekeeping ──────────────────────────────────────────────────────────

# Install dependencies (pnpm via corepack).
[group('housekeeping')]
setup:
    corepack enable
    pnpm install

# Remove build output.
[group('housekeeping')]
clean:
    rm -rf apps/web/dist apps/ios/dist apps/ios/www apps/desktop/out "{{ release }}" apps/desktop/node_modules/.cache/taskite-dev
    find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete
    rm -rf .e2e-data .e2e-results .e2e-report .e2e-soak .types-e2e

# Remove build output and every node_modules (run `just setup` after).
[group('housekeeping')]
clean-all: clean
    find . -name node_modules -type d -prune -exec rm -rf {} +

# Earlier names, kept so nothing that uses them breaks.
alias web := run-web
alias server := run-server
alias desktop := run-desktop
alias package := package-desktop
alias docker := build-docker
