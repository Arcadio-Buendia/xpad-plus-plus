// Theme = Style × Appearance (issue #43). The three styles (Paper, Flat,
// Terminal) each get a light and a dark palette, and the appearance is
// Light, Dark, or System — which follows the OS setting. These tests hold
// down the parts that must not drift:
//   - upgraders see no change: a stored style with no appearance resolves to
//     the palette that style always had, value for value;
//   - the token resolution (style + appearance + the OS flag → one palette);
//   - every new palette is readable: text on chrome clears WCAG AA (4.5:1)
//     and the hover still lands a visible step away from the panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(dir, '..', 'utils.jsx'), 'utf8');
const sandbox = { React: {}, window: {}, document: {}, navigator: {}, console, Math, JSON, Date };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const {
  themeTokens, resolveAppearance, migrateTweaks, withDefaults, TWEAK_DEFAULTS,
  hoverBg, isDarkSurface, normHex,
} = sandbox.window;

// Values built inside the vm belong to another realm; compare plain copies.
const plain = (x) => JSON.parse(JSON.stringify(x));

const STYLES = ['paper', 'flat', 'terminal'];
const VARIANTS = STYLES.flatMap((style) => ['light', 'dark'].map((appearance) => ({ style, appearance })));
// The palettes that did not exist before #43. Each style's other one is the
// look it always had.
const NEW_VARIANTS = [
  { style: 'paper', appearance: 'dark' },
  { style: 'flat', appearance: 'dark' },
  { style: 'terminal', appearance: 'light' },
];

/* ---------------- colour plumbing ---------------- */

const channels = (hex) => {
  const h = normHex(hex);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const parseRgba = (s) => {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(s);
  assert.ok(m, `not an rgba() string: ${s}`);
  return { r: +m[1], g: +m[2], b: +m[3], a: +m[4] };
};
const composite = (rgba, bgHex) => {
  const bg = channels(bgHex);
  return [rgba.r, rgba.g, rgba.b].map((v, i) => rgba.a * v + (1 - rgba.a) * bg[i]);
};
const distance = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
// WCAG 2.x relative luminance and contrast ratio.
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const rgb = (c) => (Array.isArray(c) ? c : channels(c));
const ratio = (fg, bg) => contrast(rgb(fg), rgb(bg));
// Every colour stop a wallpaper gradient passes through.
const wallpaperStops = (T) => T.wallpaper.match(/#[0-9a-f]{6}\b/gi);

/* ---------------- upgraders see no change ---------------- */

// The three palettes exactly as they were before #43 (master b03d32b).
const BEFORE = {
  paper: {
    wallpaper: 'linear-gradient(180deg,#efe8dc 0%, #e5dbc8 100%)',
    panelBg: '#fbf7ef', panelBorder: '#d8cfbc', panelText: '#2a241a',
    accent: '#b8621b', muted: '#7a6f5b', hairline: '#e6dfce',
    noteShadow: '0 2px 0 rgba(60,40,20,.05), 0 10px 28px rgba(60,40,20,.14), inset 0 0 0 1px rgba(0,0,0,.04)',
    noteRadius: '2px',
    bodyFont: 'Caveat, "Segoe Script", cursive',
    folderBg: '#f3ead7', folderBorder: '#d8cfbc',
  },
  flat: {
    wallpaper: 'linear-gradient(135deg,#e9edf2 0%, #dde3eb 100%)',
    panelBg: '#ffffff', panelBorder: '#d6dce4', panelText: '#1f2430',
    accent: '#3584e4', muted: '#6a7383', hairline: '#eaeef3',
    noteShadow: '0 1px 2px rgba(20,30,50,.06), 0 6px 20px rgba(20,30,50,.08)',
    noteRadius: '10px',
    bodyFont: 'Inter, system-ui, sans-serif',
    folderBg: '#f3f5f9', folderBorder: '#d6dce4',
  },
  terminal: {
    wallpaper: 'radial-gradient(1200px 800px at 20% 10%, #1b2028 0%, #0e1116 60%, #0a0c10 100%)',
    panelBg: '#141a22', panelBorder: '#2a3340', panelText: '#cfe0d4',
    accent: '#8fd27a', muted: '#7b8a9a', hairline: '#1d2530',
    noteShadow: '0 0 0 1px #2a3340, 0 8px 22px rgba(0,0,0,.5)',
    noteRadius: '4px',
    bodyFont: '"JetBrains Mono", "IBM Plex Mono", monospace',
    folderBg: '#1a2230', folderBorder: '#2f3b4c',
  },
};
const NATIVE = { paper: 'light', flat: 'light', terminal: 'dark' };

for (const style of STYLES) {
  test(`${style}: every token it had before #43 keeps its value in its own appearance`, () => {
    const T = plain(themeTokens(style, NATIVE[style]));
    for (const [key, value] of Object.entries(BEFORE[style])) {
      assert.equal(T[key], value, `${style}/${NATIVE[style]} changed ${key}`);
    }
  });

  test(`${style}: themeTokens with no appearance is still the style's own palette`, () => {
    // Callers that predate the appearance axis (and stores that predate it)
    // keep getting exactly what they always got.
    assert.deepEqual(plain(themeTokens(style)), plain(themeTokens(style, NATIVE[style])));
  });

  test(`${style}: its light and dark palettes carry the same tokens`, () => {
    const light = Object.keys(themeTokens(style, 'light')).sort();
    const dark = Object.keys(themeTokens(style, 'dark')).sort();
    assert.deepEqual(plain(dark), plain(light));
  });
}

test('an unknown style still falls back to Paper, as it always did', () => {
  assert.deepEqual(plain(themeTokens('nonsense')), plain(themeTokens('paper', 'light')));
  assert.deepEqual(plain(themeTokens(undefined, 'dark')), plain(themeTokens('paper', 'dark')));
});

/* ---------------- six real palettes ---------------- */

for (const { style, appearance } of VARIANTS) {
  test(`${style}/${appearance}: the chrome really is ${appearance}`, () => {
    const T = themeTokens(style, appearance);
    const dark = appearance === 'dark';
    assert.equal(isDarkSurface(T.panelBg), dark, `panel ${T.panelBg}`);
    for (const stop of wallpaperStops(T)) {
      assert.equal(isDarkSurface(stop), dark, `wallpaper stop ${stop}`);
    }
  });
}

test('all six variants are told apart by their accent', () => {
  // The accent is the one token every surface carries (focus ring, links,
  // selection), and the e2e suite reads it back through --sticky-accent.
  const accents = VARIANTS.map(({ style, appearance }) => themeTokens(style, appearance).accent.toLowerCase());
  assert.equal(new Set(accents).size, 6, accents.join(' '));
});

/* ---------------- resolution ---------------- */

test('resolveAppearance: Light and Dark ignore the system setting', () => {
  assert.equal(resolveAppearance('light', true), 'light');
  assert.equal(resolveAppearance('light', false), 'light');
  assert.equal(resolveAppearance('dark', true), 'dark');
  assert.equal(resolveAppearance('dark', false), 'dark');
});

test('resolveAppearance: System follows the OS', () => {
  assert.equal(resolveAppearance('system', true), 'dark');
  assert.equal(resolveAppearance('system', false), 'light');
});

test('resolveAppearance: no (or a garbage) appearance means the style decides', () => {
  assert.equal(resolveAppearance(undefined, true), null);
  assert.equal(resolveAppearance('purple', false), null);
  // ...which themeTokens reads as "the style's own palette".
  assert.deepEqual(plain(themeTokens('terminal', resolveAppearance(undefined, false))),
    plain(themeTokens('terminal', 'dark')));
});

/* ---------------- migration ---------------- */

test('migrateTweaks: a store from before #43 keeps the look its style always had', () => {
  assert.equal(migrateTweaks({ theme: 'terminal' }).appearance, 'dark');
  assert.equal(migrateTweaks({ theme: 'paper' }).appearance, 'light');
  assert.equal(migrateTweaks({ theme: 'flat' }).appearance, 'light');
  // Style is untouched, and so is everything else in the tweaks.
  const t = migrateTweaks({ theme: 'terminal', font: 'Caveat', tilt: false });
  assert.deepEqual(plain(t), { theme: 'terminal', font: 'Caveat', tilt: false, appearance: 'dark' });
});

test('migrateTweaks: a chosen appearance — System included — is left alone', () => {
  for (const appearance of ['light', 'dark', 'system']) {
    assert.equal(migrateTweaks({ theme: 'terminal', appearance }).appearance, appearance);
    assert.equal(migrateTweaks({ theme: 'paper', appearance }).appearance, appearance);
  }
});

test('migrateTweaks: an unreadable appearance is replaced, the input is not mutated', () => {
  const src = { theme: 'terminal', appearance: 'sepia' };
  const out = migrateTweaks(src);
  assert.equal(out.appearance, 'dark');
  assert.equal(src.appearance, 'sepia', 'the stored object must not be rewritten in place');
  // No theme at all (or one this build doesn't know) renders as Paper, so
  // it gets Paper's appearance.
  assert.equal(migrateTweaks({}).appearance, 'light');
  assert.equal(migrateTweaks({ theme: 'nonsense' }).appearance, 'light');
});

test('withDefaults migrates on load and on restore — both go through it', () => {
  assert.equal(withDefaults({ tweaks: { theme: 'terminal' } }).tweaks.appearance, 'dark');
  assert.equal(withDefaults({ tweaks: { theme: 'paper' } }).tweaks.appearance, 'light');
  assert.equal(withDefaults({ tweaks: { theme: 'flat', appearance: 'system' } }).tweaks.appearance, 'system');
});

test('a fresh install is Paper + System — it follows the desktop from the first launch', () => {
  const { tweaks } = withDefaults(null);
  assert.equal(tweaks.theme, 'paper');
  assert.equal(tweaks.appearance, 'system');
  assert.equal(TWEAK_DEFAULTS.appearance, 'system');
});

test('the System default never reaches an upgrader: saved tweaks without an appearance keep their look', () => {
  assert.equal(withDefaults({ tweaks: { theme: 'paper' } }).tweaks.appearance, 'light');
  assert.equal(withDefaults({ tweaks: { theme: 'flat' } }).tweaks.appearance, 'light');
  assert.equal(withDefaults({ tweaks: { theme: 'terminal' } }).tweaks.appearance, 'dark');
});

/* ---------------- the new palettes are readable ---------------- */

for (const { style, appearance } of NEW_VARIANTS) {
  const name = `${style}/${appearance}`;
  const T = themeTokens(style, appearance);

  test(`${name}: text on the chrome clears WCAG AA (4.5:1)`, () => {
    const pairs = [
      ['panelText on panelBg', T.panelText, T.panelBg],
      ['muted on panelBg', T.muted, T.panelBg],
      ['danger on panelBg', T.danger, T.panelBg],
      ['accentInk on accent', T.accentInk, T.accent],
      ['panelText on the hover', T.panelText, composite(parseRgba(hoverBg(T)), T.panelBg)],
      ...wallpaperStops(T).flatMap((stop) => [
        // The empty-desk message sits straight on the wallpaper.
        [`panelText on wallpaper ${stop}`, T.panelText, stop],
        [`muted on wallpaper ${stop}`, T.muted, stop],
      ]),
      ...(T.drawerBg ? [
        ['drawerInk on drawerBg', T.drawerInk, T.drawerBg],
        ['panelText on drawerBg', T.panelText, T.drawerBg],
        ['muted on drawerBg', T.muted, T.drawerBg],
      ] : []),
    ];
    for (const [label, fg, bg] of pairs) {
      const r = ratio(fg, bg);
      assert.ok(r >= 4.5, `${name}: ${label} is ${r.toFixed(2)}:1`);
    }
  });

  test(`${name}: the accent reads as a control against the panel (3:1)`, () => {
    // Focus rings, link arrows, the selected-note outline: non-text UI,
    // WCAG 1.4.11.
    const r = ratio(T.accent, T.panelBg);
    assert.ok(r >= 3, `${name}: accent on panelBg is ${r.toFixed(2)}:1`);
  });

  test(`${name}: the hover is a visible step away from the panel`, () => {
    // Same bar tests/hover.test.mjs holds the original three to (#49).
    const rest = channels(T.panelBg);
    const hover = composite(parseRgba(hoverBg(T)), T.panelBg);
    assert.ok(distance(rest, hover) > 45,
      `${name}: hover ${hover.map(Math.round)} is only ${distance(rest, hover).toFixed(1)} away from ${rest}`);
    const toward = lum(hover) - lum(rest);
    if (appearance === 'dark') assert.ok(toward > 0, `${name}: a hover on a dark panel must get lighter`);
    else assert.ok(toward < 0, `${name}: a hover on a light panel must get darker`);
  });
}
