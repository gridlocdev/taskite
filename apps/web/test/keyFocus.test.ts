import { describe, expect, it } from 'vitest';
import { keyFocus } from '../src/app/App.tsx';

/** A stand-in element inside the given ancestors (selectors it matches, itself included). */
function el(...matches: string[]): Element {
  return {
    ownerDocument: null,
    closest: (sel: string) => (sel.split(',').some((s) => matches.includes(s.trim())) ? {} : null),
  } as unknown as Element;
}

describe('keyFocus', () => {
  it('treats a task row and anything in it as the list', () => {
    expect(keyFocus(el('[role=option]', '.tk-list'))).toBe('list');
    expect(keyFocus(el('button', '[role=option]', '.tk-list'))).toBe('list');
  });

  it('lets a button in the list keep Enter and Space', () => {
    expect(keyFocus(el('button', '.tk-list'))).toBe('control');
  });

  it('gives text fields their keys', () => {
    expect(keyFocus(el('input', '.tk-list'))).toBe('text');
  });
});
