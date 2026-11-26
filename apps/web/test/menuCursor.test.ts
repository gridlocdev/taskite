import { describe, expect, it } from 'vitest';
import { nextMenuKey } from '../src/app/menuCursor.ts';

describe("a menu's active item (PRD §9)", () => {
  const keys = ['a', 'b', 'c'];
  it('moves with the arrows, wrapping around, and jumps with Home and End', () => {
    expect(nextMenuKey(keys, 'a', 'ArrowDown')).toBe('b');
    expect(nextMenuKey(keys, 'c', 'ArrowDown')).toBe('a');
    expect(nextMenuKey(keys, 'a', 'ArrowUp')).toBe('c');
    expect(nextMenuKey(keys, 'b', 'Home')).toBe('a');
    expect(nextMenuKey(keys, 'a', 'End')).toBe('c');
  });

  it('starts at the top going down and at the bottom going up when nothing is active', () => {
    expect(nextMenuKey(keys, null, 'ArrowDown')).toBe('a');
    expect(nextMenuKey(keys, null, 'ArrowUp')).toBe('c');
    expect(nextMenuKey(keys, 'gone', 'ArrowDown')).toBe('a');
  });

  it('leaves other keys and empty menus alone', () => {
    expect(nextMenuKey(keys, 'a', 'Enter')).toBeNull();
    expect(nextMenuKey([], null, 'ArrowDown')).toBeNull();
  });
});
