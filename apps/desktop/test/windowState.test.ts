import { describe, expect, it } from 'vitest';
import { parseSavedWindow, placeWindow } from '../src/windowState.ts';

const main = { x: 0, y: 25, width: 1440, height: 875 };
const right = { x: 1440, y: 0, width: 1920, height: 1080 };
const min = { width: 560, height: 400 };
const fallback = main;

describe('placeWindow', () => {
  it('opens where it was', () => {
    const saved = { x: 100, y: 80, width: 900, height: 700, maximized: false };
    expect(placeWindow(saved, [main, right], fallback, min)).toEqual(saved);
    const there = { x: 1600, y: 100, width: 1000, height: 800, maximized: true };
    expect(placeWindow(there, [main, right], fallback, min)).toEqual(there);
  });

  it('fills the screen when nothing was saved', () => {
    expect(placeWindow(null, [main], fallback, min)).toEqual({ ...main, maximized: false });
  });

  it('moves a window that hangs off the edge back on, and shrinks one too big', () => {
    expect(
      placeWindow({ x: 1200, y: -50, width: 900, height: 2000, maximized: false }, [main], fallback, min),
    ).toEqual({ x: 540, y: 25, width: 900, height: 875, maximized: false });
  });

  it('centres a window whose screen is gone on the main screen', () => {
    const saved = { x: 2000, y: 200, width: 1000, height: 700, maximized: false };
    expect(placeWindow(saved, [main], fallback, min)).toEqual({
      x: 220,
      y: 113,
      width: 1000,
      height: 700,
      maximized: false,
    });
  });
});

describe('parseSavedWindow', () => {
  it('takes numbers and refuses anything else', () => {
    expect(parseSavedWindow({ x: 1.4, y: 2, width: 300, height: 200, maximized: true })).toEqual({
      x: 1,
      y: 2,
      width: 300,
      height: 200,
      maximized: true,
    });
    expect(parseSavedWindow({ x: 1, y: 2, width: 0, height: 200 })).toBeNull();
    expect(parseSavedWindow('nope')).toBeNull();
    expect(parseSavedWindow({ x: '1', y: 2, width: 3, height: 4 })).toBeNull();
  });
});
