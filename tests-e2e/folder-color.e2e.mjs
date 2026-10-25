// Folder colour (issue #55): the drawer's folder menu recolours a folder,
// the new colour reaches every place the folder is drawn, it is saved to
// notes.json, and it is one undoable step like moving a folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, pollUntil } from './harness.mjs';

const NOTE_ID = 'fc-note';
const BLUE = 'rgb(90, 130, 201)';         // #5a82c9, the seeded hue
const GREEN = 'rgb(76, 158, 107)';        // #4c9e6b
const GREEN_WASHI = 'rgb(157, 201, 138)'; // #9dc98a, paper's tape for green

// Paper theme (the default) with the drawer open. Twelve filler folders push
// the last row down to the bottom of the drawer, where a tall menu would
// spill past the drawer's edge.
const FILLERS = Array.from({ length: 12 }, (_, i) => `f${String(i + 1).padStart(2, '0')}`);
function seed() {
  const folders = {
    root: { id: 'root', name: 'All notes', parent: null, hue: '#888' },
    e2e: { id: 'e2e', name: 'E2E', parent: 'root', hue: '#5a82c9' },
  };
  for (const id of FILLERS) folders[id] = { id, name: id.toUpperCase(), parent: 'root', hue: '#8a8f3d' };
  return {
    tweaks: { theme: 'paper', font: 'Inter', density: 'cozy', showLinks: true, tilt: false, hideNoteTitles: false },
    folders,
    notes: [
      { id: NOTE_ID, folder: 'e2e', title: 'Colored', body: 'in the E2E folder',
        color: 'yellow', x: 40, y: 40, w: 280, h: 180, z: 1, pinned: false },
    ],
    links: [],
    cwd: 'root',
    view: { x: 0, y: 0, z: 1 },
    drawer: true,
    folderOrder: ['e2e', ...FILLERS],
  };
}

let app;
before(async () => { app = await launch({ seed: seed() }); });
after(async () => { if (app) await app.close(); });

const foldersOnDisk = () =>
  JSON.parse(fs.readFileSync(path.join(app.userData, 'notes.json'), 'utf8')).folders;

const buttonLabels = () => app.evaljs(`[...document.querySelectorAll('button')].map(b => b.textContent)`);

async function rightClickFolder(id) {
  const at = await app.evaljs(`(() => {
    const row = document.querySelector('[data-folder-id="${id}"]');
    row.scrollIntoView({ block: 'nearest' });
    const r = row.getBoundingClientRect();
    return { x: r.left + 60, y: r.top + r.height / 2 };
  })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await app.cmd('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'right', buttons: 2, clickCount: 1 });
  }
}

async function clickButton(label) {
  const at = await pollUntil(() => app.evaljs(`(() => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label)});
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`), { timeout: 5000, interval: 100, label: `the "${label}" menu item` });
  await app.click(at.x, at.y);
}

async function recolor(folderId, colorName) {
  await rightClickFolder(folderId);
  await clickButton('Change color…');
  await clickButton(colorName);
}

// The folder's dot in the note header, and paper's washi-tape stripe on the
// drawer row.
const noteDot = () => app.evaljs(
  `getComputedStyle(document.querySelector('[data-note-id="${NOTE_ID}"] span[title="E2E"]')).backgroundColor`);
const drawerTape = () => app.evaljs(
  `getComputedStyle(document.querySelector('[data-folder-id="e2e"] [data-folder-stripe]')).backgroundColor`);

const undoKey = async ({ shift = false } = {}) => {
  const key = { key: shift ? 'Z' : 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90,
    modifiers: shift ? 10 : 2 };
  await app.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await app.cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
};

test('the drawer\'s folder menu offers "Change color…"', async () => {
  assert.equal(await noteDot(), BLUE, 'precondition: the seeded hue is drawn');
  await rightClickFolder('e2e');
  const labels = await pollUntil(async () => {
    const all = await buttonLabels();
    return all.includes('Rename') ? all : null;
  }, { timeout: 5000, interval: 100, label: 'the folder context menu' });
  const menu = labels.slice(labels.indexOf('Rename'), labels.indexOf('Delete folder') + 1);
  assert.deepEqual(menu, ['Rename', 'New subfolder', 'Move to…', 'Change color…', 'Delete folder']);
});

test('"Change color…" lists the folder palette by name, each with its swatch', async () => {
  await clickButton('Change color…');
  const rows = JSON.parse(await pollUntil(() => app.evaljs(`(() => {
    const names = ['Coral', 'Blue', 'Purple', 'Green', 'Amber', 'Rose', 'Teal', 'Olive'];
    const rows = [...document.querySelectorAll('button')].filter(b => names.includes(b.textContent));
    if (rows.length !== names.length) return null;
    return JSON.stringify(rows.map(b => [b.textContent, getComputedStyle(b.querySelector('span')).backgroundColor]));
  })()`), { timeout: 5000, interval: 100, label: 'the folder colour list' }));
  assert.deepEqual(rows, [
    ['Coral', 'rgb(217, 119, 87)'], ['Blue', 'rgb(90, 130, 201)'], ['Purple', 'rgb(138, 111, 191)'],
    ['Green', 'rgb(76, 158, 107)'], ['Amber', 'rgb(196, 132, 58)'], ['Rose', 'rgb(184, 74, 107)'],
    ['Teal', 'rgb(63, 168, 154)'], ['Olive', 'rgb(138, 143, 61)'],
  ]);
  assert.equal((await buttonLabels()).includes('Rename'), false, 'the colour list replaces the first menu');
});

test('picking a colour repaints the folder everywhere it is drawn and saves it', async () => {
  await clickButton('Green');
  await pollUntil(async () => (await noteDot()) === GREEN,
    { timeout: 5000, interval: 100, label: 'the note header dot to turn green' });
  assert.equal(await drawerTape(), GREEN_WASHI, 'the drawer row\'s tape follows the folder colour');
  assert.equal((await buttonLabels()).includes('Green'), false, 'the menu closes after a pick');
  await pollUntil(() => foldersOnDisk().e2e.hue === '#4c9e6b',
    { timeout: 5000, interval: 100, label: 'the new hue to be saved to notes.json' });
});

test('one Ctrl+Z puts the old colour back and Ctrl+Shift+Z re-applies it', async () => {
  await undoKey();
  await pollUntil(async () => (await noteDot()) === BLUE,
    { timeout: 5000, interval: 100, label: 'undo to restore the blue folder' });
  await undoKey({ shift: true });
  await pollUntil(async () => (await noteDot()) === GREEN,
    { timeout: 5000, interval: 100, label: 'redo to re-apply green' });
});

test('picking the colour a folder already has records no undo step', async () => {
  await recolor('e2e', 'Green');
  await pollUntil(async () => !(await buttonLabels()).includes('Green'),
    { timeout: 5000, interval: 100, label: 'the colour list to close' });
  // Had the no-op pick been recorded, this undo would only "restore" green.
  await undoKey();
  await pollUntil(async () => (await noteDot()) === BLUE,
    { timeout: 5000, interval: 100, label: 'a single undo to reach the original blue' });
});

// Labels from `names` whose menu row is NOT the thing under its own centre
// point — what a row clipped by the drawer or pushed off the window is.
// Null until every one of them is rendered.
const unreachable = (names) => pollUntil(() => app.evaljs(`(() => {
  const names = ${JSON.stringify(names)};
  const rows = [...document.querySelectorAll('button')].filter(b => names.includes(b.textContent));
  if (rows.length !== names.length) return null;
  return JSON.stringify(rows.filter(b => {
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(hit && b.contains(hit));
  }).map(b => b.textContent));
})()`), { timeout: 5000, interval: 100, label: `menu rows ${names.join(', ')}` }).then(JSON.parse);

test('both menus stay fully on screen for a folder at the bottom of the drawer', async () => {
  // Inside the drawer, its overflow:hidden used to cut the menu off below a
  // low row — "Delete folder" (and now "Change color…") out of reach.
  const last = FILLERS.at(-1);
  await rightClickFolder(last);
  assert.deepEqual(await unreachable(['Rename', 'New subfolder', 'Move to…', 'Change color…', 'Delete folder']), [],
    'every folder menu item is reachable');
  await clickButton('Change color…');
  assert.deepEqual(await unreachable(['Coral', 'Blue', 'Purple', 'Green', 'Amber', 'Rose', 'Teal', 'Olive']), [],
    'every colour is reachable');
  await clickButton('Rose');
  await pollUntil(() => foldersOnDisk()[last].hue === '#b84a6b',
    { timeout: 5000, interval: 100, label: 'the bottom folder to be saved as rose' });
});

/* ---------- clicking the colour stripe itself ---------- */

// The clickable area around a row's colour stripe (the stripe is only a few
// pixels wide), and the folder the status bar says is open.
const stripeButton = (id) => pollUntil(() => app.evaljs(`(() => {
  const row = document.querySelector('[data-folder-id="${id}"]');
  if (!row) return null;
  row.scrollIntoView({ block: 'nearest' });
  const b = row.querySelector('[data-folder-stripe]')?.closest('button');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width };
})()`), { timeout: 5000, interval: 100, label: `the clickable colour stripe of ${id}` });
const openFolderName = () => app.evaljs(
  `[...document.querySelectorAll('span')].find(s => s.textContent.startsWith('in: '))?.textContent`);

test('clicking a folder\'s colour stripe opens its colour list, and leaves the open folder alone', async () => {
  const before = await openFolderName();
  const at = await stripeButton('e2e');
  assert.ok(at.width >= 14, `the stripe is easy to hit: ${at.width}px wide`);
  await app.click(at.x, at.y);
  await pollUntil(async () => (await buttonLabels()).includes('Teal') || null,
    { timeout: 5000, interval: 100, label: 'the colour list opened from the stripe' });
  assert.equal((await buttonLabels()).includes('Rename'), false, 'the stripe goes straight to the colours, not the folder menu');
  assert.equal(await openFolderName(), before, 'clicking the stripe must not open the folder');
  await clickButton('Teal');
  await pollUntil(() => foldersOnDisk().e2e.hue === '#3fa89a',
    { timeout: 5000, interval: 100, label: 'the stripe\'s pick to be saved as teal' });
  assert.equal(await openFolderName(), before, 'picking a colour must not open the folder either');
});

test('a press on the stripe never starts dragging the folder; the rest of the row still does', async () => {
  // The rows are draggable; a drag starts on the row, so the check is whether
  // the row's dragstart lets itself be cancelled after a press on the stripe.
  const dragStartCancelled = (fromStripe) => app.evaljs(`(() => {
    const row = document.querySelector('[data-folder-id="e2e"]');
    const stripe = row.querySelector('[data-folder-stripe]').closest('button');
    const pressed = ${fromStripe} ? stripe : row.lastElementChild;
    pressed.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true }));
    const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
    row.dispatchEvent(ev);
    window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    return ev.defaultPrevented;
  })()`);
  assert.equal(await dragStartCancelled(true), true, 'a drag from the stripe must be cancelled');
  assert.equal(await dragStartCancelled(false), false, 'a drag from the rest of the row must still move the folder');
});

test('the stripe works in Flat too, and "All notes" has no clickable stripe', async () => {
  const prefs = await pollUntil(() => app.evaljs(`(() => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent === 'preferences');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`), { timeout: 5000, interval: 100, label: 'the preferences button' });
  await app.click(prefs.x, prefs.y);
  await clickButton('Flat');
  await app.click(prefs.x, prefs.y);
  await pollUntil(() => app.evaljs(`!document.body.textContent.includes('Visual style')`),
    { timeout: 5000, interval: 100, label: 'Preferences to close' });

  const target = FILLERS[0];
  const at = await stripeButton(target);
  // Wrapping the stripe in its button must not change how it is drawn:
  // Flat's stripe is 4px wide and runs the height of the row's content.
  const drawn = JSON.parse(await app.evaljs(`(() => {
    const r = document.querySelector('[data-folder-id="${target}"] [data-folder-stripe]').getBoundingClientRect();
    return JSON.stringify([Math.round(r.width), Math.round(r.height)]);
  })()`));
  assert.equal(drawn[0], 4, 'Flat stripe width');
  assert.ok(drawn[1] >= 20, `Flat stripe is drawn full height, not collapsed: ${drawn[1]}px`);
  await app.click(at.x, at.y);
  await clickButton('Coral');
  await pollUntil(() => foldersOnDisk()[target].hue === '#d97757',
    { timeout: 5000, interval: 100, label: `${target} to be saved as coral from its Flat stripe` });
  assert.equal(await app.evaljs(`!!document.querySelector('[data-folder-id="root"] button[title="Change color"]')`), false,
    '"All notes" cannot be recoloured, so its stripe is not a button');
});
