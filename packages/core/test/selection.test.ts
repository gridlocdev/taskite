import { describe, expect, it } from 'vitest';
import { fallbackAfter, rangeIds, stepId } from '../src/index.ts';

const ids = ['a', 'b', 'c', 'd'];

describe('selection', () => {
  it('stepping moves one row and stops at the ends', () => {
    expect(stepId(ids, 'b', 1)).toBe('c');
    expect(stepId(ids, 'b', -1)).toBe('a');
    expect(stepId(ids, 'd', 1)).toBe('d');
    expect(stepId(ids, 'a', -1)).toBe('a');
  });

  it('with nothing chosen, down picks the first and up the last', () => {
    expect(stepId(ids, null, 1)).toBe('a');
    expect(stepId(ids, 'gone', -1)).toBe('d');
    expect(stepId([], null, 1)).toBeNull();
  });

  it('a range runs from the anchor to the target either way', () => {
    expect(rangeIds(ids, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(ids, 'c', 'a')).toEqual(['a', 'b', 'c']);
    expect(rangeIds(ids, null, 'c')).toEqual(['c']);
    expect(rangeIds(ids, 'a', 'gone')).toEqual([]);
  });

  it('after tasks leave, the next one below is chosen, else the one above', () => {
    expect(fallbackAfter(ids, new Set(['b']))).toBe('c');
    expect(fallbackAfter(ids, new Set(['a', 'c']))).toBe('d');
    expect(fallbackAfter(ids, new Set(['b', 'd']))).toBe('c');
    expect(fallbackAfter(ids, new Set(ids))).toBeNull();
    expect(fallbackAfter(ids, new Set(['x']))).toBeNull();
  });
});
