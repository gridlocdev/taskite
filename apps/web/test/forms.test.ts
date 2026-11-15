import { describe, expect, it } from 'vitest';
import { dropOrder, duePreview, parseDueText, parseLabels } from '../src/app/forms.ts';

const TODAY = '2026-03-10';

describe('forms', () => {
  it('reads due dates', () => {
    expect(parseDueText('tomorrow', TODAY)).toEqual({ due: '2026-03-11', ok: true });
    expect(parseDueText(' none ', TODAY)).toEqual({ due: null, ok: true });
    expect(parseDueText('whenever', TODAY).ok).toBe(false);
    expect(duePreview('', TODAY)).toBe('No due date');
    expect(duePreview('today', TODAY)).toBe('Due today (2026-03-10)');
    expect(duePreview('blah', TODAY)).toBe('Not a date I understand yet.');
  });

  it('reads labels', () => {
    expect(parseLabels(' @phone, errands ,Phone, deep work,')).toEqual(['phone', 'errands', 'deep-work']);
  });

  it('works out the order after a drop', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(dropOrder(ids, ['a'], 'c', true)).toEqual(['b', 'c', 'a', 'd']);
    expect(dropOrder(ids, ['d', 'b'], 'a', false)).toEqual(['b', 'd', 'a', 'c']);
    expect(dropOrder(ids, ['a'], 'b', false)).toBeNull();
    expect(dropOrder(ids, ['a'], 'a', true)).toBeNull();
  });
});
