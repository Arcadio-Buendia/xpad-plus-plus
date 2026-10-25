// Freeze the old-vs-new markdown invariants: for every corpus case classed
// 'same', the current markdown-it pipeline must render EXACTLY what the old
// hand-rolled converter (tests/fixtures/utils-pre-markdown-it.jsx, frozen
// from e840165) rendered — these are the shapes existing users' notes rely
// on. 'intended' and 'collateral' cases carry no old-vs-new equality
// assertions yet: they are cataloged by tests/compat-report.mjs and await
// user decisions (the heading invariant at the bottom still covers them).
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
