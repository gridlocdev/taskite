import { describe, expect, it } from 'vitest';
import { INBOX_ID } from '@taskite/core';
import { SLOP_PX, SWIPE_COMMIT_PX, gestureOf, swipeSide } from '../src/app/touch.ts';
import { makeApp } from './helpers.ts';

describe('touch gestures (PRD §5.5)', () => {
  it('a finger that has barely moved is still a tap or a long press', () => {
    expect(gestureOf(SLOP_PX - 1, 0)).toBe('none');
    expect(gestureOf(3, -3)).toBe('none');
  });

  it('mostly sideways is a swipe, mostly up or down is a scroll', () => {
    expect(gestureOf(20, 5)).toBe('swipe');
    expect(gestureOf(-20, 5)).toBe('swipe');
    expect(gestureOf(5, 20)).toBe('scroll');
    expect(gestureOf(10, -10)).toBe('scroll');
  });

  it('a swipe commits past a third of the row or SWIPE_COMMIT_PX, whichever is less', () => {
    expect(swipeSide(SWIPE_COMMIT_PX, 1000)).toBe('right');
    expect(swipeSide(SWIPE_COMMIT_PX - 1, 1000)).toBeNull();
    expect(swipeSide(-SWIPE_COMMIT_PX, 1000)).toBe('left');
    expect(swipeSide(100, 300)).toBe('right');
    expect(swipeSide(-99, 300)).toBeNull();
  });
});

describe('the Browse tab (PRD §5.5)', () => {
  it('Browse clears a search and closes the add-task row; going to a view leaves Browse', async () => {
    const { app } = await makeApp();
    app.go({ type: 'project', id: INBOX_ID });
    app.newTask();
    app.setSearch('milk');
    app.browse();
    expect(app.browsing.value).toBe(true);
    expect(app.search.value).toBe('');
    expect(app.composer.value).toBeNull();
    app.go({ type: 'today' });
    expect(app.browsing.value).toBe(false);
  });

  it('New Task leaves Browse for the view it adds to', async () => {
    const { app } = await makeApp();
    app.browse();
    app.newTask();
    expect(app.browsing.value).toBe(false);
    expect(app.composer.value).not.toBeNull();
  });
});
