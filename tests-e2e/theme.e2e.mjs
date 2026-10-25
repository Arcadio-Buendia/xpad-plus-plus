// Style × Appearance (issue #43), driven through the real Preferences panel
// and the real prefers-color-scheme signal. The palettes themselves (values,
// contrast, migration rules) are unit-tested in tests/theme.test.mjs; what
// needs a window is that the choice actually repaints the app, is saved, and
// that System tracks the OS while the app is running — which is emulated
// here with Emulation.setEmulatedMedia, the same media feature GNOME's
// light/dark switch drives through the settings portal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, NOTE } from './harness.mjs';

const emulateOS = (app, scheme) => app.cmd('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-color-scheme', value: scheme }],
});

// What the app is painting right now, read back from the DOM.
const painted = (app) => app.evaljs(`(() => {
  const luma = (css) => {
    const [r, g, b] = css.match(/\\d+(\\.\\d+)?/g).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  const prefs = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'preferences');
  const chrome = getComputedStyle(prefs.parentElement).backgroundColor;   // the status bar
  const note = getComputedStyle(document.querySelector('[data-note-id="${NOTE.plain}"]')).backgroundColor;
  return {
    accent: document.documentElement.style.getPropertyValue('--sticky-accent'),
    chromeDark: luma(chrome) < 0.5,
    note,
    noteLight: luma(note) > 0.7,
  };
})()`);

// The accent a variant should carry, asked of the app's own tokens.
const accentOf = (app, style, appearance) =>
  app.evaljs(`themeTokens(${JSON.stringify(style)}, ${JSON.stringify(appearance)}).accent`);

const waitFor = async (app, style, appearance) => {
  const want = await accentOf(app, style, appearance);
  return app.pollUntil(async () => {
    const p = await painted(app);
    return p.accent === want ? p : null;
  }, { timeout: 3000, interval: 50, label: `${style}/${appearance} to be painted` });
};

const centreOf = (app, text) => app.evaljs(`(() => {
  const el = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(text)});
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
})()`);

const clickButton = async (app, text) => {
  const at = await app.pollUntil(() => centreOf(app, text),
    { timeout: 3000, interval: 50, label: `a "${text}" button` });
  await app.click(at.x, at.y);
};

const openPrefs = async (app) => {
  if (await centreOf(app, 'System')) return;
  await clickButton(app, 'preferences');
  await app.pollUntil(() => centreOf(app, 'System'),
    { timeout: 3000, interval: 50, label: 'the Preferences panel' });
};

const pressed = (app) => app.evaljs(`[...document.querySelectorAll('button[aria-pressed="true"]')]
  .map(b => b.textContent.trim()).filter(t => /^(Paper|Flat|Terminal|Light|Dark|System)$/.test(t))`);

// The store as written to disk (saves are debounced by 500ms).
const savedTweaks = (app, want) => app.pollUntil(() => {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(app.userData, 'notes.json'), 'utf8')).tweaks;
    return Object.entries(want).every(([k, v]) => t[k] === v) ? t : null;
  } catch { return null; }
}, { timeout: 4000, interval: 100, label: `notes.json tweaks to hold ${JSON.stringify(want)}` });

/* ---------- one profile, walked through the choices in order ---------- */

let app;
before(async () => {
  // The default harness seed is a Paper store saved before appearances
  // existed: tweaks.theme only.
  app = await launch();
  // An OS in dark mode from the start, so "Light" below is proven to be an
  // explicit choice rather than an accident of the machine running the test.
  await emulateOS(app, 'dark');
});
after(async () => { if (app) await app.close(); });

test('a Paper store from before #43 opens exactly as before: Paper + Light', async () => {
  const p = await waitFor(app, 'paper', 'light');
  assert.equal(p.chromeDark, false, 'the chrome must stay light even with the OS in dark mode');
  assert.equal(p.noteLight, true);
  await openPrefs(app);
  assert.deepEqual(await pressed(app), ['Paper', 'Light']);
  await savedTweaks(app, { theme: 'paper', appearance: 'light' });
});

let pastelNote;
test('Appearance → Dark repaints the chrome; the notes stay pastel; the choice is saved', async () => {
  pastelNote = (await painted(app)).note;
  await clickButton(app, 'Dark');
  const p = await waitFor(app, 'paper', 'dark');
  assert.equal(p.chromeDark, true, 'the status bar must have gone dark');
  assert.equal(p.note, pastelNote, 'note paper is the same colour in both appearances');
  assert.deepEqual(await pressed(app), ['Paper', 'Dark']);
  await savedTweaks(app, { theme: 'paper', appearance: 'dark' });
});

test('switching Style keeps the chosen Appearance', async () => {
  await clickButton(app, 'Flat');
  assert.equal((await waitFor(app, 'flat', 'dark')).chromeDark, true);
  await clickButton(app, 'Terminal');
  const term = await waitFor(app, 'terminal', 'dark');
  assert.equal(term.chromeDark, true);
  assert.equal(term.noteLight, true, 'terminal notes are pastel too');
  assert.deepEqual(await pressed(app), ['Terminal', 'Dark']);

  // ...and the reverse: Light on Terminal is the new light terminal palette.
  await clickButton(app, 'Light');
  const light = await waitFor(app, 'terminal', 'light');
  assert.equal(light.chromeDark, false);
  assert.deepEqual(await pressed(app), ['Terminal', 'Light']);
  await savedTweaks(app, { theme: 'terminal', appearance: 'light' });
});

test('System follows the OS setting live — no click after the OS flips', async () => {
  await emulateOS(app, 'light');
  await clickButton(app, 'System');
  assert.equal((await waitFor(app, 'terminal', 'light')).chromeDark, false);
  assert.deepEqual(await pressed(app), ['Terminal', 'System']);
  await savedTweaks(app, { theme: 'terminal', appearance: 'system' });

  // The user switches their desktop to dark while the app is open.
  await emulateOS(app, 'dark');
  const dark = await waitFor(app, 'terminal', 'dark');
  assert.equal(dark.chromeDark, true, 'the app must follow the OS into dark mode');
  assert.equal(dark.noteLight, true);

  // ...and back.
  await emulateOS(app, 'light');
  assert.equal((await waitFor(app, 'terminal', 'light')).chromeDark, false);

  // Following the OS is not a stored choice of light or dark: the saved
  // appearance is still System, and the selector still says so.
  assert.deepEqual(await pressed(app), ['Terminal', 'System']);
  await savedTweaks(app, { theme: 'terminal', appearance: 'system' });
});

test('the Style buttons follow System too', async () => {
  await emulateOS(app, 'dark');
  await waitFor(app, 'terminal', 'dark');
  await clickButton(app, 'Paper');
  assert.equal((await waitFor(app, 'paper', 'dark')).chromeDark, true);
  await emulateOS(app, 'light');
  assert.equal((await waitFor(app, 'paper', 'light')).chromeDark, false);
});

/* ---------- upgrade from a dark (Terminal) store ---------- */

test('a Terminal store from before #43 opens dark: Terminal + Dark, saved as such', async () => {
  const seeded = await launch({
    seed: {
      tweaks: { theme: 'terminal', font: 'Inter', density: 'cozy', showLinks: true, tilt: false, hideNoteTitles: false },
      folders: {
        root: { id: 'root', name: 'All notes', parent: null, hue: '#888' },
        e2e: { id: 'e2e', name: 'E2E', parent: 'root', hue: '#5a82c9' },
      },
      notes: [{ id: NOTE.plain, folder: 'e2e', title: 'Plain', body: 'terminal upgrader',
        color: 'yellow', x: 40, y: 40, w: 300, h: 180, z: 1, pinned: false }],
      links: [], cwd: 'root', view: { x: 0, y: 0, z: 1 }, drawer: false, folderOrder: ['e2e'],
    },
  });
  try {
    // A light OS: the dark look must come from the migration, not from System.
    await emulateOS(seeded, 'light');
    const p = await waitFor(seeded, 'terminal', 'dark');
    assert.equal(p.chromeDark, true);
    await openPrefs(seeded);
    assert.deepEqual(await pressed(seeded), ['Terminal', 'Dark']);
    await savedTweaks(seeded, { theme: 'terminal', appearance: 'dark' });
  } finally {
    await seeded.close();
  }
});
