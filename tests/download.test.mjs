import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// utils.jsx is a browser-global script (no module exports). Same loading
// trick as folders.test.mjs: run it in a vm sandbox with light shims and
// read the pure helpers back off the shimmed `window`.
const dir = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(dir, '..', 'utils.jsx'), 'utf8');
const sandbox = { React: {}, window: {}, document: {}, navigator: {}, console, Math, JSON, Date };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { noteDownloadFilename, noteToMarkdown, applyNotePatch } = sandbox.window;

/* ---------------- noteDownloadFilename ---------------- */

test('filename comes from the note title', () => {
  assert.equal(noteDownloadFilename({ title: 'Groceries', body: 'x' }), 'Groceries.md');
});

test('filename strips filesystem-hostile characters', () => {
  assert.equal(
    noteDownloadFilename({ title: 'a/b\\c:d*e?f"g<h>i|j', body: '' }),
    'a b c d e f g h i j.md');
});

test('filename strips control characters', () => {
  assert.equal(noteDownloadFilename({ title: 'plan\u0000A\tB', body: '' }), 'plan A B.md');
});

test('filename collapses runs of whitespace and trims', () => {
  assert.equal(noteDownloadFilename({ title: '  Sprint   42   scope ', body: '' }), 'Sprint 42 scope.md');
});

test('blank title falls back to the first non-empty body line', () => {
  assert.equal(
    noteDownloadFilename({ title: '  ', body: '\n\nRouter reboot\nssh admin@10.0.0.1' }),
    'Router reboot.md');
});

test('body-line fallback drops a leading heading marker', () => {
  assert.equal(noteDownloadFilename({ title: '', body: '## Build flags\nstuff' }), 'Build flags.md');
});

test('body-line fallback drops a leading bullet marker', () => {
  assert.equal(noteDownloadFilename({ title: '', body: '- Sourdough\n- olive oil' }), 'Sourdough.md');
});

test('title that sanitizes away to nothing falls back to the body', () => {
  assert.equal(noteDownloadFilename({ title: '///', body: 'Dinner: friday' }), 'Dinner friday.md');
});

test('empty note falls back to note.md', () => {
  assert.equal(noteDownloadFilename({ title: '', body: '' }), 'note.md');
  assert.equal(noteDownloadFilename({}), 'note.md');
  assert.equal(noteDownloadFilename(undefined), 'note.md');
});

test('filename base is capped at 60 characters', () => {
  const name = noteDownloadFilename({ title: 'x'.repeat(200), body: '' });
  assert.equal(name, 'x'.repeat(60) + '.md');
});

test('no trailing dots or spaces survive (Windows-safe)', () => {
  assert.equal(noteDownloadFilename({ title: 'notes...', body: '' }), 'notes.md');
  // Truncation at the cap must not leave a trailing space either.
  const name = noteDownloadFilename({ title: 'y'.repeat(59) + ' zzzz', body: '' });
  assert.equal(name, 'y'.repeat(59) + '.md');
});

test('no dotfile names: leading dots are stripped', () => {
  assert.equal(noteDownloadFilename({ title: '.bashrc notes', body: '' }), 'bashrc notes.md');
});

/* ---------------- noteToMarkdown ---------------- */

// Issue #40: the file opens with YAML frontmatter carrying the note's
// metadata, then the body verbatim — note bodies ARE markdown.

test('the file is frontmatter, then the body — the example from issue #40', () => {
  const note = {
    title: 'Goals Q2', color: 'peach',
    created: '2026-08-11T10:30:00.000Z', updated: '2026-08-11T12:45:00.000Z',
    body: '## Goals\n1. Ship sync\n2. Offline mode\n3. 1k weekly actives',
  };
  assert.equal(noteToMarkdown(note), [
    '---',
    'title: Goals Q2',
    'created: 2026-08-11T10:30:00Z',
    'updated: 2026-08-11T12:45:00Z',
    'color: peach',
    '---',
    '## Goals',
    '1. Ship sync',
    '2. Offline mode',
    '3. 1k weekly actives',
    '',
  ].join('\n'));
});

test('a note from before timestamps were kept leaves them out instead of inventing them', () => {
  assert.equal(
    noteToMarkdown({ title: 'Standup', color: 'blue', body: '**Yday:** fixed dnd bug' }),
    '---\ntitle: Standup\ncolor: blue\n---\n**Yday:** fixed dnd bug\n');
});

test('an untitled note leaves the title key out — the filename carries one', () => {
  assert.equal(noteToMarkdown({ title: '  ', color: 'yellow', body: 'x' }), '---\ncolor: yellow\n---\nx\n');
});

test('a colour the app does not know is left out', () => {
  assert.equal(noteToMarkdown({ title: 'T', color: 'chartreuse', body: 'x' }), '---\ntitle: T\n---\nx\n');
});

test('timestamps are written as ISO 8601 UTC to the second, whatever they were stored as', () => {
  const md = noteToMarkdown({
    title: 'T', created: '2026-08-11T12:30:00+02:00', updated: '2026-08-11T12:45:59.999Z', body: '',
  });
  assert.equal(md, '---\ntitle: T\ncreated: 2026-08-11T10:30:00Z\nupdated: 2026-08-11T12:45:59Z\n---\n');
});

test('a timestamp that is not a date is left out', () => {
  assert.equal(
    noteToMarkdown({ title: 'T', created: 'yesterday', updated: 1754908200000, body: 'x' }),
    '---\ntitle: T\n---\nx\n');
});

test('a note with nothing for the frontmatter exports the body alone', () => {
  assert.equal(noteToMarkdown({ title: '', body: 'just the body' }), 'just the body\n');
});

test('an empty body leaves the frontmatter alone, still ending in one newline', () => {
  assert.equal(noteToMarkdown({ title: 'Ideas', color: 'lilac', body: '' }), '---\ntitle: Ideas\ncolor: lilac\n---\n');
  assert.equal(noteToMarkdown({ title: '', body: '' }), '\n', 'nothing at all is a single newline, as before');
});

test('trailing whitespace collapses to exactly one final newline', () => {
  assert.equal(noteToMarkdown({ title: '', body: 'line\n\n\n  ' }), 'line\n');
});

test('body markdown is preserved verbatim after the frontmatter', () => {
  const body = '## This sprint\n- onboarding polish\n- dnd quick fix';
  assert.equal(noteToMarkdown({ title: 'Sprint 42', body }), '---\ntitle: Sprint 42\n---\n' + body + '\n');
});

test('a body that opens with its own --- rule follows the frontmatter untouched', () => {
  assert.equal(
    noteToMarkdown({ title: 'Rules', color: 'green', body: '---\nbetween rules\n---' }),
    '---\ntitle: Rules\ncolor: green\n---\n---\nbetween rules\n---\n');
});

/* ---------------- the title as YAML ---------------- */

const titleLine = (title) => noteToMarkdown({ title, body: '' }).split('\n')[1];

test('an ordinary title is written plain, exactly as the issue shows it', () => {
  for (const t of ['Goals Q2', 'Café über — 日本語', "Bob's list", 'Sprint 42 (draft)', 'a  b', 'Ship it!']) {
    assert.equal(titleLine(t), 'title: ' + t);
  }
});

test('a title YAML would read as something else is double-quoted', () => {
  for (const t of [
    'Re: plans', 'Issue #40', '#hash',                       // mapping / comment syntax
    '- dash', '[draft] spec', '{x}', '*bold*', '&anchor', '!tag', '%pct', '@at', '`code`',
    "'single'", '>folded', '|literal', '? key', ': colon', ',comma', '---', '...',   // leading indicators
    'yes', 'No', 'OFF', 'on', 'y', 'N', 'true', 'False', 'null', 'Null', '~',      // YAML 1.1 booleans and nulls
    '2026', '1:20', '0x1F', '3.14', '.5', '+1', '2026-08-11',                       // numbers and dates
    'trailing ', ' leading',                                                        // whitespace a plain scalar drops
  ]) {
    assert.equal(titleLine(t), 'title: ' + JSON.stringify(t), `title ${JSON.stringify(t)}`);
  }
});

test('quotes, backslashes and newlines are escaped so the title stays on its one line', () => {
  assert.equal(titleLine('"quoted"'), 'title: "\\"quoted\\""');
  assert.equal(titleLine('back\\slash'), 'title: "back\\\\slash"');
  assert.equal(titleLine('two\nlines'), 'title: "two\\nlines"');
  assert.equal(titleLine('cr\rlf'), 'title: "cr\\rlf"');
  assert.equal(titleLine('tab\there'), 'title: "tab\\there"');
  assert.equal(noteToMarkdown({ title: 'two\nlines\nhere', body: 'b' }).split('\n').length, 5,
    '---, title, ---, body, and the final empty line — nothing else');
});

test('characters YAML forbids in a file are escaped, not written raw', () => {
  assert.equal(titleLine('bell\u0007'), 'title: "bell\\u0007"');
  assert.equal(titleLine('del\u007f'), 'title: "del\\u007f"');
  assert.equal(titleLine('nel\u0085'), 'title: "nel\\u0085"');
  assert.equal(titleLine('ls ps '), 'title: "ls\\u2028ps\\u2029"');
  assert.equal(titleLine('bom﻿'), 'title: "bom\\ufeff"');
});

/* ---------------- note timestamps (issue #40) ----------------
 * What the frontmatter's `updated` means: the last time the title or the
 * body changed. applyNotePatch is the one place a note edit is applied.
 */

const NOW = '2026-10-24T09:00:00.000Z';
const OLD = { id: 'n_1', title: 'Plan', body: 'old body', color: 'blue', x: 1, y: 2, w: 260, h: 180, z: 3,
  pinned: false, folder: 'f', created: '2026-01-01T00:00:00.000Z', updated: '2026-01-02T00:00:00.000Z' };

test('editing the title or the body stamps updated', () => {
  assert.equal(applyNotePatch(OLD, { title: 'Plan B' }, NOW).updated, NOW);
  assert.equal(applyNotePatch(OLD, { body: 'new body' }, NOW).updated, NOW);
});

test('the patch itself is applied, and created is never touched', () => {
  const next = applyNotePatch(OLD, { body: 'new body' }, NOW);
  assert.equal(next.body, 'new body');
  assert.equal(next.title, 'Plan');
  assert.equal(next.created, OLD.created);
  assert.equal(OLD.body, 'old body', 'the original note is not mutated');
  assert.equal(OLD.updated, '2026-01-02T00:00:00.000Z');
});

test('an edit that leaves the text as it was is not an update', () => {
  assert.equal(applyNotePatch(OLD, { title: 'Plan', body: 'old body' }, NOW).updated, OLD.updated);
});

test('moving, resizing, pinning, recolouring and refiling are not edits', () => {
  for (const patch of [{ x: 9, y: 9 }, { w: 400, h: 300 }, { pinned: true }, { color: 'pink' }, { folder: 'g' }, { z: 99 }]) {
    assert.equal(applyNotePatch(OLD, patch, NOW).updated, OLD.updated, JSON.stringify(patch));
  }
});

test('a note from before timestamps gains updated on its first edit, but no invented created', () => {
  const legacy = { id: 'n_2', title: 'Old', body: 'b', color: 'yellow' };
  const next = applyNotePatch(legacy, { body: 'b2' }, NOW);
  assert.equal(next.updated, NOW);
  assert.equal('created' in next, false);
  assert.equal('updated' in applyNotePatch(legacy, { x: 5 }, NOW), false, 'and a move adds nothing');
});
