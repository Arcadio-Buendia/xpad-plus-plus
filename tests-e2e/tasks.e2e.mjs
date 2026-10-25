// Task lists (issue #65): "- [ ] x" renders a checkbox, and clicking it
// ticks that item in the note BODY — without opening the editor, without a
// text selection, undoable with Ctrl+Z and saved to disk like any edit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './harness.mjs';

const TASKS = 'e2e-tasks';
const EMPTY = 'e2e-tasks-empty';

// Two items with the same text (only the clicked one may change), a nested
// checked item, a plain bullet to measure against, and a fenced "- [ ]"
// that must stay code.
const BODY = [
  'Errands',
  '',
  '- [ ] same',
  '- [ ] same',
  '  - [x] nested done',
  '- plain bullet',
  '```',
  '- [ ] fenced',
  '```',
].join('\n');
const lines = BODY.split('\n');
const withLine = (i, text) => lines.map((l, k) => (k === i ? text : l)).join('\n');

const seed = {
  tweaks: { theme: 'paper', font: 'Inter', density: 'cozy', showLinks: true, tilt: false, hideNoteTitles: false },
  folders: { root: { id: 'root', name: 'All notes', parent: null, hue: '#888' } },
  notes: [
    { id: TASKS, folder: 'root', title: 'Tasks', body: BODY,
      color: 'yellow', x: 40, y: 40, w: 340, h: 330, z: 1, pinned: false },
    { id: EMPTY, folder: 'root', title: 'Empty', body: '',
      color: 'blue', x: 520, y: 40, w: 300, h: 220, z: 2, pinned: false },
  ],
  links: [],
  cwd: 'root',
  view: { x: 0, y: 0, z: 1 },
  drawer: false,
  folderOrder: [],
};

let app;
before(async () => { app = await launch({ seed }); });
after(async () => { if (app) await app.close(); });

const sel = (id) => `[data-note-id="${id}"]`;
const bodyOnDisk = () => {
  try {
    const store = JSON.parse(fs.readFileSync(path.join(app.userData, 'notes.json'), 'utf8'));
    return store.notes.find(n => n.id === TASKS).body;
  } catch { return null; }   // mid-write (atomic rename) or not yet saved
};
const waitForDiskBody = (want, label) => app.pollUntil(() => bodyOnDisk() === want,
  { timeout: 5000, interval: 100, label });
const boxStates = () => app.evaljs(`JSON.stringify([...document.querySelectorAll('${sel(TASKS)} .task-list-item-checkbox')]
  .map(b => [Number(b.dataset.taskLine), b.checked]))`).then(JSON.parse);
const boxCenter = (line) => app.evaljs(`(() => {
  const r = document.querySelector('${sel(TASKS)} [data-task-line="${line}"]').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
const ctrlZ = async () => {
  const key = { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 };
  await app.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await app.cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
};

test('task items render as checkboxes in their own state; fenced ones stay code', async () => {
  assert.deepEqual(await boxStates(), [[2, false], [3, false], [4, true]]);
  const dom = JSON.parse(await app.evaljs(`(() => {
    const body = document.querySelector('${sel(TASKS)} .md-body');
    return JSON.stringify({
      text: [...body.querySelectorAll('li')].map(li => li.firstChild.nodeType === 3 ? li.firstChild.data : li.children[1].textContent),
      code: body.querySelector('pre code').textContent,
    });
  })()`));
  assert.deepEqual(dom.text, ['same', 'same', 'nested done', 'plain bullet'], 'no literal "[ ]" left in the text');
  assert.equal(dom.code, '- [ ] fenced\n');
});

test('a task line is exactly as tall as a plain bullet line (preview parity, #26)', async () => {
  const h = JSON.parse(await app.evaljs(`(() => {
    const lis = [...document.querySelectorAll('${sel(TASKS)} .md-body li')];
    const lh = parseFloat(getComputedStyle(document.querySelector('${sel(TASKS)} .md-body')).lineHeight);
    return JSON.stringify({ lh, task: lis[0].getBoundingClientRect().height, plain: lis[3].getBoundingClientRect().height });
  })()`));
  assert.equal(h.task, h.plain);
  assert.ok(Math.abs(h.task - h.lh) < 0.5, `one line high (${h.task} vs line-height ${h.lh})`);
});

test('clicking a checkbox ticks that item in the body, and only that one', async () => {
  const noteBefore = await app.evaljs(`JSON.stringify(document.querySelector('${sel(TASKS)}').getBoundingClientRect())`);
  const at = await boxCenter(3);
  await app.click(at.x, at.y);
  await app.pollUntil(async () => JSON.stringify(await boxStates()) === '[[2,false],[3,true],[4,true]]',
    { timeout: 5000, interval: 50, label: 'the second "same" box to show ticked' });
  await waitForDiskBody(withLine(3, '- [x] same'), 'the ticked body to be saved to notes.json');

  const after = JSON.parse(await app.evaljs(`JSON.stringify({
    editor: !!document.querySelector('${sel(TASKS)} textarea'),
    selection: window.getSelection().toString(),
    focused: document.activeElement ? document.activeElement.tagName : null,
    note: JSON.stringify(document.querySelector('${sel(TASKS)}').getBoundingClientRect()),
  })`));
  assert.equal(after.editor, false, 'the editor stays closed');
  assert.equal(after.selection, '', 'no text got selected');
  assert.notEqual(after.focused, 'INPUT', 'the checkbox never takes focus (it would swallow Ctrl+Z)');
  assert.equal(after.note, noteBefore, 'the note did not move');
});

// A click hides a focus bug: the toggle re-renders the checkbox, and focus
// falls back to <body> with the node it was on. A press that is dragged off
// the box toggles nothing and re-renders nothing — so if the press had
// focused it, the box would keep focus and swallow the Ctrl+Z below.
test('a press dragged off a checkbox toggles nothing, selects nothing, keeps focus away', async () => {
  const at = await boxCenter(2);
  await app.drag([at, { x: at.x + 40, y: at.y + 4 }, { x: at.x + 120, y: at.y + 30 }]);
  assert.deepEqual(await boxStates(), [[2, false], [3, true], [4, true]]);
  const after = JSON.parse(await app.evaljs(`JSON.stringify({
    selection: window.getSelection().toString(),
    focused: document.activeElement ? document.activeElement.tagName : null,
  })`));
  assert.equal(after.selection, '');
  assert.notEqual(after.focused, 'INPUT', 'pressing a checkbox must not focus it');
});

test('Ctrl+Z unticks it again', async () => {
  await ctrlZ();
  await app.pollUntil(async () => JSON.stringify(await boxStates()) === '[[2,false],[3,false],[4,true]]',
    { timeout: 5000, interval: 50, label: 'the undo to untick the box' });
  await waitForDiskBody(BODY, 'the undone body to be saved');
});

test('double-clicking a checkbox toggles it twice and never opens the editor', async () => {
  const at = await boxCenter(4);
  // Every toggle re-renders the body: record the box's state after each one.
  await app.evaljs(`(() => {
    const body = document.querySelector('${sel(TASKS)} .md-body');
    window.__ticks = [];
    new MutationObserver(() => window.__ticks.push(body.querySelector('[data-task-line="4"]').checked))
      .observe(body, { childList: true });
    return 1;
  })()`);
  await app.dblclick(at.x, at.y);
  const ticks = await app.pollUntil(async () => {
    const seen = JSON.parse(await app.evaljs(`JSON.stringify(window.__ticks)`));
    return seen.length >= 2 ? seen : null;
  }, { timeout: 5000, interval: 50, label: 'both clicks of the double-click to re-render the box' });
  assert.deepEqual(ticks, [false, true], 'unticked by the first click, ticked again by the second');
  assert.deepEqual(await boxStates(), [[2, false], [3, false], [4, true]]);
  assert.equal(await app.evaljs(`!!document.querySelector('${sel(TASKS)} textarea')`), false,
    'a double-click on a checkbox is not a request to edit');
  // Chromium sends no dblclick above (the first click re-renders the box, so
  // the two clicks hit different nodes). Deliver one anyway: whatever route
  // a dblclick takes onto a checkbox, it must not open the editor.
  await app.evaljs(`document.querySelector('${sel(TASKS)} [data-task-line="4"]')
    .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 })), 1`);
  assert.equal(await app.evaljs(`!!document.querySelector('${sel(TASKS)} textarea')`), false,
    'a dblclick event on a checkbox does not open the editor');
});

test('a ticked box is still ticked after a reload', async () => {
  const at = await boxCenter(2);
  await app.click(at.x, at.y);
  await waitForDiskBody(withLine(2, '- [x] same'), 'the tick to reach notes.json');
  await app.cmd('Page.reload');
  await app.pollUntil(() => app.evaljs(`document.querySelectorAll('[data-note-id] .md-body').length === 2`),
    { timeout: 20000, interval: 200, label: 'the notes to render again after the reload' });
  assert.deepEqual(await boxStates(), [[2, true], [3, false], [4, true]]);
});

test('double-clicking the text of a task item opens the editor at that word', async () => {
  const at = await app.evaljs(`(() => {
    const li = [...document.querySelectorAll('${sel(TASKS)} .md-body li')][2];
    const text = li.querySelector('.task-list-item-text').firstChild;
    const r = document.createRange();
    r.setStart(text, 0); r.setEnd(text, 'nested'.length);
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  })()`);
  await app.dblclick(at.x, at.y);
  await app.pollUntil(() => app.evaljs(`!!document.querySelector('${sel(TASKS)} textarea')`),
    { timeout: 5000, interval: 100, label: 'the editor to open' });
  const caret = await app.evaljs(`document.querySelector('${sel(TASKS)} textarea').selectionStart`);
  const body = withLine(2, '- [x] same');
  assert.equal(caret, body.indexOf('nested'), 'the caret lands on the clicked word, past the checkbox marker');
  await app.press('Escape');
  await app.pollUntil(() => app.evaljs(`!document.querySelector('${sel(TASKS)} textarea')`),
    { timeout: 5000, interval: 100, label: 'the editor to close' });
});

test('Enter on a task item continues with "- [ ] ", and on an empty one ends the list', async () => {
  const r = await app.noteBodyRect(EMPTY);
  await app.dblclick((r.left + r.right) / 2, (r.top + r.bottom) / 2);
  const ta = `document.querySelector('${sel(EMPTY)} textarea')`;
  await app.pollUntil(() => app.evaljs(`document.activeElement === ${ta}`),
    { timeout: 5000, interval: 100, label: 'the empty note editor to open and focus' });
  await app.type('- [x] first');
  await app.press('Enter');
  assert.equal(await app.evaljs(`${ta}.value`), '- [x] first\n- [ ] ');
  await app.type('second');
  await app.press('Enter');
  await app.press('Enter');
  assert.equal(await app.evaljs(`${ta}.value`), '- [x] first\n- [ ] second\n');
  await app.click(1250, 750);   // outside every note: commit and leave edit mode
  await app.pollUntil(() => app.evaljs(`!${ta}`),
    { timeout: 5000, interval: 100, label: 'edit mode to close' });
  const states = await app.evaljs(`JSON.stringify([...document.querySelectorAll('${sel(EMPTY)} .task-list-item-checkbox')].map(b => b.checked))`);
  assert.equal(states, '[true,false]');
});
