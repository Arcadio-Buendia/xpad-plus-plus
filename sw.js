// Service worker for the web build (GitHub Pages): together with
// manifest.webmanifest it makes the page installable as an app and lets that
// app open with no network (#60). The desktop app never registers it — see
// the guard at the bottom of index.html.
//
// Network first, cache as the fallback. Online, every file comes from the
// server just as it would with no service worker, so a deploy reaches users
// on their next load and nobody is left running an old version; each
// response also refreshes the cache. Offline, the cached copy answers.
// (Cache-first would load faster on a slow connection, but with no build
// step to fingerprint file names it would serve the old files until someone
// remembered to bump CACHE.)
//
// PRECACHE is the app shell, fetched at install so the first offline launch
// works even for files the page hadn't needed yet, like most of the fonts.
// Every file index.html loads must be listed, and the manifest's icons:
// tests/pwa.test.mjs checks.
//
// Bumping CACHE is only needed to drop files that left the list: activate
// deletes every other sticky-notes-* cache.
const CACHE = 'sticky-notes-v1';
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'pwa/icon-192.png',
  'pwa/icon-512.png',
  'pwa/icon-maskable-192.png',
  'pwa/icon-maskable-512.png',
  'utils.jsx',
  'hooks.jsx',
  'components.jsx',
  'app.jsx',
  'vendor/react.production.min.js',
  'vendor/react-dom.production.min.js',
  'vendor/babel.min.js',
  'vendor/markdown-it.min.js',
  'vendor/mermaid.min.js',
  'assets/favicon.png',
  'assets/pin-filled.png',
  'assets/fonts/caveat-400.woff2',
  'assets/fonts/caveat-600.woff2',
  'assets/fonts/caveat-700.woff2',
  'assets/fonts/ibm-plex-mono-400.woff2',
  'assets/fonts/ibm-plex-mono-500.woff2',
  'assets/fonts/ibm-plex-mono-600.woff2',
  'assets/fonts/inter-400.woff2',
  'assets/fonts/inter-500.woff2',
  'assets/fonts/inter-600.woff2',
  'assets/fonts/inter-700.woff2',
  'assets/fonts/jetbrains-mono-400.woff2',
  'assets/fonts/jetbrains-mono-500.woff2',
  'assets/fonts/jetbrains-mono-700.woff2',
  'assets/fonts/source-serif-4-400.woff2',
  'assets/fonts/source-serif-4-500.woff2',
  'assets/fonts/source-serif-4-600.woff2',
];

// The same files as absolute URLs. Only these are handled; every other
// request (other sites, other files on this one) goes to the network as if
// there were no service worker.
const SHELL = new Set(PRECACHE.map(p => new URL(p, self.location).href));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      // Take over straight away: the old worker serves the same files the
      // same way, so there is nothing for open pages to wait for.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith('sticky-notes-') && k !== CACHE)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  url.search = '';
  url.hash = '';
  const key = url.href;
  if (!SHELL.has(key)) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.status === 200) {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE).then(cache => cache.put(key, copy)));
        }
        return res;
      })
      .catch(() => caches.match(key, { cacheName: CACHE }).then(hit => hit || Response.error()))
  );
});
