import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/* Issue #65 — GFM task lists ("- [ ] todo") with clickable checkboxes.
 *
 * Two halves, both pure and both in utils.jsx:
 *   mdToHtml        — a task item renders a checkbox that carries the
 *                     0-based body line of its "[ ]" (data-task-line);
 *   toggleTaskItem  — flips that line's "[ ]" <-> "[x]" in the raw body,
 *                     or returns null when the line is not a task item.
 * Plus the editor nicety: Enter on a task item continues with "- [ ] ".
 */

const dir = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { React: {}, window: {}, document: {}, navigator: {}, console, Math, JSON, Date };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(dir, '..', 'vendor', 'markdown-it.min.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(dir, '..', 'utils.jsx'), 'utf8'), sandbox);
const { mdToHtml, toggleTaskItem, editListOnEnter, editListOnTab, noteToMarkdown, notesToClipboardText } = sandbox.window;

// Every checkbox in rendered HTML, in document order.
function boxes(html) {
  return [...html.matchAll(/<input [^>]*>/g)].map(([tag]) => ({
    line: Number((/data-task-line="(\d+)"/.exec(tag) || [])[1]),
    checked: / checked/.test(tag),
  }));
}

function applyEdit(value, edit) {
  return { value: value.slice(0, edit.start) + edit.text + value.slice(edit.end), caret: edit.caret };
}

/* ---------------- rendering ---------------- */

test('an unchecked task item renders a checkbox in place of the "[ ]" text', () => {
  assert.equal(mdToHtml('- [ ] buy milk'),
    '<ul dir="auto"><li class="task-list-item" dir="auto">'
    + '<input type="checkbox" class="task-list-item-checkbox" data-task-line="0" tabindex="-1">'
    + '<span class="task-list-item-text">buy milk</span></li></ul>');
});

test('[x] and [X] both render a checked box', () => {
  assert.deepEqual(boxes(mdToHtml('- [x] done')), [{ line: 0, checked: true }]);
  assert.deepEqual(boxes(mdToHtml('- [X] Done')), [{ line: 0, checked: true }]);
  assert.match(mdToHtml('- [x] done'), /<span class="task-list-item-text">done<\/span>/);
});

test('every bullet marker and ordered lists can hold task items', () => {
  for (const src of ['* [ ] a', '+ [ ] a', '1. [ ] a', '3) [x] a']) {
    assert.equal(boxes(mdToHtml(src)).length, 1, src);
    assert.doesNotMatch(mdToHtml(src), /\[[ x]\]/, `${src} keeps no literal marker`);
  }
  assert.match(mdToHtml('1. [ ] a'), /^<ol dir="auto"><li class="task-list-item"/);
});

test('nested task items each carry their own source line', () => {
  const src = '- [ ] parent\n  - [x] child\n    - [ ] grandchild\n- [ ] sibling';
  assert.deepEqual(boxes(mdToHtml(src)), [
    { line: 0, checked: false }, { line: 1, checked: true },
    { line: 2, checked: false }, { line: 3, checked: false },
  ]);
});

test("the reporter's sample: double spaces are fine, \"[ X]\" is not GFM and stays text", () => {
  const html = mdToHtml('- [ ] Thing to dod\n    - [ ]  other thing\n    - [ X] done');
  assert.deepEqual(boxes(html), [{ line: 0, checked: false }, { line: 1, checked: false }]);
  assert.match(html, /<span class="task-list-item-text">other thing<\/span>/);
  assert.match(html, /<li dir="auto">\[ X\] done<\/li>/);
});

test('blank lines and fences above a task do not throw its line number off', () => {
  // markBlankLines pads every blank line into three before markdown-it sees
  // them, so markdown-it's own line numbers are NOT body line numbers.
  const src = 'title\n\n\n```\n- [ ] in a fence\n\n```\n\n- [ ] real one\n\n- [x] another';
  assert.deepEqual(boxes(mdToHtml(src)), [{ line: 8, checked: false }, { line: 10, checked: true }]);
});

test('CRLF and lone-CR bodies number their lines like the textarea does', () => {
  assert.deepEqual(boxes(mdToHtml('note\r\n\r\n- [ ] a\r\n- [x] b')),
    [{ line: 2, checked: false }, { line: 3, checked: true }]);
  assert.deepEqual(boxes(mdToHtml('note\r- [ ] a')), [{ line: 1, checked: false }]);
});

test('side effect of numbering CRLF lines like the textarea: a CRLF fence keeps its blank line as code', () => {
  // Before, markBlankLines never saw the fence ("```\r" failed its regex) and
  // padded the blank line inside it, leaking the U+E000 sentinel into <code>.
  assert.equal(mdToHtml('```\r\na\r\n\r\nb\r\n```'), '<pre dir="auto"><code>a\n\nb\n</code></pre>');
});

test('a task item inside a blockquote is still a task item', () => {
  assert.deepEqual(boxes(mdToHtml('> - [ ] quoted todo')), [{ line: 0, checked: false }]);
});

test('an empty task item still renders its checkbox', () => {
  assert.deepEqual(boxes(mdToHtml('- [ ]')), [{ line: 0, checked: false }]);
  assert.deepEqual(boxes(mdToHtml('- [ ] ')), [{ line: 0, checked: false }]);
});

test('a multi-line task item keeps its second line on a line of its own', () => {
  assert.equal(mdToHtml('- [ ] first\n  second'),
    '<ul dir="auto"><li class="task-list-item" dir="auto">'
    + '<input type="checkbox" class="task-list-item-checkbox" data-task-line="0" tabindex="-1">'
    + '<span class="task-list-item-text">first<br>second</span></li></ul>');
});

test('inline markdown after the marker still renders', () => {
  assert.match(mdToHtml('- [ ] **ship** `v2`'),
    /<span class="task-list-item-text"><strong>ship<\/strong> <code>v2<\/code><\/span>/);
});

test('lookalikes are never checkboxes', () => {
  const cases = [
    '[ ] not in a list',
    '-[ ] no space after the bullet',
    '- [] empty brackets',
    '- [y] another letter',
    '- [x]no space after the bracket',
    '- `[ ] inline code`',
    '- \\[ ] escaped',
    '```\n- [ ] inside a fence\n```',
    '~~~\n- [x] inside a tilde fence\n~~~',
    '    - [ ] four-space indented text',
  ];
  for (const src of cases) assert.deepEqual(boxes(mdToHtml(src)), [], src);
});

test('a link whose label is "x" stays a link', () => {
  const html = mdToHtml('- [x](https://example.com) see');
  assert.deepEqual(boxes(html), []);
  assert.match(html, /<a href="https:\/\/example.com"/);
});

test('raw HTML is still escaped: the checkbox only ever comes from the renderer', () => {
  const html = mdToHtml('- [ ] <input type="checkbox" checked> <b>x</b>\n<input type="checkbox">');
  assert.equal(boxes(html).length, 1);
  assert.match(html, /&lt;input type=&quot;checkbox&quot; checked&gt; &lt;b&gt;x&lt;\/b&gt;/);
});

/* ---------------- toggleTaskItem ---------------- */

test('toggling flips "[ ]" to "[x]" and back on the given line only', () => {
  const src = '- [ ] a\n- [ ] b';
  assert.equal(toggleTaskItem(src, 1), '- [ ] a\n- [x] b');
  assert.equal(toggleTaskItem('- [x] a', 0), '- [ ] a');
  assert.equal(toggleTaskItem('- [X] a', 0), '- [ ] a');
});

test('the rendered line number round-trips through the toggle', () => {
  const src = 'Groceries\n\n- [ ] milk\n  - [ ] oat\n\n1. [x] bread\n> - [ ] quoted';
  let body = src;
  for (const { line } of boxes(mdToHtml(src))) body = toggleTaskItem(body, line);
  assert.equal(body, 'Groceries\n\n- [x] milk\n  - [x] oat\n\n1. [ ] bread\n> - [x] quoted');
});

test('duplicate item texts: only the clicked one changes', () => {
  const src = '- [ ] same\n- [ ] same\n- [ ] same';
  assert.equal(toggleTaskItem(src, 1), '- [ ] same\n- [x] same\n- [ ] same');
});

test('the rest of the line is kept byte for byte', () => {
  assert.equal(toggleTaskItem('   *   [ ]   spaced  out  ', 0), '   *   [x]   spaced  out  ');
  assert.equal(toggleTaskItem('-\t[ ]\ttabbed', 0), '-\t[x]\ttabbed');
  assert.equal(toggleTaskItem('- [ ] has [ ] and [x] later', 0), '- [x] has [ ] and [x] later');
});

test('CRLF line endings survive a toggle', () => {
  assert.equal(toggleTaskItem('note\r\n- [ ] a\r\n- [ ] b\r\n', 2), 'note\r\n- [ ] a\r\n- [x] b\r\n');
});

test('a line that is not a task item is never touched', () => {
  const fence = '```\n- [ ] code\n```';
  assert.equal(toggleTaskItem(fence, 1), null, 'inside a fence');
  assert.equal(toggleTaskItem('- `[ ] code`', 0), null, 'inline code');
  assert.equal(toggleTaskItem('plain text', 0), null);
  assert.equal(toggleTaskItem('- [ X] lenient?', 0), null, 'not GFM');
  assert.equal(toggleTaskItem('- [ ] a', 1), null, 'past the end');
  assert.equal(toggleTaskItem('- [ ] a', -1), null);
  assert.equal(toggleTaskItem('- [ ] a', NaN), null);
  assert.equal(toggleTaskItem('', 0), null);
  assert.equal(toggleTaskItem(undefined, 0), null);
});

test('Download and Copy carry the raw markdown, ticks included', () => {
  const note = { id: 'n1', title: 'Todo', body: toggleTaskItem('- [ ] a\n- [ ] b', 1) };
  assert.equal(noteToMarkdown(note), '---\ntitle: Todo\n---\n- [ ] a\n- [x] b\n');
  assert.ok(notesToClipboardText([note], []).startsWith('Todo\n\n- [ ] a\n- [x] b\n'));
});

/* ---------------- editor: Enter on a task item ---------------- */

test('Enter on a task item continues with a fresh unchecked box', () => {
  const v = '- [x] done';
  const r = applyEdit(v, editListOnEnter(v, v.length, v.length, false));
  assert.equal(r.value, '- [x] done\n- [ ] ');
  assert.equal(r.caret, r.value.length);
});

test('Enter on a nested or ordered task item keeps its indent and numbering', () => {
  const v = '- [ ] a\n  - [ ] b';
  assert.equal(applyEdit(v, editListOnEnter(v, v.length, v.length, false)).value, '- [ ] a\n  - [ ] b\n  - [ ] ');
  const o = '1. [ ] a';
  assert.equal(applyEdit(o, editListOnEnter(o, o.length, o.length, false)).value, '1. [ ] a\n2. [ ] ');
});

test('Enter on an empty task item ends the list like an empty bullet', () => {
  for (const v of ['- [ ] a\n- [ ] ', '- [ ] a\n- [ ]', '- [ ] a\n- [x] ']) {
    const r = applyEdit(v, editListOnEnter(v, v.length, v.length, false));
    assert.equal(r.value, '- [ ] a\n', JSON.stringify(v));
    assert.equal(r.caret, 8);
  }
});

test('Enter with the caret inside the task marker falls back to a plain newline', () => {
  assert.equal(editListOnEnter('- [ ] a', 3, 3, false), null);
});

test('Enter in the middle of a task item splits it into two task items', () => {
  const v = '- [ ] buy milk';
  const r = applyEdit(v, editListOnEnter(v, 9, 9, false));
  assert.equal(r.value, '- [ ] buy\n- [ ]  milk');
});

test('Tab nests a task item under the one above, and it renders nested', () => {
  const v = '- [ ] parent\n- [ ] child';
  const r = applyEdit(v, editListOnTab(v, v.length, v.length, false));
  assert.equal(r.value, '- [ ] parent\n  - [ ] child');
  assert.match(mdToHtml(r.value), /<li class="task-list-item"[^>]*>.*parent.*<ul[^>]*><li class="task-list-item"[^>]*>.*child/);
  const o = '1. [ ] one\n2. [ ] two';
  const ro = applyEdit(o, editListOnTab(o, o.length, o.length, false));
  assert.equal(ro.value, '1. [ ] one\n   1. [ ] two');
  assert.deepEqual(boxes(mdToHtml(ro.value)).map(b => b.line), [0, 1]);
  assert.match(mdToHtml(ro.value), /<ol[^>]*>.*<ol[^>]*>.*two/);
});
