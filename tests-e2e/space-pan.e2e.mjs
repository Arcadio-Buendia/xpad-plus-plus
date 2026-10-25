// Space-to-pan and the focused control (issue #54).
//
// Holding Space turns the canvas into a hand tool, but a button the user
// clicked earlier keeps keyboard focus. A held key is not one keydown: after
// the first, the OS auto-repeat keeps sending keydowns flagged
// `repeat: true` until the key comes up. The app used to claim
// (preventDefault) only the first; every repeat went on to Chromium's
// default handler, which arms the focused button (:active), and a Space
// keyup on an armed button clicks it. So releasing Space after a pan
// re-fired the last clicked toolbar button (fit snapped the view back), and
// with nothing focused the same leak scrolled the note body last clicked by
// a page per repeat.
//
// The key events below are what a real held key sends — one keyDown carrying
// the character, auto-repeat keyDowns, one keyUp — confirmed against a real
// held Space on an X server (XTest), which arrives as exactly that sequence.
// A single keyDown/keyUp pair never reproduces the bug.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './harness.mjs';

const SHORT = 'pan-short';
const LONG = 'pan-long';
const LONG_BODY = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n');

const seed = {
  tweaks: { theme: 'paper', font: 'Inter', density: 'cozy', showLinks: true, tilt: false, hideNoteTitles: false },
  folders: {
    root: { id: 'root', name: 'All notes', parent: null, hue: '#888' },
    e2e: { id: 'e2e', name: 'E2E', parent: 'root', hue: '#5a82c9' },
  },
  notes: [
    { id: SHORT, folder: 'e2e', title: 'Short', body: 'alpha bravo charlie',
      color: 'yellow', x: 40, y: 40, w: 300, h: 180, z: 1, pinned: false },
    { id: LONG, folder: 'e2e', title: 'Long', body: LONG_BODY,
      color: 'blue', x: 420, y: 40, w: 300, h: 240, z: 2, pinned: false },
  ],
  links: [],
  cwd: 'root',
  view: { x: 0, y: 0, z: 1 },
  drawer: false,
  folderOrder: ['e2e'],
};

let app;
before(async () => {
  app = await launch({ seed });
  // Every click on any button, from any source (mouse, keyboard activation,
  // script), lands here as the button's title or text.
  await app.evaljs(`(() => {
    window.__clicks = [];
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button');
      if (b) window.__clicks.push(b.title || b.textContent.trim());
    }, true);
    return 1;
  })()`);
});
after(async () => { if (app) await app.close(); });

const SPACE = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 };
const ENTER = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
const BACKSPACE = { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 };

const spaceDown = () => app.cmd('Input.dispatchKeyEvent', { type: 'keyDown', ...SPACE, text: ' ', unmodifiedText: ' ' });
// The OS auto-repeat of a held Space: keyDowns with autoRepeat set, which
// the page sees as keydown events with e.repeat === true.
const spaceRepeat = async (n) => {
  for (let i = 0; i < n; i++) {
    await app.cmd('Input.dispatchKeyEvent', { type: 'keyDown', ...SPACE, text: ' ', unmodifiedText: ' ', autoRepeat: true });
    await app.sleep(30);
  }
};
const spaceUp = () => app.cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...SPACE });
// keyDown carrying '\r' is what makes Chromium fire the keypress that
// activates a focused button (the harness's press('Enter') sends no text).
const pressEnter = async () => {
  await app.cmd('Input.dispatchKeyEvent', { type: 'keyDown', ...ENTER, text: '\r', unmodifiedText: '\r' });
  await app.cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...ENTER });
};
const pressBackspace = async () => {
  await app.cmd('Input.dispatchKeyEvent', { type: 'keyDown', ...BACKSPACE });
  await app.cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...BACKSPACE });
};

const clicks = () => app.evaljs('window.__clicks.slice()');
const resetClicks = () => app.evaljs('(window.__clicks = [], 1)');

// The "drag to pan" pill the desk shows while Space is held and no pan runs.
const panHint = () => app.evaljs(`[...document.querySelectorAll('#desk div')].some(d => d.textContent === '✋ drag to pan')`);

const deskZoom = () => app.evaljs(`(() => {
  const m = /scale\\(([\\d.]+)\\)/.exec(document.getElementById('desk-inner').style.transform);
  return m ? Number(m[1]) : null;
})()`);
const deskPan = () => app.evaljs(`(() => {
  const m = /translate\\((-?[\\d.]+)px, *(-?[\\d.]+)px\\)/.exec(document.getElementById('desk-inner').style.transform);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
})()`);
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

const buttonCenter = (title) => app.evaljs(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.title === ${JSON.stringify(title)});
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
})()`);
const focusedTitle = () => app.evaljs('document.activeElement && document.activeElement.title');

// A point on bare desk (no note, no control over it), scanning from the
// bottom-right where the seeded notes never reach.
const emptyDeskPoint = () => app.evaljs(`(() => {
  const d = document.getElementById('desk').getBoundingClientRect();
  for (let y = d.bottom - 120; y > d.top + 40; y -= 40) {
    for (let x = d.right - 120; x > d.left + 40; x -= 40) {
      const el = document.elementFromPoint(x, y);
      if (el && ['desk', 'desk-inner', 'desk-grid'].includes(el.id)) return { x, y };
    }
  }
  return null;
})()`);

// Space goes down (and the desk confirms pan mode), the auto-repeat runs
// while the user gets the drag going, the drag pans by (dx, dy) starting at
// `from` (bare desk by default), the key keeps repeating for a moment,
// `whileHeld` runs, then Space comes up.
const spacePan = async (dx, dy, { from, whileHeld } = {}) => {
  const p = from || await emptyDeskPoint();
  assert.ok(p, 'an empty stretch of desk to start the pan on');
  await spaceDown();
  await app.pollUntil(panHint, { timeout: 3000, interval: 50, label: 'the desk to enter pan mode on Space' });
  await spaceRepeat(4);
  await app.drag(Array.from({ length: 7 }, (_, i) => ({ x: p.x + (dx * i) / 6, y: p.y + (dy * i) / 6 })));
  await spaceRepeat(2);
  if (whileHeld) await whileHeld();
  await spaceUp();
  await app.pollUntil(async () => !(await panHint()), { timeout: 3000, interval: 50, label: 'pan mode to end on Space release' });
};

const resetView = async () => {
  await app.evaljs(`([...document.querySelectorAll('button')]
    .find(b => (b.title || '').startsWith('Reset view')).click(), 1)`);
  await app.pollUntil(async () => (await deskZoom()) === 1 && (await deskPan()).x === 0,
    { timeout: 3000, interval: 50, label: 'the reset-view button to restore {0,0,1}' });
};

// The issue's steps, verbatim: click fit with the mouse, hold Space, drag to
// pan, release Space. The view must stay where the pan left it.
test('releasing Space after a pan does not re-fire the clicked fit button (#54)', async () => {
  const fit = await buttonCenter('Fit all notes to view');
  await app.click(fit.x, fit.y);
  await app.pollUntil(async () => (await deskZoom()) !== 1,
    { timeout: 3000, interval: 50, label: 'fit to change the view' });
  assert.equal(await focusedTitle(), 'Fit all notes to view', 'a clicked button keeps keyboard focus');
  await resetClicks();
  const p0 = await deskPan();

  let panned;
  await spacePan(-150, -90, { whileHeld: async () => {
    await app.pollUntil(async () => {
      const p = await deskPan();
      return near(p.x, p0.x - 150) && near(p.y, p0.y - 90);
    }, { timeout: 3000, interval: 50, label: 'the space-drag to pan the canvas' });
    panned = await deskPan();
  } });

  await app.sleep(250); // negative assertion — window for a stray fit to land
  assert.deepEqual(await clicks(), [], 'releasing Space must not click the focused fit button');
  assert.deepEqual(await deskPan(), panned, 'the view must stay where the pan put it, not snap back to fit');
  // Nothing was blurred to get there: the button keeps focus, and the
  // keyboard focus ring from #49 still shows on it.
  assert.equal(await focusedTitle(), 'Fit all notes to view', 'the fit button must keep keyboard focus');
  assert.equal(await app.evaljs(`document.activeElement.matches(':focus-visible')`), true,
    'the focused button must still show its focus ring');
});

test('holding Space without dragging fires nothing on release', async () => {
  await resetView();
  const zoomIn = await buttonCenter('Zoom in (Ctrl +)');
  await app.click(zoomIn.x, zoomIn.y);
  await app.pollUntil(async () => (await deskZoom()) > 1.15,
    { timeout: 3000, interval: 50, label: 'the zoom-in click to zoom in' });
  const z1 = await deskZoom();
  await resetClicks();

  await spaceDown();
  await app.pollUntil(panHint, { timeout: 3000, interval: 50, label: 'the desk to enter pan mode on Space' });
  await spaceRepeat(8);
  await spaceUp();
  await app.pollUntil(async () => !(await panHint()), { timeout: 3000, interval: 50, label: 'pan mode to end on Space release' });

  await app.sleep(250); // negative assertion
  assert.deepEqual(await clicks(), [], 'a held-and-released Space must not click the focused zoom-in button');
  assert.equal(await deskZoom(), z1, 'the zoom must not take another step');
});

// Every button the app renders (toolbar, zoom bar, folders drawer, and one
// note's worth of note buttons) gets keyboard focus in turn and then sits
// through a full space-pan. Half the pans start on bare desk and half on a
// note body — the two places a space-drag can begin.
test('no focused button fires when a held Space pans — toolbar, zoom bar, drawer, notes', async () => {
  await resetView();
  // Open the folders drawer so its buttons are in the sweep too.
  await app.evaljs(`([...document.querySelectorAll('button')]
    .find(b => b.textContent.trim().startsWith('FOLDERS')).click(), 1)`);
  await app.pollUntil(() => app.evaljs(`[...document.querySelectorAll('button')].some(b => b.title === 'New folder')`),
    { timeout: 3000, interval: 50, label: 'the folders drawer to open' });

  const labels = await app.evaljs(`(() => {
    const seen = new Set();
    window.__sweep = [...document.querySelectorAll('button')].filter((b) => {
      const note = b.closest('[data-note-id]');
      if (note && note.getAttribute('data-note-id') !== ${JSON.stringify(SHORT)}) return false;
      const key = b.title || b.textContent.trim();
      if (b.disabled || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return window.__sweep.map(b => b.title || b.textContent.trim());
  })()`);
  assert.ok(labels.length >= 15, `expected the whole button set, got ${labels.length}: ${labels.join(' | ')}`);

  for (let i = 0; i < labels.length; i++) {
    const focused = await app.evaljs(`(() => {
      const b = window.__sweep[${i}];
      if (!b.isConnected) return 'detached';
      b.focus();
      return document.activeElement === b;
    })()`);
    assert.equal(focused, true, `"${labels[i]}" should take keyboard focus`);
    await resetClicks();

    const dir = i % 2 ? 1 : -1;
    let from;
    if (i % 2) {
      const r = await app.noteBodyRect(SHORT);
      from = { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
    }
    const p0 = await deskPan();
    await spacePan(dir * 60, dir * 40, { from });
    await app.sleep(100); // negative assertion
    assert.deepEqual(await clicks(), [], `a space-pan must not click the focused "${labels[i]}" button`);
    const p = await deskPan();
    assert.ok(near(p.x, p0.x + dir * 60) && near(p.y, p0.y + dir * 40),
      `the space-drag ${from ? 'from a note body' : 'from bare desk'} should have panned the canvas (focus on "${labels[i]}")`);
  }
});

test('Enter still activates a focused button', async () => {
  await resetView();
  await app.evaljs(`([...document.querySelectorAll('button')].find(b => b.title === 'Zoom in (Ctrl +)').focus(), 1)`);
  assert.equal(await focusedTitle(), 'Zoom in (Ctrl +)');
  await resetClicks();
  await pressEnter();
  await app.pollUntil(async () => (await deskZoom()) > 1.15,
    { timeout: 3000, interval: 50, label: 'Enter on the focused zoom-in button to zoom in' });
  assert.deepEqual(await clicks(), ['Zoom in (Ctrl +)']);
});

test('Space still types into a note editor and the search box', async () => {
  await resetView();
  const r = await app.noteBodyRect(SHORT);
  await app.dblclick((r.left + r.right) / 2, (r.top + r.bottom) / 2);
  const ta = `document.querySelector('[data-note-id="${SHORT}"] textarea')`;
  await app.pollUntil(() => app.evaljs(`document.activeElement === ${ta}`),
    { timeout: 3000, interval: 100, label: 'the note editor textarea to take focus' });
  const before = await app.evaljs(`(() => { const t = ${ta}; return { v: t.value, at: t.selectionStart }; })()`);

  await spaceDown();
  await spaceRepeat(2);
  await spaceUp();
  const expected = before.v.slice(0, before.at) + '   ' + before.v.slice(before.at);
  await app.pollUntil(async () => (await app.evaljs(`${ta}.value`)) === expected,
    { timeout: 3000, interval: 50, label: 'a held Space to type three spaces into the editor' });
  assert.equal(await panHint(), false, 'typing a space must not put the desk in pan mode');
  for (let i = 0; i < 3; i++) await pressBackspace();
  await app.pollUntil(async () => (await app.evaljs(`${ta}.value`)) === before.v,
    { timeout: 3000, interval: 50, label: 'the typed spaces to be deleted again' });
  await app.press('Escape');
  await app.pollUntil(() => app.evaljs(`!${ta}`), { timeout: 3000, interval: 100, label: 'the editor to close on Escape' });

  await app.evaljs(`(document.getElementById('qs').focus(), 1)`);
  await spaceDown();
  await spaceUp();
  await app.pollUntil(() => app.evaljs(`document.getElementById('qs').value === ' '`),
    { timeout: 3000, interval: 50, label: 'Space to type into the search box' });
  assert.equal(await panHint(), false, 'typing a space in the search box must not put the desk in pan mode');
  await pressBackspace();
  await app.pollUntil(() => app.evaljs(`document.getElementById('qs').value === ''`),
    { timeout: 3000, interval: 50, label: 'the search box to be cleared again' });
});

// Same leak, different symptom: with nothing focused, the auto-repeat's
// keydowns fell through to the browser's Space-scrolls-a-page default, which
// scrolls the note body last clicked.
test('a held Space does not scroll the note body last clicked', async () => {
  await resetView();
  await app.evaljs('(document.activeElement && document.activeElement.blur(), 1)');
  const box = `document.querySelector('[data-note-id="${LONG}"] .md-body').parentElement`;
  assert.ok(await app.evaljs(`${box}.scrollHeight > ${box}.clientHeight + 100`), 'the long note must overflow its body');
  await app.evaljs(`(${box}.scrollTop = 0, 1)`);
  const r = await app.noteBodyRect(LONG);
  await app.click(r.left + 40, r.top + 40);

  await spaceDown();
  await app.pollUntil(panHint, { timeout: 3000, interval: 50, label: 'the desk to enter pan mode on Space' });
  await spaceRepeat(4);
  await spaceUp();
  await app.sleep(250); // negative assertion — window for a smooth scroll to move
  assert.equal(await app.evaljs(`${box}.scrollTop`), 0, 'holding Space must not scroll the note body');
});
