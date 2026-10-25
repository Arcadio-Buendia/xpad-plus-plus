// The window's size and state across launches (#62).
//
// window.json used to hold whatever the window covered at the moment it
// closed. Quit while maximized and that was the maximized size with no flag,
// so the next launch asked for a plain window as big as the screen — which
// GNOME on Wayland draws offset, title bar under the top bar. It now keeps
// the window's normal size plus maximized / fullScreen flags.
//
// Xvfb has no window manager, so maximize() does nothing there. Full screen
// is a state Chromium applies by itself and it goes through the same save
// and restore path, so it is what the round trip below drives; the maximized
// case, and what the compositor makes of it, needs a real desktop (README).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, pollUntil } from './harness.mjs';

const WIN = `require('electron').BrowserWindow.getAllWindows()[0]`;
const windowInfo = (app) => app.evalMain(`(() => {
  const w = ${WIN};
  return { bounds: w.getBounds(), normal: w.getNormalBounds(), maximized: w.isMaximized(), fullScreen: w.isFullScreen() };
})()`);
const savedWindowJson = (app) => JSON.parse(fs.readFileSync(path.join(app.userData, 'window.json'), 'utf8'));

test('quitting in full screen saves the normal size and a fullScreen flag, not the screen size', async () => {
  const app = await launch({ inspectMain: true });
  try {
    await app.evalMain(`${WIN}.setFullScreen(true), 1`);
    await pollUntil(async () => (await windowInfo(app)).fullScreen, { label: 'full screen' });
    await app.quit();
    const saved = savedWindowJson(app);
    assert.equal(saved.width, 1400, `saved ${JSON.stringify(saved)}`);
    assert.equal(saved.height, 900, `saved ${JSON.stringify(saved)}`);
    assert.equal(saved.fullScreen, true);
    assert.equal(saved.maximized, false);
  } finally {
    await app.close();
  }
});

test('a full-screen window.json reopens full screen, and leaving it gives the saved size back', async () => {
  const app = await launch({
    inspectMain: true,
    windowJson: { x: 0, y: 0, width: 1400, height: 900, maximized: false, fullScreen: true },
  });
  try {
    // What getNormalBounds() reads while in a full screen entered before
    // the first show differs by platform (Xvfb swaps it with getBounds()),
    // so the check is the one the user sees: the size full screen ends at.
    await pollUntil(async () => (await windowInfo(app)).fullScreen,
      { label: 'the window to open full screen' });
    await app.evalMain(`${WIN}.setFullScreen(false), 1`);
    const left = await pollUntil(async () => {
      const i = await windowInfo(app);
      return !i.fullScreen && i.bounds.width === 1400 && i;
    }, { label: 'full screen to end at the saved size' });
    assert.equal(left.bounds.height, 900);
  } finally {
    await app.close();
  }
});

test("a window.json 2.2.1 wrote while maximized no longer reopens as a screen-sized plain window", async () => {
  // The reporter's file, from a 1920x1080 GNOME screen: maximized size, no
  // flag. It now opens maximized over a real, smaller normal size — Xvfb
  // can't show the maximizing, but the normal size is the part that went
  // wrong: un-maximizing used to have nothing smaller to return to.
  const app = await launch({ inspectMain: true, windowJson: { x: 0, y: 0, width: 1920, height: 1048 } });
  try {
    const { normal } = await windowInfo(app);
    assert.ok(normal.width < 1920 && normal.height < 1048,
      `normal bounds ${JSON.stringify(normal)} must be smaller than the screen`);
  } finally {
    await app.close();
  }
});
