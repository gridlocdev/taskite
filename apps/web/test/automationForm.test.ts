import { describe, expect, it } from 'vitest';
import type { SectionAutomation } from '@taskite/core';
import {
  enterRulesChanged,
  fromDraft,
  fromDrafts,
  newAction,
  placeKey,
  toDrafts,
} from '../src/app/automationForm.ts';

const HERE = placeKey('p1', 's1');

describe('the automations editor (PRD §6.1)', () => {
  it('turns rules into fields and back unchanged', () => {
    const rules: SectionAutomation[] = [
      {
        on: 'enter',
        do: [
          { complete: true },
          { complete: false },
          { due: 'today' },
          { due: '+3' },
          { due: 'nextWeek' },
          { due: null },
          { priority: 2 },
          { addLabel: 'shipped' },
          { removeLabel: 'waiting' },
        ],
      },
      { on: 'leave', do: [{ complete: false }] },
      { on: 'complete', do: [{ moveTo: { projectId: 'p2', sectionId: null } }] },
      { on: 'complete', do: [{ moveTo: { projectId: 'p2', sectionId: 's9' } }] },
    ];
    expect(fromDrafts(toDrafts(rules, HERE))).toEqual(rules);
  });

  it('leaves out actions not filled in, and rules left with none', () => {
    const blank = newAction(HERE);
    expect(fromDraft({ ...blank, kind: 'addLabel', label: '  ' })).toBeUndefined();
    expect(fromDraft({ ...blank, kind: 'addLabel', label: '@Deep work' })).toEqual({ addLabel: 'Deep-work' });
    expect(fromDraft({ ...blank, kind: 'due', due: 'days', days: '0' })).toBeUndefined();
    expect(fromDraft({ ...blank, kind: 'due', due: 'days', days: '366' })).toBeUndefined();
    expect(fromDraft({ ...blank, kind: 'due', due: 'days', days: ' 7 ' })).toEqual({ due: '+7' });
    expect(
      fromDrafts([
        { on: 'enter', actions: [{ ...blank, kind: 'removeLabel', label: '' }] },
        { on: 'complete', actions: [] },
        { on: 'enter', actions: [blank] },
      ]),
    ).toEqual([{ on: 'enter', do: [{ complete: true }] }]);
  });

  it('asks about tasks already there only when an enters rule is new or changed', () => {
    const before: SectionAutomation[] = [
      { on: 'enter', do: [{ complete: true }] },
      { on: 'complete', do: [{ priority: 4 }] },
    ];
    expect(enterRulesChanged(before, before)).toBe(false);
    expect(enterRulesChanged(before, [before[0]!])).toBe(false);
    expect(enterRulesChanged(before, [...before, { on: 'complete', do: [{ priority: 1 }] }])).toBe(false);
    expect(enterRulesChanged(before, [{ on: 'enter', do: [{ complete: true }, { priority: 1 }] }])).toBe(
      true,
    );
    expect(enterRulesChanged([], [{ on: 'enter', do: [{ due: 'today' }] }])).toBe(true);
  });
});
