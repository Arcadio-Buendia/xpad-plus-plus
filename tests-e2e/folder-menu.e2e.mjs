// The drawer's folder menu for a folder near the bottom of the drawer: the
// drawer clips its contents (overflow:hidden), so a menu drawn inside it lost
// every item below a low row — "Delete folder" could not be clicked. The
// menus render in screen space now, shifted up to stay on screen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, pollUntil } from './harness.mjs';

// Paper (the default) with the drawer open; twelve filler folders push the
// last row down to the bottom of the drawer.
const FILLERS = Array.from({ length: 12 }, (_, i) => `f${String(i + 1).padStart(2, '0')}`);
function seed() {
  const folders = { root: { id: 'root', name: 'All notes', parent: null, hue: '#888' } };
  for (const id of FILLERS) folders[id] = { id, name: id.toUpperCase(), parent: 'root', hue: '#8a8f3d' };
  return {
    tweaks: { theme: 'paper', font: 'Inter', density: 'cozy', showLinks: true, tilt: false, hideNoteTitles: false },
    folders,
    notes: [
      { id: 'fm-note', folder: FILLERS[0], title: 'A note', body: 'so the canvas is not empty',
        color: 'yellow', x: 40, y: 40, w: 280, h: 180, z: 1, pinned: false },
    ],
    links: [],
    cwd: 'root',
    view: { x: 0, y: 0, z: 1 },
    drawer: true,
    folderOrder: FILLERS,
  };
}

let app;
before(async () => { app = await launch({ seed: seed() }); });
after(async () => { if (app) await app.close(); });

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

// Labels from `names` whose menu row is NOT the thing under its own centre
// point — what a row clipped by the drawer or pushed off the window is.
// Null until every one of them is rendered.
const unreachable = (names) => pollUntil(() => app.evaljs(`(() => {
  const names = ${JSON.stringify(names)};
  const rows = [...document.querySelectorAll('button')].filter(b => names.includes(b.textContent.trim()));
  if (rows.length !== names.length) return null;
  return JSON.stringify(rows.filter(b => {
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(hit && b.contains(hit));
  }).map(b => b.textContent.trim()));
})()`), { timeout: 5000, interval: 100, label: `menu rows ${names.join(', ')}` }).then(JSON.parse);

test('the folder menu stays fully on screen for a folder at the bottom of the drawer', async () => {
  await rightClickFolder(FILLERS.at(-1));
  assert.deepEqual(await unreachable(['Rename', 'New subfolder', 'Move to…', 'Delete folder']), [],
    'every folder menu item is reachable');
});

test('so does its "Move to…" list', async () => {
  const at = await app.evaljs(`(() => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent === 'Move to…');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await app.click(at.x, at.y);
  // A top-level folder offers every other folder (no "Top level" entry).
  assert.deepEqual(await unreachable(FILLERS.slice(0, -1).map(id => id.toUpperCase())), [],
    'every destination is reachable');
});
