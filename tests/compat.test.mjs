// Freeze the old-vs-new markdown invariants: for every corpus case classed
// 'same', the current markdown-it pipeline must render EXACTLY what the old
// hand-rolled converter (tests/fixtures/utils-pre-markdown-it.jsx, frozen
// from e840165) rendered — these are the shapes existing users' notes rely
// on. 'intended' and 'collateral' cases carry no old-vs-new equality
// assertions yet: they are cataloged by tests/compat-report.mjs and await
// user decisions — except the #65 task-list cases (a `tasks` field), whose
// one difference is pinned below (the heading invariant further down still
// covers them all).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corpus } from './fixtures/compat-corpus.mjs';
import { oldMdToHtml, newMdToHtml } from './fixtures/load-md-converters.mjs';

for (const c of corpus.filter(c => c.expect === 'same')) {
  test(`compat invariant: ${c.name}`, () => {
    assert.equal(newMdToHtml(c.input), oldMdToHtml(c.input),
      `old and new converters must agree on ${JSON.stringify(c.input)}`);
  });
}

// Across EVERY class: a heading only ever comes from a # line. CommonMark's
// setext form ("Title\n---") turned plain lines into headings nobody typed a
// # for (issue #63) — the old converter never had that form.
test('compat invariant: no corpus case renders a heading without a # line', () => {
  const ATX_LINE = /^ {0,3}#{1,6}(?:[ \t]|$)/;
  const offenders = corpus.filter(c => {
    const hashLines = c.input.split('\n').filter(l => ATX_LINE.test(l)).length;
    return (newMdToHtml(c.input).match(/<h[1-6][\s>]/g) || []).length > hashLines;
  }).map(c => c.name);
  assert.deepEqual(offenders, []);
});
// The one deliberate exception (#65): a GFM task item renders a checkbox
// where the old converter showed the literal "[ ] ". Undo exactly that —
// the li class, the checkbox and the text span on the new side, the marker
// (and the spaces after it) on the old side — and the rest must still be
// byte-identical. The checkboxes themselves must match the markers.
const TASK_BOX = /<input type="checkbox" class="task-list-item-checkbox"[^>]*>/g;
const withoutTaskMarkup = (html) => html
  .replace(/ class="task-list-item"/g, '')
  .replace(TASK_BOX, '')
  .replace(/<span class="task-list-item-text">|<\/span>/g, '');
const withoutTaskMarkers = (html) => html.replace(/(<li dir="auto">)\[[ xX]\](?:[ \t]+|(?=<))/g, '$1');

for (const c of corpus.filter(c => c.tasks)) {
  test(`compat exception (#65 task list): ${c.name}`, () => {
    const html = newMdToHtml(c.input);
    assert.deepEqual([...html.matchAll(TASK_BOX)].map(([tag]) => / checked=""/.test(tag)), c.tasks,
      `checkbox states for ${JSON.stringify(c.input)}`);
    assert.equal(withoutTaskMarkup(html), withoutTaskMarkers(oldMdToHtml(c.input)),
      `nothing but the task markup may differ for ${JSON.stringify(c.input)}`);
  });
}
