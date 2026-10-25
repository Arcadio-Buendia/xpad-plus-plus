import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowStateOf, restoreWindowState } from '../window-state.js';

/* ==================================================================== */
/* window.json — what is saved at quit, and how it comes back (#62)      */
/* ==================================================================== */

// Work areas as Electron's screen module reports them. Under Wayland it
// cannot see the shell's panels, so the work area is the whole monitor;
// under X11 it is the monitor minus the top bar.
const WAYLAND_1080 = { x: 0, y: 0, width: 1920, height: 1080 };
const X11_1080 = { x: 0, y: 32, width: 1920, height: 1048 };
const QHD = { x: 0, y: 0, width: 2560, height: 1440 };
const one = (wa) => ({ workAreas: [wa], primary: wa });

// BrowserWindow stand-in: getBounds() is what the window covers right now,
// getNormalBounds() the size it goes back to when un-maximized.
const fakeWindow = ({ bounds, normal = bounds, maximized = false, fullScreen = false }) => ({
  getBounds: () => bounds,
  getNormalBounds: () => normal,
  isMaximized: () => maximized,
  isFullScreen: () => fullScreen,
});

test('a maximized window saves its normal size and a maximized flag, not the screen-sized bounds', () => {
  const win = fakeWindow({
    bounds: { x: 0, y: 0, width: 1920, height: 1048 },
    normal: { x: 260, y: 90, width: 1400, height: 900 },
    maximized: true,
  });
  assert.deepEqual(windowStateOf(win),
    { x: 260, y: 90, width: 1400, height: 900, maximized: true, fullScreen: false });
});

test('a full-screen window saves its normal size and a fullScreen flag', () => {
  const win = fakeWindow({
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    normal: { x: 260, y: 90, width: 1400, height: 900 },
    fullScreen: true,
  });
  assert.deepEqual(windowStateOf(win),
    { x: 260, y: 90, width: 1400, height: 900, maximized: false, fullScreen: true });
});

test('a plain window saves its bounds with both flags off', () => {
  const win = fakeWindow({ bounds: { x: 100, y: 80, width: 1200, height: 800 } });
  assert.deepEqual(windowStateOf(win),
    { x: 100, y: 80, width: 1200, height: 800, maximized: false, fullScreen: false });
});

test("the reporter's window.json (2.2.1, quit while maximized) reopens maximized — Wayland", () => {
  // Saved by 2.2.1 on GNOME/Wayland 1920x1080: the maximized size, no flag.
  // Reopened as a plain window of that size, GNOME placed it offset.
  const r = restoreWindowState({ x: 0, y: 0, width: 1920, height: 1048 }, one(WAYLAND_1080));
  assert.equal(r.maximized, true);
  assert.equal(r.fullScreen, false);
  // ...and un-maximizing it gives a real window, smaller than the screen.
  assert.deepEqual(r.bounds, { x: 192, y: 108, width: 1536, height: 864 });
});

test("the same legacy file reopens maximized under X11, where the work area excludes the top bar", () => {
  const r = restoreWindowState({ x: 0, y: 32, width: 1920, height: 1048 }, one(X11_1080));
  assert.equal(r.maximized, true);
  assert.ok(r.bounds.width < 1920 && r.bounds.height < 1048, JSON.stringify(r.bounds));
});

test('a maximized window comes back maximized over the normal size it was saved with', () => {
  const r = restoreWindowState(
    { x: 260, y: 90, width: 1400, height: 900, maximized: true, fullScreen: false }, one(WAYLAND_1080));
  assert.deepEqual(r, { bounds: { x: 260, y: 90, width: 1400, height: 900 }, maximized: true, fullScreen: false });
});

test('a maximized flag over a screen-sized normal size gets a real normal size', () => {
  // What a first quit after upgrading from 2.2.1 could write on GNOME: the
  // window was auto-maximized from the legacy size, so its "normal" size is
  // that same screen size. Creating the window at the size it is about to
  // be maximized to is exactly what makes Chromium draw it offset.
  const r = restoreWindowState({ x: 0, y: 0, width: 1920, height: 1048, maximized: true }, one(WAYLAND_1080));
  assert.equal(r.maximized, true);
  assert.deepEqual(r.bounds, { x: 192, y: 108, width: 1536, height: 864 });
});

test('a plain window comes back exactly as it was', () => {
  const saved = { x: 100, y: 80, width: 1200, height: 800, maximized: false, fullScreen: false };
  assert.deepEqual(restoreWindowState(saved, one(X11_1080)),
    { bounds: { x: 100, y: 80, width: 1200, height: 800 }, maximized: false, fullScreen: false });
});

test('the e2e seed (legacy format, 1400x900 at 0,0) is left alone', () => {
  assert.deepEqual(restoreWindowState({ x: 0, y: 0, width: 1400, height: 900 }, one(WAYLAND_1080)),
    { bounds: { x: 0, y: 0, width: 1400, height: 900 }, maximized: false, fullScreen: false });
});

test('full screen comes back full screen, never combined with maximized', () => {
  // Maximizing and then going full screen before the first show leaves
  // Chromium at its minimum size once full screen is left again.
  const r = restoreWindowState(
    { x: 260, y: 90, width: 1400, height: 900, maximized: true, fullScreen: true }, one(WAYLAND_1080));
  assert.deepEqual(r, { bounds: { x: 260, y: 90, width: 1400, height: 900 }, maximized: false, fullScreen: true });
});

test('a full-screen window with a screen-sized normal size gets a real one, and stays full screen', () => {
  const r = restoreWindowState({ x: 0, y: 0, width: 1920, height: 1080, fullScreen: true }, one(WAYLAND_1080));
  assert.equal(r.fullScreen, true);
  assert.equal(r.maximized, false);
  assert.deepEqual(r.bounds, { x: 192, y: 108, width: 1536, height: 864 });
});

test('no window.json: the default size opens maximized on a 1080p screen...', () => {
  const r = restoreWindowState(null, one(WAYLAND_1080));
  assert.equal(r.maximized, true);
  assert.deepEqual(r.bounds, { x: 192, y: 108, width: 1536, height: 864 });
});

test('...and as a plain, centred 1920x1080 window on a bigger one', () => {
  assert.deepEqual(restoreWindowState(null, one(QHD)),
    { bounds: { x: 320, y: 180, width: 1920, height: 1080 }, maximized: false, fullScreen: false });
});

test('a window saved on a larger monitor that is now gone opens maximized on the primary', () => {
  // 2400x1300 on a monitor to the right of the primary; that monitor is
  // unplugged, and the size no longer fits the remaining 1080p screen.
  const r = restoreWindowState({ x: 2000, y: 100, width: 2400, height: 1300, maximized: false }, one(X11_1080));
  assert.equal(r.maximized, true);
  assert.deepEqual(r.bounds, { x: 192, y: 137, width: 1536, height: 838 });
});

test('a window whose monitor is gone moves onto the primary, centred, at its own size', () => {
  const r = restoreWindowState({ x: 2200, y: 300, width: 1000, height: 700 }, one(X11_1080));
  assert.deepEqual(r, { bounds: { x: 460, y: 206, width: 1000, height: 700 }, maximized: false, fullScreen: false });
});

test('a window too wide for its screen is narrowed to fit and pulled back inside it', () => {
  const r = restoreWindowState({ x: 300, y: 100, width: 2400, height: 700 }, one(X11_1080));
  assert.deepEqual(r, { bounds: { x: 0, y: 100, width: 1920, height: 700 }, maximized: false, fullScreen: false });
});

test('a window hanging off the edge of its screen is pulled back inside it', () => {
  // Its centre is still on the screen, so it stays where it was, just inside.
  const r = restoreWindowState({ x: 1500, y: 700, width: 800, height: 600 }, one(X11_1080));
  assert.deepEqual(r.bounds, { x: 1120, y: 480, width: 800, height: 600 });
});

test('a window on a second monitor stays on that monitor', () => {
  const right = { x: 1920, y: 0, width: 2560, height: 1440 };
  const r = restoreWindowState({ x: 2100, y: 200, width: 1600, height: 1000, maximized: true },
    { workAreas: [X11_1080, right], primary: X11_1080 });
  assert.deepEqual(r, { bounds: { x: 2100, y: 200, width: 1600, height: 1000 }, maximized: true, fullScreen: false });
});

test('garbage in window.json falls back to the default', () => {
  for (const saved of [undefined, 'nope', 42, [], { width: 'wide', height: -5, x: 'left', maximized: 'yes' }]) {
    assert.deepEqual(restoreWindowState(saved, one(QHD)),
      { bounds: { x: 320, y: 180, width: 1920, height: 1080 }, maximized: false, fullScreen: false },
      JSON.stringify(saved));
  }
});

test('no display information at all still yields usable bounds', () => {
  const r = restoreWindowState({ width: 1400, height: 900 }, {});
  assert.equal(r.bounds.width, 1400);
  assert.equal(r.bounds.height, 900);
  assert.ok(Number.isInteger(r.bounds.x) && Number.isInteger(r.bounds.y));
});

test('restored bounds are always whole numbers', () => {
  const r = restoreWindowState({ x: 10.6, y: 20.2, width: 1000.4, height: 700.7 }, one({ x: 0, y: 0, width: 1366, height: 768 }));
  for (const k of ['x', 'y', 'width', 'height']) assert.ok(Number.isInteger(r.bounds[k]), `${k}=${r.bounds[k]}`);
});
