/* ---------- Window size and state across launches (window.json) ----------
 * { x, y, width, height, maximized, fullScreen }: the window's NORMAL bounds
 * (the size it returns to when un-maximized) plus the two state flags. Up to
 * 2.2.1 the file held whatever the window covered when it closed, with no
 * flags — quit while maximized and the next launch asked for a plain window
 * exactly as big as the screen. GNOME on Wayland auto-maximizes a window
 * that big as it maps, and Chromium, already at the size it is configured
 * to, keeps its un-maximized frame geometry: everything is drawn up and to
 * the left by the width of the frame's shadow, title bar under the top bar
 * (#62).
 *
 * Pure functions; main.js reads and writes the file and asks Electron's
 * screen module for the work areas. Positions are only a hint: Wayland
 * ignores them and the compositor places the window itself.
 */

// First launch, and anything unreadable in window.json.
const DEFAULT_SIZE = { width: 1920, height: 1080 };

// A size at least this share of the work area in both directions is a
// maximized window in all but name, and is restored as one. Not "equal to
// the work area": under Wayland Electron cannot see the shell's panels, so
// its work area is the whole monitor and a maximized window is short of it
// by the top bar (1048 of 1080 on GNOME) — or by a dock, or a bottom panel.
const FILLS = 0.9;

// The normal size a maximized window gets when it has no real one of its
// own. Under GNOME's auto-maximize threshold (80% of the work area's area),
// so un-maximizing it gives a real window.
const RESTORE_SHARE = 0.8;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const contains = (a, px, py) => px >= a.x && px < a.x + a.width && py >= a.y && py < a.y + a.height;

// What to save when the window closes. getNormalBounds(), never
// getBounds(): while maximized or full screen the latter is the screen.
// Electron reports a maximized window that went full screen as not
// maximized, and restoring both at once is broken anyway (see below).
function windowStateOf(win) {
  const { x, y, width, height } = win.getNormalBounds();
  const fullScreen = win.isFullScreen();
  return { x, y, width, height, maximized: !fullScreen && win.isMaximized(), fullScreen };
}

// How to open the window from what was saved. `workAreas` are the work
// areas of every display, `primary` the primary's; returns the bounds to
// create the window with and whether to maximize it / make it full screen
// before it is first shown.
function restoreWindowState(saved, { workAreas = [], primary } = {}) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const fullScreen = s.fullScreen === true;
  // Maximizing, then going full screen, before the first show leaves
  // Chromium at its minimum size once full screen ends. Full screen wins.
  let maximized = !fullScreen && s.maximized === true;
  let width = isNum(s.width) && s.width > 0 ? Math.round(s.width) : DEFAULT_SIZE.width;
  let height = isNum(s.height) && s.height > 0 ? Math.round(s.height) : DEFAULT_SIZE.height;

  // The display the window was on is the one holding the centre of its
  // saved rectangle. None (monitor unplugged, layout changed, or no
  // position saved) means the primary, and the saved position is dropped.
  const hasPos = isNum(s.x) && isNum(s.y);
  const home = hasPos ? workAreas.find((a) => contains(a, s.x + width / 2, s.y + height / 2)) : null;
  const area = home || primary || workAreas[0] || { x: 0, y: 0, ...DEFAULT_SIZE };

  width = Math.min(width, area.width);
  height = Math.min(height, area.height);
  let keepPos = !!home;
  if (width >= area.width * FILLS && height >= area.height * FILLS) {
    // A screen-filling size is never handed to the window as its normal
    // size: created at the size it is about to be maximized to, it is drawn
    // offset (above). That covers a 2.2.1 file written while maximized, the
    // default size on a 1080p screen, and a window from a bigger monitor.
    if (!fullScreen) maximized = true;
    width = Math.round(area.width * RESTORE_SHARE);
    height = Math.round(area.height * RESTORE_SHARE);
    keepPos = false;
  }

  const x = keepPos ? clamp(Math.round(s.x), area.x, area.x + area.width - width) : area.x + Math.round((area.width - width) / 2);
  const y = keepPos ? clamp(Math.round(s.y), area.y, area.y + area.height - height) : area.y + Math.round((area.height - height) / 2);
  return { bounds: { x, y, width, height }, maximized, fullScreen };
}

module.exports = { windowStateOf, restoreWindowState, DEFAULT_SIZE };
