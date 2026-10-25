// "Import markdown file…" (issue #44) — the pure half of the importer: the
// filename → title derivation, the contents → body normalisation, and the
// guards that keep a non-note out of a note. The file picker itself lives in
// the main process (notes:import-markdown) and its reader is covered by
// tests/storage.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// utils.jsx is a browser-global script (no module exports). Same loading
// trick as download.test.mjs: run it in a vm sandbox with light shims and
// read the pure helpers back off the shimmed `window`.
const dir = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(dir, '..', 'utils.jsx'), 'utf8');
const sandbox = { React: {}, window: {}, document: {}, navigator: {}, console, Math, JSON, Date };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const {
  markdownFileTitle, markdownFileBody, markdownFileToNote,
  noteDownloadFilename, noteToMarkdown,
} = sandbox.window;

/* ---------------- markdownFileTitle ---------------- */

test('title is the filename with the .md extension dropped', () => {
  assert.equal(markdownFileTitle('Groceries.md'), 'Groceries');
});

test('title drops the other markdown extensions the picker offers', () => {
  assert.equal(markdownFileTitle('plan.markdown'), 'plan');
  assert.equal(markdownFileTitle('plan.mdown'), 'plan');
  assert.equal(markdownFileTitle('plan.mkd'), 'plan');
  assert.equal(markdownFileTitle('plan.txt'), 'plan');
  assert.equal(markdownFileTitle('PLAN.MD'), 'PLAN', 'extension match is case-insensitive');
});

test('title keeps an unknown suffix instead of guessing it is an extension', () => {
  assert.equal(markdownFileTitle('release-2.1.md'), 'release-2.1');
  assert.equal(markdownFileTitle('notes.v2'), 'notes.v2');
});

test('title keeps unicode exactly as the filename spells it', () => {
  assert.equal(markdownFileTitle('Café über — 日本語.md'), 'Café über — 日本語');
  assert.equal(markdownFileTitle('التخطيط.md'), 'التخطيط');
});

test('title drops any directory part of the name', () => {
  assert.equal(markdownFileTitle('/home/farid/Notes/Sprint 42.md'), 'Sprint 42');
  assert.equal(markdownFileTitle('C:\\Users\\farid\\Sprint 42.md'), 'Sprint 42');
});

test('title collapses whitespace runs, like the download filename does', () => {
  assert.equal(markdownFileTitle('  Sprint   42   scope .md'), 'Sprint 42 scope');
});

test('title falls back to "note" when the name leaves nothing behind', () => {
  assert.equal(markdownFileTitle('.md'), 'note', 'a dotfile named only for its extension');
  assert.equal(markdownFileTitle('   .md'), 'note');
  assert.equal(markdownFileTitle(''), 'note');
  assert.equal(markdownFileTitle(undefined), 'note');
  assert.equal(markdownFileTitle('/tmp/notes/'), 'note', 'a path with no file part');
});

test('title keeps a real dotfile stem', () => {
  assert.equal(markdownFileTitle('.bashrc.md'), '.bashrc');
});

test('title is capped so an absurd filename cannot become an absurd title', () => {
  assert.equal(markdownFileTitle('x'.repeat(400) + '.md').length, 120);
});

/* ---------------- markdownFileBody ---------------- */

test('body keeps the file contents verbatim', () => {
  const md = '## Goals\n\n- ship #44\n- **bold** and `code`';
  assert.equal(markdownFileBody(md), md);
});

test('body strips a leading UTF-8 BOM', () => {
  assert.equal(markdownFileBody('\uFEFF# Title\ntext'), '# Title\ntext');
  assert.equal(markdownFileBody('text\uFEFFmore'), 'text\uFEFFmore', 'only a LEADING BOM goes');
});

test('body normalises CRLF and lone CR line endings to \\n', () => {
  assert.equal(markdownFileBody('a\r\nb\rc\nd'), 'a\nb\nc\nd');
});

test('body trims trailing whitespace, exactly as noteToMarkdown wrote it', () => {
  assert.equal(markdownFileBody('line\n\n\n  '), 'line');
  assert.equal(markdownFileBody('line\r\n'), 'line');
});

test('body of an empty file is an empty string', () => {
  assert.equal(markdownFileBody(''), '');
  assert.equal(markdownFileBody(undefined), '');
});

/* ---------------- markdownFileToNote ---------------- */

// The helpers run inside the vm realm, so their return values carry that
// realm's Object.prototype — deepStrictEqual would reject them on identity
// alone. Compare the fields.
const sameNote = (actual, expected, msg) => {
  for (const k of ['name', 'title', 'body', 'error']) {
    assert.equal(actual[k], expected[k], `${msg || ''} ${k}`.trim());
  }
};

test('a read file becomes a titled note', () => {
  sameNote(
    markdownFileToNote({ name: 'Sprint 42.md', content: '## This sprint\r\n- dogfood search\r\n' }),
    { name: 'Sprint 42.md', title: 'Sprint 42', body: '## This sprint\n- dogfood search' });
});

test("main's per-file error passes straight through", () => {
  sameNote(
    markdownFileToNote({ name: 'photo.md', error: 'not a text file' }),
    { name: 'photo.md', error: 'not a text file' });
});

test('a file with no contents is an error, not an empty note', () => {
  sameNote(markdownFileToNote({ name: 'x.md' }), { name: 'x.md', error: 'nothing to read' });
  sameNote(markdownFileToNote(undefined), { name: 'file', error: 'nothing to read' });
});

test('a huge file still imports — no size cap on the importer (issue #39)', () => {
  const big = 'x'.repeat(2 * 1024 * 1024);
  const res = markdownFileToNote({ name: 'huge.md', content: big });
  assert.equal(res.error, undefined);
  assert.equal(res.body.length, big.length);
});

test('binary content that slipped through is refused', () => {
  sameNote(
    markdownFileToNote({ name: 'thing.md', content: 'PK\u0003\u0004\u0000\u0000gibberish' }),
    { name: 'thing.md', error: 'not a text file' });
});

/* ---------------- the round trip with "Download" ---------------- */

test('download → import returns the note it started from', () => {
  for (const note of [
    { title: 'Groceries', body: '# Weekend run\n- **Sourdough**\n- _olive oil_' },
    { title: 'Sprint 42 scope', body: '## This sprint\n\n- onboarding polish' },
    { title: 'Café über — 日本語', body: 'unicode body — é 日本語' },
    { title: 'Ideas', body: '' },
  ]) {
    const file = { name: noteDownloadFilename(note), content: noteToMarkdown(note) };
    const back = markdownFileToNote(file);
    assert.equal(back.title, note.title, `title round trip for ${note.title}`);
    assert.equal(back.body, note.body, `body round trip for ${note.title}`);
  }
});

test('download → import of a titleless note titles it from its first line', () => {
  // noteDownloadFilename falls back to the first body line, so the round
  // trip gives the note the title the file was named after — the file has
  // nowhere else to carry one.
  const note = { title: '', body: '- Sourdough\n- olive oil' };
  const back = markdownFileToNote({ name: noteDownloadFilename(note), content: noteToMarkdown(note) });
  assert.equal(back.title, 'Sourdough');
  assert.equal(back.body, note.body);
});

/* ---------------- frontmatter (issue #40) ----------------
 * A downloaded note opens with YAML frontmatter (title, created, updated,
 * color). The importer reads those four back and drops the block from the
 * body; anything else in it is ignored. Only a well-formed leading block
 * counts — a body that merely starts with a --- rule imports as before.
 */

const ISSUE_FILE = [
  '---',
  'title: Goals Q2',
  'created: 2026-08-11T10:30:00Z',
  'updated: 2026-08-11T12:45:00Z',
  'color: peach',
  '---',
  '## Goals',
  '1. Ship sync',
  '',
].join('\n');

test('frontmatter supplies title, colour and timestamps, and stays out of the body', () => {
  const res = markdownFileToNote({ name: 'goals.md', content: ISSUE_FILE });
  assert.equal(res.error, undefined);
  assert.equal(res.title, 'Goals Q2');
  assert.equal(res.body, '## Goals\n1. Ship sync');
  assert.equal(res.color, 'peach');
  assert.equal(res.created, '2026-08-11T10:30:00Z');
  assert.equal(res.updated, '2026-08-11T12:45:00Z');
});

test('a file without frontmatter imports exactly as before — no colour, no timestamps', () => {
  const res = markdownFileToNote({ name: 'Sprint 42.md', content: '## This sprint\n- dogfood search\n' });
  assert.equal(res.title, 'Sprint 42');
  assert.equal(res.body, '## This sprint\n- dogfood search');
  for (const k of ['color', 'created', 'updated']) assert.equal(k in res, false, k);
});

test('no title in the frontmatter: the filename still titles the note', () => {
  const res = markdownFileToNote({ name: 'Router reboot.md', content: '---\ncolor: blue\n---\nssh admin@10.0.0.1\n' });
  assert.equal(res.title, 'Router reboot');
  assert.equal(res.body, 'ssh admin@10.0.0.1');
  assert.equal(res.color, 'blue');
});

test('a blank or null title falls back to the filename too', () => {
  for (const line of ['title: ""', "title: ''", 'title: "   "', 'title: ~', 'title: null', 'title: Null', 'title:']) {
    const res = markdownFileToNote({ name: 'fallback.md', content: `---\n${line}\ncolor: red\n---\nbody` });
    assert.equal(res.title, 'fallback', line);
    assert.equal(res.body, 'body', line);
  }
});

test('the colour is used only when the app knows it', () => {
  const colorOf = (v) => markdownFileToNote({ name: 'c.md', content: `---\ntitle: C\ncolor: ${v}\n---\nx` }).color;
  assert.equal(colorOf('lilac'), 'lilac');
  assert.equal(colorOf('"green"'), 'green');
  assert.equal(colorOf('Peach'), 'peach', 'case does not matter');
  assert.equal(colorOf('chartreuse'), undefined, 'unknown: the import picks one, like any other');
  assert.equal(colorOf('#ff0000'), undefined);
});

test('timestamps are normalised to ISO 8601 UTC; anything that is not a date is ignored', () => {
  const at = (v) => markdownFileToNote({ name: 't.md', content: `---\ntitle: T\ncreated: ${v}\n---\nx` }).created;
  assert.equal(at('2026-08-11T10:30:00Z'), '2026-08-11T10:30:00Z');
  assert.equal(at('2026-08-11T10:30:00.123Z'), '2026-08-11T10:30:00Z');
  assert.equal(at('2026-08-11T12:30:00+02:00'), '2026-08-11T10:30:00Z');
  assert.equal(at('2026-08-11 10:30:00'), '2026-08-11T10:30:00Z', 'YAML reads a timestamp with no zone as UTC');
  assert.equal(at('2026-08-11'), '2026-08-11T00:00:00Z');
  assert.equal(at('"2026-08-11T10:30:00Z"'), '2026-08-11T10:30:00Z');
  for (const bad of ['yesterday', '2026-13-45T99:00:00Z', '2026-02-30', '2026-04-31T10:00:00Z', '1754908200', 'August 11, 2026', '']) {
    assert.equal(at(bad), undefined, bad);
  }
});

test('unknown keys are ignored, nested values and comments included', () => {
  const content = [
    '---',
    '# written by another app',
    'layout: post',
    'tags:',
    '  - work',
    '  - planning',
    'aliases: [w, weekly]',
    'author:',
    '  name: Ana',
    'categories:',
    '- notes',
    '',
    'title: Weekly',
    'draft: true',
    '---',
    'the body',
  ].join('\n');
  const res = markdownFileToNote({ name: 'w.md', content });
  assert.equal(res.title, 'Weekly');
  assert.equal(res.body, 'the body');
});

test('a BOM and CRLF line endings do not hide the frontmatter', () => {
  const res = markdownFileToNote({ name: 'x.md', content: '﻿---\r\ntitle: Windows\r\ncolor: pink\r\n---\r\nline one\r\nline two\r\n' });
  assert.equal(res.title, 'Windows');
  assert.equal(res.color, 'pink');
  assert.equal(res.body, 'line one\nline two');
});

test('quoted titles are unquoted the way YAML does it', () => {
  const titleOf = (line) => markdownFileToNote({ name: 'q.md', content: `---\n${line}\n---\nx` }).title;
  assert.equal(titleOf('title: "Re: plans \\"v2\\"\\n#2"'), 'Re: plans "v2"\n#2');
  assert.equal(titleOf('title: "tab\\tand \\u00e9 and \\\\"'), 'tab\tand é and \\');
  assert.equal(titleOf("title: 'it''s: done'"), "it's: done");
  assert.equal(titleOf('title: Plain words # a comment'), 'Plain words');
  assert.equal(titleOf('title: "Quoted" # a comment'), 'Quoted');
  assert.equal(titleOf('title:   spaced out   '), 'spaced out');
});

test('a title YAML would not hand over as one plain string is ignored, not half-read', () => {
  for (const block of [
    'title: |\n  a literal block',
    'title: >\n  a folded block',
    'title: first line\n  continued on the next',
    'title: [a, b]',
    'title: {a: b}',
    'title: "never closed',
    'title: "bad \\q escape"',
    'title: &anchor Named',
    'title: !!str Tagged',
  ]) {
    const res = markdownFileToNote({ name: 'fallback.md', content: `---\n${block}\ncolor: red\n---\nbody` });
    assert.equal(res.title, 'fallback', block);
    assert.equal(res.body, 'body', `${block}: still frontmatter, still stripped`);
  }
});

test('a body that opens with a --- rule is not mistaken for frontmatter', () => {
  for (const content of [
    '---\nJust a rule above this line',             // never closed
    '---\n\nparagraph\n\n---\nmore',                 // not key: value lines
    '---\nNote: remember milk\n---\nmore',          // key-shaped, but none of ours
    '---\n---\nbody',                                // empty block: two rules
    '---\n- one\n- two\n---\nafter',                 // a list between rules
    '----\ntitle: x\n----\nbody',                    // a longer rule is not a delimiter
    ' ---\ntitle: x\n---\nbody',                     // indented: not at the very start
    'text first\n---\ntitle: x\n---',                // not leading at all
  ]) {
    const res = markdownFileToNote({ name: 'rule.md', content });
    assert.equal(res.title, 'rule', JSON.stringify(content));
    assert.equal(res.body, markdownFileBody(content), JSON.stringify(content));
    assert.equal('color' in res, false, JSON.stringify(content));
  }
});

test('only the first block is frontmatter — a second one stays in the body', () => {
  const res = markdownFileToNote({ name: 'x.md', content: '---\ntitle: Outer\n---\n---\ntitle: Inner\n---\nbody' });
  assert.equal(res.title, 'Outer');
  assert.equal(res.body, '---\ntitle: Inner\n---\nbody');
});

test('YAML\'s ... also closes the block', () => {
  const res = markdownFileToNote({ name: 'x.md', content: '---\ntitle: Dots\n...\nbody' });
  assert.equal(res.title, 'Dots');
  assert.equal(res.body, 'body');
});

/* ---------------- the round trip with "Download", frontmatter included ---------------- */

const HOSTILE_TITLES = [
  'Goals Q2', 'Re: plans', 'Issue #40', '- dash', '[draft] spec', '{x}', '*bold*', '&anchor',
  '!tag', '%pct', '@at', '`code`', "'single'", '"double"', 'it\'s "both"', '>folded', '|literal',
  '? key', ': colon', '---', '...', 'yes', 'No', 'null', '~', 'true', '2026', '1:20', '0x1F',
  '3.14', '2026-08-11', 'trailing ', ' leading', 'two\nlines', 'tab\there', 'back\\slash',
  'bell\u0007', 'del\u007f', 'nel\u0085', 'ls ', 'Café über — 日本語', 'emoji 🎉', 'a  b',
  'title: nested', '# not a comment', 'x # y',
];

test('download → import keeps the title, colour and timestamps, whatever the title holds', () => {
  for (const title of HOSTILE_TITLES) {
    const note = {
      title, color: 'lilac', body: '## x\n- y',
      created: '2026-08-11T10:30:00.000Z', updated: '2026-08-11T12:45:00.000Z',
    };
    const back = markdownFileToNote({ name: noteDownloadFilename(note), content: noteToMarkdown(note) });
    assert.equal(back.title, title, `title ${JSON.stringify(title)}`);
    assert.equal(back.body, note.body, `body under title ${JSON.stringify(title)}`);
    assert.equal(back.color, 'lilac');
    assert.equal(back.created, '2026-08-11T10:30:00Z');
    assert.equal(back.updated, '2026-08-11T12:45:00Z');
  }
});

test('download → import of a body that starts like frontmatter gives the body back intact', () => {
  for (const body of ['---\ntitle: not mine\n---\ntext', '---\n\n---', '---', '...\n---']) {
    const note = { title: 'Rules', color: 'green', body };
    const back = markdownFileToNote({ name: noteDownloadFilename(note), content: noteToMarkdown(note) });
    assert.equal(back.title, 'Rules');
    assert.equal(back.body, body, JSON.stringify(body));
  }
});

test('download → import of a note from before timestamps adds none', () => {
  const note = { title: 'Old', color: 'yellow', body: 'b' };
  const back = markdownFileToNote({ name: noteDownloadFilename(note), content: noteToMarkdown(note) });
  assert.equal(back.title, 'Old');
  assert.equal(back.color, 'yellow');
  assert.equal('created' in back, false);
  assert.equal('updated' in back, false);
});
