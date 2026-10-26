// Note text size preference (issue #67): "make something to increase the
// font size". Preferences → Note text size scales the text of every note —
// title, rendered preview and editor alike — while the note boxes keep their
// size, so the bigger text wraps (and scrolls) inside them.
//
// The contracts that must survive any size: the preview and the editor put
// every word on the same line (#26), double-clicking a word opens the editor
// at that word (#35), and text-selection drags snap to the note's boundary
// the same way they do at 100% (#30). Each of those is re-run here at 150%
// and 200% through the real UI; parity at 100% too, which this change fixed
// along the way (the editor used to wrap 8px narrower than the preview).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, PLAIN_BODY, RICH_BODY } from './harness.mjs';

const PLAIN = 'ts-plain';
const PARA = 'ts-para';
const RICH = 'ts-rich';
const PROSE = 'ts-prose';
const TASKS = 'ts-tasks';

// Soft-wrapping prose plus everything the parity contract names: a space
// run, leading indentation, a blank line and one word too long for the box.
const PARA_BODY = [
  'The quick brown fox jumps over the lazy dog while   three spaces sit in the middle of this line.',
  '',
  '    indented line keeps its leading spaces and then wraps around',
  'short',
  'supercalifragilisticexpialidocious-and-then-some-more',
].join('\n');

// One long paragraph in a box too short for it, so it scrolls at every size —
// the case where the editor's wrap width used to come out 8px narrower than
// the preview's and the paragraph reflowed by a line on entering edit mode.
const PROSE_BODY = 'Sticky notes are small pieces of paper with a re-adherable strip of glue on the back, made for temporarily attaching notes to documents, walls, computer monitors and other surfaces. They come in many colours and sizes and people use them for reminders, lists and quick messages to each other at work and at home.';

// An old store: no noteTextSize key anywhere, exactly what every notes.json
// written before this feature looks like. The boxes are big enough that the
// plain note's whole text is still on screen at 200%.
const seed = () => ({
  tweaks: { theme: 'paper', font: 'Inter', density: 'cozy', showLinks: true, tilt: false, hideNoteTitles: false },
  folders: {
    root: { id: 'root', name: 'All notes', parent: null, hue: '#888' },
    e2e: { id: 'e2e', name: 'E2E', parent: 'root', hue: '#5a82c9' },
  },
  notes: [
    { id: PLAIN, folder: 'e2e', title: 'Plain', body: PLAIN_BODY,
      color: 'yellow', x: 40, y: 40, w: 340, h: 440, z: 1, pinned: false },
    { id: PARA, folder: 'e2e', title: 'Parity', body: PARA_BODY,
      color: 'blue', x: 420, y: 40, w: 320, h: 440, z: 2, pinned: false },
    { id: RICH, folder: 'e2e', title: 'Rich', body: RICH_BODY,
      color: 'green', x: 780, y: 40, w: 420, h: 520, z: 3, pinned: false },
    { id: PROSE, folder: 'e2e', title: 'Prose', body: PROSE_BODY,
      color: 'pink', x: 420, y: 500, w: 300, h: 280, z: 4, pinned: false },
    { id: TASKS, folder: 'e2e', title: 'Tasks', body: '- [ ] task\n- [x] done\n- bullet',
      color: 'peach', x: 40, y: 520, w: 340, h: 260, z: 5, pinned: false },
  ],
  links: [],
  cwd: 'root',
  view: { x: 0, y: 0, z: 1 },
  drawer: false,
  folderOrder: ['e2e'],
});

let app;
before(async () => { app = await launch({ seed: seed() }); });
after(async () => { if (app) await app.close(); });

/* ---------- Preferences driving ---------- */

// Centre of the first element matching `sel` (optionally with this exact
// trimmed text), or null when there is none on screen.
const centreOf = (sel, text) => app.evaljs(`(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(sel)})]
    .find(e => ${JSON.stringify(text ?? null)} === null || e.textContent.trim() === ${JSON.stringify(text ?? null)});
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
})()`);

const SIZE = '[role="group"][aria-label="Note text size"]';
const SLIDER = `${SIZE} input[type="range"]`;
const readout = () => app.evaljs(`(() => {
  const o = document.querySelector('${SIZE} output');
  return o ? o.textContent.trim() : null;
})()`);
// Centre of the slider's thumb at its current value, plus the track's ends.
// A native thumb travels the input's box inset by half its own width.
const thumbPoint = () => app.evaljs(`(() => {
  const r = document.querySelector('${SLIDER}');
  const b = r.getBoundingClientRect();
  const f = (r.value - r.min) / (r.max - r.min), thumb = 16;
  return { x: Math.round(b.left + thumb / 2 + f * (b.width - thumb)), y: Math.round(b.top + b.height / 2),
           left: b.left, right: b.right };
})()`);
const sliderFocused = () => app.evaljs(`document.activeElement === document.querySelector('${SLIDER}')`);
const ARROW = {
  [+1]: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  [-1]: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
};
const arrow = async (dir) => {
  await app.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...ARROW[dir] });
  await app.cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...ARROW[dir] });
};

const prefsOpen = async () => !!(await readout());
const openPrefs = async () => {
  if (await prefsOpen()) return;
  const at = await centreOf('button', 'preferences');
  await app.click(at.x, at.y);
  await app.pollUntil(prefsOpen, { timeout: 3000, interval: 50, label: 'the Note text size control' });
};
const closePrefs = async () => {
  if (!(await prefsOpen())) return;
  const at = await centreOf('button', 'preferences');
  await app.click(at.x, at.y);
  await app.pollUntil(async () => !(await prefsOpen()), { timeout: 3000, interval: 50, label: 'preferences to close' });
};

// One arrow key on the slider, and wait for the readout to move. A click on
// the thumb gives the slider the keyboard first; it leaves the value alone.
const step = async (dir) => {
  if (!(await sliderFocused())) {
    const at = await thumbPoint();
    await app.click(at.x, at.y);
  }
  const was = await readout();
  await arrow(dir);
  return app.pollUntil(async () => { const now = await readout(); return now !== was ? now : null; },
    { timeout: 3000, interval: 50, label: `an arrow key to change the size from ${was}` });
};

// Walk the slider to `pct` with the arrow keys, then close the panel so it
// covers nothing.
const setTextSize = async (pct) => {
  await openPrefs();
  for (let i = 0; i < 12; i++) {
    const now = parseInt(await readout(), 10);
    if (now === pct) break;
    await step(now < pct ? +1 : -1);
  }
  assert.equal(await readout(), `${pct}%`);
  await closePrefs();
};

/* ---------- measuring ---------- */

// Computed sizes of a note's text, in px, plus its box.
const noteMetrics = (id) => app.evaljs(`(() => {
  const root = document.querySelector('[data-note-id="${id}"]');
  const md = root.querySelector('.md-body');
  const box = md.parentElement;
  const title = root.firstElementChild.querySelector('[dir="auto"]');
  const px = (el, prop = 'fontSize') => el ? parseFloat(getComputedStyle(el)[prop]) : null;
  const first = (sel) => px(md.querySelector(sel));
  const svg = md.querySelector('.mermaid-diagram svg');
  return {
    body: px(box), lineHeight: px(box, 'lineHeight'), md: px(md), title: px(title),
    h3: first('h3'), h4: first('h4'), code: first('pre code'), table: first('table'),
    olIndent: md.querySelector('ol') ? parseFloat(getComputedStyle(md.querySelector('ol')).paddingLeft) : null,
    svgWidth: svg ? svg.getBoundingClientRect().width : null,
    room: md.clientWidth,
    w: root.offsetWidth, h: root.offsetHeight,
  };
})()`);

const mermaidRendered = () => app.pollUntil(
  () => app.evaljs(`!!document.querySelector('[data-note-id="${RICH}"] .mermaid-diagram svg')`),
  { timeout: 10000, interval: 100, label: 'the mermaid diagram to render' });

// Which visual line every word of the preview sits on, counted from the top
// of the rendered body (0-based). The last glyph of each word decides, so a
// word too long for the box counts on the line where it ends.
const previewLines = (id) => app.evaljs(`(() => {
  const md = document.querySelector('[data-note-id="${id}"] .md-body');
  const top = md.getBoundingClientRect().top;
  const lh = parseFloat(getComputedStyle(md).lineHeight);
  const out = [];
  const walk = document.createTreeWalker(md, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    for (const m of n.data.matchAll(/\\S+/g)) {
      const r = document.createRange();
      r.setStart(n, m.index + m[0].length - 1);
      r.setEnd(n, m.index + m[0].length);
      const b = r.getBoundingClientRect();
      out.push({ word: m[0], line: Math.floor((b.top + b.height / 2 - top) / lh) });
    }
  }
  return { lines: out, width: md.getBoundingClientRect().width, left: md.getBoundingClientRect().left,
           top, font: getComputedStyle(md).font, lineHeight: lh };
})()`);

// The same map for the open editor. A textarea exposes no glyph geometry,
// so ask a real one: a hidden clone of the editor (same element, same inline
// style, same parent, so the same inherited font and width) is given the
// text up to the end of each word in turn, and its scrollHeight says how many
// lines that prefix takes — i.e. which line the word ended on.
const editorLines = (id) => app.evaljs(`(() => {
  const ta = document.querySelector('[data-note-id="${id}"] textarea');
  const c = ta.cloneNode(false);
  c.removeAttribute('autofocus');
  Object.assign(c.style, { position: 'absolute', visibility: 'hidden', overflow: 'hidden',
    width: ta.clientWidth + 'px', height: '0px' });
  ta.parentElement.appendChild(c);
  const lh = parseFloat(getComputedStyle(c).lineHeight);
  const out = [];
  for (const m of ta.value.matchAll(/\\S+/g)) {
    c.value = ta.value.slice(0, m.index + m[0].length);
    out.push({ word: m[0], line: Math.round(c.scrollHeight / lh) - 1 });
  }
  c.remove();
  const b = ta.getBoundingClientRect();
  return { lines: out, width: ta.clientWidth, left: b.left, top: b.top,
           font: getComputedStyle(ta).font, lineHeight: lh };
})()`);

const clearSelection = () => app.evaljs('getSelection().removeAllRanges(); undefined');

// Open a note's editor by double-clicking the middle of its body; Escape
// closes it again without changing anything.
const openEditor = async (id) => {
  await clearSelection();
  const r = await app.noteBodyRect(id);
  await app.dblclick((r.left + r.right) / 2, r.top + 30);
  await app.pollUntil(() => app.evaljs(`!!document.querySelector('[data-note-id="${id}"] textarea')`),
    { timeout: 3000, interval: 50, label: `editor on ${id}` });
};
const closeEditor = async (id) => {
  await app.press('Escape');
  await app.pollUntil(() => app.evaljs(`!document.querySelector('[data-note-id="${id}"] textarea')`),
    { timeout: 3000, interval: 50, label: 'editor to close' });
};

/* ---------- double-click → caret (same probe as selection.e2e.mjs) ---------- */

// Viewport centre of the `nth` occurrence of `word` in a note's preview. With
// `reveal`, the note body is first scrolled so the word sits mid-box — at
// 200% most of a note's text lives below the fold.
const wordPoint = (noteId, word, { nth = 0, reveal = false } = {}) => app.evaljs(`(() => {
  const body = document.querySelector('[data-note-id="${noteId}"] .md-body');
  if (!body) return { error: 'no preview' };
  const scroller = body.parentElement;
  const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let n, seen = 0;
  while ((n = walk.nextNode())) {
    for (let i = n.data.indexOf(${JSON.stringify(word)}); i !== -1;
         i = n.data.indexOf(${JSON.stringify(word)}, i + 1)) {
      if (seen++ !== ${nth}) continue;
      const r = document.createRange();
      r.setStart(n, i); r.setEnd(n, i + ${word.length});
      if (${reveal}) {
        const box0 = scroller.getBoundingClientRect(), b0 = r.getBoundingClientRect();
        scroller.scrollTop += (b0.top - box0.top) - box0.height / 2;
      }
      const box = scroller.getBoundingClientRect();
      const b = r.getBoundingClientRect();
      const p = { x: b.left + b.width / 2, y: b.top + b.height / 2, scrollTop: scroller.scrollTop };
      if (p.x < box.left || p.x > box.right || p.y < box.top || p.y > box.bottom) {
        return { error: 'word is scrolled out of the note body' };
      }
      return p;
    }
  }
  return { error: 'word not rendered' };
})()`);

const caretAfterDblclick = async (noteId, word, opts) => {
  await clearSelection();
  const pt = await wordPoint(noteId, word, opts);
  assert.equal(pt.error, undefined, `"${word}": ${pt.error}`);
  await app.dblclick(pt.x, pt.y);
  const state = await app.pollUntil(() => app.evaljs(`(() => {
    const ta = document.querySelector('[data-note-id="${noteId}"] textarea');
    return ta ? { start: ta.selectionStart, end: ta.selectionEnd, value: ta.value } : null;
  })()`), { timeout: 3000, interval: 50, label: `textarea for ${noteId}` });
  await closeEditor(noteId);
  return { ...state, scrollTop: pt.scrollTop };
};

/* ---------- selection snapshot (same as selection.e2e.mjs) ---------- */

const selectionState = () => app.evaljs(`(() => {
  const s = getSelection();
  if (!s.rangeCount || s.isCollapsed) return { text: '', collapsed: true, backward: false, focusInPlain: false };
  const r = document.createRange();
  r.setStart(s.anchorNode, s.anchorOffset);
  r.setEnd(s.anchorNode, s.anchorOffset);
  const backward = r.comparePoint(s.focusNode, s.focusOffset) < 0;
  const plainBox = document.querySelector('[data-note-id="${PLAIN}"] .md-body').parentElement;
  return { text: s.toString(), collapsed: false, backward, focusInPlain: plainBox.contains(s.focusNode) };
})()`);

/* ==================================================================== */

let base;   // every note's metrics at 100%, captured before anything changes

test('a store saved before this preference shows note text at the size it always had', async () => {
  await mermaidRendered();
  base = {};
  for (const id of [PLAIN, PARA, RICH, PROSE]) base[id] = await noteMetrics(id);
  // Paper theme + Inter: 18px body, 12px title — the sizes on master.
  assert.equal(base[PLAIN].body, 18);
  assert.equal(base[PLAIN].md, 18);
  assert.equal(base[PLAIN].title, 12);
  assert.equal(base[RICH].olIndent, 18);
  await openPrefs();
  assert.equal(await readout(), '100%', 'the control reads 100% for a store that never set it');
  await closePrefs();
});

test('the Preferences slider walks note text a step per arrow key, and stops at either end', async () => {
  await openPrefs();
  assert.equal(await step(+1), '115%');
  assert.ok(Math.abs((await noteMetrics(PLAIN)).body - 18 * 1.15) < 0.01, '115% of 18px');
  assert.equal(await step(-1), '100%');
  assert.equal(await step(-1), '85%');
  assert.ok(Math.abs((await noteMetrics(PLAIN)).body - 18 * 0.85) < 0.01, '85% of 18px');
  await arrow(-1);
  await app.sleep(200);
  assert.equal(await readout(), '85%', 'nothing below 85%');
  await closePrefs();
  await setTextSize(200);
  await openPrefs();
  await step(-1);
  await arrow(+1);
  await arrow(+1);
  await app.sleep(200);
  assert.equal(await readout(), '200%', 'nothing above 200%');
  await closePrefs();
});

test('dragging the slider changes the size, live, and stops at either end of the track', async () => {
  await setTextSize(100);
  await openPrefs();
  // Past the right end of the track: the largest size.
  let at = await thumbPoint();
  await app.drag([{ x: at.x, y: at.y }, { x: at.x + 20, y: at.y }, { x: at.right + 40, y: at.y }]);
  assert.equal(await readout(), '200%');
  assert.equal((await noteMetrics(PLAIN)).body, 36, 'the notes follow the drag');
  // Past the left end: the smallest.
  at = await thumbPoint();
  await app.drag([{ x: at.x, y: at.y }, { x: at.x - 20, y: at.y }, { x: at.left - 40, y: at.y }]);
  assert.equal(await readout(), '85%');
  assert.ok(Math.abs((await noteMetrics(PLAIN)).body - 18 * 0.85) < 0.01, '85% of 18px');
  await closePrefs();
});

// Every body the parity check reads, by note.
const PARITY = { [PARA]: PARA_BODY, [PLAIN]: PLAIN_BODY, [PROSE]: PROSE_BODY };

for (const pct of [100, 150, 200]) {
  test(`at ${pct}% the editor puts every word on the same line as the preview`, async () => {
    await setTextSize(pct);
    let wrapped = 0;
    for (const [id, body] of Object.entries(PARITY)) {
      const preview = await previewLines(id);
      await openEditor(id);
      const editor = await editorLines(id);
      await closeEditor(id);
      assert.equal(editor.font, preview.font, `${id}: same font shorthand in both`);
      assert.equal(editor.lineHeight, preview.lineHeight, `${id}: same line height in both`);
      assert.equal(editor.left, preview.left, `${id}: text starts at the same x`);
      assert.equal(editor.top, preview.top, `${id}: text starts at the same y`);
      assert.ok(Math.abs(editor.width - preview.width) < 1, `${id}: same wrap width (${editor.width} vs ${preview.width})`);
      assert.deepEqual(editor.lines.map((l) => l.word), preview.lines.map((l) => l.word), `${id}: same words`);
      assert.deepEqual(editor.lines, preview.lines, `${id}: every word on the same line`);
      if (preview.lines.at(-1).line + 1 > body.split('\n').length) wrapped++;
    }
    // Proves the check has teeth: at this size the text really soft-wraps.
    assert.ok(wrapped >= 2, `soft wraps happen at ${pct}% (in ${wrapped} notes)`);
  });
}

for (const pct of [150, 200]) {
  const k = pct / 100;

  test(`at ${pct}% every piece of note text grows by the same factor and the boxes do not`, async () => {
    await setTextSize(pct);
    for (const id of [PLAIN, PARA, RICH, PROSE]) {
      const m = await noteMetrics(id);
      const was = base[id];
      assert.equal(m.w, was.w, `${id}: the note box keeps its width`);
      assert.equal(m.h, was.h, `${id}: the note box keeps its height`);
      for (const key of ['body', 'md', 'lineHeight', 'title', 'h3', 'h4', 'code', 'table', 'olIndent']) {
        if (was[key] == null) continue;
        assert.ok(Math.abs(m[key] - was[key] * k) < 0.05,
          `${id}: ${key} is ${m[key]}px, expected ${was[key]}px x ${k}`);
      }
    }
    // The diagram's labels are note text too: it grows with the rest unless
    // the note is already too narrow for it.
    const { svgWidth: svg, room } = await noteMetrics(RICH);
    assert.ok(Math.abs(svg - Math.min(base[RICH].svgWidth * k, room)) < 1,
      `mermaid svg is ${svg}px wide, expected ${base[RICH].svgWidth}px x ${k} (room ${room}px)`);
  });

  test(`at ${pct}% double-clicking a word still opens the editor on that word`, async () => {
    await setTextSize(pct);
    for (const word of ['kilo', 'foxtrot', 'alpha', 'lima']) {
      const s = await caretAfterDblclick(PLAIN, word);
      assert.equal(s.value, PLAIN_BODY);
      assert.equal(s.start, PLAIN_BODY.indexOf(word), `caret on "${word}"`);
      assert.equal(s.end, s.start, 'a caret, not a selection');
    }
    // A word inside markdown, far enough down the rich note that it has to
    // be scrolled to first.
    const s = await caretAfterDblclick(RICH, 'quoted', { reveal: true });
    assert.equal(s.value, RICH_BODY);
    assert.ok(s.scrollTop > 0, 'the word was below the fold');
    assert.equal(s.start, RICH_BODY.indexOf('quoted'));
  });
}

test('at 200% selection drags still snap to the note they started in', async () => {
  await setTextSize(200);
  const r = await app.noteBodyRect(PLAIN);
  const lh = (await noteMetrics(PLAIN)).lineHeight;
  const y = r.top + 10 + lh / 2;                       // middle of the first line

  // Exit right: forward, snapped to the end of the note.
  await clearSelection();
  const right = [{ x: r.left + 20, y }];
  for (let x = r.left + 45; x < r.right + 100; x += 25) right.push({ x, y });
  await app.drag(right);
  let s = await selectionState();
  assert.equal(s.collapsed, false, 'exit right: a selection exists');
  assert.equal(s.backward, false, 'exit right: forward');
  assert.equal(s.focusInPlain, true, 'exit right: ends in the note');
  assert.match(s.text, /lima/, 'exit right: snapped to the end of the note text');

  // Dip below the bottom border: still forward (the #30 regression).
  await clearSelection();
  const midX = (r.left + r.right) / 2;
  await app.drag([
    { x: r.left + 20, y }, { x: midX, y },
    { x: midX + 30, y: r.bottom + 1 }, { x: midX + 60, y: r.bottom + 60 },
  ]);
  s = await selectionState();
  assert.equal(s.backward, false, 'exit below: must not flip backward');
  assert.equal(s.focusInPlain, true, 'exit below: ends in the note');
  assert.match(s.text, /lima/, 'exit below: snapped to the end of the note text');

  // Exit left from inside the first word pair: backward, to the line start.
  await clearSelection();
  const left = [{ x: r.left + 150, y }];
  for (let x = r.left + 120; x > Math.max(4, r.left - 100); x -= 30) left.push({ x, y });
  await app.drag(left);
  s = await selectionState();
  assert.equal(s.backward, true, 'exit left: backward');
  assert.match(s.text, /^alpha/, 'exit left: reaches back to the start of the line');
  assert.doesNotMatch(s.text, /echo|india/, 'exit left: stays on its line');

  // Across onto the neighbouring note: nothing from it.
  await clearSelection();
  const rB = await app.noteBodyRect(PARA);
  const across = [{ x: r.left + 20, y }];
  for (let x = r.left + 50; x < (rB.left + rB.right) / 2; x += 30) across.push({ x, y });
  across.push({ x: (rB.left + rB.right) / 2, y: (rB.top + rB.bottom) / 2 });
  await app.drag(across);
  s = await selectionState();
  assert.equal(s.focusInPlain, true, 'across: contained to the source note');
  assert.doesNotMatch(s.text, /quick|brown|spaces|indented/, 'across: nothing from the other note');
  await clearSelection();
});

// A task checkbox takes the bullet's place (#65): it hangs into the list
// indent, which grows with the text, so its hang has to grow too — capped
// at a fixed 18px it sat 18px inside the note at 200%, and the task text
// started well right of the plain bullets' text.
for (const pct of [100, 200]) {
  test(`at ${pct}% a task checkbox sits at the start of the list indent, where the bullets hang`, async () => {
    await setTextSize(pct);
    const m = await app.evaljs(`(() => {
      const md = document.querySelector('[data-note-id="${TASKS}"] .md-body');
      const box = md.querySelector('.task-list-item-checkbox').getBoundingClientRect();
      return { box: box.left, list: md.querySelector('ul').getBoundingClientRect().left };
    })()`);
    assert.ok(Math.abs(m.box - m.list) < 0.5, `checkbox at x=${m.box}, list starts at x=${m.list}`);
  });
}

test('the size is saved with the other preferences and survives a reload', async () => {
  await setTextSize(175);
  const file = path.join(app.userData, 'notes.json');
  await app.pollUntil(() => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')).tweaks.noteTextSize === 175; } catch { return false; }
  }, { timeout: 5000, interval: 100, label: 'noteTextSize 175 in notes.json' });
  const kept = JSON.parse(fs.readFileSync(file, 'utf8')).tweaks;
  assert.equal(kept.theme, 'paper', 'the other preferences are untouched');
  assert.equal(kept.tilt, false);

  await app.cmd('Page.reload');
  await app.pollUntil(() => app.evaljs(`document.querySelectorAll('[data-note-id] .md-body').length === 5`),
    { timeout: 20000, interval: 200, label: 'notes to render after reload' });
  assert.equal((await noteMetrics(PLAIN)).body, 18 * 1.75);
  await openPrefs();
  assert.equal(await readout(), '175%');
  await closePrefs();
});

test('back at 100% everything is exactly as it was', async () => {
  await setTextSize(100);
  await mermaidRendered();
  for (const id of [PLAIN, PARA, RICH, PROSE]) {
    assert.deepEqual(await noteMetrics(id), base[id], `${id} at 100% matches the untouched store`);
  }
});
