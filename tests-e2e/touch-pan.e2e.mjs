// Touch panning of the canvas (issue #41), driven with real CDP touch input
// (Input.dispatchTouchEvent — Blink turns it into touch events plus pointer
// events with pointerType 'touch', the same stream a touchscreen produces).
//   - one finger dragged on EMPTY canvas pans the view, in the desktop app
//     too (it used to be gated to the narrow web demo, so in Electron the
//     browser took the drag as a native scroll of a desk that can't scroll,
//     and nothing happened);
//   - two fingers on empty canvas pan AND zoom in one gesture, the way a
//     map does: the world point between the fingers stays between them
//     wherever they travel, and the finger spread sets the zoom;
//   - what must not change: touches that start on a note never pan the
//     canvas, a long note body still touch-scrolls, a tap on empty canvas
//     still clears the selection, and a mouse drag on empty canvas is still
//     a marquee selection.
// Unlike pinch.e2e.mjs, the swipes here do NOT pause after touchStart (see
// swipe): a real digitizer's first moves arrive before React has attached
// any gesture listener, and that first move is where the browser decides
// whether to take the gesture for itself — which the pointercancel
// assertions catch.
// No Emulation.setTouchEmulationEnabled here: dispatchTouchEvent delivers
// touch input on its own, and enabling emulation mid-session was observed
// to inject a spurious pointercancel into the next gesture.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, NOTE } from './harness.mjs';

let app;
before(async () => { app = await launch(); });
after(async () => { if (app) await app.close(); });

// One CDP touch event. touchPoints is the full set of fingers on the screen
// AFTER the event (active-set semantics): a new id is a finger down, a
// missing id is a finger up, a moved id is a finger move. touchEnd with []
// lifts every remaining finger.
const touch = (type, points) => app.cmd('Input.dispatchTouchEvent', {
  type,
  touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 2.5, radiusY: 2.5, force: 1 })),
});

// Fingers land at from[i], glide linearly to to[i] in `steps` touchMoves,
// then lift. Each CDP touch command waits for the page to handle the event,
// which a real digitizer never does: its first moves reach the browser a
// millisecond or two after the landing, before the page has run a single
// touchstart handler. So the landing and the first two moves are sent
// without waiting in between (CDP still delivers them in order); the rest
// follow at a touchscreen-like cadence.
const swipe = async (from, to, steps = 10) => {
  const at = (f) => from.map((p, i) => ({
    x: Math.round(p.x + (to[i].x - p.x) * f),
    y: Math.round(p.y + (to[i].y - p.y) * f),
    id: i + 1,
  }));
  await Promise.all([
    touch('touchStart', at(0)),
    touch('touchMove', at(1 / steps)),
    touch('touchMove', at(2 / steps)),
  ]);
  for (let i = 3; i <= steps; i++) {
    await touch('touchMove', at(i / steps));
    await app.sleep(8);
  }
  await touch('touchEnd', []);
};

// Current zoom and pan, read straight off the desk transform the app renders.
const deskView = () => app.evaljs(`(() => {
  const t = document.getElementById('desk-inner').style.transform;
  const m = /translate\\((-?[\\d.]+)px, *(-?[\\d.]+)px\\) scale\\(([\\d.]+)\\)/.exec(t);
  return m ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) } : null;
})()`);

// The desk's viewport origin — the transform is desk-relative.
const deskOrigin = () => app.evaljs(`(() => {
  const r = document.getElementById('desk').getBoundingClientRect();
  return { left: r.left, top: r.top };
})()`);

// World position of every note straight off its style — left/top ARE
// note.x/y, zoom- and pan-independent, so any change means a note moved.
const allNoteGeom = () => app.evaljs(`(() => {
  const out = {};
  for (const el of document.querySelectorAll('[data-note="1"]')) {
    out[el.getAttribute('data-note-id')] = el.style.left + ' ' + el.style.top;
  }
  return out;
})()`);

// Selected notes render a solid outline; unselected notes have outline:none.
const selectedIdList = () => app.evaljs(`
  [...document.querySelectorAll('[data-note="1"]')]
    .filter(el => el.style.outlineStyle === 'solid')
    .map(el => el.getAttribute('data-note-id'))
    .sort()
`);

// Viewport center of the note's header — the primary drag handle, always
// the first child of the note root.
const headerCenter = (id) => app.evaljs(`(() => {
  const r = document.querySelector('[data-note-id="${id}"]').firstElementChild.getBoundingClientRect();
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
})()`);

// Counts pointercancel events from here on. Blink fires one when the
// browser claims a touch for its own scroll/zoom handling — after which the
// app only gets uncancelable, throttled touchmoves — so a canvas gesture
// must finish with this still at zero.
const countCancels = () => app.evaljs(`(() => {
  window.__e2eCancels = 0;
  if (!window.__e2eCancelHook) {
    window.__e2eCancelHook = true;
    window.addEventListener('pointercancel', () => { window.__e2eCancels += 1; }, true);
  }
  return 0;
})()`);
const cancels = () => app.evaljs('window.__e2eCancels');

// Full "Reset view" (x, y AND z) via the zoom-bar button, so each test
// starts from the seeded {0,0,1} regardless of what ran before it.
const resetView = async () => {
  await app.evaljs(`([...document.querySelectorAll('button')]
    .find(b => (b.title || '').startsWith('Reset view')).click(), 1)`);
  await app.pollUntil(async () => {
    const v = await deskView();
    return v.x === 0 && v.y === 0 && v.z === 1;
  }, { timeout: 3000, interval: 50, label: 'the reset-view button to restore {0,0,1}' });
};

const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

// Empty canvas: right of the seeded notes and below the top row, so every
// finger below starts (and stays) on the desk background.
const EMPTY = { x: 1100, y: 650 };

test('one finger dragged on empty canvas pans the view', async () => {
  await resetView();
  const geom0 = await allNoteGeom();
  const sel0 = await selectedIdList();
  await countCancels();

  await swipe([EMPTY], [{ x: EMPTY.x - 200, y: EMPTY.y - 100 }]);

  // At z=1 the canvas must have moved exactly one finger-delta.
  await app.pollUntil(async () => {
    const v = await deskView();
    return near(v.x, -200) && near(v.y, -100);
  }, { timeout: 3000, interval: 50, label: 'the canvas to pan one full finger-delta' });
  assert.equal((await deskView()).z, 1, 'a one-finger pan must not zoom');
  assert.equal(await cancels(), 0,
    'the browser must not claim the drag as a native scroll (pointercancel)');
  assert.deepEqual(await allNoteGeom(), geom0, 'panning moves the view, never the notes');
  assert.deepEqual(await selectedIdList(), sel0, 'panning must not select anything (no marquee)');
});

test('two fingers moved together on empty canvas pan the view without zooming', async () => {
  await resetView();
  await countCancels();

  // Constant 150px spread, both fingers sweep by (-150, -80).
  await swipe(
    [{ x: 1000, y: 650 }, { x: 1150, y: 650 }],
    [{ x: 850,  y: 570 }, { x: 1000, y: 570 }],
  );

  await app.pollUntil(async () => {
    const v = await deskView();
    return near(v.x, -150) && near(v.y, -80);
  }, { timeout: 3000, interval: 50, label: 'the canvas to follow the two fingers' });
  assert.equal((await deskView()).z, 1, 'an unchanged finger spread must not zoom');
  assert.equal(await cancels(), 0,
    'the browser must not claim the gesture (pointercancel)');
});

test('two fingers spreading while they move zoom and pan at once, like a map', async () => {
  await resetView();
  const o = await deskOrigin();
  const v0 = await deskView();
  // Spread 100px → 200px (zoom ×2) while the midpoint travels
  // (1050,650) → (1000,500).
  const from = [{ x: 1000, y: 650 }, { x: 1100, y: 650 }];
  const to   = [{ x: 900,  y: 500 }, { x: 1100, y: 500 }];
  const m0 = { x: 1050, y: 650 };
  const m1 = { x: 1000, y: 500 };
  // The world point that sat under the fingers' midpoint at the start.
  const w = { x: (m0.x - o.left - v0.x) / v0.z, y: (m0.y - o.top - v0.y) / v0.z };

  await swipe(from, to);

  // Must end up under the midpoint where the fingers finished, at 2× zoom.
  await app.pollUntil(async () => {
    const v = await deskView();
    return near(v.z, v0.z * 2, 0.01)
      && near(o.left + v.x + w.x * v.z, m1.x)
      && near(o.top + v.y + w.y * v.z, m1.y);
  }, { timeout: 3000, interval: 50, label: 'the world point between the fingers to follow them at 2x zoom' });
});

test('a second finger joining a one-finger pan carries on without a jump', async () => {
  await resetView();
  // Finger 1 pans (-100, 0) on its own…
  await touch('touchStart', [{ id: 1, x: EMPTY.x, y: EMPTY.y }]);
  try {
    for (let i = 1; i <= 5; i++) {
      await touch('touchMove', [{ id: 1, x: EMPTY.x - i * 20, y: EMPTY.y }]);
      await app.sleep(8);
    }
    await app.pollUntil(async () => near((await deskView()).x, -100),
      { timeout: 3000, interval: 50, label: 'the one-finger pan to land before finger 2 does' });

    // …then finger 2 lands 150px to its right, and both sweep (-50, -50) at
    // a constant spread: the canvas must pick up from where finger 1 left it.
    const f1 = { x: EMPTY.x - 100, y: EMPTY.y };
    const f2 = { x: EMPTY.x + 50, y: EMPTY.y };
    await touch('touchStart', [{ id: 1, ...f1 }, { id: 2, ...f2 }]);
    for (let i = 1; i <= 5; i++) {
      await touch('touchMove', [
        { id: 1, x: f1.x - i * 10, y: f1.y - i * 10 },
        { id: 2, x: f2.x - i * 10, y: f2.y - i * 10 },
      ]);
      await app.sleep(8);
    }
  } finally {
    // Always lift: a finger left down would turn the next test's
    // touchStart into a move of this one.
    await touch('touchEnd', []);
  }

  await app.pollUntil(async () => {
    const v = await deskView();
    return near(v.x, -150) && near(v.y, -50) && v.z === 1;
  }, { timeout: 3000, interval: 50, label: 'the canvas to end one full delta from where it began' });
});

test('touches that start on a note never pan the canvas', async () => {
  await resetView();
  // Header: the note's drag handle — the note moves, the canvas does not.
  const c = await headerCenter(NOTE.other);
  const geom0 = await allNoteGeom();
  await swipe([c], [{ x: c.x + 60, y: c.y + 40 }]);
  await app.pollUntil(async () => (await allNoteGeom())[NOTE.other] !== geom0[NOTE.other],
    { timeout: 3000, interval: 50, label: 'the header drag to move the note' });
  assert.deepEqual(await deskView(), { x: 0, y: 0, z: 1 }, 'a header drag must move the note, not the canvas');

  // Body: a text-selection surface — neither the note nor the canvas moves.
  const b = await app.noteBodyRect(NOTE.plain);
  const s = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
  const geom1 = await allNoteGeom();
  await swipe([s], [{ x: s.x + 80, y: s.y + 40 }]);
  await app.sleep(200); // negative assertion — window for any wrong pan to apply
  assert.deepEqual(await deskView(), { x: 0, y: 0, z: 1 }, 'a drag on a note body must not pan the canvas');
  assert.deepEqual(await allNoteGeom(), geom1, 'a drag on a note body must not move any note');
});

test('a touch drag on a long note body still scrolls the body, not the canvas', async () => {
  await resetView();
  // Rich's body overflows its note, so it is a real touch-scroll surface.
  const scrollTop = () => app.evaljs(
    `document.querySelector('[data-note-id="${NOTE.rich}"] .md-body').parentElement.scrollTop`);
  assert.equal(await scrollTop(), 0);
  const b = await app.noteBodyRect(NOTE.rich);
  const x = Math.round((b.left + b.right) / 2);
  await swipe([{ x, y: Math.round(b.bottom - 20) }], [{ x, y: Math.round(b.top + 40) }]);
  await app.pollUntil(async () => (await scrollTop()) > 50,
    { timeout: 3000, interval: 50, label: 'the note body to scroll under the finger' });
  assert.deepEqual(await deskView(), { x: 0, y: 0, z: 1 }, 'scrolling a note body must not pan the canvas');
  // Let the fling the swipe started run out: Chromium swallows a tap that
  // stops a fling, which would eat the next test's tap.
  let last = -1;
  await app.pollUntil(async () => {
    const s = await scrollTop();
    const settled = s === last;
    last = s;
    return settled;
  }, { timeout: 3000, interval: 150, label: 'the note body fling to settle' });
});

test('a tap on empty canvas still clears the selection', async () => {
  await resetView();
  const c = await headerCenter(NOTE.plain);
  await app.click(c.x, c.y);
  await app.pollUntil(async () => (await selectedIdList()).includes(NOTE.plain),
    { timeout: 3000, interval: 50, label: 'clicking the header to select the note' });

  await touch('touchStart', [{ id: 1, ...EMPTY }]);
  await touch('touchEnd', []);
  await app.pollUntil(async () => (await selectedIdList()).length === 0,
    { timeout: 3000, interval: 50, label: 'a tap on empty canvas to clear the selection' });
  assert.deepEqual(await deskView(), { x: 0, y: 0, z: 1 }, 'a tap must not pan');
});

test('a mouse drag on empty canvas is still a marquee selection, not a pan', async () => {
  await resetView();
  // From the gap between the top-row notes, up-left across Plain's corner.
  await app.drag([{ x: 450, y: 300 }, { x: 400, y: 260 }, { x: 350, y: 230 }, { x: 300, y: 200 }]);
  await app.pollUntil(async () => {
    const ids = await selectedIdList();
    return ids.length === 1 && ids[0] === NOTE.plain;
  }, { timeout: 3000, interval: 50, label: 'the marquee to select the note it crossed' });
  assert.deepEqual(await deskView(), { x: 0, y: 0, z: 1 }, 'a mouse drag on the canvas must not pan');
});
