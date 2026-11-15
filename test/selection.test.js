import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepId, rangeIds } from '../src/renderer/selection.js';

const ids = ['a', 'b', 'c', 'd'];

test('stepping moves one row and stops at the ends', () => {
  assert.equal(stepId(ids, 'b', 1), 'c');
  assert.equal(stepId(ids, 'b', -1), 'a');
  assert.equal(stepId(ids, 'd', 1), 'd');
  assert.equal(stepId(ids, 'a', -1), 'a');
});

test('with nothing chosen, down picks the first and up the last', () => {
  assert.equal(stepId(ids, null, 1), 'a');
  assert.equal(stepId(ids, 'gone', -1), 'd');
  assert.equal(stepId([], null, 1), null);
});

test('a range runs from the anchor to the target either way', () => {
  assert.deepEqual(rangeIds(ids, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(rangeIds(ids, 'c', 'a'), ['a', 'b', 'c']);
  assert.deepEqual(rangeIds(ids, null, 'c'), ['c']);
  assert.deepEqual(rangeIds(ids, 'a', 'gone'), []);
});
