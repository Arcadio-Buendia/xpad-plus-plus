import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Same vm-sandbox loading pattern as zoom.test.mjs / selection.test.mjs.
const dir = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(dir, '..', 'utils.jsx'), 'utf8');
const sandbox = { React: {}, window: {}, document: {}, navigator: {}, console, Math, JSON, Date };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { NOTE_TEXT_SIZES, noteTextScale, noteTextSizeStep, withDefaults } = sandbox.window;

/* ==================================================================== */
/* Note text size preference (issue #67)                                 */
/* ==================================================================== */

test('the steps run from 85% to 200%, ascending, and include 100%', () => {
  assert.ok(Array.isArray(NOTE_TEXT_SIZES));
  assert.equal(NOTE_TEXT_SIZES[0], 85);
  assert.equal(NOTE_TEXT_SIZES.at(-1), 200);
  assert.ok(NOTE_TEXT_SIZES.includes(100));
  for (let i = 1; i < NOTE_TEXT_SIZES.length; i++) {
    assert.ok(NOTE_TEXT_SIZES[i] > NOTE_TEXT_SIZES[i - 1], 'strictly ascending');
  }
});

test('a store saved before the preference existed reads as exactly 100%', () => {
  // Old notes.json files have no noteTextSize key at all; nothing about
  // them may change on upgrade.
  assert.equal(noteTextScale({ theme: 'paper', font: 'Inter' }), 1);
  assert.equal(noteTextScale(withDefaults({}).tweaks), 1);
  assert.equal(noteTextScale(undefined), 1);
  assert.equal(noteTextScale(null), 1);
});

test('the stored percentage becomes the multiplier', () => {
  assert.equal(noteTextScale({ noteTextSize: 100 }), 1);
  assert.equal(noteTextScale({ noteTextSize: 150 }), 1.5);
  assert.equal(noteTextScale({ noteTextSize: 200 }), 2);
  assert.equal(noteTextScale({ noteTextSize: 85 }), 0.85);
});

test('a hand-edited or corrupt value never breaks the notes', () => {
  // Not a number at all: ignore it.
  for (const v of ['big', '150', NaN, Infinity, null, {}, [150], true]) {
    assert.equal(noteTextScale({ noteTextSize: v }), 1, `noteTextSize ${String(v)} -> 1`);
  }
  // A number outside the range is held to the nearest end.
  assert.equal(noteTextScale({ noteTextSize: 1000 }), 2);
  assert.equal(noteTextScale({ noteTextSize: 10 }), 0.85);
});

test('the slider sits on the step a stored size names', () => {
  NOTE_TEXT_SIZES.forEach((size, i) => assert.equal(noteTextSizeStep(size), i, `${size}%`));
});

test('an unset or corrupt size puts the slider at 100%', () => {
  for (const v of [undefined, null, 'junk', NaN, Infinity]) {
    assert.equal(noteTextSizeStep(v), NOTE_TEXT_SIZES.indexOf(100), String(v));
  }
});

test('a hand-edited size between steps puts the slider on the nearer step', () => {
  assert.equal(NOTE_TEXT_SIZES[noteTextSizeStep(120)], 115);
  assert.equal(NOTE_TEXT_SIZES[noteTextSizeStep(125)], 130);
  // Past either end, on that end.
  assert.equal(noteTextSizeStep(10), 0);
  assert.equal(noteTextSizeStep(1000), NOTE_TEXT_SIZES.length - 1);
});
