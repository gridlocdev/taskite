import { describe, expect, it } from 'vitest';
import { KEYBOARD_MIN_PX, frameOf } from '../src/app/keyboard.ts';

describe('the on-screen keyboard frame (PRD §5.5)', () => {
  it('fills the window when there is no visual viewport', () => {
    expect(frameOf(844, null)).toEqual({ height: 844, top: 0, keyboard: false });
  });

  it('shrinks to the part the keyboard leaves, starting where the page is scrolled to', () => {
    expect(frameOf(844, { height: 508, pageTop: 40 })).toEqual({ height: 508, top: 40, keyboard: true });
  });

  it("doesn't take a browser bar for the keyboard", () => {
    expect(frameOf(844, { height: 844 - KEYBOARD_MIN_PX + 1, pageTop: 0 }).keyboard).toBe(false);
    expect(frameOf(844, { height: 844 - KEYBOARD_MIN_PX, pageTop: 0 }).keyboard).toBe(true);
  });
});
