// The web build as an installed app (#60). Served over http from the same
// /StickyNotesCanvas/ subpath GitHub Pages uses, the page registers sw.js,
// which takes control, keeps the app opening with the server gone, and still
// lets a deploy reach the next online load instead of pinning the old files.
//
// Electron stands in for the browser — it's the one Chromium this suite can
// count on — as a bare BrowserWindow with no preload, so the page sees what
// a browser tab sees: an http:// origin and no window.stickyAPI. Chrome's own
// install UI isn't reachable from here; that check is manual (README.md).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pollUntil } from './harness.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON = path.join(APP_ROOT, 'node_modules', '.bin', 'electron');
const BASE = '/StickyNotesCanvas/';

const TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.jsx': 'text/jsx',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2',
};

// The repo under /StickyNotesCanvas/, like GitHub Pages. `overrides` swaps a
// file's contents (a deploy); stop()/start() take the site away and bring it
// back on the same port. Cache-Control: no-cache keeps the browser's HTTP
// cache out of the way, so what's under test is the service worker alone.
function pagesServer() {
  const overrides = new Map();
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const rel = pathname.startsWith(BASE) ? (decodeURIComponent(pathname.slice(BASE.length)) || 'index.html') : null;
    const file = rel && path.join(APP_ROOT, rel);
    let body = null;
    if (rel && overrides.has(rel)) body = overrides.get(rel);
    else if (file && file.startsWith(APP_ROOT + path.sep) && fs.statSync(file, { throwIfNoEntry: false })?.isFile()) body = fs.readFileSync(file);
    if (body == null) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  let port = 0;
  return {
    overrides,
    url: (rel = '') => `http://127.0.0.1:${port}${BASE}${rel}`,
    start: () => new Promise((resolve, reject) => {
      if (server.listening) { resolve(); return; }
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { port = server.address().port; resolve(); });
    }),
    stop: () => new Promise((resolve) => {
      if (!server.listening) { resolve(); return; }
      server.close(() => resolve());
      for (const s of sockets) s.destroy();
    }),
  };
}

// A bare browser window: no preload, its own throwaway profile.
const BROWSER_MAIN = `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.PWA_PROFILE);
app.whenReady().then(() => {
  new BrowserWindow({ width: 1200, height: 800 }).loadURL(process.env.PWA_URL);
});
`;

// Seeded before the app first runs. Terminal theme, so the window colour has
// to move off the manifest's default, and its monospace body font has to come
// out of the cache offline; the mermaid fence needs vendor/mermaid.min.js.
const NOTE_ID = 'pwa-note';
const SEED = {
  tweaks: { theme: 'terminal', font: 'Inter', density: 'cozy', showLinks: true, tilt: false, hideNoteTitles: false },
  folders: {
    root: { id: 'root', name: 'All notes', parent: null, hue: '#888' },
    pwa: { id: 'pwa', name: 'PWA', parent: 'root', hue: '#5a82c9' },
  },
  notes: [{ id: NOTE_ID, folder: 'pwa', title: 'Offline', body: 'still here\n\n```mermaid\ngraph TD;\nA-->B;\n```',
    color: 'yellow', x: 40, y: 40, w: 360, h: 300, z: 1, pinned: false }],
  links: [], cwd: 'root', view: { x: 0, y: 0, z: 1 }, drawer: false, folderOrder: ['pwa'],
};

let site, child, tmp, ws, cmd;
let exited = false;
const killTree = (signal) => { try { process.kill(-child.pid, signal); } catch {} };
const emergency = () => killTree('SIGKILL');

const evaljs = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`evaluate threw: ${r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)}`);
  return r.result?.value;
};
// Polled evaluation that rides out the moment a navigation swaps documents.
const waitFor = (expr, label, timeout = 30000) =>
  pollUntil(() => evaljs(expr).catch(() => false), { timeout, interval: 200, label });

// The app is up in a NEW document: the reload marker is gone and the seeded
// note rendered, which takes React, Babel and every .jsx file.
const appReady = `!window.__pwaOld && !!document.querySelector('[data-note-id="${NOTE_ID}"] .md-body')?.textContent.includes('still here')`;
async function reload(label) {
  await evaljs('window.__pwaOld = true');
  await cmd('Page.reload');
  await waitFor(appReady, label);
}

before(async () => {
  site = pagesServer();
  await site.start();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sticky-pwa-'));
  fs.writeFileSync(path.join(tmp, 'main.js'), BROWSER_MAIN);

  const port = await new Promise((resolve, reject) => {
    const srv = http.createServer().listen(0, '127.0.0.1', () => {
      const { port: p } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(p)));
    });
  });
  // First stop: a same-origin page that isn't the app, to seed localStorage
  // before the app ever runs (it would otherwise write its sample notes).
  child = spawn(ELECTRON, [path.join(tmp, 'main.js'), `--remote-debugging-port=${port}`], {
    env: { ...process.env, PWA_PROFILE: path.join(tmp, 'profile'), PWA_URL: site.url('manifest.webmanifest') },
    stdio: 'ignore',
    detached: true,
  });
  child.on('exit', () => { exited = true; });
  process.on('exit', emergency);

  const page = await pollUntil(async () => {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      return list.find((t) => t.type === 'page' && t.url.startsWith(site.url())) || null;
    } catch { return null; }
  }, { timeout: 15000, interval: 200, label: 'CDP page target' });
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('CDP WebSocket failed to connect'));
  });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(`CDP ${m.error.message || JSON.stringify(m.error)}`));
      else resolve(m.result);
    }
  };
  cmd = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await cmd('Runtime.enable');
  await cmd('Page.enable');

  await waitFor(`document.readyState === 'complete' && location.pathname.endsWith('manifest.webmanifest')`, 'the seeding page');
  await evaljs(`localStorage.setItem('stickies.all', ${JSON.stringify(JSON.stringify(SEED))}), 1`);
  await cmd('Page.navigate', { url: site.url() });
  await waitFor(appReady, 'the app to render the seeded note');
});

after(async () => {
  try { if (ws && ws.readyState === 1) ws.close(); } catch {}
  if (child) {
    killTree('SIGTERM');
    try { await pollUntil(() => exited, { timeout: 3000, interval: 50, label: 'electron exit' }); }
    catch { killTree('SIGKILL'); }
  }
  process.removeListener('exit', emergency);
  if (site) await site.stop();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('the page registers sw.js, scoped to the app, and it takes control', async () => {
  const sw = await waitFor(`(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const c = navigator.serviceWorker.controller;
    return reg && c && c.state === 'activated' && { scope: reg.scope, script: c.scriptURL };
  })()`, 'a service worker controlling the page');
  assert.equal(sw.scope, site.url());
  assert.equal(sw.script, site.url('sw.js'));
});

test('the window colour follows the theme: the title bar matches the top bar', async () => {
  assert.equal(await evaljs(`document.querySelector('meta[name="theme-color"]').content`), '#141a22',
    "the terminal theme's top bar");
});

test('with the server gone, a reload still opens the app: notes, fonts, diagrams', async () => {
  await site.stop();
  try {
    await reload('the app to open offline');
    await waitFor(`!!document.querySelector('[data-note-id="${NOTE_ID}"] .md-body .mermaid-diagram svg')`,
      'the mermaid diagram offline');
    const font = await waitFor(`document.fonts.ready.then(() =>
      [...document.fonts].filter(f => f.family.includes('JetBrains Mono') && f.status !== 'unloaded').map(f => f.status))`,
    'the note font to settle');
    assert.ok(font.length && font.every(s => s === 'loaded'), `JetBrains Mono came from the cache, got ${font}`);
  } finally {
    await site.start();
  }
});

test('a deploy reaches the next online load, and becomes the offline copy', async () => {
  site.overrides.set('index.html', fs.readFileSync(path.join(APP_ROOT, 'index.html'), 'utf8')
    .replace('<head>', '<head>\n<meta name="e2e-deploy" content="2">'));
  try {
    await reload('the app after a deploy');
    assert.equal(await evaljs(`!!document.querySelector('meta[name="e2e-deploy"]')`), true,
      'online, the new index.html is served, not the cached one');
    await site.stop();
    await reload('the app offline after a deploy');
    assert.equal(await evaljs(`!!document.querySelector('meta[name="e2e-deploy"]')`), true,
      'offline, the cache holds the new version');
  } finally {
    site.overrides.delete('index.html');
    await site.start();
  }
});

test('a changed sw.js takes over and deletes the old cache', async () => {
  const code = fs.readFileSync(path.join(APP_ROOT, 'sw.js'), 'utf8');
  const old = code.match(/const CACHE = '([^']+)'/)?.[1];
  assert.ok(old, "sw.js names its cache as const CACHE = '…'");
  const next = `${old}-e2e`;
  site.overrides.set('sw.js', code.replace(`const CACHE = '${old}'`, `const CACHE = '${next}'`));
  try {
    await reload('the app with a new sw.js deployed');
    const keys = await waitFor(`caches.keys().then(k => k.length === 1 && k[0] === ${JSON.stringify(next)} && k)`,
      'the new cache to replace the old one');
    assert.deepEqual(keys, [next]);
  } finally {
    site.overrides.delete('sw.js');
  }
});
