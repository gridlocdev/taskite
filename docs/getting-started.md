# Getting started

You can run Taskite as a desktop app, on a NAS with Docker, from source in your browser, or as the `taskite` command line.

## What you need

- For the desktop app: macOS (Apple silicon or Intel), Windows or Linux.
- For the NAS: Docker.
- For running from source and the command line: Node 22.18 or later, pnpm (through `corepack enable`) and [just](https://github.com/casey/just).

## Download

Get the desktop app from the [Releases page](https://github.com/gridlocdev/taskite/releases/latest):

| System                | File                              |
| --------------------- | --------------------------------- |
| macOS (Apple silicon) | `Taskite-…-mac-arm64.dmg`         |
| macOS (Intel)         | `Taskite-…-mac-x64.dmg`           |
| Windows               | `Taskite-…-win-x64.exe`           |
| Linux                 | `Taskite-…-linux-x86_64.AppImage` |

The apps aren't signed by Apple or Microsoft yet, so the first launch needs one extra step:

- **macOS** says Taskite "can't be opened" or "is damaged". Open **System Settings > Privacy & Security**, scroll down, and click **Open Anyway** next to Taskite. Or run this once after moving the app to Applications:

  ```bash
  xattr -dr com.apple.quarantine /Applications/Taskite.app
  ```

- **Windows** shows "Windows protected your PC". Click **More info**, then **Run anyway**.
- **Linux**: make the AppImage executable (`chmod +x Taskite-*.AppImage`), then run it.

### Coming from Tasks 1.x

Taskite used to be called Tasks. The first time it starts, if it has no tasks file of its own, it reads the old one (`Tasks/tasks.json` in the app data folder) and shows your tasks. The first change you make saves them to Taskite's own file. The old file is never changed, so you can delete it once you're happy.

## Where your tasks are kept

| Runs as | File |
| --- | --- |
| Desktop | `tasks.json` in `~/Library/Application Support/Taskite/` (macOS), `%APPDATA%\Taskite\` (Windows) or `~/.config/Taskite/` (Linux) |
| Browser | The browser's private storage for the site |
| NAS | `tasks.json` in the folder you mount at `/data` |
| CLI | `--file <path>`, else `$TASKITE_FILE`, else the desktop app's file |

It is plain JSON, so you can back it up, sync it, or read it with other tools.

## Run it on a NAS (Docker)

```bash
docker build -t taskite .
docker run -d -p 8788:8788 -e TASKITE_TOKEN=change-me -v /volume1/taskite:/data taskite
```

Then open `http://<nas>:8788` and enter the token. To run it with Compose or as your NAS user, see [compose.example.yaml](../compose.example.yaml).

| Variable | Default | Meaning |
| --- | --- | --- |
| `TASKITE_TOKEN` | unset | The browser asks for this token once before it shows any tasks. Required unless the server answers this machine only |
| `TASKITE_NO_AUTH` | unset | `1` lets the server listen on the network without a token, for a reverse proxy that already asks for a password |
| `TASKITE_HOSTS` | unset | Without a token, the extra host names to answer (comma-separated) |
| `TASKITE_HOST` | `0.0.0.0` | The address to listen on, in the Docker image (`127.0.0.1` outside it) |
| `TASKITE_PORT` | `8788` | The port to listen on |
| `TASKITE_DATA` | `/data` | The folder that holds `tasks.json` |

Anyone who can reach the server can change and delete your tasks, so it refuses to start on a network address without `TASKITE_TOKEN`. If your NAS's reverse proxy already asks for a password, set `TASKITE_NO_AUTH=1` instead, and publish the port only to the proxy.

Without a token, the server only answers requests addressed to an IP address or `localhost`. If you open it by name (for example `http://nas.lan:8788`), list that name in `TASKITE_HOSTS=nas.lan`. Other names get `421 Misdirected Request`, which stops a hostile web page from reaching your tasks through DNS rebinding.

If two browsers change the tasks at the same time, the second one to save is told, and chooses what to keep (see [Features](features.md#never-losing-a-task)).

## The `taskite` command line

The CLI reads and changes the same file as the desktop app. From a clone of this repo:

```bash
just setup
just cli list
just cli add "Call mum friday p1 #Home @phone"
just cli done 3f2a9c1b
```

`taskite help` lists every command: `list`, `add`, `done`, `reopen`, `trash`, `restore`, `move`, `due`, `attach`, `attachments`, `projects` and `path`. Add `--json` for output a script or an agent can read, and `--file <path>` to work on another file. An agent skill that teaches an AI coding agent to use it is in [apps/cli/skill/SKILL.md](../apps/cli/skill/SKILL.md).

## Run it from source

```bash
just setup     # corepack enable, then pnpm install
just run-web   # the web app on http://localhost:5173, plus the NAS server on :8788 serving ./.nas-data
```

See [Development](development.md) for every other way to run and build it.

## First run

Taskite opens on Today, or on the view you had open last time. There's no welcome screen: press `N` (or click **Add task**) and type your first task. Press `?` to see every shortcut.
