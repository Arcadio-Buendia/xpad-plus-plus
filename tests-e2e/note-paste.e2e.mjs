// The note context menu's "Paste" (issue #59), end to end: the clipboard is
// read in the main process, and what it holds decides which of the app's
// own Ctrl+V paths the paste takes — text and pictures into the note, the
// app's copied notes onto the canvas. Undo has to behave the way it does
// for the keyboard paste it stands in for.
//
// Uses the SYSTEM clipboard (that is what the feature reads), so a run
// replaces whatever was on it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, pollUntil } from './harness.mjs';

const NOTE_VIEW = 'np-view';
const NOTE_EDIT = 'np-edit';
const NOTE_LINK = 'np-link';
const NOTE_IMAGE = 'np-image';
const NOTE_SRC = 'np-src';
const NOTE_DEST = 'np-dest';
const NOTE_LONG = 'np-long';
const LONG_BODY = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n');

const seed = {
  tweaks: { theme: 'paper', font: 'Inter', density: 'cozy', showLinks: true, tilt: false, hideNoteTitles: false },
  folders: {
    root: { id: 'root', name: 'All notes', parent: null, hue: '#888' },
    e2e: { id: 'e2e', name: 'E2E', parent: 'root', hue: '#5a82c9' },
  },
  notes: [
    { id: NOTE_VIEW, folder: 'e2e', title: 'View', body: 'first line',
      color: 'yellow', x: 40, y: 40, w: 300, h: 200, z: 1, pinned: false },
    { id: NOTE_EDIT, folder: 'e2e', title: 'Edit', body: 'alpha bravo charlie',
      color: 'blue', x: 380, y: 40, w: 300, h: 200, z: 2, pinned: false },
    { id: NOTE_LINK, folder: 'e2e', title: 'Link', body: 'see docs here',
      color: 'green', x: 720, y: 40, w: 300, h: 200, z: 3, pinned: false },
    { id: NOTE_IMAGE, folder: 'e2e', title: 'Image', body: 'pic:',
      color: 'pink', x: 40, y: 300, w: 300, h: 240, z: 4, pinned: false },
    { id: NOTE_SRC, folder: 'e2e', title: 'Source', body: 'copied body',
      color: 'peach', x: 380, y: 300, w: 300, h: 200, z: 5, pinned: false },
    { id: NOTE_DEST, folder: 'e2e', title: 'Dest', body: 'untouched',
      color: 'yellow', x: 720, y: 300, w: 300, h: 200, z: 6, pinned: false },
    { id: NOTE_LONG, folder: 'e2e', title: 'Long', body: LONG_BODY,
      color: 'blue', x: 1060, y: 40, w: 300, h: 220, z: 7, pinned: false },
  ],
  links: [],
  cwd: 'root',
  view: { x: 0, y: 0, z: 1 },
  drawer: false,
  folderOrder: ['e2e'],
};

// A real 2x2 PNG (red/blue rows): what goes on the clipboard for the
// picture test.
const PNG_2X2 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4zwAE/xkgFAAb8gP91pbyKwAAAABJRU5ErkJggg==';

let app;
before(async () => { app = await launch({ seed }); });
after(async () => { if (app) await app.close(); });

/* ---------- helpers ---------- */

// The body the app has saved for a note. Saves are debounced (500ms), so
// every check of it polls (waitBody). Not read through React's fiber props:
// a DOM node's fiber pointer is set once, when the node is created, and can
// be the stale alternate tree.
const bodyOf = (id) => {
  try {
    const store = JSON.parse(fs.readFileSync(path.join(app.userData, 'notes.json'), 'utf8'));
    const n = store.notes.find(x => x.id === id);
    return n ? n.body : null;
  } catch { return null; }   // mid-write is impossible (atomic rename), but stay safe
};
const textarea = (id) => `document.querySelector('[data-note-id="${id}"] textarea')`;
const editorValue = (id) => app.evaljs(`(() => { const ta = ${textarea(id)}; return ta ? ta.value : null; })()`);
const noteCount = () => app.evaljs(`document.querySelectorAll('[data-note-id]').length`);

// The clipboard is written from the page; Chromium refuses that unless the
// document has focus.
const setClipboardText = async (text) => {
  await app.focusWindow();
  await app.evaljs(`navigator.clipboard.writeText(${JSON.stringify(text)}).then(() => true)`);
};
const setClipboardPng = async (b64) => {
  await app.focusWindow();
  await app.evaljs(`(async () => {
    const bytes = Uint8Array.from(atob('${b64}'), c => c.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
    return true;
  })()`);
};

const rightClick = async (x, y) => {
  await app.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
  await app.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 2, clickCount: 1 });
};
const menuRows = () => app.evaljs(
  `[...document.querySelectorAll('.ctx-row > button')].map(b => ({ label: b.textContent, disabled: b.disabled }))`);

// Right-click a note — on its rendered body, or on its header (which leaves
// an open editor's selection where it is) — and wait for the menu.
const openMenu = async (id, where = 'body') => {
  const at = await app.evaljs(`(() => {
    const n = document.querySelector('[data-note-id="${id}"]').getBoundingClientRect();
    return { x: Math.round(n.left + n.width / 2), y: Math.round(${where === 'header' ? 'n.top + 10' : 'n.top + n.height / 2'}) };
  })()`);
  await rightClick(at.x, at.y);
  return pollUntil(async () => {
    const rows = await menuRows();
    return rows.length > 2 ? rows : null;
  }, { timeout: 3000, interval: 50, label: `the context menu of ${id}` });
};

const clickRow = async (label) => {
  const at = await app.evaljs(`(() => {
    const b = [...document.querySelectorAll('.ctx-row > button')].find(b => b.textContent === ${JSON.stringify(label)});
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  assert.ok(at, `the menu has no "${label}" row`);
  await app.click(at.x, at.y);
};

// The menu greys Paste out once the main process says the clipboard holds
// nothing; wait for that answer rather than racing it.
const waitPasteEnabled = (want) => pollUntil(async () => {
  const row = (await menuRows()).find(r => r.label === 'Paste');
  return row && row.disabled === !want;
}, { timeout: 3000, interval: 50, label: `Paste to be ${want ? 'enabled' : 'greyed out'}` });

const closeMenu = async () => {
  await app.click(1300, 860);   // empty desk
  await pollUntil(async () => (await menuRows()).length === 0,
    { timeout: 3000, interval: 50, label: 'the menu to close' });
};

const ctrlZ = async () => {
  const k = { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 };
  await app.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
  await app.cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
};

const waitBody = (id, want, label) => pollUntil(async () => (await bodyOf(id)) === want,
  { timeout: 5000, interval: 100, label });
const waitEditor = (id, want, label) => pollUntil(async () => (await editorValue(id)) === want,
  { timeout: 5000, interval: 100, label });

/* ---------- tests ---------- */

test('the note menu offers Paste, right after Copy', async () => {
  await setClipboardText('anything');
  const rows = await openMenu(NOTE_VIEW);
  assert.deepEqual(rows.slice(0, 3).map(r => r.label), ['Copy', 'Paste', 'Download']);
  await closeMenu();
});

test('Paste is greyed out while the clipboard holds nothing to paste', async () => {
  await setClipboardText('');
  await openMenu(NOTE_VIEW);
  await waitPasteEnabled(false);
  // A greyed-out row does nothing when clicked.
  await clickRow('Paste');
  await closeMenu().catch(() => {});
  assert.equal(await bodyOf(NOTE_VIEW), 'first line');

  // …and comes back as soon as there is something to paste.
  await setClipboardText('words');
  await openMenu(NOTE_VIEW);
  await waitPasteEnabled(true);
  await closeMenu();
});

test('Paste on a note that is not being edited adds the text on its own line; one Ctrl+Z takes it back', async () => {
  await setClipboardText('pasted words');
  await openMenu(NOTE_VIEW);
  await waitPasteEnabled(true);
  await clickRow('Paste');
  await waitBody(NOTE_VIEW, 'first line\npasted words', 'the text to land at the end, on its own line');
  assert.equal(await app.evaljs(`!${textarea(NOTE_VIEW)}`), true,
    'pasting into a note nobody is editing leaves it rendered, like "Insert image…"');
  await pollUntil(
    () => app.evaljs(`document.querySelector('[data-note-id="${NOTE_VIEW}"] .md-body').textContent.includes('pasted words')`),
    { timeout: 3000, interval: 100, label: 'the rendered note to show the paste' });

  await ctrlZ();
  await waitBody(NOTE_VIEW, 'first line', 'one Ctrl+Z to take the paste back out');
});

test('Paste while editing replaces the selection and keeps editing; Ctrl+Z in the editor takes it back', async () => {
  await setClipboardText('ZULU');
  const box = await app.noteBodyRect(NOTE_EDIT);
  await app.dblclick(box.left + 20, box.top + 12);
  await pollUntil(() => app.evaljs(`!!${textarea(NOTE_EDIT)}`), { timeout: 5000, label: 'the editor to open' });
  await app.evaljs(`${textarea(NOTE_EDIT)}.setSelectionRange(6, 11), 1`);   // "bravo"

  // Right-clicking the header moves focus off the textarea — which ends edit
  // mode before the menu even opens. The paste must still aim at the
  // selection the user was editing.
  await openMenu(NOTE_EDIT, 'header');
  await waitPasteEnabled(true);
  await clickRow('Paste');
  await waitEditor(NOTE_EDIT, 'alpha ZULU charlie', 'the selection to be replaced by the clipboard text');

  const ed = await app.evaljs(`(() => {
    const ta = ${textarea(NOTE_EDIT)};
    return ta && { focused: document.activeElement === ta, caret: [ta.selectionStart, ta.selectionEnd] };
  })()`);
  assert.ok(ed, 'the editor is open again after the paste, as after Ctrl+V');
  assert.equal(ed.focused, true, 'and has the keyboard');
  assert.deepEqual(ed.caret, [10, 10], 'with the caret right after the pasted text');

  // The textarea's own undo, exactly as after a keyboard paste.
  await ctrlZ();
  await waitEditor(NOTE_EDIT, 'alpha bravo charlie', 'Ctrl+Z in the editor to undo the paste');
  await app.click(1300, 860);
  await pollUntil(() => app.evaljs(`!${textarea(NOTE_EDIT)}`), { timeout: 3000, label: 'the editor to close' });
  await waitBody(NOTE_EDIT, 'alpha bravo charlie', 'the undone body to be what is kept');
});

test('a long paste while editing deep in a long note leaves the caret in view', async () => {
  // execCommand, which the paste goes through so native undo keeps working,
  // doesn't scroll to the caret the way a keyboard paste does: 20 lines in,
  // the editor sat scrolled to the bottom with none of them on screen.
  const pasted = Array.from({ length: 20 }, (_, i) => `P${i}`).join('\n');
  await setClipboardText(pasted);
  const box = await app.noteBodyRect(NOTE_LONG);
  await app.dblclick(box.left + 20, box.top + 12);
  await pollUntil(() => app.evaljs(`!!${textarea(NOTE_LONG)}`), { timeout: 5000, label: 'the editor to open' });
  const at = LONG_BODY.indexOf('line 50');
  // Caret on line 50, scrolled so that line is on screen — where the user is looking.
  await app.evaljs(`(() => {
    const ta = ${textarea(NOTE_LONG)};
    ta.setSelectionRange(${at}, ${at});
    const lh = parseFloat(getComputedStyle(ta).lineHeight);
    ta.scrollTop = 50 * lh - ta.clientHeight / 2;
    return 1;
  })()`);

  await openMenu(NOTE_LONG, 'header');
  await waitPasteEnabled(true);
  await clickRow('Paste');
  await waitEditor(NOTE_LONG, LONG_BODY.slice(0, at) + pasted + LONG_BODY.slice(at),
    'the 20 lines to be pasted at the caret');
  // Lines this short never wrap, so line count × line height is exact.
  const view = await app.evaljs(`(() => {
    const ta = ${textarea(NOTE_LONG)};
    const lh = parseFloat(getComputedStyle(ta).lineHeight);
    const line = ta.value.slice(0, ta.selectionEnd).split('\\n').length;
    return { top: (line - 1) * lh, bottom: line * lh, scrollTop: ta.scrollTop, height: ta.clientHeight };
  })()`);
  assert.ok(view.top >= view.scrollTop - 1 && view.bottom <= view.scrollTop + view.height + 1,
    `the caret's line (${view.top}–${view.bottom}px) is inside the view (${view.scrollTop}–${view.scrollTop + view.height}px)`);

  await ctrlZ();
  await waitEditor(NOTE_LONG, LONG_BODY, 'Ctrl+Z in the editor to undo the paste');
  await app.click(1300, 860);
  await pollUntil(() => app.evaljs(`!${textarea(NOTE_LONG)}`), { timeout: 3000, label: 'the editor to close' });
});

test('Paste goes through the editor\'s Ctrl+V edits: a URL pasted over a selected word makes it a link', async () => {
  await setClipboardText('https://example.com');
  const box = await app.noteBodyRect(NOTE_LINK);
  await app.dblclick(box.left + 20, box.top + 12);
  await pollUntil(() => app.evaljs(`!!${textarea(NOTE_LINK)}`), { timeout: 5000, label: 'the editor to open' });
  await app.evaljs(`${textarea(NOTE_LINK)}.setSelectionRange(4, 8), 1`);    // "docs"

  await openMenu(NOTE_LINK, 'header');
  await waitPasteEnabled(true);
  await clickRow('Paste');
  await waitEditor(NOTE_LINK, 'see [docs](https://example.com) here', 'the selected word to become a link');
  await app.click(1300, 860);
  await pollUntil(() => app.evaljs(`!${textarea(NOTE_LINK)}`), { timeout: 3000, label: 'the editor to close' });
  await waitBody(NOTE_LINK, 'see [docs](https://example.com) here', 'the link to be saved');
});

test('a picture on the clipboard is stored and referenced in the note, like Ctrl+V in the editor', async () => {
  await setClipboardPng(PNG_2X2);
  await openMenu(NOTE_IMAGE);
  await waitPasteEnabled(true);
  await clickRow('Paste');

  const body = await pollUntil(async () => {
    const b = await bodyOf(NOTE_IMAGE);
    return b !== 'pic:' ? b : null;
  }, { timeout: 5000, interval: 100, label: 'the picture reference to land in the note' });
  const m = body.match(/^pic:\n!\[\]\(sticky-image:\/\/([0-9a-f]{16}\.png)\)$/);
  assert.ok(m, `the body ends in one picture reference on its own line, got ${JSON.stringify(body)}`);
  assert.ok(fs.existsSync(path.join(app.userData, 'images', m[1])), 'the picture is stored under userData/images/');
  await pollUntil(
    () => app.evaljs(`(() => {
      const img = document.querySelector('[data-note-id="${NOTE_IMAGE}"] .md-body img');
      return !!img && img.complete && img.naturalWidth > 0;
    })()`),
    { timeout: 5000, interval: 100, label: 'the pasted picture to render' });

  await ctrlZ();
  await waitBody(NOTE_IMAGE, 'pic:', 'one Ctrl+Z to take the picture back out');
});

test('copied notes paste as new notes, like Ctrl+V on the canvas — not as text into the body', async () => {
  await app.focusWindow();
  await openMenu(NOTE_SRC);
  await clickRow('Copy');
  await pollUntil(async () => {
    const t = await app.evaljs('navigator.clipboard.readText()');
    return t && t.includes('<!-- sticky-notes/v1 -->') && t.includes('copied body');
  }, { timeout: 5000, interval: 100, label: 'the copied note payload on the clipboard' });

  const before = await noteCount();
  await openMenu(NOTE_DEST);
  await waitPasteEnabled(true);
  await clickRow('Paste');
  await pollUntil(async () => (await noteCount()) === before + 1,
    { timeout: 5000, interval: 100, label: 'the pasted note to appear' });
  const copies = await app.evaljs(`[...document.querySelectorAll('[data-note-id]')]
    .filter(el => el.textContent.includes('copied body')).length`);
  assert.equal(copies, 2, 'the paste is a second "Source" note');
  assert.equal(await bodyOf(NOTE_DEST), 'untouched', 'the note whose menu it was stays as it was');

  await ctrlZ();
  await pollUntil(async () => (await noteCount()) === before,
    { timeout: 5000, interval: 100, label: 'one Ctrl+Z to remove the pasted note' });
});
