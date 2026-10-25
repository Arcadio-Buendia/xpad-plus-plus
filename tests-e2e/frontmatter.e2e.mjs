// Frontmatter on a downloaded note (issue #40), in the running app: notes
// are stamped with created/updated where they are made and edited, the
// note menu's "Download" hands the save dialog a file that opens with the
// note's frontmatter, and importing that file gives the note back. The
// native save and open dialogs can't be driven headlessly, so the file is
// caught just before the save dialog and handed to the importer just after
// the open dialog; the file format itself is covered by
// tests/download.test.mjs and tests/import-markdown.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, pollUntil } from './harness.mjs';

const LEGACY = 'e2e-legacy';        // made before timestamps existed: has neither
const UNTOUCHED = 'e2e-untouched';  // the same, and never edited here
const DATED = 'e2e-dated';          // a title YAML must quote, a body that opens with a rule

const DATED_TITLE = 'Re: "Q2" #goals';
const DATED_BODY = '---\nopens with a rule\n\n- ship sync';

const seed = {
  tweaks: { theme: 'paper', font: 'Inter', density: 'cozy', showLinks: true, tilt: false, hideNoteTitles: false },
  folders: {
    root: { id: 'root', name: 'All notes', parent: null, hue: '#888' },
    e2e: { id: 'e2e', name: 'E2E', parent: 'root', hue: '#5a82c9' },
  },
  notes: [
    { id: LEGACY, folder: 'e2e', title: 'Legacy', body: 'alpha bravo charlie',
      color: 'yellow', x: 40, y: 40, w: 300, h: 180, z: 1, pinned: false },
    { id: UNTOUCHED, folder: 'e2e', title: 'Untouched', body: 'leave me be',
      color: 'blue', x: 400, y: 40, w: 260, h: 180, z: 2, pinned: false },
    { id: DATED, folder: 'e2e', title: DATED_TITLE, body: DATED_BODY,
      color: 'lilac', x: 720, y: 40, w: 300, h: 220, z: 3, pinned: false,
      created: '2026-08-11T10:30:00.000Z', updated: '2026-08-11T12:45:00.000Z' },
  ],
  links: [],
  cwd: 'root',
  view: { x: 0, y: 0, z: 1 },
  drawer: false,
  folderOrder: ['e2e'],
};

let app;
before(async () => { app = await launch({ seed }); });
after(async () => { if (app) await app.close(); });

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const notesOnDisk = () =>
  JSON.parse(fs.readFileSync(path.join(app.userData, 'notes.json'), 'utf8')).notes;
const onDisk = (id) => notesOnDisk().find(n => n.id === id);

// Viewport centre of the menu button labelled `label`, once it is showing.
const menuButton = (label) => pollUntil(
  () => app.evaljs(`(() => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label)});
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`),
  { timeout: 5000, interval: 100, label: `the "${label}" menu item` },
);

const rightClick = async (x, y) => {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await app.cmd('Input.dispatchMouseEvent', { type, x, y, button: 'right', buttons: 2, clickCount: 1 });
  }
};

// Double-click into a note's body, type, and click away to commit.
const typeInto = async (id, text) => {
  const r = await app.noteBodyRect(id);
  await app.dblclick((r.left + r.right) / 2, r.top + 14);
  await pollUntil(
    () => app.evaljs(`document.activeElement === document.querySelector('[data-note-id="${id}"] textarea')`),
    { timeout: 3000, interval: 100, label: `the editor of ${id} to open` },
  );
  await app.type(text);
  await app.click(20, 700);
  await pollUntil(
    () => app.evaljs(`!document.querySelector('[data-note-id="${id}"] textarea')`),
    { timeout: 3000, interval: 100, label: `the editor of ${id} to close` },
  );
};

let madeId = null;

test('a note made from the desk menu is stamped: created and updated, both now', async () => {
  const before = new Set(notesOnDisk().map(n => n.id));
  const t0 = new Date().toISOString();
  await rightClick(900, 520);
  const item = await menuButton('New note here');
  await app.click(item.x, item.y);
  const made = await pollUntil(
    () => notesOnDisk().find(n => !before.has(n.id)) || null,
    { timeout: 5000, interval: 100, label: 'the new note to be stored' },
  );
  const t1 = new Date().toISOString();
  madeId = made.id;
  assert.match(made.created, ISO);
  assert.equal(made.updated, made.created, 'a brand-new note was last updated when it was made');
  assert.ok(made.created >= t0 && made.created <= t1, `${made.created} within ${t0}..${t1}`);
});

test('editing a note moves updated, never created', async () => {
  const was = onDisk(madeId);
  await typeInto(madeId, 'first words');
  const now = await pollUntil(
    () => { const n = onDisk(madeId); return n && n.body === 'first words' ? n : null; },
    { timeout: 5000, interval: 100, label: 'the edit to be stored' },
  );
  assert.equal(now.created, was.created);
  assert.match(now.updated, ISO);
  assert.ok(now.updated > was.updated, `${now.updated} is later than ${was.updated}`);
});

test('a note from before timestamps gains updated when edited, and no invented created', async () => {
  await typeInto(LEGACY, 'X');
  const n = await pollUntil(
    () => { const n = onDisk(LEGACY); return n && n.body !== 'alpha bravo charlie' ? n : null; },
    { timeout: 5000, interval: 100, label: 'the legacy note edit to be stored' },
  );
  assert.match(n.updated, ISO);
  assert.equal('created' in n, false);
  const untouched = onDisk(UNTOUCHED);
  assert.equal('created' in untouched, false, 'loading and saving the store back-fills nothing');
  assert.equal('updated' in untouched, false);
  assert.equal(onDisk(DATED).updated, '2026-08-11T12:45:00.000Z', 'an unedited note keeps its timestamps');
});

let downloaded = null;

test('"Download" hands the save dialog the note\'s frontmatter, then its body', async () => {
  // Catch the file on its way to the native save dialog (which no test can
  // drive): the menu item calls the page's downloadNoteAsMarkdown with the
  // live note, and this records what it would have written.
  await app.evaljs(`(() => {
    window.__downloadSpy = [];
    window.downloadNoteAsMarkdown = (note) => window.__downloadSpy.push({
      name: noteDownloadFilename(note), content: noteToMarkdown(note),
    });
    return true;
  })()`);
  const r = await app.noteBodyRect(DATED);
  await rightClick((r.left + r.right) / 2, r.top + 30);
  const item = await menuButton('Download');
  await app.click(item.x, item.y);
  const files = await pollUntil(
    () => app.evaljs(`window.__downloadSpy.length ? JSON.stringify(window.__downloadSpy) : null`),
    { timeout: 5000, interval: 100, label: 'the download to be handed over' },
  );
  [downloaded] = JSON.parse(files);
  assert.equal(downloaded.content, [
    '---',
    'title: "Re: \\"Q2\\" #goals"',
    'created: 2026-08-11T10:30:00Z',
    'updated: 2026-08-11T12:45:00Z',
    'color: lilac',
    '---',
    DATED_BODY,
    '',
  ].join('\n'));
});

test('importing the downloaded file gives the note back, frontmatter and all', async () => {
  const before = new Set(notesOnDisk().map(n => n.id));
  await app.evaljs(`(() => {
    const desk = document.getElementById('desk');
    const key = Object.keys(desk).find(k => k.startsWith('__reactFiber$'));
    let fiber = desk[key];
    while (fiber && typeof (fiber.memoizedProps || {}).onImportMarkdown !== 'function') fiber = fiber.return;
    if (!fiber) throw new Error('the canvas has no onImportMarkdown prop');
    fiber.memoizedProps.onImportMarkdown(${JSON.stringify([downloaded])});
    return true;
  })()`);
  const back = await pollUntil(
    () => notesOnDisk().find(n => !before.has(n.id)) || null,
    { timeout: 5000, interval: 100, label: 'the imported note to be stored' },
  );
  assert.equal(back.title, DATED_TITLE, 'the title comes from the frontmatter, not the filename');
  assert.equal(back.body, DATED_BODY, 'the frontmatter is gone from the body; the body\'s own rule is not');
  assert.equal(back.color, 'lilac');
  assert.equal(back.created, '2026-08-11T10:30:00Z');
  assert.equal(back.updated, '2026-08-11T12:45:00Z');

  // It renders its body — a rule, then the rest — and none of the metadata.
  const rendered = JSON.parse(await pollUntil(
    () => app.evaljs(`(() => {
      const body = document.querySelector('[data-note-id="${back.id}"] .md-body');
      return body ? JSON.stringify({ hr: !!body.querySelector('hr'), text: body.textContent }) : null;
    })()`),
    { timeout: 5000, interval: 100, label: 'the imported note to render' },
  ));
  assert.equal(rendered.hr, true);
  assert.match(rendered.text, /opens with a rule/);
  assert.doesNotMatch(rendered.text, /created|color: lilac/);
});
