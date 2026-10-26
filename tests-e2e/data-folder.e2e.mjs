// Choosing the data folder (issue #68), end to end: File → Choose where
// notes are saved… shows where notes.json and images/ live, switching copies them to an empty folder or
// asks what to do with one that already holds notes, and a chosen folder
// that can't be reached at startup is reported instead of being replaced by
// an empty canvas that would later be saved over it — and so is a notes.json
// that can't be read, in any folder.
//
// The folder picker is a native dialog (the file-chooser portal under
// flatpak) that no headless test can drive, so — like the markdown import —
// these hand that dialog's onChangeDataFolder the answer the picker would
// have produced ({ path, hasNotes }) and drive everything after it through
// the real UI. Checking a folder and copying into it are covered in
// tests/data-folder.test.mjs; the picker itself needs the manual flatpak
// pass described in tests-e2e/README.md.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, pollUntil } from './harness.mjs';
import { imageFileName } from '../storage.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const IMG_NAME = imageFileName(PNG, 'image/png');

const store = (notes) => ({
  tweaks: { theme: 'paper', font: 'Inter', density: 'cozy', showLinks: true, tilt: false, hideNoteTitles: false },
  folders: {
    root: { id: 'root', name: 'All notes', parent: null, hue: '#888' },
    e2e: { id: 'e2e', name: 'E2E', parent: 'root', hue: '#5a82c9' },
  },
  notes: notes.map((n, i) => ({
    folder: 'e2e', color: 'yellow', x: 40 + i * 420, y: 40, w: 340, h: 220, z: i + 1, pinned: false, ...n,
  })),
  links: [],
  cwd: 'root',
  view: { x: 0, y: 0, z: 1 },
  drawer: false,
  folderOrder: ['e2e'],
});

// This computer's notes: one with a picture, one empty to type into.
const MINE = store([
  { id: 'df-image', title: 'Image', body: `shot:\n![](sticky-image://${IMG_NAME})` },
  { id: 'df-empty', title: 'Typed here', body: '' },
]);
// What another computer synced into a shared folder.
const THEIRS = store([{ id: 'df-remote', title: 'Remote', body: 'synced from another computer' }]);
const OTHER = store([{ id: 'df-other', title: 'Other', body: 'about to be replaced' }]);

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const noteIds = (p) => readJSON(p).notes.map((n) => n.id);
const tmpFolder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sticky-e2e-folder-'));

// evaljs, but quiet while the page is reloading (the context is gone).
const peek = (app, expr) => app.evaljs(expr).catch(() => null);

const renderedNoteIds = (app) => peek(app,
  `JSON.stringify([...document.querySelectorAll('[data-note-id]')].map(e => e.getAttribute('data-note-id')).sort())`);

// Mark the page, act, then wait for a NEW page (the switch reloads it)
// showing exactly these notes.
async function expectReloadInto(app, act, ids, label) {
  await app.evaljs('window.__beforeSwitch = true');
  await act();
  await pollUntil(async () => {
    if (await peek(app, 'window.__beforeSwitch === true') !== false) return false;
    return (await renderedNoteIds(app)) === JSON.stringify([...ids].sort());
  }, { timeout: 15000, interval: 150, label });
}

// File → Choose where notes are saved…, clicked in the real application menu.
async function openDataFolder(app) {
  if (!(await peek(app, `!!document.querySelector('[data-data-folder-dialog]')`))) {
    await app.evalMain(`require('electron').Menu.getApplicationMenu().getMenuItemById('data-folder').click(), 1`);
  }
  await pollUntil(() => peek(app, `!!document.querySelector('[data-data-folder-dialog]')`),
    { timeout: 5000, interval: 100, label: 'the where-notes-are-saved dialog' });
}

// That dialog's "Choose folder…" handler, handed the picker's answer.
// The handler itself is called without awaiting: a successful switch
// reloads the page under it.
const changeFolderTo = async (app, picked) => { await openDataFolder(app); return app.evaljs(`(() => {
  const el = document.querySelector('[data-data-folder-path]');
  const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
  let fiber = el[key];
  while (fiber && typeof (fiber.memoizedProps || {}).onChangeDataFolder !== 'function') fiber = fiber.return;
  if (!fiber) throw new Error('the where-notes-are-saved dialog has no onChangeDataFolder prop');
  fiber.memoizedProps.onChangeDataFolder(${JSON.stringify(picked)});
  return true;
})()`); };

const clickButton = (app, label) => app.evaljs(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)});
  if (!b) throw new Error('no button ' + ${JSON.stringify(label)});
  b.click();
  return true;
})()`);

// The confirmation that follows a switch shows up once the reloaded page
// has hydrated; wait for it, then close it.
async function dismissInfo(app) {
  await pollUntil(() => peek(app, `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'OK')`),
    { timeout: 5000, interval: 100, label: 'the confirmation dialog' });
  await clickButton(app, 'OK');
}

const choiceButtons = (app) => peek(app, `(() => {
  const d = document.querySelector('[data-data-folder-choice]');
  return d ? JSON.stringify([...d.querySelectorAll('button')].map(b => b.textContent.trim())) : null;
})()`);

const dialogText = (app, re) => peek(app, `(() => {
  const hit = [...document.querySelectorAll('div')].find(d => ${re}.test(d.textContent) && d.textContent.length < 600);
  return hit ? hit.textContent : '';
})()`);

/* ---------------- switching folders (one app, one journey) ---------------- */

let app;
const folders = [];
before(async () => {
  app = await launch({ seed: MINE, files: { [`images/${IMG_NAME}`]: PNG }, inspectMain: true });
});
after(async () => {
  if (app) await app.close();
  for (const d of folders) fs.rmSync(d, { recursive: true, force: true });
});

test('File → Choose where notes are saved… shows where the notes are kept, and warns before an empty folder is copied into', async () => {
  await openDataFolder(app);
  const panel = await app.evaljs(`(() => {
    const el = document.querySelector('[data-data-folder-path]');
    return { path: el.textContent, panel: el.parentElement.textContent };
  })()`);
  assert.equal(panel.path, app.userData);
  assert.match(panel.panel, /Default location/);
  assert.match(panel.panel, /Choose folder…/);
  assert.doesNotMatch(panel.panel, /Reset to default location/, 'nothing to reset yet');
  assert.match(panel.panel, /Make sure the new folder is ready\..*An empty folder gets a copy of the notes you have open now/,
    'it warns before an empty folder is copied into without asking');
  await app.evaljs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await pollUntil(async () => (await peek(app, `!!document.querySelector('[data-data-folder-dialog]')`)) === false,
    { timeout: 3000, interval: 100, label: 'Escape to close the where-notes-are-saved dialog' });
});

let folderA;
test('an empty folder gets a copy of the notes and their pictures', async () => {
  folderA = tmpFolder(); folders.push(folderA);
  await expectReloadInto(app, () => changeFolderTo(app, { path: folderA, hasNotes: false }),
    ['df-image', 'df-empty'], 'the app to reload from the new folder');

  assert.deepEqual(noteIds(path.join(folderA, 'notes.json')), ['df-image', 'df-empty']);
  assert.ok(fs.readFileSync(path.join(folderA, 'images', IMG_NAME)).equals(PNG), 'the picture came along');
  assert.deepEqual(readJSON(path.join(app.userData, 'data-folder.json')), { path: folderA },
    'the choice is recorded in userData, per machine');
  assert.ok(!fs.existsSync(path.join(folderA, 'window.json')), 'window.json stays with this machine');
  assert.ok(!fs.existsSync(path.join(folderA, 'data-folder.json')), 'the pointer never travels with the data');

  const info = await pollUntil(() => dialogText(app, /Notes are now saved in this folder/),
    { timeout: 5000, interval: 100, label: 'the switch to be confirmed' });
  assert.ok(info.includes(folderA), 'the confirmation names the folder');
  await dismissInfo(app);
});

test('pictures are served from the new folder', async () => {
  fs.rmSync(path.join(app.userData, 'images', IMG_NAME));
  const width = await app.evaljs(`new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth);
    img.onerror = () => resolve(-1);
    img.src = 'sticky-image://${IMG_NAME}?after-switch=' + Date.now();
  })`);
  assert.equal(width, 1, 'the old copy is gone, so only the new folder can have served it');
});

test('edits are saved to the new folder, not the old one', async () => {
  const before = fs.readFileSync(path.join(app.userData, 'notes.json'), 'utf8');
  const r = await app.noteBodyRect('df-empty');
  await app.dblclick((r.left + r.right) / 2, (r.top + r.bottom) / 2);
  await pollUntil(() => app.evaljs(`document.activeElement === document.querySelector('[data-note-id="df-empty"] textarea')`),
    { timeout: 3000, interval: 100, label: 'the note editor to open' });
  await app.type('typed after the switch');
  await app.click(20, 860);
  await pollUntil(
    () => readJSON(path.join(folderA, 'notes.json')).notes.find((n) => n.id === 'df-empty')?.body === 'typed after the switch',
    { timeout: 5000, interval: 100, label: 'the edit to reach the new folder' });
  assert.equal(fs.readFileSync(path.join(app.userData, 'notes.json'), 'utf8'), before, 'the old copy is left alone');
});

let folderB;
test('a folder that already has notes asks first, and Cancel changes nothing', async () => {
  folderB = tmpFolder(); folders.push(folderB);
  fs.writeFileSync(path.join(folderB, 'notes.json'), JSON.stringify(THEIRS, null, 2));
  const theirsBefore = fs.readFileSync(path.join(folderB, 'notes.json'), 'utf8');

  await openDataFolder(app);
  await changeFolderTo(app, { path: folderB, hasNotes: true });
  const buttons = await pollUntil(() => choiceButtons(app),
    { timeout: 5000, interval: 100, label: 'the use-or-replace question' });
  assert.deepEqual(JSON.parse(buttons), ['Cancel', 'Use my current notes', 'Use the notes there']);
  assert.match(await app.evaljs(`document.querySelector('[data-data-folder-choice]').textContent`), /This folder already has notes/);

  await clickButton(app, 'Cancel');
  await pollUntil(async () => (await choiceButtons(app)) === null,
    { timeout: 5000, interval: 100, label: 'the question to close' });
  assert.deepEqual(readJSON(path.join(app.userData, 'data-folder.json')), { path: folderA });
  assert.equal(fs.readFileSync(path.join(folderB, 'notes.json'), 'utf8'), theirsBefore);
});

test('"Use the notes there" opens them without overwriting them', async () => {
  await openDataFolder(app);
  await changeFolderTo(app, { path: folderB, hasNotes: true });
  await pollUntil(() => choiceButtons(app), { timeout: 5000, interval: 100, label: 'the use-or-replace question' });
  await expectReloadInto(app, () => clickButton(app, 'Use the notes there'),
    ['df-remote'], 'the notes from the shared folder to open');

  assert.deepEqual(noteIds(path.join(folderB, 'notes.json')), ['df-remote'], 'their notes were adopted, not replaced');
  assert.deepEqual(readJSON(path.join(app.userData, 'data-folder.json')), { path: folderB });
  assert.equal(readJSON(path.join(folderA, 'notes.json')).notes.find((n) => n.id === 'df-empty').body,
    'typed after the switch', 'the folder left behind kept the latest edits');
  await dismissInfo(app);
});

test('"Use my current notes" overwrites the notes in the chosen folder', async () => {
  const folderC = tmpFolder(); folders.push(folderC);
  fs.writeFileSync(path.join(folderC, 'notes.json'), JSON.stringify(OTHER));
  await openDataFolder(app);
  await changeFolderTo(app, { path: folderC, hasNotes: true });
  await pollUntil(() => choiceButtons(app), { timeout: 5000, interval: 100, label: 'the use-or-replace question' });
  await expectReloadInto(app, () => clickButton(app, 'Use my current notes'),
    ['df-remote'], 'the app to reload with the notes it had open');
  assert.deepEqual(noteIds(path.join(folderC, 'notes.json')), ['df-remote']);
  assert.deepEqual(readJSON(path.join(app.userData, 'data-folder.json')), { path: folderC });
  await dismissInfo(app);
});

test('Reset to default location goes back to userData, asking because the old copy is still there', async () => {
  await openDataFolder(app);
  assert.match(await app.evaljs(`document.querySelector('[data-data-folder-path]').parentElement.textContent`),
    /Reset to default location/);
  await clickButton(app, 'Reset to default location');
  await pollUntil(() => choiceButtons(app), { timeout: 5000, interval: 100, label: 'the use-or-replace question' });
  assert.match(await app.evaljs(`document.querySelector('[data-data-folder-choice]').textContent`),
    /The default location already has notes/);
  await expectReloadInto(app, () => clickButton(app, 'Use the notes there'),
    ['df-image', 'df-empty'], 'the notes in the default location to open');
  assert.ok(!fs.existsSync(path.join(app.userData, 'data-folder.json')), 'no pointer means the default location');
  await dismissInfo(app);
  await openDataFolder(app);
  assert.equal(await app.evaljs(`document.querySelector('[data-data-folder-path]').textContent`), app.userData);
});

/* ---------------- a chosen folder that can't be reached at startup ---------------- */

const unavailableText = (a) => peek(a,
  `document.querySelector('[data-data-folder-unavailable]')?.textContent || ''`);

test('a missing data folder is reported at startup, nothing is written, and Try again recovers', async () => {
  const parent = tmpFolder(); folders.push(parent);
  const gone = path.join(parent, 'unmounted-share', 'notes');
  const app2 = await launch({ seed: null, files: { 'data-folder.json': JSON.stringify({ path: gone }) } });
  try {
    const text = await pollUntil(() => unavailableText(app2),
      { timeout: 10000, interval: 100, label: 'the unreachable-folder screen' });
    assert.ok(text.includes(gone), 'it names the folder');
    assert.match(text, /can't be found/);
    assert.match(text, /Nothing has been loaded or saved/);
    assert.equal(await app2.evaljs(`document.querySelectorAll('[data-note-id]').length`), 0, 'no canvas behind it');

    const res = await app2.evaljs(`window.stickyAPI.save({ notes: [] })`);
    assert.equal(res.ok, false, 'main refuses to save while the folder is out of reach');
    assert.ok(!fs.existsSync(path.join(parent, 'unmounted-share')), 'the missing folder is never created');
    assert.ok(!fs.existsSync(path.join(app2.userData, 'notes.json')), 'and nothing is saved anywhere else instead');

    // The share comes back.
    fs.mkdirSync(gone, { recursive: true });
    fs.writeFileSync(path.join(gone, 'notes.json'), JSON.stringify(THEIRS));
    await expectReloadInto(app2, () => clickButton(app2, 'Try again'), ['df-remote'], 'the notes to open after Try again');
  } finally {
    await app2.close();
  }
});

test('a data folder without notes.json (an empty mount point) is reported; "Use the default location" goes back', async () => {
  const empty = tmpFolder(); folders.push(empty);
  const app3 = await launch({ seed: null, files: {
    'data-folder.json': JSON.stringify({ path: empty }),
    'notes.json': JSON.stringify(MINE),
  } });
  try {
    const text = await pollUntil(() => unavailableText(app3),
      { timeout: 10000, interval: 100, label: 'the unreachable-folder screen' });
    assert.match(text, /no notes\.json in it/);
    assert.deepEqual(fs.readdirSync(empty), [], 'nothing is written into the empty folder');

    await expectReloadInto(app3, () => clickButton(app3, 'Use the default location'),
      ['df-image', 'df-empty'], 'the notes in the default location to open');
    assert.ok(!fs.existsSync(path.join(app3.userData, 'data-folder.json')));
    assert.deepEqual(fs.readdirSync(empty), [], 'still nothing in the folder that was out of reach');
  } finally {
    await app3.close();
  }
});

/* ---------------- a notes.json that can't be read ---------------- */

test('a notes.json that cannot be read is reported, never replaced by the sample notes, and Try again loads it once fixed', async () => {
  // A hand edit one comma short.
  const broken = JSON.stringify(MINE, null, 2).replace('"title": "Image",', '"title": "Image"');
  const app4 = await launch({ seed: null, files: { 'notes.json': broken } });
  const file = path.join(app4.userData, 'notes.json');
  try {
    const text = await pollUntil(() => unavailableText(app4),
      { timeout: 10000, interval: 100, label: 'the unreadable-notes screen' });
    assert.match(text, /can't be read/);
    assert.ok(text.includes(file), 'it names the file');
    assert.match(text, /line \d+ column \d+/, 'and says where the mistake is');
    assert.equal(await app4.evaljs(`[...document.querySelectorAll('[data-data-folder-unavailable] button')]
      .some(b => b.textContent === 'Use the default location')`), false, 'it already is the default location');
    assert.equal(await app4.evaljs(`document.querySelectorAll('[data-note-id]').length`), 0, 'no sample notes behind it');

    // Longer than the save that follows every load (500 ms).
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(fs.readFileSync(file, 'utf8'), broken, 'the file is untouched');
    assert.equal((await app4.evaljs(`window.stickyAPI.save({ notes: [] })`)).ok, false, 'main refuses to save over it');

    fs.writeFileSync(file, JSON.stringify(MINE));
    await expectReloadInto(app4, () => clickButton(app4, 'Try again'), ['df-image', 'df-empty'],
      'the fixed notes to open after Try again');
  } finally {
    await app4.close();
  }
});
