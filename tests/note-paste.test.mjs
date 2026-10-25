import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Same vm-sandbox loading pattern as paste.test.mjs / lists.test.mjs.
const dir = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(dir, '..', 'utils.jsx'), 'utf8');
const sandbox = { React: {}, window: {}, document: {}, navigator: {}, console, Math, JSON, Date };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { notePasteAction, editOnPaste, appendOnOwnLine, notesToClipboardText, STICKY_CLIPBOARD_MARKER } = sandbox.window;

/* ---------------- notePasteAction (#59) ----------------
 * The note context menu's "Paste": what the clipboard holds decides which of
 * the app's two Ctrl+V paths it takes. */

test('a picture on the clipboard is pasted as a picture, even with text beside it', () => {
  assert.equal(notePasteAction({ text: '', image: true }), 'image');
  // Copying a picture from a browser offers its URL as text too; Ctrl+V in
  // the editor takes the picture, so the menu does.
  assert.equal(notePasteAction({ text: 'https://x.y/cat.png', image: true }), 'image');
});

test('the app\'s own copied notes paste as notes, the way Ctrl+V on the canvas does', () => {
  const payload = notesToClipboardText([{ id: 'n1', title: 'T', body: 'B', color: 'blue', w: 1, h: 1 }], []);
  assert.equal(notePasteAction({ text: payload, image: false }), 'notes');
});

test('a broken payload goes the canvas way too, so it gets the same error toast', () => {
  assert.equal(notePasteAction({ text: 'hi\n' + STICKY_CLIPBOARD_MARKER + '\n{oops', image: false }), 'notes');
});

test('any other text goes into the note', () => {
  assert.equal(notePasteAction({ text: 'shopping: eggs, milk', image: false }), 'text');
  assert.equal(notePasteAction({ text: '  ', image: false }), 'text');
});

test('nothing usable on the clipboard means nothing to paste', () => {
  assert.equal(notePasteAction({ text: '', image: false }), 'none');
  assert.equal(notePasteAction({}), 'none');
  assert.equal(notePasteAction(null), 'none');
  assert.equal(notePasteAction(undefined), 'none');
});

/* ---------------- editOnPaste ----------------
 * The editor's smart text pastes, shared by Ctrl+V and the menu: the link
 * wrap first, then the blockquote spread; null = a plain insert. */

test('a URL pasted over a selected word wraps it as a link', () => {
  const r = editOnPaste('see docs here', 4, 8, 'https://example.com');
  assert.deepEqual({ ...r }, { start: 4, end: 8, text: '[docs](https://example.com)', caret: 4 + '[docs](https://example.com)'.length });
});

test('multi-line text pasted on a quote line keeps every line in the quote', () => {
  const r = editOnPaste('> a', 3, 3, 'b\nc');
  assert.equal(r.text, 'b\n> c');
});

test('plain text with no special shape is a plain insert', () => {
  assert.equal(editOnPaste('abc', 1, 2, 'xyz'), null);
  assert.equal(editOnPaste('abc', 3, 3, 'line 1\nline 2'), null);
});

/* ---------------- appendOnOwnLine ----------------
 * Where a paste lands when the note isn't being edited: at the end, on a
 * line of its own — where "Insert image…" puts a picture when there is no
 * caret to aim at. */

test('appending to an empty body is just the text', () => {
  assert.equal(appendOnOwnLine('', 'new'), 'new');
  assert.equal(appendOnOwnLine(undefined, 'new'), 'new');
});

test('appending starts a new line', () => {
  assert.equal(appendOnOwnLine('first line', 'new'), 'first line\nnew');
});

test('a body that already ends in a newline gets no blank line added', () => {
  assert.equal(appendOnOwnLine('first line\n', 'new'), 'first line\nnew');
});
