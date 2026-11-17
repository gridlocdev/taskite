/**
 * Section automations (PRD §6.1): the rules a project section holds, and how they are checked when read from
 * the file or saved from the editor. Running them is a separate step.
 */
import type { Priority } from './parser.ts';

/** What sets a rule off: a task entering the section, or a task in it being completed. */
export type AutomationTrigger = 'enter' | 'complete';

/** A date a rule sets: relative to the day it runs, or none. `+N` is N days on. */
export type AutomationDue = 'today' | 'tomorrow' | 'nextWeek' | `+${number}` | null;

export type AutomationAction =
  | { complete: boolean }
  | { due: AutomationDue }
  | { priority: Priority }
  | { addLabel: string }
  | { removeLabel: string }
  | { moveTo: { projectId: string; sectionId: string | null } };

export interface SectionAutomation {
  on: AutomationTrigger;
  do: AutomationAction[];
}

export const MAX_RULES = 10;
export const MAX_ACTIONS = 5;
/** Furthest `+N` a rule can set a date to. */
export const MAX_DUE_DAYS = 365;

/** Whether a rule may move a task to this place: a project, or one of its sections. */
export type PlaceExists = (projectId: string, sectionId: string | null) => boolean;

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null;

function cleanDue(value: unknown): { ok: true; due: AutomationDue } | { ok: false } {
  if (value === null || value === 'today' || value === 'tomorrow' || value === 'nextWeek')
    return { ok: true, due: value };
  if (typeof value !== 'string' || !/^\+\d+$/.test(value)) return { ok: false };
  const days = Number(value.slice(1));
  return days >= 1 && days <= MAX_DUE_DAYS ? { ok: true, due: `+${days}` } : { ok: false };
}

/** One action as the file or the editor gave it, or undefined when it isn't one this version understands. */
function cleanAction(raw: unknown, exists: PlaceExists): AutomationAction | undefined {
  if (!isObject(raw)) return undefined;
  const keys = Object.keys(raw);
  const key = keys[0];
  if (keys.length !== 1 || key === undefined) return undefined;
  const value = raw[key];
  switch (key) {
    case 'complete':
      return typeof value === 'boolean' ? { complete: value } : undefined;
    case 'due': {
      const due = cleanDue(value);
      return due.ok ? { due: due.due } : undefined;
    }
    case 'priority':
      return value === 1 || value === 2 || value === 3 || value === 4 ? { priority: value } : undefined;
    case 'addLabel':
    case 'removeLabel': {
      const label = typeof value === 'string' ? value.trim() : '';
      if (!label) return undefined;
      return key === 'addLabel' ? { addLabel: label } : { removeLabel: label };
    }
    case 'moveTo': {
      if (!isObject(value) || typeof value['projectId'] !== 'string') return undefined;
      const sectionId = typeof value['sectionId'] === 'string' ? value['sectionId'] : null;
      return exists(value['projectId'], sectionId)
        ? { moveTo: { projectId: value['projectId'], sectionId } }
        : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * A section's rules as the file or the editor gave them, keeping only what this version understands: unknown
 * actions, moves to places that don't exist and rules left with no action are dropped, and the limits hold.
 */
export function cleanAutomations(raw: unknown, exists: PlaceExists): SectionAutomation[] {
  if (!Array.isArray(raw)) return [];
  const rules: SectionAutomation[] = [];
  for (const rule of raw) {
    if (rules.length === MAX_RULES) break;
    if (!isObject(rule) || (rule['on'] !== 'enter' && rule['on'] !== 'complete')) continue;
    const actions = Array.isArray(rule['do'])
      ? (rule['do'] as unknown[])
          .map((a) => cleanAction(a, exists))
          .filter((a) => a !== undefined)
          .slice(0, MAX_ACTIONS)
      : [];
    if (actions.length) rules.push({ on: rule['on'], do: actions });
  }
  return rules;
}

/**
 * Renames a label in a section's rules, as Edit Label… does on tasks (PRD §6). Matches ignoring case. Says
 * whether anything changed.
 */
export function renameLabelInRules(rules: SectionAutomation[], from: string, to: string): boolean {
  const key = from.toLowerCase();
  let changed = false;
  for (const rule of rules)
    for (const action of rule.do) {
      if ('addLabel' in action && action.addLabel.toLowerCase() === key && action.addLabel !== to) {
        action.addLabel = to;
        changed = true;
      }
      if ('removeLabel' in action && action.removeLabel.toLowerCase() === key && action.removeLabel !== to) {
        action.removeLabel = to;
        changed = true;
      }
    }
  return changed;
}
