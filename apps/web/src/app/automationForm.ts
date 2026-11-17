/**
 * The automations editor's fields (PRD §6.1): rules as the dialog holds them while they're edited, and back to
 * rules for saving. Every action keeps a value for each kind, so switching the kind and back loses nothing.
 */
import {
  MAX_DUE_DAYS,
  type AutomationAction,
  type AutomationDue,
  type AutomationTrigger,
  type Priority,
  type SectionAutomation,
} from '@taskite/core';
import { parseLabels } from './forms.ts';

export type ActionKind = 'complete' | 'reopen' | 'due' | 'priority' | 'addLabel' | 'removeLabel' | 'moveTo';

export const ACTION_NAMES: Readonly<Record<ActionKind, string>> = {
  complete: 'Complete',
  reopen: 'Reopen',
  due: 'Set due date',
  priority: 'Set priority',
  addLabel: 'Add label',
  removeLabel: 'Remove label',
  moveTo: 'Move to',
};

export const TRIGGER_NAMES: Readonly<Record<AutomationTrigger, string>> = {
  enter: 'enters this section',
  complete: 'is completed here',
};

export type DueChoice = 'today' | 'tomorrow' | 'days' | 'nextWeek' | 'none';

export const DUE_NAMES: Readonly<Record<DueChoice, string>> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  days: 'In N days',
  nextWeek: 'Next week',
  none: 'No date',
};

export interface ActionDraft {
  readonly kind: ActionKind;
  readonly due: DueChoice;
  /** The N of "In N days", as typed. */
  readonly days: string;
  readonly priority: Priority;
  readonly label: string;
  /** Where Move to goes: `projectId/sectionId`, or `projectId/` for the project's top. */
  readonly place: string;
}

export interface RuleDraft {
  readonly on: AutomationTrigger;
  readonly actions: readonly ActionDraft[];
}

/** A Move to choice as the dialog stores it. */
export function placeKey(projectId: string, sectionId: string | null): string {
  return `${projectId}/${sectionId ?? ''}`;
}

/** A new action: Complete, with the other kinds' values ready for when the kind changes. */
export function newAction(place: string): ActionDraft {
  return { kind: 'complete', due: 'today', days: '3', priority: 1, label: '', place };
}

export function newRule(place: string): RuleDraft {
  return { on: 'enter', actions: [newAction(place)] };
}

/** A section's rules as the editor shows them. */
export function toDrafts(rules: readonly SectionAutomation[], place: string): RuleDraft[] {
  return rules.map((rule) => ({ on: rule.on, actions: rule.do.map((a) => toDraft(a, place)) }));
}

function toDraft(action: AutomationAction, place: string): ActionDraft {
  const blank = newAction(place);
  if ('complete' in action) return { ...blank, kind: action.complete ? 'complete' : 'reopen' };
  if ('due' in action) {
    const due = action.due;
    if (due === null) return { ...blank, kind: 'due', due: 'none' };
    if (due.startsWith('+')) return { ...blank, kind: 'due', due: 'days', days: due.slice(1) };
    return { ...blank, kind: 'due', due: due as DueChoice };
  }
  if ('priority' in action) return { ...blank, kind: 'priority', priority: action.priority };
  if ('addLabel' in action) return { ...blank, kind: 'addLabel', label: action.addLabel };
  if ('removeLabel' in action) return { ...blank, kind: 'removeLabel', label: action.removeLabel };
  return { ...blank, kind: 'moveTo', place: placeKey(action.moveTo.projectId, action.moveTo.sectionId) };
}

/** The number of days "In N days" holds, or undefined when it isn't 1 to 365. */
export function dueDays(text: string): number | undefined {
  if (!/^\s*\d+\s*$/.test(text)) return undefined;
  const days = Number(text);
  return days >= 1 && days <= MAX_DUE_DAYS ? days : undefined;
}

/** One action for saving, or undefined when its value isn't filled in (no label, no number of days). */
export function fromDraft(draft: ActionDraft): AutomationAction | undefined {
  switch (draft.kind) {
    case 'complete':
      return { complete: true };
    case 'reopen':
      return { complete: false };
    case 'due': {
      if (draft.due !== 'days') {
        const due: AutomationDue = draft.due === 'none' ? null : draft.due;
        return { due };
      }
      const days = dueDays(draft.days);
      return days === undefined ? undefined : { due: `+${days}` };
    }
    case 'priority':
      return { priority: draft.priority };
    case 'addLabel':
    case 'removeLabel': {
      const label = parseLabels(draft.label)[0];
      if (!label) return undefined;
      return draft.kind === 'addLabel' ? { addLabel: label } : { removeLabel: label };
    }
    case 'moveTo': {
      const cut = draft.place.indexOf('/');
      if (cut <= 0) return undefined;
      return {
        moveTo: { projectId: draft.place.slice(0, cut), sectionId: draft.place.slice(cut + 1) || null },
      };
    }
  }
}

/** The rules to save: actions not filled in are left out, and so are rules left with none. */
export function fromDrafts(drafts: readonly RuleDraft[]): SectionAutomation[] {
  return drafts
    .map((rule) => ({
      on: rule.on,
      do: rule.actions.map(fromDraft).filter((a): a is AutomationAction => a !== undefined),
    }))
    .filter((rule) => rule.do.length > 0);
}

/** Whether saving adds an "enters" rule, or changes one: then the editor asks about tasks already there. */
export function enterRulesChanged(
  before: readonly SectionAutomation[],
  after: readonly SectionAutomation[],
): boolean {
  const old = new Set(before.filter((r) => r.on === 'enter').map((r) => JSON.stringify(r.do)));
  return after.some((r) => r.on === 'enter' && !old.has(JSON.stringify(r.do)));
}
