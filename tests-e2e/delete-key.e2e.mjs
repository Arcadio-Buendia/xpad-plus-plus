// Deleting notes from the keyboard (#47). Delete and Backspace with notes
// selected open the same confirmation the note's × button and its "Delete…"
// menu item use — with the count when several are selected — and
// Shift+Delete / Shift+Backspace skip it. Neither key may ever reach the
// delete while the user is typing: in the editor, a title, the search box or
// a folder name, with text highlighted in a note, or with the selection left
// behind in a folder that is no longer on screen.
//
// Every test starts from the same seed: the page is parked on about:blank
// (so no pending save can land afterwards), notes.json is rewritten, and the
// app is loaded again.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './harness.mjs';

const N = { alpha: 'del-alpha', bravo: 'del-bravo', charlie: 'del-charlie', delta: 'del-delta' };

// Four notes in one folder, two links (alpha–bravo, bravo–charlie), a second
// empty folder, and the drawer open so folder rows can be clicked. All notes
// sit left of the drawer.
function seed() {
  const note = (id, title, x, y, z) => ({ id, folder: 'home', title,
    body: `${title.toLowerCase()} first line\nsecond line of ${title.toLowerCase()}`,
    color: 'yellow', x, y, w: 300, h: 180, z, pinned: false });
  return {
    tweaks: { theme: 'paper', font: 'Inter', density: 'cozy', showLinks: true, tilt: false, hideNoteTitles: false },
    folders: {
      root: { id: 'root', name: 'All notes', parent: null, hue: '#888' },
      home: { id: 'home', name: 'Home', parent: 'root', hue: '#5a82c9' },
      spare: { id: 'spare', name: 'Spare', parent: 'root', hue: '#4c9e6b' },
    },
    notes: [
      note(N.alpha, 'Alpha', 40, 40, 1),
      note(N.bravo, 'Bravo', 400, 40, 2),
      note(N.charlie, 'Charlie', 40, 300, 3),
      note(N.delta, 'Delta', 400, 300, 4),
    ],
    links: [
      { id: 'l-ab', from: N.alpha, to: N.bravo },
      { id: 'l-bc', from: N.bravo, to: N.charlie },
    ],
    cwd: 'root',
    view: { x: 0, y: 0, z: 1 },
    drawer: true,
    folderOrder: ['home', 'spare'],
  };
}

let app;
let appUrl;
before(async () => {
  app = await launch({ seed: seed() });
  appUrl = await app.evaljs('location.href');
});
after(async () => { if (app) await app.close(); });

beforeEach(async () => {
  await app.cmd('Page.navigate', { url: 'about:blank' });
  await app.pollUntil(() => app.evaljs(`location.href === 'about:blank'`),
    { timeout: 10000, label: 'the page to park on about:blank' });
  fs.writeFileSync(path.join(app.userData, 'notes.json'), JSON.stringify(seed(), null, 2));
  await app.cmd('Page.navigate', { url: appUrl });
  await app.pollUntil(() => app.evaljs(`document.querySelectorAll('[data-note-id] .md-body').length === 4`),
    { timeout: 20000, label: 'the seeded notes to render again' });
});

/* ---------- drivers ---------- */

const KEY = {
  Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
  n: { key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78, nativeVirtualKeyCode: 78 },
  z: { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90 },
};
// CDP modifier bitmask: 2 = Ctrl, 8 = Shift. rawKeyDown is how Chromium
// reports a key that types no character, which is all of these.
const key = async (name, { shift = false, ctrl = false } = {}) => {
  const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0);
  await app.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, ...KEY[name] });
  await app.cmd('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...KEY[name] });
};

const ctrlClick = async (x, y) => {
  await app.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers: 2 });
  await app.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers: 2 });
};

const exists = (id) => app.evaljs(`!!document.querySelector('[data-note-id="${id}"]')`);
const noteCount = () => app.evaljs(`document.querySelectorAll('[data-note-id]').length`);
const isSelected = (id) => app.evaljs(`(document.querySelector('[data-note-id="${id}"]')?.style.outline || '').includes('solid')`);

// The confirmation as the user reads it — title and body text — or null
// when none is up. Found through its Cancel button, so any ConfirmDialog
// counts, not just one that carries particular markup.
const dialog = () => app.evaljs(`(() => {
  const cancel = [...document.querySelectorAll('button')].find(b => b.textContent === 'Cancel');
  if (!cancel) return null;
  const card = cancel.parentElement.parentElement;
  return { title: card.children[0].textContent, body: card.children[1].textContent };
})()`);

const rectOf = async (expr, what) => {
  const r = await app.evaljs(`(() => {
    const el = ${expr};
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  })()`);
  if (!r) throw new Error(`no ${what} on screen`);
  return r;
};
const clickDialogButton = async (label) => {
  const c = await rectOf(`[...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label)})`,
    `"${label}" button`);
  await app.click(c.x, c.y);
};

// A plain click on a note's body: selects the note, opens no editor — the
// "I clicked into the note" gesture from the issue's comments.
const clickBody = async (id) => {
  const r = await app.noteBodyRect(id);
  await app.click(r.left + 40, r.top + 40);
  await app.pollUntil(() => isSelected(id), { timeout: 5000, label: `${id} to be selected` });
};
const ctrlClickBody = async (id) => {
  const r = await app.noteBodyRect(id);
  await ctrlClick(r.left + 40, r.top + 40);
  await app.pollUntil(() => isSelected(id), { timeout: 5000, label: `${id} to join the selection` });
};

// Wait for a key's outcome without a bare sleep: whichever comes first, a
// dialog or the note disappearing, then report both.
const settle = async (id) => {
  await app.pollUntil(async () => (await dialog()) || !(await exists(id)),
    { timeout: 5000, label: `a confirmation, or ${id} to be deleted` });
  return { dialog: await dialog(), exists: await exists(id) };
};

// Keys that must do nothing get a bounded window to misbehave in, checked
// every 50ms, rather than one look straight after the press.
const staysPut = async (check, label) => {
  const deadline = Date.now() + 600;
  while (Date.now() < deadline) {
    const bad = await check();
    if (bad) assert.fail(`${label}: ${bad}`);
    await app.sleep(50);
  }
};
const nothingHappens = (ids, label) => staysPut(async () => {
  const d = await dialog();
  if (d) return `a confirmation opened (${d.title})`;
  for (const id of ids) if (!(await exists(id))) return `${id} was deleted`;
  return null;
}, label);

const savedStore = () => JSON.parse(fs.readFileSync(path.join(app.userData, 'notes.json'), 'utf8'));

/* ---------- the confirmation ---------- */

test('Delete on a selected note opens the same confirmation as its × button', async () => {
  // The × first: what it shows is the reference.
  const x = await rectOf(`document.querySelector('[data-note-id="${N.alpha}"] button[title="Delete"]')`, 'the × button');
  await app.click(x.x, x.y);
  const fromButton = await app.pollUntil(() => dialog(), { timeout: 5000, label: 'the × confirmation' });
  await clickDialogButton('Cancel');
  await app.pollUntil(async () => !(await dialog()), { timeout: 5000, label: 'the × confirmation to close' });

  await clickBody(N.alpha);
  await key('Delete');
  const r = await settle(N.alpha);
  assert.equal(r.exists, true, 'Delete removed the note without asking');
  assert.deepEqual(r.dialog, fromButton, 'the keyboard must ask with the very same dialog as the × button');
  assert.deepEqual(r.dialog, { title: 'Delete "Alpha"?', body: 'This note will be permanently removed.' });
});

test('Backspace on a note that was only clicked (no editor open) asks instead of deleting', async () => {
  // The accident from the issue's comments: one click into the note, then
  // Backspace to delete some text — but a single click selects the note and
  // never opens the editor.
  await clickBody(N.alpha);
  assert.equal(await app.evaljs(`!!document.querySelector('[data-note-id="${N.alpha}"] textarea')`), false,
    'a single click must not have opened the editor');
  await key('Backspace');
  const r = await settle(N.alpha);
  assert.equal(r.exists, true, 'Backspace removed the note without asking');
  assert.deepEqual(r.dialog, { title: 'Delete "Alpha"?', body: 'This note will be permanently removed.' });
});

test('after Escape closes the editor, Backspace asks instead of deleting', async () => {
  // Escape leaves the editor but keeps the note selected, with the keyboard
  // back on the page — one more Backspace "into the note" from there.
  const r0 = await app.noteBodyRect(N.alpha);
  await app.dblclick(r0.left + 40, r0.top + 20);
  await app.pollUntil(() => app.evaljs(`document.activeElement === document.querySelector('[data-note-id="${N.alpha}"] textarea')`),
    { timeout: 5000, label: 'the editor to open and focus' });
  await key('Escape');
  await app.pollUntil(() => app.evaljs(`!document.querySelector('[data-note-id="${N.alpha}"] textarea')`),
    { timeout: 5000, label: 'Escape to close the editor' });
  assert.equal(await isSelected(N.alpha), true, 'the note stays selected after Escape');
  await key('Backspace');
  const r = await settle(N.alpha);
  assert.equal(r.exists, true, 'Backspace right after leaving the editor removed the note without asking');
  assert.ok(r.dialog, 'a confirmation must be showing');
});

test('Cancel keeps the note, and keeps it selected', async () => {
  await clickBody(N.alpha);
  await key('Delete');
  assert.ok((await settle(N.alpha)).dialog, 'a confirmation must be showing');
  await clickDialogButton('Cancel');
  await app.pollUntil(async () => !(await dialog()), { timeout: 5000, label: 'Cancel to close the confirmation' });
  assert.equal(await exists(N.alpha), true, 'Cancel must not delete');
  assert.equal(await isSelected(N.alpha), true, 'Cancel must leave the selection as it was');
  assert.equal(await noteCount(), 4);
});

test('Escape closes the confirmation without deleting, and keeps the selection', async () => {
  await clickBody(N.alpha);
  await ctrlClickBody(N.bravo);
  await key('Delete');
  assert.ok((await settle(N.alpha)).dialog, 'a confirmation must be showing');
  await key('Escape');
  await app.pollUntil(async () => !(await dialog()), { timeout: 5000, label: 'Escape to close the confirmation' });
  assert.equal(await noteCount(), 4, 'Escape must not delete anything');
  assert.equal(await isSelected(N.alpha), true, 'Escape on the dialog must not also clear the selection');
  assert.equal(await isSelected(N.bravo), true, 'Escape on the dialog must not also clear the selection');
});

test('keys pressed while the confirmation is up do nothing behind it', async () => {
  // Someone who believes they are typing keeps typing: more Backspaces, a
  // Delete, a letter. None of it may confirm, delete, or make a note.
  await clickBody(N.alpha);
  await key('Backspace');
  assert.ok((await settle(N.alpha)).dialog, 'a confirmation must be showing');
  await key('Backspace');
  await key('Delete');
  await key('n');
  await key('Enter');
  await staysPut(async () => {
    if (!(await dialog())) return 'the confirmation went away';
    if (!(await exists(N.alpha))) return 'the note was deleted';
    const n = await noteCount();
    return n === 4 ? null : `${n} notes on the canvas instead of 4`;
  }, 'typing at an open confirmation');
});

test('Confirm deletes the note, and Ctrl+Z brings it back', async () => {
  await clickBody(N.alpha);
  await key('Delete');
  assert.ok((await settle(N.alpha)).dialog, 'a confirmation must be showing');
  await clickDialogButton('Delete');
  await app.pollUntil(async () => !(await exists(N.alpha)), { timeout: 5000, label: 'Confirm to delete the note' });
  assert.equal(await dialog(), null, 'the confirmation closes once it has deleted');
  assert.equal(await noteCount(), 3);
  await key('z', { ctrl: true });
  await app.pollUntil(() => exists(N.alpha), { timeout: 5000, label: 'Ctrl+Z to restore the deleted note' });
});

test('several selected notes: the confirmation states the count, and one Ctrl+Z restores them all', async () => {
  await clickBody(N.alpha);
  await ctrlClickBody(N.bravo);
  await key('Backspace');
  const r = await settle(N.alpha);
  assert.equal(r.exists, true, 'Backspace removed the selection without asking');
  assert.deepEqual(r.dialog, { title: 'Delete 2 notes?', body: 'These notes will be permanently removed.' });

  await clickDialogButton('Delete');
  await app.pollUntil(async () => !(await exists(N.alpha)) && !(await exists(N.bravo)),
    { timeout: 5000, label: 'Confirm to delete both notes' });
  assert.equal(await noteCount(), 2, 'only the two selected notes go');
  // Both links touched a deleted note, so both go with them.
  const saved = await app.pollUntil(() => {
    const s = savedStore();
    return s.notes.length === 2 ? s : null;
  }, { timeout: 5000, label: 'the deletion to be saved' });
  assert.deepEqual(saved.links, [], 'links to deleted notes are removed with them');

  await key('z', { ctrl: true });
  await app.pollUntil(async () => (await exists(N.alpha)) && (await exists(N.bravo)),
    { timeout: 5000, label: 'one Ctrl+Z to restore both notes' });
});

test('Shift+Delete deletes the selection at once, with no confirmation', async () => {
  await clickBody(N.alpha);
  await ctrlClickBody(N.bravo);
  await key('Delete', { shift: true });
  await app.pollUntil(async () => !(await exists(N.alpha)) && !(await exists(N.bravo)),
    { timeout: 5000, label: 'Shift+Delete to delete both notes' });
  assert.equal(await dialog(), null, 'Shift+Delete must not ask');
  assert.equal(await noteCount(), 2);
  await key('z', { ctrl: true });
  await app.pollUntil(async () => (await exists(N.alpha)) && (await exists(N.bravo)),
    { timeout: 5000, label: 'Ctrl+Z to restore both notes' });
});

test('Shift+Backspace deletes the selected note at once, with no confirmation', async () => {
  await clickBody(N.charlie);
  await key('Backspace', { shift: true });
  await app.pollUntil(async () => !(await exists(N.charlie)), { timeout: 5000, label: 'Shift+Backspace to delete the note' });
  assert.equal(await dialog(), null, 'Shift+Backspace must not ask');
  assert.equal(await noteCount(), 3);
});

/* ---------- never while typing ---------- */

test('in the note editor, Delete and Backspace edit the text and never touch the note', async () => {
  const r0 = await app.noteBodyRect(N.alpha);
  await app.dblclick(r0.left + 40, r0.top + 20);
  const ta = `document.querySelector('[data-note-id="${N.alpha}"] textarea')`;
  await app.pollUntil(() => app.evaljs(`document.activeElement === ${ta}`),
    { timeout: 5000, label: 'the editor to open and focus' });
  await app.evaljs(`${ta}.setSelectionRange(5, 5), 1`);   // "alpha| first line"
  await key('Backspace');
  await key('Delete');
  await key('Backspace', { shift: true });
  await app.pollUntil(async () => (await app.evaljs(`${ta}.value`)).startsWith('alpfirst line'),
    { timeout: 5000, label: 'the three keys to edit the text' });
  await nothingHappens([N.alpha], 'Delete/Backspace in the editor');
});

test('in a note title, Delete and Backspace edit the title and never touch the note', async () => {
  const head = await rectOf(`document.querySelector('[data-note-id="${N.alpha}"] [dir="auto"]')`, 'the title');
  await app.dblclick(head.x, head.y);
  const input = `document.querySelector('[data-note-id="${N.alpha}"] input')`;
  await app.pollUntil(() => app.evaljs(`document.activeElement === ${input}`),
    { timeout: 5000, label: 'the title editor to open and focus' });
  await app.evaljs(`${input}.setSelectionRange(5, 5), 1`);
  await key('Backspace');
  await key('Backspace', { shift: true });
  await app.pollUntil(async () => (await app.evaljs(`${input}.value`)) === 'Alp',
    { timeout: 5000, label: 'Backspace to edit the title' });
  await nothingHappens([N.alpha], 'Delete/Backspace in a title');
});

test('in the search box, Backspace edits the query and never deletes the selected note', async () => {
  await clickBody(N.alpha);
  const qs = await rectOf(`document.getElementById('qs')`, 'the search box');
  await app.click(qs.x, qs.y);
  await app.pollUntil(() => app.evaljs(`document.activeElement === document.getElementById('qs')`),
    { timeout: 5000, label: 'the search box to take focus' });
  await app.type('alp');
  await key('Backspace');
  await key('Delete');
  await key('Backspace', { shift: true });
  await app.pollUntil(async () => (await app.evaljs(`document.getElementById('qs').value`)) === 'a',
    { timeout: 5000, label: 'Backspace to edit the query' });
  await nothingHappens([N.alpha], 'Delete/Backspace in the search box');
});

test('naming a new folder, then Backspace after Enter, never deletes the notes left selected behind it', async () => {
  // Select a note, make a folder (the canvas switches to it, empty), type
  // its name, Enter — then a Backspace to fix a typo, a beat too late. The
  // selection is still alive but not one of its notes is on screen.
  await clickBody(N.alpha);
  await ctrlClickBody(N.bravo);
  const create = await rectOf(`[...document.querySelectorAll('button')].find(b => /Create folder/.test(b.textContent))`,
    'the drawer\'s "Create folder" button');
  await app.click(create.x, create.y);
  const rename = `document.querySelector('[data-folder-id] input')`;
  await app.pollUntil(() => app.evaljs(`document.activeElement === ${rename}`),
    { timeout: 5000, label: 'the new folder\'s name field to take focus' });
  await app.evaljs(`${rename}.setSelectionRange(99, 99), 1`);   // caret after "New folder"
  await key('Backspace');
  assert.equal(await app.evaljs(`${rename}.value`), 'New folde', 'Backspace edits the folder name');
  // The notes aren't rendered in this (empty) folder, so only the dialog
  // can be watched from here; their survival is checked back in Home.
  await nothingHappens([], 'Backspace in the folder name field');

  await key('Enter');
  await app.pollUntil(() => app.evaljs(`!${rename}`), { timeout: 5000, label: 'Enter to finish the rename' });
  await key('Backspace');
  await key('Delete', { shift: true });
  // Back to the folder holding the notes: both must still be there.
  const home = await rectOf(`document.querySelector('[data-folder-id="home"]')`, 'the Home folder row');
  await app.click(home.x, home.y);
  await app.pollUntil(() => app.evaljs(`document.querySelectorAll('[data-note-id]').length > 0`),
    { timeout: 5000, label: 'the Home folder to show its notes' });
  assert.equal(await dialog(), null, 'no confirmation for notes that are not on screen');
  assert.equal(await exists(N.alpha), true, 'a note in another folder was deleted by a key pressed in this one');
  assert.equal(await exists(N.bravo), true, 'a note in another folder was deleted by a key pressed in this one');
});

test('with text highlighted in a note, Delete and Shift+Delete leave the note alone', async () => {
  // A highlight means the user is working with text: Shift+Delete is "cut"
  // to a text field, Delete is "erase this". Same rule as Ctrl+C / Ctrl+X.
  const r = await app.noteBodyRect(N.alpha);
  const y = r.top + 20;
  const pathPts = [{ x: r.left + 16, y }];
  for (let x = r.left + 40; x < r.left + 160; x += 20) pathPts.push({ x, y });
  await app.drag(pathPts);
  assert.ok((await app.evaljs('getSelection().toString()')).length > 0, 'the drag must leave text highlighted');
  assert.equal(await isSelected(N.alpha), true, 'pressing in the body selects the note too');
  await key('Delete', { shift: true });
  await key('Delete');
  await key('Backspace');
  await nothingHappens([N.alpha], 'Delete/Backspace over highlighted text');
});
