/** The command line, read by one small parser (PRD §11). */

export const COMMANDS = [
  'list',
  'add',
  'done',
  'reopen',
  'trash',
  'restore',
  'move',
  'due',
  'attach',
  'attachments',
  'projects',
  'path',
  'help',
] as const;
export type CommandName = (typeof COMMANDS)[number];

export const LIST_VIEWS = ['today', 'upcoming', 'inbox', 'completed', 'trash'] as const;

export interface Args {
  readonly command: CommandName;
  readonly words: readonly string[];
  readonly file: string | null;
  readonly json: boolean;
  readonly help: boolean;
  readonly version: boolean;
  readonly project: string | null;
  readonly label: string | null;
  /** The section `add` puts the task in. */
  readonly section: string | null;
}

/** A command line the user can fix: printed as one line, exit code 2. */
export class UsageError extends Error {}

/** Something went wrong that isn't the command line (unknown id, a conflict): exit code 1. */
export class ProblemError extends Error {}

const VALUE_OPTIONS = new Set(['--file', '--project', '--label', '--section']);

export function parseArgs(argv: readonly string[]): Args {
  const words: string[] = [];
  const values = new Map<string, string>();
  let json = false;
  let help = false;
  let version = false;
  let rest = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (rest || !token.startsWith('-') || token === '-') {
      words.push(token);
      continue;
    }
    if (token === '--') rest = true;
    else if (token === '--json') json = true;
    else if (token === '--help' || token === '-h') help = true;
    else if (token === '--version' || token === '-v') version = true;
    else {
      const eq = token.indexOf('=');
      const name = eq > 0 ? token.slice(0, eq) : token;
      if (!VALUE_OPTIONS.has(name)) throw new UsageError(`unknown option ${name} (see taskite --help)`);
      const value = eq > 0 ? token.slice(eq + 1) : argv[++i];
      if (value === undefined || value === '') throw new UsageError(`${name} needs a value`);
      values.set(name, value);
    }
  }
  const [first, ...others] = words;
  let command: CommandName = 'list';
  if (first !== undefined) {
    if (!(COMMANDS as readonly string[]).includes(first))
      throw new UsageError(`unknown command "${first}" (see taskite --help)`);
    command = first as CommandName;
  }
  return {
    command,
    words: first === undefined ? [] : others,
    file: values.get('--file') ?? null,
    json,
    help: help || command === 'help',
    version,
    project: values.get('--project') ?? null,
    label: values.get('--label') ?? null,
    section: values.get('--section') ?? null,
  };
}

export const HELP = `taskite: list and change your Taskite tasks from the terminal.

Usage: taskite <command> [options]

Commands:
  list [today|upcoming|inbox|completed|trash]   Print tasks (default: today)
  list --project <name>                          Print a project's open tasks
  list --label <name>                            Print open tasks with a label
  add <text...>                                  Add a task with Quick Add ("Call mum tomorrow p1 #Home @phone")
  add <text...> --section <name>                 Add it into a section of its project
  done <task>                                    Complete a task (a repeating one moves to its next date)
  reopen <task>                                  Mark a completed task not done
  trash <task>                                   Move a task to the Trash
  restore <task>                                 Bring a task back from the Trash
  move <task> <project>                          Move a task to another project
  due <task> <date>                              Set the due date ("tomorrow", "fri", "jan 5", "none")
  attach <task> <file...>                        Copy files into the attachments folder and attach them
  attachments <task>                             List a task's attachments with their paths
  projects                                       List projects with their open task counts
  path                                           Print the tasks file's path

A <task> is part of its title ("call mum", quoted when a date or project follows) or the short id that
list prints. When several titles match, taskite lists them and changes nothing.

Options:
  --file <path>   The tasks file (else $TASKITE_FILE, else the desktop app's file)
  --json          Print JSON instead of text
  --help          Show this help
  --version       Show the version

Exit codes: 0 done, 1 a problem (unknown id, the file changed), 2 a command-line mistake.
`;
