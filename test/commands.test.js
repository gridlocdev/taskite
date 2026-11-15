import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesChord, formatShortcut, toAccelerator, filterCommands, shortcutSteps, keyName } from '../src/renderer/commands.js';

/** @param {Partial<{key: string, metaKey: boolean, ctrlKey: boolean, shiftKey: boolean, altKey: boolean}>} e */
const key = (e) => ({ key: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...e });

test('mod is Cmd on a Mac and Ctrl elsewhere', () => {
  assert.ok(matchesChord(key({ key: 'k', metaKey: true }), 'mod+k', true));
  assert.ok(!matchesChord(key({ key: 'k', ctrlKey: true }), 'mod+k', true));
  assert.ok(matchesChord(key({ key: 'k', ctrlKey: true }), 'mod+k', false));
  assert.ok(!matchesChord(key({ key: 'k', metaKey: true }), 'mod+k', false));
});

test('extra modifiers stop a match', () => {
  assert.ok(!matchesChord(key({ key: 'z', metaKey: true, shiftKey: true }), 'mod+z', true));
  assert.ok(matchesChord(key({ key: 'Z', metaKey: true, shiftKey: true }), 'mod+shift+z', true));
  assert.ok(!matchesChord(key({ key: 'j', altKey: true }), 'j', true));
  assert.ok(!matchesChord(key({ key: 'ArrowDown', shiftKey: true }), 'arrowdown', true));
  assert.ok(matchesChord(key({ key: 'ArrowDown', shiftKey: true }), 'shift+arrowdown', true));
});

test('Shift is ignored for symbols such as ?', () => {
  assert.ok(matchesChord(key({ key: '?', shiftKey: true }), '?', true));
  assert.ok(matchesChord(key({ key: ' ' }), 'space', false));
});

test('two-step shortcuts split into steps', () => {
  assert.deepEqual(shortcutSteps('g i'), ['g', 'i']);
  assert.equal(keyName('G'), 'g');
});

test('shortcuts are shown with the right key caps', () => {
  assert.deepEqual(formatShortcut('mod+shift+z', true), [['⇧', '⌘', 'Z']]);
  assert.deepEqual(formatShortcut('mod+shift+z', false), [['Shift', 'Ctrl', 'Z']]);
  assert.deepEqual(formatShortcut('g i', true), [['G'], ['I']]);
  assert.deepEqual(formatShortcut('enter', false), [['Enter']]);
  assert.deepEqual(formatShortcut('backspace', true), [['⌫']]);
});

test('menu accelerators', () => {
  assert.equal(toAccelerator('mod+k'), 'CmdOrCtrl+K');
  assert.equal(toAccelerator('mod+shift+z'), 'CmdOrCtrl+Shift+Z');
  assert.equal(toAccelerator('shift+arrowdown'), 'Shift+Down');
  assert.equal(toAccelerator('space'), 'Space');
  assert.equal(toAccelerator('?'), '?');
  assert.equal(toAccelerator('g i'), null);
});

test('the command menu matches every word and puts recent commands first', () => {
  const commands = [
    { title: 'Go to Today', group: 'Go' },
    { title: 'Go to Inbox', group: 'Go' },
    { title: 'New task', group: 'File' },
  ];
  assert.deepEqual(filterCommands(commands, 'go in').map((c) => c.title), ['Go to Inbox']);
  assert.deepEqual(filterCommands(commands, 'file').map((c) => c.title), ['New task']);
  assert.deepEqual(filterCommands(commands, '', ['New task', 'Go to Today']).map((c) => c.title),
    ['New task', 'Go to Today', 'Go to Inbox']);
});
