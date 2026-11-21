/**
 * The app's state and every action the commands and components call. No DOM here: the components draw it
 * and the tests drive it in Node.
 */
import { batch, computed, signal, type Signal } from '@preact/signals';
import {
  INBOX_ID,
  MAX_ATTACHMENT_BYTES,
  addDays,
  addDraft,
  describeAutomations,
  fallbackAfter,
  formatDue,
  parseQuickAdd,
  plural,
  rangeIds,
  resolveDraft,
  resolveView,
  sameView,
  stepId,
  todayISO,
  viewContent,
  visibleIds,
  type Attachment,
  type Priority,
  type Project,
  type ProjectSection,
  type ProjectColor,
  type Recurrence,
  type SavedView,
  type SectionAutomation,
  type Section,
  type Task,
  type TaskPatch,
  type Theme,
  type View,
} from '@taskite/core';
import {
  DEFAULT_WORKSPACE_NAME,
  MAIN_WORKSPACE_ID,
  defaultWorkspaceList,
  workspaceNameProblem,
  type Workspace,
} from '@taskite/core';
import {
  after,
  memoryWorkspaceMemory,
  wait,
  type OpenResult,
  type OpenWorkspaceMemory,
  type TaskSession,
} from '@taskite/ui';
import type { DeletedWorkspace, WorkspaceDirectory } from './workspaces.ts';
import { stepOrder } from './forms.ts';

/** How long a checked-off row shows its tick before it leaves, and how long a leaving row fades (PRD §5.3). */
export const COMPLETE_MS = 350;
export const LEAVE_MS = 180;
/** How long a notice stays when it isn't an error. */
export const NOTICE_MS = 5000;

export interface NoticeAction {
  readonly label: string;
  readonly run: () => void;
  /** For an Undo: the list's step it belongs to; the action is dropped once the list moves past it. */
  readonly step?: number;
}

export interface Notice {
  readonly id: number;
  readonly text: string;
  readonly action: NoticeAction | null;
  /** Stays until acted on or replaced (errors). */
  readonly sticky: boolean;
  readonly tone: 'info' | 'error';
}

/** The task editor's unsaved text: save it, or ask whether there is any. */
export interface Draft {
  flush(): void;
  dirty(): boolean;
}

/** A task's name being edited in its row (PRD §4.4): the text in the field, and the name it was last saved as. */
export interface Renaming {
  readonly id: string;
  readonly text: string;
  readonly from: string;
}

/** The one dialog that can be open (PRD §9). */

export type DialogState =
  | { readonly kind: 'task'; readonly id: string }
  | { readonly kind: 'due'; readonly ids: readonly string[] }
  | { readonly kind: 'project'; readonly id: string | null }
  | { readonly kind: 'label'; readonly name: string }
  /** Add Section (no id, after `after`) or Rename Section. */
  | {
      readonly kind: 'section';
      readonly projectId: string;
      readonly id: string | null;
      readonly after?: string;
    }
  | {
      readonly kind: 'confirm';
      readonly title: string;
      readonly message: string;
      readonly confirm: string;
      readonly run: () => void;
    }
  | { readonly kind: 'move'; readonly ids: readonly string[] }
  /** New Workspace (no id) or Rename Workspace (PRD §14.3). */
  | { readonly kind: 'workspace'; readonly id: string | null }
  /** Section Automations… (PRD §6.1). */
  | { readonly kind: 'automations'; readonly projectId: string; readonly sectionId: string }
  | { readonly kind: 'sections' }
  | { readonly kind: 'commands'; readonly query: string }
  | { readonly kind: 'settings' }
  | { readonly kind: 'about' }
  | { readonly kind: 'shortcuts' };

/** Which right-click menu is open (PRD §8). Its items are listed in `MENUS` in commands.ts. */
export type MenuKind =
  'task' | 'list' | 'project' | 'label' | 'section' | 'completed' | 'trash' | 'projects' | 'workspace';

/** What a sidebar menu acts on, when it isn't the view on screen. */
export type MenuTarget =
  | { readonly kind: 'project'; readonly id: string }
  | { readonly kind: 'label'; readonly name: string }
  | { readonly kind: 'section'; readonly projectId: string; readonly id: string };

export interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly kind: MenuKind;
  readonly target?: MenuTarget;
}

export interface ControllerOptions {
  readonly now?: () => number;
  /** Waits for an animation; tests pass one that doesn't. */
  readonly wait?: (ms: number) => Promise<void>;
  /** The app's version, for About. */
  readonly version?: string;
  /** Where the tasks file lives, for About and Settings. */
  readonly location?: string;
  /** The list of workspaces (PRD §14); without one the app has `main` alone and can't switch. */
  readonly workspaces?: WorkspaceDirectory;
  /** Opens a workspace's file as a session. */
  readonly openWorkspace?: (id: string) => Promise<OpenResult>;
  /** The workspace `session` is (default `main`). */
  readonly workspaceId?: string;
  /** Remembers which workspace this device has open. */
  readonly workspaceMemory?: OpenWorkspaceMemory;
}

/** What the editor needs of a file picked or dropped on it: a `File`. */
export type AttachedFile = Pick<File, 'name' | 'size' | 'type' | 'arrayBuffer'>;

/** The cursor's id for a section's Add task button, which ↑ and ↓ stop on after the section's tasks (PRD §7). */
export function addStop(slot: string): string {
  return `add:${slot}`;
}

/** The add-task slot an Add task stop opens, or undefined for a task id. */
export function stopSlot(id: string | null): string | undefined {
  return id?.startsWith('add:') ? id.slice(4) : undefined;
}

/** With no saved view, the app opens on Today (PRD §5.1). */
const DEFAULT_VIEW: View = { type: 'today' };

export class AppController {
  readonly #session: Signal<TaskSession>;
  readonly version: string;
  readonly #location: string | undefined;
  readonly workspaces: WorkspaceDirectory | null;
  readonly #openWorkspace: ((id: string) => Promise<OpenResult>) | null;
  readonly #workspaceMemory: OpenWorkspaceMemory;
  /** The workspace on screen (PRD §14). */
  readonly workspaceId: Signal<string>;
  /** True while a switch is loading the other workspace, so a second one waits its turn. */
  readonly switching = signal(false);
  readonly #now: () => number;
  readonly #wait: (ms: number) => Promise<void>;

  /** Bumped on every change to the task list, so computed values read it. */
  readonly rev = signal(0);
  readonly today: Signal<string>;
  readonly view = signal<View>(DEFAULT_VIEW);
  readonly search = signal('');
  /** On a phone, the Browse tab is showing the list of views in place of a view (PRD §5.5). */
  readonly browsing = signal(false);
  readonly selected = signal<ReadonlySet<string>>(new Set());
  /** The row keyboard focus is on; Shift+arrows extend from `anchor` to it. */
  readonly cursor = signal<string | null>(null);
  #anchor: string | null = null;
  /** Where the add-task row is open: `end`, or `day:YYYY-MM-DD` in Upcoming. */
  readonly composer = signal<string | null>(null);
  #seed = '';
  readonly dialog = signal<DialogState | null>(null);
  readonly menu = signal<ContextMenuState | null>(null);
  readonly notice = signal<Notice | null>(null);
  /** Rows showing their tick before they leave. */
  readonly completing = signal<ReadonlySet<string>>(new Set());
  /** Rows fading out. */
  readonly leaving = signal<ReadonlySet<string>>(new Set());
  /** What the screen reader's live region says next. */
  readonly announcement = signal('');
  /** The task whose name is being edited in its row: what's typed, and the name it started from. */
  readonly renaming = signal<Renaming | null>(null);
  /** Bumped when the list should take keyboard focus (after a dialog or the composer closes). */
  readonly focusList = signal(0);
  /** Bumped to put the cursor in the search box. */
  readonly focusSearch = signal(0);

  #noticeId = 0;
  #cancelNotice: (() => void) | undefined;

  readonly theme = computed<Theme>(() => {
    void this.rev.value;
    return this.list.data.settings.theme;
  });

  /** The view on screen: Search while there's a query, and a gone project or label falls back to the Inbox. */
  readonly shown = computed<View>(() => {
    void this.rev.value;
    const q = this.search.value.trim();
    return q ? { type: 'search', query: q } : resolveView(this.list, this.view.value);
  });

  /** Views list checked-off tasks too (the Show Completed Tasks setting). */
  readonly showCompleted = computed(() => {
    void this.rev.value;
    return this.list.data.settings.showCompleted === true;
  });

  /** A new section named Done gets the Done rules (PRD §6.1). */
  readonly doneRules = computed(() => {
    void this.rev.value;
    return this.list.data.settings.doneRules !== false;
  });

  readonly content = computed(() => {
    void this.rev.value;
    return viewContent(this.list, this.shown.value, this.today.value, {
      showCompleted: this.showCompleted.value,
    });
  });

  readonly ids = computed(() => visibleIds(this.content.value));
  /** Where ↑ and ↓ go: each section's tasks, then its Add task button. */
  readonly stops = computed(() => this.content.value.sections.flatMap(sectionStops));

  constructor(session: TaskSession, opts: ControllerOptions = {}) {
    this.#session = signal(session);
    this.#now = opts.now ?? Date.now;
    this.#wait = opts.wait ?? wait;
    this.version = opts.version ?? '';
    this.#location = opts.location;
    this.workspaces = opts.workspaces ?? null;
    this.#openWorkspace = opts.openWorkspace ?? null;
    this.#workspaceMemory = opts.workspaceMemory ?? memoryWorkspaceMemory();
    this.workspaceId = signal(opts.workspaceId ?? MAIN_WORKSPACE_ID);
    this.today = signal(todayISO(new Date(this.#now())));
    this.#attach(session);
  }

  /** The open workspace's save session. Switching workspaces replaces it (PRD §14.2). */
  get session(): TaskSession {
    return this.#session.value;
  }

  /** Where the open workspace's file lives, for About and Settings. */
  get location(): string {
    return this.#location ?? this.session.store.location();
  }

  /** Shows `session`: its last view, and its changes from now on. */
  #attach(session: TaskSession): void {
    const last = session.list.data.settings.lastView;
    this.view.value = last ? resolveView(session.list, last) : DEFAULT_VIEW;
    session.list.onChange(() => {
      // A workspace switched away from keeps no say over the screen.
      if (session !== this.#session.peek()) return;
      const notice = this.notice.peek();
      if (notice?.action?.step !== undefined && notice.action.step !== this.list.step)
        this.notice.value = { ...notice, action: null };
      // `ids` is computed from `rev`, so read before bumping it, it is still the rows shown before the change.
      const before = this.ids.peek();
      this.rev.value++;
      this.#pruneSelection(before);
      // Its section went (deleted elsewhere, or undone): the automations editor has nothing left to edit.
      const d = this.dialog.peek();
      if (d?.kind === 'automations' && !this.list.getSection(d.projectId, d.sectionId)) this.close();
    });
  }

  get list() {
    return this.session.list;
  }

  // ---------- Workspaces (PRD §14) ----------

  /** Every workspace, `main` first; `main` alone when the app has no list. */
  readonly workspaceList = computed<readonly Workspace[]>(
    () => this.workspaces?.list.value.workspaces ?? [{ id: MAIN_WORKSPACE_ID, name: DEFAULT_WORKSPACE_NAME }],
  );

  readonly currentWorkspace = computed<Workspace>(() => {
    const id = this.workspaceId.value;
    return this.workspaceList.value.find((w) => w.id === id) ?? { id, name: DEFAULT_WORKSPACE_NAME };
  });

  /** "<workspace> — Taskite" once there is more than one workspace (PRD §14.2). */
  readonly windowTitle = computed(() =>
    this.workspaceList.value.length > 1 ? `${this.currentWorkspace.value.name} — Taskite` : 'Taskite',
  );

  /** Whether workspaces can be added, renamed and switched between here. */
  get canSwitch(): boolean {
    return this.workspaces !== null && this.#openWorkspace !== null;
  }

  /**
   * Opens another workspace (PRD §14.2): saves what's typed and waiting first, and stays put when that fails.
   * `force` leaves unsaved changes to the recovery snapshot, for a workspace deleted elsewhere.
   */
  async switchWorkspace(id: string, opts: { force?: boolean } = {}): Promise<boolean> {
    const open = this.#openWorkspace;
    if (!open || !this.workspaces) return false;
    if (id === this.workspaceId.peek()) return true;
    const target = this.workspaces.find(id);
    if (!target || this.switching.peek()) return false;
    this.switching.value = true;
    try {
      // A row still playing its tick or fade finishes first, so its change lands in the workspace it was made in.
      while (this.completing.peek().size || this.leaving.peek().size) await this.#wait(COMPLETE_MS);
      this.flushDraft();
      await this.session.flush();
      if (!opts.force && this.session.status.peek() !== 'saved') {
        this.say(`Couldn't switch to ${target.name}: the changes here aren't saved yet.`, { tone: 'error' });
        return false;
      }
      const { session, notice } = await open(id);
      batch(() => {
        this.#session.value = session;
        this.workspaceId.value = id;
        this.#clearScreen();
        this.#attach(session);
        this.rev.value++;
      });
      this.#workspaceMemory.set(id);
      this.dismissNotice();
      if (notice) this.say(notice, { sticky: true, tone: 'error' });
      this.announcement.value = `Switched to ${target.name}.`;
      return true;
    } catch (e) {
      this.say(`Couldn't open ${target.name}: ${messageOf(e)}`, { sticky: true, tone: 'error' });
      return false;
    } finally {
      this.switching.value = false;
    }
  }

  /** What one workspace showed that means nothing in another. */
  #clearScreen(): void {
    this.search.value = '';
    this.browsing.value = false;
    this.selected.value = new Set();
    this.cursor.value = null;
    this.#anchor = null;
    this.composer.value = null;
    this.#seed = '';
    this.dialog.value = null;
    this.menu.value = null;
    this.renaming.value = null;
    this.focusList.value++;
  }

  /** The n-th workspace (1-based), for ⌃1–⌃9. */
  switchToNumber(n: number): void {
    const target = this.workspaceList.peek()[n - 1];
    if (target) void this.switchWorkspace(target.id);
  }

  /** Why `name` can't name a workspace (`selfId` when renaming), or null. */
  workspaceNameProblem(name: string, selfId?: string): string | null {
    return workspaceNameProblem(this.workspaces?.list.peek() ?? defaultWorkspaceList(), name, selfId);
  }

  /** New Workspace: adds it and opens it (PRD §14.3). */
  async newWorkspace(name: string): Promise<boolean> {
    if (!this.workspaces) return false;
    const problem = this.workspaceNameProblem(name);
    if (problem) {
      this.say(problem, { tone: 'error' });
      return false;
    }
    let added: Workspace;
    try {
      added = await this.workspaces.add(name);
    } catch (e) {
      this.say(`Couldn't add the workspace: ${messageOf(e)}`, { sticky: true, tone: 'error' });
      return false;
    }
    return this.switchWorkspace(added.id);
  }

  async renameWorkspace(id: string, name: string): Promise<boolean> {
    if (!this.workspaces) return false;
    const problem = this.workspaceNameProblem(name, id);
    if (problem) {
      this.say(problem, { tone: 'error' });
      return false;
    }
    try {
      await this.workspaces.rename(id, name);
      return true;
    } catch (e) {
      this.say(`Couldn't rename the workspace: ${messageOf(e)}`, { sticky: true, tone: 'error' });
      return false;
    }
  }

  /** Delete Workspace: asks first, then takes it away with Undo (PRD §14.3). Never `main`. */
  deleteWorkspace(id: string = this.workspaceId.peek()): void {
    const target = this.workspaces?.find(id);
    if (!target || id === MAIN_WORKSPACE_ID) return;
    const open =
      id === this.workspaceId.peek() ? this.list.liveTasks().filter((t) => !t.completed).length : null;
    const count = open === null ? '' : `It has ${open} open ${open === 1 ? 'task' : 'tasks'}. `;
    this.confirm({
      title: `Delete "${target.name}"?`,
      message: `${count}Its tasks, projects and settings go with it.`,
      confirm: 'Delete Workspace',
      run: () => void this.#deleteWorkspace(target),
    });
  }

  async #deleteWorkspace(target: Workspace): Promise<void> {
    const dir = this.workspaces;
    if (!dir) return;
    const wasOpen = this.workspaceId.peek() === target.id;
    if (wasOpen && !(await this.switchWorkspace(MAIN_WORKSPACE_ID))) return;
    let deleted: DeletedWorkspace | null;
    try {
      deleted = await dir.remove(target.id);
    } catch (e) {
      this.say(`Couldn't delete the workspace: ${messageOf(e)}`, { sticky: true, tone: 'error' });
      return;
    }
    if (!deleted) return;
    const undo = deleted;
    this.say(`Deleted workspace ${target.name}.`, {
      action: {
        label: 'Undo',
        run: () => {
          dir.restore(undo).then(
            async () => {
              if (wasOpen && !(await this.switchWorkspace(target.id))) return;
              this.say(`Restored workspace ${target.name}.`);
            },
            (e: unknown) =>
              this.say(`Couldn't restore the workspace: ${messageOf(e)}`, { sticky: true, tone: 'error' }),
          );
        },
      },
    });
  }

  /**
   * Reads `workspaces.json` again (on focus). A workspace deleted elsewhere while open falls back to `main`, its
   * unsaved changes kept by the recovery snapshot (PRD §14.3).
   */
  async refreshWorkspaces(): Promise<void> {
    const dir = this.workspaces;
    if (!dir || this.switching.peek()) return;
    const gone = this.currentWorkspace.peek().name;
    const changed = await dir.load().catch(() => false);
    const id = this.workspaceId.peek();
    if (!changed || id === MAIN_WORKSPACE_ID || dir.find(id)) return;
    if (await this.switchWorkspace(MAIN_WORKSPACE_ID, { force: true }))
      this.say(
        `The workspace ${gone} was deleted elsewhere, so Taskite opened ${this.currentWorkspace.peek().name}.`,
        {
          sticky: true,
        },
      );
  }

  // ---------- Notices ----------

  /** Puts a message in the status bar (PRD §5.5). */
  say(text: string, opts: { action?: NoticeAction; sticky?: boolean; tone?: 'info' | 'error' } = {}): void {
    this.#cancelNotice?.();
    const notice: Notice = {
      id: ++this.#noticeId,
      text,
      action: opts.action ?? null,
      sticky: opts.sticky ?? false,
      tone: opts.tone ?? 'info',
    };
    this.notice.value = notice;
    this.announcement.value = text;
    if (!notice.sticky) {
      this.#cancelNotice = after(NOTICE_MS, () => {
        if (this.notice.peek()?.id === notice.id) this.notice.value = null;
      });
    }
  }

  /**
   * A notice with Undo, for the edit that just changed tasks. Its Undo goes away as soon as anything else
   * changes the tasks, so it can't take back a different change than the one it names.
   */
  sayUndoable(text: string): void {
    // An edit that changed nothing says nothing: there is nothing to undo, and Undo would take back the step before.
    if (!this.list.lastEditChanged) return;
    const step = this.list.step;
    // What section automations did comes after, as part of the same undo step (PRD §6.1).
    const automated = describeAutomations(this.list, this.list.automated);
    this.say(automated ? `${text} Automation: ${automated}.` : text, {
      action: {
        label: 'Undo',
        step,
        run: () => {
          if (this.list.step === step) this.undo();
        },
      },
    });
  }

  dismissNotice(): void {
    this.#cancelNotice?.();
    this.notice.value = null;
  }

  // ---------- Views ----------

  go(view: SavedView): void {
    batch(() => {
      this.browsing.value = false;
      this.search.value = '';
      this.composer.value = null;
      if (!sameView(view, this.view.peek())) {
        this.view.value = view;
        this.#select([]);
        this.cursor.value = null;
        this.#anchor = null;
      }
    });
    this.list.rememberView(view);
    this.announcement.value = this.title();
  }

  /** The Browse tab on a phone: the list of views, with search, in place of the view (PRD §5.5). */
  browse(): void {
    batch(() => {
      if (this.search.peek()) this.setSearch('');
      this.composer.value = null;
      this.menu.value = null;
      this.browsing.value = true;
    });
  }

  setSearch(query: string): void {
    batch(() => {
      this.search.value = query;
      this.composer.value = null;
      this.cursor.value = null;
      this.#anchor = null;
      this.#select([]);
    });
  }

  title(): string {
    const view = this.shown.value;
    switch (view.type) {
      case 'project':
        return this.list.getProject(view.id)?.name ?? 'Inbox';
      case 'label':
        return `@${view.name}`;
      case 'search':
        return `Search: ${view.query}`;
      case 'today':
        return 'Today';
      case 'upcoming':
        return 'Upcoming';
      case 'completed':
        return 'Completed';
      case 'trash':
        return 'Trash';
    }
  }

  /** Moves to the next day's date when the clock passes midnight (PRD §5.2). */
  tick(): void {
    const today = todayISO(new Date(this.#now()));
    if (today !== this.today.peek()) this.today.value = today;
  }

  // ---------- Choosing tasks ----------

  selectedIds(): string[] {
    const chosen = this.selected.value;
    return this.ids.value.filter((id) => chosen.has(id));
  }

  /** The chosen tasks, or the one under the cursor. */
  targetIds(): string[] {
    const ids = this.selectedIds();
    if (ids.length) return ids;
    const cursor = this.cursor.value;
    return cursor && this.ids.value.includes(cursor) ? [cursor] : [];
  }

  hasTargets(): boolean {
    return this.targetIds().length > 0;
  }

  /** One task chosen (Edit, which opens one task). */
  single(): Task | undefined {
    const ids = this.targetIds();
    return ids.length === 1 ? this.list.getTask(ids[0]!) : undefined;
  }

  #select(ids: readonly string[]): void {
    this.selected.value = new Set(ids);
  }

  /** A click on a row: alone, ⌘/Ctrl adds or removes it, Shift takes the range from the anchor (PRD §5.3). */
  click(id: string, how: { toggle?: boolean; range?: boolean } = {}): void {
    batch(() => {
      if (how.range && this.#anchor && this.ids.value.includes(this.#anchor)) {
        this.#select(rangeIds(this.ids.value, this.#anchor, id));
      } else if (how.toggle) {
        const next = new Set(this.selected.value);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        this.selected.value = next;
        this.#anchor = id;
      } else {
        this.#select([id]);
        this.#anchor = id;
      }
      this.cursor.value = id;
    });
    this.#announceSelection();
  }

  /**
   * ↓ / ↑: moves to the next row or Add task button, choosing a row alone; with `extend`, grows the range
   * from the anchor over tasks only.
   */
  step(delta: 1 | -1, extend = false): void {
    const ids = this.ids.value;
    const stops = this.stops.value;
    const cursor = this.cursor.value;
    let next: string | null | undefined;
    if (cursor === null)
      next = extend ? (delta > 0 ? ids[0] : ids.at(-1)) : delta > 0 ? stops[0] : stops.at(-1);
    else if (extend && stopSlot(cursor) !== undefined) {
      // From an Add task button, the range starts at the task beyond it.
      const at = stops.indexOf(cursor);
      const beyond = delta > 0 ? stops.slice(at + 1) : stops.slice(0, Math.max(at, 0)).reverse();
      next = beyond.find((id) => stopSlot(id) === undefined);
    } else next = stepId(extend ? ids : stops, cursor, delta);
    if (!next) return;
    const to = next;
    batch(() => {
      if (stopSlot(to) !== undefined) {
        this.#select([]);
        this.#anchor = null;
      } else if (extend) {
        this.#anchor ??= this.cursor.value ?? to;
        this.#select(rangeIds(ids, this.#anchor, to));
      } else {
        this.#select([to]);
        this.#anchor = to;
      }
      this.cursor.value = to;
    });
    this.#announceSelection();
  }

  // ---------- Going to a section (PRD §7) ----------

  /** The view's sections with a heading: what Go to Section… and the command menu offer. */
  namedSections(): Section[] {
    return this.content.value.sections.filter((s) => s.heading !== null);
  }

  /** The nearest section `delta` places from the cursor's (or from the top or bottom) with a task or an Add task button. */
  #nextSection(delta: 1 | -1): Section | undefined {
    const sections = this.content.value.sections;
    const cursor = this.cursor.value;
    const at = cursor === null ? -1 : sections.findIndex((s) => holds(s, cursor));
    const from = at !== -1 ? at : delta > 0 ? -1 : sections.length;
    for (let i = from + delta; i >= 0 && i < sections.length; i += delta) {
      const s = sections[i]!;
      if (sectionStops(s).length) return s;
    }
    return undefined;
  }

  /** Whether the next or previous section (a list) or column (a board) has a task or Add task button to move to. */
  canJumpSection(delta: 1 | -1, board: boolean): boolean {
    return (this.content.value.board === true) === board && this.#nextSection(delta) !== undefined;
  }

  /**
   * ⇧⌥↓ / ⇧⌥↑ in a list, ⇧⌥→ / ⇧⌥← on a board: the cursor goes to the first task of the next or previous
   * section, or to its Add task button when it has none. With `near` (← → on a board), it goes to the stop
   * `near` picks instead; without one, to the stop at the same place in the column, else the column's last.
   */
  jumpSection(delta: 1 | -1, near?: (ids: readonly string[]) => string | undefined): void {
    const target = this.#nextSection(delta);
    if (!target) return;
    const stops = sectionStops(target);
    let next = stops[0]!;
    if (near) {
      const cursor = this.cursor.value;
      const from = cursor === null ? undefined : this.content.value.sections.find((s) => holds(s, cursor));
      const place = from && cursor !== null ? Math.max(sectionStops(from).indexOf(cursor), 0) : 0;
      next = near(stops) ?? stops[Math.min(place, stops.length - 1)]!;
    }
    const slot = stopSlot(next);
    if (slot === undefined) this.#moveTo(next);
    else this.cursorToAdd(slot);
  }

  /** Go to Section…: the cursor goes to the section's first task, or the add-task row opens in an empty one. */
  goToSection(key: string): void {
    const section = this.content.value.sections.find((s) => s.key === key);
    if (!section) return;
    const first = section.rows[0]?.task.id;
    if (first) {
      this.#moveTo(first);
      this.focusList.value++;
    } else if (section.addSlot !== null) {
      batch(() => {
        this.#select([]);
        this.cursor.value = null;
        this.#anchor = null;
        this.composer.value = section.addSlot;
      });
    }
  }

  /** Tab onto an Add task button puts the cursor there, as the arrow keys would (PRD §7). */
  cursorToAdd(slot: string): void {
    const stop = addStop(slot);
    if (this.cursor.value === stop || !this.stops.value.includes(stop)) return;
    batch(() => {
      this.#select([]);
      this.#anchor = null;
      this.cursor.value = stop;
    });
    this.#announceSelection();
  }

  /** Puts the cursor on one row and chooses it alone. */
  #moveTo(id: string): void {
    batch(() => {
      this.#select([id]);
      this.#anchor = id;
      this.cursor.value = id;
    });
    this.#announceSelection();
  }

  selectAll(): void {
    this.#select(this.ids.value);
    this.#announceSelection();
  }

  clearSelection(): void {
    batch(() => {
      this.#select([]);
      this.#anchor = null;
    });
  }

  #announceSelection(): void {
    const n = this.selected.value.size;
    if (stopSlot(this.cursor.value) !== undefined) this.announcement.value = 'Add task';
    else if (n > 1) this.announcement.value = `${plural(n, 'task')} chosen`;
    else {
      const task = this.cursor.value ? this.list.getTask(this.cursor.value) : undefined;
      if (task) this.announcement.value = task.title;
    }
  }

  /** Drops ids that are no longer on screen after a change. */
  /**
   * After any change, keeps the choice, the cursor and the range's start on rows that are still shown. A
   * cursor whose row went (Clear Completed, an undone add, a change made elsewhere) moves to the nearest
   * row that was below it, else above.
   */
  #pruneSelection(before: readonly string[]): void {
    const ids = new Set(this.ids.peek());
    const chosen = this.selected.peek();
    batch(() => {
      if ([...chosen].some((id) => !ids.has(id)))
        this.selected.value = new Set([...chosen].filter((id) => ids.has(id)));
      if (this.#anchor && !ids.has(this.#anchor)) this.#anchor = null;
      const cursor = this.cursor.peek();
      if (cursor === null || ids.has(cursor) || this.stops.peek().includes(cursor)) return;
      const at = before.indexOf(cursor);
      const near = [...before.slice(at + 1), ...before.slice(0, Math.max(at, 0)).reverse()];
      const next = near.find((id) => ids.has(id)) ?? null;
      this.cursor.value = next;
      if (next && this.selected.peek().size === 0) this.#select([next]);
    });
  }

  /** Before rows leave the view, puts the cursor on the row that will take their place (PRD §5.3). */
  #fallBack(gone: readonly string[]): void {
    const goneSet = new Set(gone);
    const cursor = this.cursor.peek();
    const rest = [...this.selected.peek()].filter((id) => !goneSet.has(id));
    // Checking off a row outside the choice leaves the choice and the cursor alone.
    if (rest.length && cursor !== null && !goneSet.has(cursor)) {
      this.#select(rest);
      return;
    }
    const next = fallbackAfter(this.ids.peek(), goneSet);
    batch(() => {
      this.cursor.value = next;
      this.#anchor = next;
      this.#select(rest.length ? rest : next ? [next] : []);
    });
  }

  /**
   * Plays a row's way out before the change is made. Returns the ids still waiting afterwards: Undo during
   * the animation cancels it (the change it would undo hasn't happened yet).
   */
  async #leave(ids: readonly string[], mark: 'completing' | 'leaving', ms: number): Promise<string[]> {
    const sig = mark === 'completing' ? this.completing : this.leaving;
    sig.value = new Set([...sig.value, ...ids]);
    await this.#wait(ms);
    const still = ids.filter((id) => sig.peek().has(id));
    sig.value = new Set([...sig.value].filter((id) => !ids.includes(id)));
    return still;
  }

  // ---------- Adding ----------

  /** Where Add task opens in this view, or null when the view takes no new tasks. */
  defaultSlot(): string | null {
    const view = this.shown.value;
    if (view.type === 'completed' || view.type === 'trash' || view.type === 'search') return null;
    const sections = this.content.value.sections;
    // Beside the task with the cursor: its section or board column, or its day in Upcoming.
    const cursor = this.cursor.value;
    const onButton = stopSlot(cursor);
    if (onButton !== undefined && this.stops.value.includes(cursor!)) return onButton;
    const here = sections.find((s) => s.rows.some((r) => r.task.id === cursor))?.addSlot;
    if (cursor !== null && here) return here;
    if (view.type === 'upcoming') return `day:${this.today.value}`;
    // A board hides its empty No section column, so add to the first column there.
    const slots = sections.map((s) => s.addSlot);
    return slots.length === 0 || slots.includes('end') ? 'end' : (slots.find((s) => s !== null) ?? 'end');
  }

  /** New Task: opens the add-task row here, or in the Inbox from a view that can't take one. */
  newTask(): void {
    this.menu.value = null;
    this.browsing.value = false;
    if (this.defaultSlot() === null) this.go({ type: 'project', id: INBOX_ID });
    this.composer.value = this.defaultSlot();
  }

  /**
   * A character typed on an Add task button: opens the add-task row there starting with it (PRD §7). Keys typed
   * before the row appears are kept, in order.
   */
  typeIntoSlot(slot: string, text: string): void {
    this.#seed = this.composer.peek() === slot ? this.#seed + text : text;
    this.composer.value = slot;
  }

  /** What the add-task row starts with when it opens; reading it empties it. */
  takeSeed(): string {
    const text = this.#seed;
    this.#seed = '';
    return text;
  }

  closeComposer(): void {
    this.#seed = '';
    this.composer.value = null;
    this.focusList.value++;
  }

  /** Adds what the add-task row holds. True when a task was added. */
  addTask(text: string, slot: string): boolean {
    const draft = resolveDraft(text, this.shown.value, slot, this.today.value);
    const { task, createdProject } = addDraft(this.list, draft);
    if (!task) return false;
    if (createdProject) this.sayUndoable(`Created new project "${createdProject.name}".`);
    else if (this.list.automated.length) this.sayUndoable(`Added "${task.title}".`);
    else this.announcement.value = `Added "${task.title}".`;
    return true;
  }

  // ---------- Task actions ----------

  /** Space: checks off the chosen tasks, or un-checks them when they are all done. */
  async toggleComplete(ids: readonly string[] = this.targetIds()): Promise<void> {
    const live = ids.filter((id) => !this.completing.peek().has(id) && this.list.getTask(id));
    if (!live.length) return;
    if (live.every((id) => this.list.getTask(id)?.completed)) {
      this.list.reopenTasks(live);
      this.sayUndoable(live.length === 1 ? 'Task reopened.' : `${plural(live.length, 'task')} reopened.`);
      return;
    }
    const open = live.filter((id) => !this.list.getTask(id)?.completed);
    const type = this.shown.peek().type;
    // Checked-off rows stay in view while completed tasks are shown, and on a board.
    const stays = type === 'search' || type === 'completed' || this.showCompleted.peek();
    if (!stays && !this.content.peek().board) this.#fallBack(open);
    const still = await this.#leave(open, 'completing', COMPLETE_MS);
    if (!still.length) return;
    const results = this.list.completeTasks(still, this.today.peek());
    const [first] = results;
    if (results.length === 1 && first) {
      const title = this.list.getTask(first.id)?.title ?? '';
      if (first.repeated && first.nextDue)
        this.sayUndoable(
          `Nice! "${title}" is next due ${formatDue(first.nextDue, this.today.peek()).toLowerCase()}.`,
        );
      else this.sayUndoable('Task completed.');
    } else if (results.length > 1) this.sayUndoable(`${plural(results.length, 'task')} completed.`);
  }

  edit(id: string | undefined = this.single()?.id): void {
    if (id) this.open({ kind: 'task', id });
  }

  /** Puts the task's name in a text field in its row (PRD §4.4). */
  rename(id: string | undefined = this.single()?.id): void {
    const task = id ? this.list.getTask(id) : undefined;
    if (!task || task.deletedAt !== null) return;
    this.flushDraft();
    this.renaming.value = { id: task.id, text: task.title, from: task.title };
  }

  /** Typing in the row's name field. */
  typeName(text: string): void {
    const r = this.renaming.peek();
    if (r) this.renaming.value = { ...r, text };
  }

  /** Saves the row's name field when it was typed in; an empty name keeps the last one. */
  #saveName(): void {
    const r = this.renaming.peek();
    if (!r || r.text === r.from) return;
    const title = r.text.trim();
    if (title) this.saveTask(r.id, { title });
    this.renaming.value = { ...r, text: title || r.from, from: title || r.from };
  }

  /** Closes the row's name field, saving it unless `save` is false. `focus` gives the keyboard back to the list. */
  endRename({ save = true, focus = true } = {}): void {
    if (this.renaming.peek() === null) return;
    if (save) this.#saveName();
    this.renaming.value = null;
    if (focus) this.focusList.value++;
  }

  /**
   * Changes a task from the editor (PRD §9.1): one undo step, or none when nothing differs. A repeating
   * task needs a date to repeat from, so repeating gives it today and clearing the date stops it repeating.
   */
  saveTask(id: string, patch: TaskPatch): void {
    const task = this.list.getTask(id);
    if (!task || task.deletedAt !== null) return;
    const next: TaskPatch = { ...patch };
    if (next.recurrence && !(next.due ?? task.due)) next.due = this.today.peek();
    if (next.due === null && task.recurrence && next.recurrence === undefined) next.recurrence = null;
    const changed = Object.fromEntries(
      Object.entries(next).filter(
        ([key, value]) => JSON.stringify(task[key as keyof typeof task]) !== JSON.stringify(value),
      ),
    ) as TaskPatch;
    if (!Object.keys(changed).length) return;
    this.list.updateTasks(id, changed);
    if (this.list.automated.length) this.sayUndoable('Task saved.');
  }

  /** The editor's subtask field: Quick Add text (PRD §4.4). A #project is ignored: subtasks live with their parent. */
  addSubtask(parentId: string, text: string): void {
    if (!text.trim()) return;
    const parsed = parseQuickAdd(text, this.today.peek());
    this.list.addTask({
      title: parsed.title || text,
      parentId,
      due: parsed.due ?? (parsed.recurrence ? this.today.peek() : null),
      recurrence: parsed.recurrence,
      priority: parsed.priority ?? 4,
      labels: parsed.labels,
    });
  }

  /**
   * Files picked or dropped in the editor (PRD §4.8). Each is written to the store before the task names it,
   * and the ones written are attached as one undo step. A file over the limit, or one that can't be written,
   * is left out and named in a notice.
   */
  async attachFiles(taskId: string, files: readonly AttachedFile[]): Promise<void> {
    const written: Attachment[] = [];
    const refused: string[] = [];
    const failed: string[] = [];
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        refused.push(file.name);
        continue;
      }
      const id = crypto.randomUUID();
      try {
        await this.session.store.putFile(id, new Uint8Array(await file.arrayBuffer()));
        written.push({ id, name: file.name, size: file.size, type: file.type });
      } catch {
        failed.push(file.name);
      }
    }
    const attached = this.list.addAttachments(taskId, written);
    const problems = [
      ...refused.map((name) => `${name} is over 25 MB, so it wasn't attached.`),
      ...failed.map((name) => `${name} couldn't be saved, so it wasn't attached.`),
    ];
    if (problems.length) this.say(problems.join(' '), { tone: 'error', sticky: true });
    else if (attached.length)
      this.sayUndoable(
        attached.length === 1
          ? `Attached ${attached[0]!.name}.`
          : `Attached ${plural(attached.length, 'file')}.`,
      );
  }

  /** The editor's × on an attachment: the task stops naming it, and Undo brings it back (PRD §4.8). */
  removeAttachment(taskId: string, attachment: Attachment): void {
    this.list.removeAttachment(taskId, attachment.id);
    this.sayUndoable(`Removed ${attachment.name}.`);
  }

  /** An attachment's bytes, for opening it; null, with a notice, when they can't be read. */
  async readAttachment(attachment: Attachment): Promise<Uint8Array | null> {
    let bytes: Uint8Array | null;
    try {
      bytes = await this.session.store.getFile(attachment.id);
    } catch {
      this.say(`${attachment.name} couldn't be opened. Try again.`, { tone: 'error' });
      return null;
    }
    if (!bytes) this.say(`${attachment.name} is missing from the attachments folder.`, { tone: 'error' });
    return bytes;
  }

  setDue(ids: readonly string[], due: string | null): void {
    if (!ids.length) return;
    // A repeating task can't be without a date, so clearing the date stops it repeating.
    this.list.updateTasks(ids, due ? { due } : { due: null, recurrence: null });
    this.sayUndoable(
      due
        ? `${ids.length === 1 ? 'Due' : `${plural(ids.length, 'task')} due`} ${formatDue(due, this.today.peek()).toLowerCase()}.`
        : 'Date removed.',
    );
  }

  setPriority(ids: readonly string[], priority: Priority): void {
    if (!ids.length) return;
    this.list.updateTasks(ids, { priority });
    this.announcement.value = `Priority ${priority}`;
  }

  setRecurrence(ids: readonly string[], recurrence: Recurrence | null): void {
    this.list.updateTasks(ids, recurrence ? { recurrence } : { recurrence: null });
  }

  /** Moves tasks to a project; a subtask moved on its own leaves its parent. */
  moveTo(ids: readonly string[], projectId: string): void {
    const project = this.list.getProject(projectId);
    if (!ids.length || !project) return;
    const type = this.shown.peek();
    if (type.type === 'project' && type.id !== projectId) this.#fallBack(ids);
    this.list.batch(() => {
      for (const id of ids) {
        const task = this.list.getTask(id);
        if (task?.parentId && !ids.includes(task.parentId))
          this.list.updateTasks(id, { projectId, parentId: null });
        else this.list.updateTasks(id, { projectId });
      }
    });
    this.sayUndoable(
      ids.length === 1
        ? `Moved task to ${project.name}.`
        : `Moved ${plural(ids.length, 'task')} to ${project.name}.`,
    );
  }

  addLabel(ids: readonly string[], label: string): void {
    const tasks = ids.map((id) => this.list.getTask(id)).filter((t): t is Task => !!t);
    this.list.batch(() => {
      for (const t of tasks)
        if (!t.labels.some((l) => l.toLowerCase() === label.toLowerCase()))
          this.list.updateTasks(t.id, { labels: [...t.labels, label] });
    });
    this.sayUndoable(`Added @${label}.`);
  }

  async trash(ids: readonly string[] = this.targetIds()): Promise<void> {
    if (!ids.length) return;
    const first = this.list.getTask(ids[0]!);
    this.#fallBack(ids);
    const still = await this.#leave(ids, 'leaving', LEAVE_MS);
    if (!still.length) return;
    this.list.deleteTasks(still, this.#now());
    this.sayUndoable(
      still.length === 1 && first
        ? `Moved "${first.title}" to the Trash.`
        : `Moved ${plural(still.length, 'task')} to the Trash.`,
    );
  }

  restore(ids: readonly string[] = this.targetIds()): void {
    if (!ids.length) return;
    this.#fallBack(ids);
    this.list.restoreTasks(ids);
    this.sayUndoable(ids.length === 1 ? 'Task restored.' : `${plural(ids.length, 'task')} restored.`);
  }

  purge(ids: readonly string[] = this.targetIds()): void {
    if (!ids.length) return;
    this.confirm({
      title: ids.length === 1 ? 'Delete for good?' : `Delete ${plural(ids.length, 'task')} for good?`,
      message: "You can undo this until you close Taskite. After that it can't be brought back.",
      confirm: 'Delete for Good',
      run: () => {
        this.#fallBack(ids);
        this.list.purgeTasks(ids);
        this.sayUndoable('Deleted for good.');
      },
    });
  }

  emptyTrash(): void {
    const n = this.list.trashList().length;
    if (!n) return;
    this.confirm({
      title: 'Empty the Trash?',
      message: `${plural(n, 'task')} will be deleted for good.`,
      confirm: 'Empty Trash',
      run: () => {
        this.list.emptyTrash();
        this.sayUndoable('Trash emptied.');
      },
    });
  }

  clearCompleted(): void {
    if (!this.list.liveTasks().some((t) => t.completed)) return;
    this.list.clearCompleted();
    this.sayUndoable('Completed tasks moved to the Trash.');
  }

  /** Puts dragged rows in a new order (project views). */
  reorder(ids: readonly string[]): void {
    this.list.reorderTasks(ids);
  }

  /** Whether the chosen tasks can move up and down: only where the order is yours (PRD §4.5). */
  canMove(): boolean {
    return this.shown.value.type === 'project' && this.hasTargets();
  }

  /** Move Up / Move Down (⌥↑ / ⌥↓): the chosen tasks pass one neighbour (PRD §4.5). */
  moveChosen(delta: 1 | -1): void {
    if (!this.canMove()) return;
    const parentOf = (id: string) => this.list.getTask(id)?.parentId ?? null;
    const order = stepOrder(this.ids.value, parentOf, this.targetIds(), delta);
    if (!order) return;
    this.list.reorderTasks(order);
    this.announcement.value = delta < 0 ? 'Moved up.' : 'Moved down.';
  }

  /** Schedules tasks for today (dropping them on Today). */
  scheduleToday(ids: readonly string[]): void {
    if (!ids.length) return;
    this.list.updateTasks(ids, { due: this.today.peek() });
    this.sayUndoable('Scheduled for today.');
  }

  /** Whether Undo has something to take back, a completion or trash still animating included. */
  canUndo(): boolean {
    return this.list.canUndo || this.completing.value.size > 0 || this.leaving.value.size > 0;
  }

  undo(): void {
    // A completion or trash still animating hasn't been made yet: Undo cancels it.
    if (this.completing.peek().size || this.leaving.peek().size) {
      this.completing.value = new Set();
      this.leaving.value = new Set();
      this.say('Undone.');
      return;
    }
    if (!this.list.canUndo) return;
    this.list.undo();
    this.say('Undone.');
  }

  redo(): void {
    if (!this.list.canRedo) return;
    this.list.redo();
    this.say('Redone.');
  }

  // ---------- Projects and labels ----------

  saveProject(id: string | null, name: string, color: ProjectColor): Project | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (id) {
      this.list.updateProject(id, { name: trimmed, color });
      return this.list.getProject(id) ?? null;
    }
    const project = this.list.addProject(trimmed, color);
    this.go({ type: 'project', id: project.id });
    this.sayUndoable(`Created new project "${project.name}".`);
    return project;
  }

  /** The project on screen, if it's one that can be edited (not the Inbox). */
  currentProject(): Project | undefined {
    const view = this.shown.value;
    return view.type === 'project' && view.id !== INBOX_ID ? this.list.getProject(view.id) : undefined;
  }

  currentLabel(): string | undefined {
    const view = this.shown.value;
    return view.type === 'label' ? view.name : undefined;
  }

  /** The project a project command acts on: the one right-clicked in the sidebar, else the one on screen. */
  projectTarget(): Project | undefined {
    const target = this.menu.value?.target;
    if (target?.kind === 'project')
      return target.id === INBOX_ID ? undefined : this.list.getProject(target.id);
    return this.currentProject();
  }

  /** The label a label command acts on: the one right-clicked in the sidebar, else the one on screen. */
  labelTarget(): string | undefined {
    const target = this.menu.value?.target;
    return target?.kind === 'label' ? target.name : this.currentLabel();
  }

  deleteProject(id: string): void {
    const project = this.list.getProject(id);
    if (!project || id === INBOX_ID) return;
    const n = this.list.liveTasks().filter((t) => t.projectId === id).length;
    this.confirm({
      title: `Delete "${project.name}"?`,
      message: n ? `Its ${plural(n, 'task')} will move to the Trash.` : 'It has no tasks.',
      confirm: 'Delete Project',
      run: () => {
        // Only the view of the project itself has to go; one deleted from the sidebar elsewhere stays put.
        const view = this.shown.peek();
        this.list.deleteProject(id, this.#now());
        if (view.type === 'project' && view.id === id) this.go({ type: 'project', id: INBOX_ID });
        this.sayUndoable(`Deleted project "${project.name}".`);
      },
    });
  }

  /** Renames and recolours a label (PRD §4.7); a label on screen stays on screen under its new name. */
  editLabel(name: string, next: string, color: ProjectColor | null): void {
    const before = this.list.labelColor(name);
    const renamed = next.trim().replace(/^@/, '').replace(/\s+/g, '-');
    if (renamed === name && before === color) return;
    // Read before the edit: once the old name is gone, the view on screen falls back.
    const view = this.shown.peek();
    if (!this.list.editLabel(name, next, color)) return;
    if (view.type === 'label' && view.name.toLowerCase() === name.toLowerCase())
      this.go({ type: 'label', name: renamed });
    if (renamed !== name) this.sayUndoable(`Renamed @${name} to @${renamed}.`);
  }

  removeLabel(name: string): void {
    this.confirm({
      title: `Remove @${name}?`,
      message: 'The label comes off every task. The tasks stay.',
      confirm: 'Remove Label',
      run: () => {
        const view = this.shown.peek();
        this.list.deleteLabel(name);
        if (view.type === 'label' && view.name.toLowerCase() === name.toLowerCase())
          this.go({ type: 'project', id: INBOX_ID });
        this.sayUndoable(`Removed @${name}.`);
      },
    });
  }

  // ---------- Sections (PRD §6) ----------

  /** The project on screen, the Inbox included. */
  shownProject(): Project | undefined {
    const view = this.shown.value;
    return view.type === 'project' ? this.list.getProject(view.id) : undefined;
  }

  /** The section a section command acts on: the one whose heading was right-clicked. */
  sectionTarget(): { readonly projectId: string; readonly section: ProjectSection } | undefined {
    const target = this.menu.value?.target;
    if (target?.kind !== 'section') return undefined;
    const section = this.list.getSection(target.projectId, target.id);
    return section ? { projectId: target.projectId, section } : undefined;
  }

  /**
   * The section Section Automations… edits: the one right-clicked, else the project section the cursor is in
   * (PRD §6.1).
   */
  automationTarget(): { readonly projectId: string; readonly section: ProjectSection } | undefined {
    const right = this.sectionTarget();
    if (right) return right;
    if (this.menu.value) return undefined;
    const project = this.shownProject();
    const cursor = this.cursor.value;
    if (!project || cursor === null) return undefined;
    const sectionId = this.content.value.sections.find((s) => holds(s, cursor))?.sectionId;
    const section = sectionId ? this.list.getSection(project.id, sectionId) : undefined;
    return section ? { projectId: project.id, section } : undefined;
  }

  /**
   * Saves a section's rules from the editor; with `apply`, also runs its "enters" rules on the open tasks already
   * there. One undo step either way (PRD §6.1).
   */
  saveAutomations(
    projectId: string,
    sectionId: string,
    rules: readonly SectionAutomation[],
    apply: boolean,
  ): void {
    this.list.batch(() => {
      this.list.setSectionAutomations(projectId, sectionId, rules);
      if (apply) this.list.applyEnterRules(projectId, sectionId);
    });
    this.sayUndoable('Automations saved.');
  }

  /** Adds a section (after `after`, else at the end) or renames one. */
  saveSection(projectId: string, id: string | null, name: string, after?: string): void {
    if (!name.trim()) return;
    if (id) {
      this.list.renameSection(projectId, id, name);
      return;
    }
    const section = this.list.addSection(projectId, name, after);
    if (section) this.announcement.value = `Added section "${section.name}".`;
  }

  deleteSection(projectId: string, id: string): void {
    const section = this.list.getSection(projectId, id);
    if (!section) return;
    const n = this.list.liveTasks().filter((t) => t.projectId === projectId && t.sectionId === id).length;
    this.confirm({
      title: `Delete "${section.name}"?`,
      message: n ? `Its ${plural(n, 'task')} will move to the Trash.` : 'It has no tasks.',
      confirm: 'Delete Section',
      run: () => {
        this.list.deleteSection(projectId, id, this.#now());
        this.sayUndoable(`Deleted section "${section.name}".`);
      },
    });
  }

  /** Shows the project on screen as a board, or back as a list. */
  setBoard(on: boolean): void {
    const project = this.shownProject();
    if (project) this.list.setProjectView(project.id, on ? 'board' : 'list');
  }

  /**
   * Drops dragged tasks into a section (undefined: above the first one) in the given order, as one undo
   * step. Subtasks dragged without their parent stay with it.
   */
  dropInto(dragged: readonly string[], sectionId: string | undefined, order: readonly string[] | null): void {
    const tops = dragged.filter((id) => !this.list.getTask(id)?.parentId);
    this.list.batch(() => {
      if (tops.length) this.list.updateTasks(tops, { sectionId });
      if (order) this.list.reorderTasks(order);
    });
    if (this.list.automated.length) this.sayUndoable(this.#movedTo(sectionId));
  }

  /** "Moved to Doing." for the section of the shown project, or out of sections. */
  #movedTo(sectionId: string | undefined): string {
    const project = this.shownProject();
    const name = sectionId && project ? this.list.getSection(project.id, sectionId)?.name : null;
    return name ? `Moved to ${name}.` : 'Moved out of sections.';
  }

  /** Whether the chosen tasks can move to the next or previous section (⌥← ⌥→). */
  canMoveSection(): boolean {
    return !!this.shownProject()?.sections?.length && this.hasTargets();
  }

  /** ⌥← / ⌥→: the chosen tasks go to the end of the previous or next section (PRD §4.5). */
  moveChosenSection(delta: 1 | -1): void {
    const project = this.shownProject();
    if (!project || !this.canMoveSection()) return;
    const tops = [
      ...new Set(
        this.targetIds().map((id) => {
          const task = this.list.getTask(id);
          return task?.parentId ?? id;
        }),
      ),
    ];
    const first = this.list.getTask(tops[0] ?? '');
    if (!first) return;
    const keys = [undefined, ...(project.sections ?? []).map((s) => s.id)];
    const to = keys.indexOf(first.sectionId) + delta;
    if (to < 0 || to >= keys.length) return;
    const sectionId = keys[to];
    const order = [...this.ids.peek().filter((id) => !tops.includes(id)), ...tops];
    this.dropInto(tops, sectionId, order);
    // With automations, the notice already says it.
    if (!this.list.automated.length) this.announcement.value = this.#movedTo(sectionId);
  }

  // ---------- Settings ----------

  setTheme(theme: Theme): void {
    this.list.updateSettings({ theme });
  }

  /** Whether the shown view has checked-off tasks to show or hide (not Completed, the Trash or a search). */
  canShowCompleted(): boolean {
    const type = this.shown.value.type;
    return type !== 'completed' && type !== 'trash' && type !== 'search';
  }

  toggleShowCompleted(): void {
    const on = !this.showCompleted.peek();
    this.list.updateSettings({ showCompleted: on });
    this.say(on ? 'Showing completed tasks.' : 'Hiding completed tasks.');
  }

  /** Settings: whether a section named Done gets the Done rules (PRD §6.1). */
  setDoneRules(on: boolean): void {
    this.list.updateSettings({ doneRules: on });
  }

  // ---------- Dialogs ----------

  /**
   * The open editor's typed text, which isn't in the task list until it's saved. Everything that closes
   * or replaces the editor saves it first: another dialog, Esc, a conflict, closing the window (PRD §9.1).
   */
  #draft: Draft | null = null;

  /** The editor registers its draft while it's open. */
  setDraft(draft: Draft | null): void {
    this.#draft = draft;
  }

  /** Saves the open editor's typed text, if any. */
  flushDraft(): void {
    this.#saveName();
    this.#draft?.flush();
  }

  /** Whether the open editor holds typed text not yet saved. Changes from elsewhere wait for it. */
  hasDraft(): boolean {
    const r = this.renaming.peek();
    if (r && r.text !== r.from) return true;
    return this.#draft?.dirty() ?? false;
  }

  open(dialog: DialogState): void {
    this.flushDraft();
    batch(() => {
      this.menu.value = null;
      this.renaming.value = null;
      this.dialog.value = dialog;
    });
  }

  close(): void {
    this.flushDraft();
    this.dialog.value = null;
    this.focusList.value++;
  }

  confirm(opts: { title: string; message: string; confirm: string; run: () => void }): void {
    this.open({ kind: 'confirm', ...opts });
  }

  /** Opens or closes a dialog that its own shortcut toggles (⌘K, ⌘/). */
  toggle(kind: 'commands' | 'shortcuts', query = ''): void {
    if (this.dialog.peek()?.kind === kind) this.close();
    else this.open(kind === 'commands' ? { kind, query } : { kind });
  }

  /** Commands only run with nothing in the way: no dialog, no save conflict (PRD §9). */
  blocked(): boolean {
    return this.dialog.value !== null || this.session.conflict.value !== null;
  }

  // ---------- Saving ----------

  /** Shows the save state in the status bar: failures stay with Try again (PRD §3.3). */
  saveStatusChanged(status: string): void {
    if (status === 'failed')
      this.say(
        this.session.backedUp.peek()
          ? "Couldn't save your tasks."
          : "Couldn't save your tasks, and this browser has no room to keep a copy. Keep this window open.",
        {
          sticky: true,
          tone: 'error',
          action: { label: 'Try Again', run: () => this.session.retry() },
        },
      );
    else if (status === 'saved' && this.notice.peek()?.tone === 'error') this.say('Saved.');
  }

  /** The next day after `today`, for the due dialog's quick buttons. */
  tomorrow(): string {
    return addDays(this.today.value, 1);
  }
}

/** Whether `id` is one of the section's tasks or its Add task button. */
/** A section's stops for ↑ and ↓: its tasks, then its Add task button. */
function sectionStops(section: Section): string[] {
  const ids = section.rows.map((r) => r.task.id);
  return section.addSlot === null ? ids : [...ids, addStop(section.addSlot)];
}

function holds(section: Section, id: string): boolean {
  return (
    section.rows.some((r) => r.task.id === id) ||
    (section.addSlot !== null && addStop(section.addSlot) === id)
  );
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
