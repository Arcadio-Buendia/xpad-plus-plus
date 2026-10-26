# End-to-end tests

Real-DOM tests that launch the actual Electron app and drive it over the
Chrome DevTools Protocol (raw WebSocket, no test framework dependencies).

## Run

```sh
npm ci          # once; electron is the only real dependency
npm run test:e2e
```

Plain `npm test` stays fast and node-only — the e2e suite is deliberately
not wired into it or into CI: it needs a display to launch the Electron GUI
(a headless CI runner would need Xvfb plus a GPU-less Chromium config, which
isn't worth the flake risk for this project).

## How it works

`harness.mjs` per test file:

1. creates a fresh temp dir under `os.tmpdir()` and writes a seeded
   `notes.json` (the app's whole persisted store: `{ tweaks, folders, notes,
   links, cwd, view, drawer, folderOrder }`; notes carry
   `id/folder/title/body/color/x/y/w/h/z/pinned` in world coordinates), a
   `window.json` forcing a known 1400x900 window (`windowJson` replaces
   it), and any extra `files` the test seeds (e.g. `images/<hash>.png` for
   the sticky-image tests);
2. launches `./node_modules/.bin/electron . --remote-debugging-port=<free port>`
   with `STICKY_USER_DATA` pointing at that temp dir;
3. polls `http://127.0.0.1:<port>/json` until the page target appears,
   connects a WebSocket CDP client, and waits until every seeded note has
   rendered;
4. returns drivers: `evaljs` (Runtime.evaluate), `click`/`dblclick`/`drag`
   (Input.dispatchMouseEvent), `type` (Input.insertText), `press`
   (Input.dispatchKeyEvent, `press('a', {ctrl:true})` for chords),
   `focusWindow` (Page.bringToFront + wait for `document.hasFocus()` —
   required before any menu accelerator, which the browser process only
   dispatches to the active window), `noteBodyRect`, `screenshot`, and
   `close`. With `inspectMain: true` Electron also gets `--inspect=<free
   port>`, and two more drivers reach the main process: `evalMain`
   (Runtime.evaluate on the node inspector, `require` available) and
   `quit` (closes the window the way the user does, so the app's own
   shutdown runs, and waits for Electron to exit; `userData` stays until
   `close()`).

`close()` runs in an `after` hook even on failure: it kills only the
Electron process group it spawned (tracked child PID — never a pkill) and
removes the temp dir. Every wait in the suite is a bounded poll
(`pollUntil`), never a bare sleep used as an assertion.

## The STICKY_USER_DATA contract

`main.js` contains one tiny test hook, guarded and run before app-ready:

```js
if (process.env.STICKY_USER_DATA) {
  app.setPath('userData', process.env.STICKY_USER_DATA);
}
```

When set, ALL app data (notes.json, window.json, Chromium profile) lives
under that directory, so tests can seed known notes at known positions and
can never touch real user notes. Unset, the app behaves exactly as before.

## Scenarios

- `markdown-render.e2e.mjs` — rendered `.md-body` DOM: heading shift
  (###→h5, ####→h6), `ol > li` + nested ol, blockquote, table, `pre > code`
  fences, `javascript:` links stay inert text, bare `www.` URLs linkify; the
  editor wraps at exactly the preview's width (no body-box scrollbar while
  editing). Then the markdown *import* (issue #44): the desk context menu offers
  "Import markdown file…" next to "New note here", and handing the canvas's
  `onImportMarkdown` the payload the main process returns for two chosen
  files makes one note per file — filename as the title, contents as the
  body (BOM dropped, CRLF normalised), cascaded like a paste, rendering as
  markdown, and removed as a whole by a single Ctrl+Z. The picker itself is
  a native dialog no test can drive, so it is never clicked here — the file
  reading behind it is `readMarkdownFile` in `tests/storage.test.mjs`, and
  the dialog needs the manual flatpak pass below. Last, the note from issue
  #63 typed into the empty note's editor: every `---` (even right under a
  line of text) renders as a divider, nothing becomes a heading, and each
  rendered line starts exactly where its editor line did.
- `mermaid.e2e.mjs` — a valid mermaid fence becomes an SVG (async, polled);
  a garbage fence fails soft (code block stays, no svg, app still alive),
  including across an edit-mode round trip.
- `selection.e2e.mjs` — text-selection drags with boundary-snap outcomes:
  exit right/below stays forward to note end (the below-bottom flip is the
  guarded regression), exit left goes backward to line start, dragging onto
  another note selects nothing from it, double-click opens the editor and
  Escape closes it.
- `images.e2e.mjs` — a PNG seeded into `<userData>/images/` under its
  content-hash name loads through the `sticky-image://` protocol (the
  rendered `<img>`'s naturalWidth goes above 0); a traversal-shaped
  reference renders no `<img>` and stays literal text. Then drag-and-drop
  (`Input.dispatchDragEvent` carrying a real file path in `data.files`,
  which is how Chromium itself delivers a file-manager drop): dropping a
  PNG on a note stores it under `<userData>/images/` and appends the
  reference on its own line, dropping a `.txt` changes nothing, and
  dropping onto an open editor inserts at the caret. Then bundled images
  (#38): `stickyAPI.readImages` returns the base64 behind a reference and
  refuses traversal/unknown names, `stickyAPI.writeImages` stores a picture
  that arrived only as base64 (the protocol then serves it) but refuses
  bytes that don't hash to the name they claim, and a full Ctrl+C → delete
  the file → Ctrl+V round trip puts the picture back on disk. That last one
  uses the REAL system clipboard (nothing else can test that path), so a
  run replaces whatever you had copied.
- `note-paste.e2e.mjs` — the note context menu's "Paste" (#59), right
  after "Copy": greyed out while the clipboard holds nothing; text pasted
  into a note nobody is editing goes at the end on its own line, and one
  Ctrl+Z takes it back; pasted while editing (menu opened from the header,
  which closes the editor first) it replaces the selection, the editor is
  open again with the caret after it, and the editor's own Ctrl+Z undoes
  it; 20 lines pasted deep in a long note leave the caret in view (the
  execCommand insert, unlike a keyboard paste, doesn't scroll to it on its
  own); a URL pasted over a selected word becomes a link, as with Ctrl+V; a
  picture is stored under `<userData>/images/` and referenced; copied
  notes paste as new notes (one Ctrl+Z removes them), not as text in the
  body. Uses the REAL system clipboard, so a run replaces whatever you had
  copied.
- `editing.e2e.mjs` — editor keystrokes against the real textarea: Enter
  continues ordered lists ("1. x" → "2. "), Tab renumbers-to-1 while
  nesting ("2. y" → "   1. y"), Enter continues blockquotes ("> q" → "> "),
  and the typed body renders correctly after leaving edit mode. Then the
  hidden menu bar (#42): the window carries no menu chrome
  (`innerHeight === outerHeight` — a visible bar costs ~29px), Ctrl+A/C/V/X
  still edit note text, and Ctrl+, still opens Preferences, which only the
  menu's accelerator can do in the Electron build. Alt-summons-the-bar is
  left to manual checking: a synthetic Alt over CDP lands in the menu bar's
  own key handling about a third of the time and steals the keyboard.
- `frontmatter.e2e.mjs` — YAML frontmatter on a downloaded note (#40): a
  note made from the desk menu is stored with `created` and `updated`,
  typing into it moves `updated` but never `created`, and a seeded note
  from before timestamps gains `updated` on its first edit but no invented
  `created`. Then the note menu's "Download": the page's
  `downloadNoteAsMarkdown` is swapped for a recorder just before the native
  save dialog, and the file it would have written opens with the note's
  frontmatter (a title YAML has to quote, both timestamps, the colour) and
  then the body, whose own leading `---` rule survives. Handing that file
  to `onImportMarkdown` gives the note back: title, colour and timestamps
  from the frontmatter, and a body without it.
- `theme.e2e.mjs` — Style × Appearance (#43) through the real Preferences
  panel: a Paper store saved before appearances existed opens as Paper +
  Light even with the OS in dark mode; Appearance → Dark repaints the chrome
  (the notes keep their pastel paper) and is saved to `notes.json`; switching
  Style keeps the chosen Appearance; and System follows
  `prefers-color-scheme` live — flipped with `Emulation.setEmulatedMedia`,
  no click in between. A Terminal store from before #43 opens Terminal +
  Dark. On a real desktop that media feature is driven by the settings
  portal (`org.freedesktop.appearance color-scheme`), which needs a human
  flipping the desktop's dark-style switch to see end to end.
- `space-pan.e2e.mjs` — Space-to-pan versus the focused control (#54):
  after clicking fit, a space-drag pan and the Space release leave the view
  where the pan put it (the button keeps focus and its focus ring); a held
  Space with no drag clicks nothing; every toolbar, zoom-bar, drawer and
  note button sits through a pan from bare desk and from a note body
  without firing; Enter still activates a focused button; Space still types
  in the editor and the search box; a held Space doesn't scroll the note
  body last clicked. A held key is sent the way a keyboard sends it — one
  keyDown, then `autoRepeat: true` keyDowns, then the keyUp. A lone
  keyDown/keyUp pair never reproduced the bug: only the repeats leaked.
- `pwa.e2e.mjs` — the web build as an installed app (#60), so not the
  desktop app: the repo is served over http under `/StickyNotesCanvas/`
  (the GitHub Pages path) and opened in a bare Electron window with no
  preload — what a browser tab sees. `sw.js` registers with the app's scope
  and takes control; with the server stopped, a reload still renders a
  seeded note, its mermaid diagram and its font, all from the cache; a
  changed `index.html` reaches the next online load and then becomes the
  offline copy; a changed `sw.js` takes over and deletes the old cache; and
  the `theme-color` the installed window paints its title bar with follows
  the theme. Chrome's install UI is out of reach from here — see the last
  section.
- `window-state.e2e.mjs` — `window.json` across launches (#62): quitting in
  full screen saves the normal size plus a `fullScreen` flag, such a file
  reopens full screen and leaving it gives the saved size back, and a file
  2.2.1 wrote while maximized (the maximized size, no flag) gets a real,
  smaller normal size. Xvfb has no window manager, so `maximize()` is a
  no-op there and the maximized round trip — and what the compositor makes
  of it, which is what #62 was about — is a manual check on a real desktop:
  maximize, quit, reopen; it must come back maximized, edge to edge, title
  bar below the top bar, and un-maximize to the size it had before.
- `tasks.e2e.mjs` — task lists (#65): `- [ ]` / `- [x]` items render as
  checkboxes (a fenced one stays code) that are exactly one line tall;
  clicking one ticks that item — and only that one, among identical texts —
  in the body on disk without opening the editor, selecting text, moving
  the note or taking focus; a press dragged off a box does nothing; Ctrl+Z
  unticks; a double-click is two toggles, never an edit; the tick survives
  a reload; double-clicking a task's text still puts the caret on that
  word; Enter in the editor continues a task item with `- [ ] `.

## Verifying inside the flatpak (pre-release)

Some failures only exist in the flatpak sandbox and cannot be reproduced by
this suite, which drives plain Electron. Image pasting was one: the `File`
object a paste event carries is backed by a Chromium temp file the renderer
cannot read there, so `arrayBuffer()` rejected with `NotFoundError` and the
paste silently did nothing, while every test here passed. (Fixed by reading
the image in the main process — `images:save-clipboard`.)

Recipe, run before publishing a release that touches clipboard, files, or
dialogs:

```sh
# 1. build from the working tree: copy the Flathub manifest, replace the
#    git source with `- type: dir` / `path: /home/farid/open_source/sticky-notes`
flatpak-builder --user --force-clean --install --disable-rofiles-fuse \
  build-dir io.github.faridjaff.StickyNotesCanvas.yaml

# 2. run it on a throwaway profile, with CDP reachable
#    (--share=network is needed for the debug port; --disable-gpu avoids a
#    GPU init crash under that flag; STICKY_USER_DATA keeps real notes safe)
V=~/.var/app/io.github.faridjaff.StickyNotesCanvas/config/verify
flatpak run --user --share=network --env=STICKY_USER_DATA=$V \
  io.github.faridjaff.StickyNotesCanvas --remote-debugging-port=9229 --disable-gpu

# 3. drive it over CDP exactly like harness.mjs does, then
flatpak uninstall --user -y io.github.faridjaff.StickyNotesCanvas && rm -rf $V
```

Note that a real `Ctrl+V` (`Input.dispatchKeyEvent` with `modifiers: 2`) is
the only way to test a paste: synthetic paste events cannot carry files.

What to check there for the file routes into a note:

- **drag-and-drop** — the app has no filesystem permission (`finish-args`
  is ipc + wayland/x11 + dri, nothing else), so a dropped file is only
  readable when the drop hands over a document-portal path
  (`/run/user/<uid>/doc/…`) instead of a raw host path. Both the path
  route (`webUtils.getPathForFile` → `images:save-file`, read in main) and
  the renderer-bytes fallback fail on a raw host path — there is nothing
  the app can do about that one, so this is the thing to confirm with a
  real drag out of the file manager. `Input.dispatchDragEvent` with
  `data.files` set to a path from `flatpak document-export --app=<id>
  --allow-read <file>` exercises the portal case over CDP.
- **"Insert image…"** — goes through the file-chooser portal, which needs a
  human; the dialog itself cannot be driven headlessly. Everything after it
  is `stickyAPI.saveImageFile(path)`, which can be called straight from CDP.
- **"Import markdown file…"** (desk context menu) — the same file-chooser
  portal, so the same human. Pick one `.md` and confirm a note appears with
  the filename as its title and the file's text as its body; pick several at
  once and confirm one note per file. The file is read in main
  (`notes:import-markdown` → `readMarkdownFile`) precisely because the
  portal grants it to that process; a renderer-side read would fail here the
  way image pasting used to. Worth one round trip in both directions: a
  note's "Download", then importing the file it wrote back — the file opens
  with YAML frontmatter (#40), and the imported note takes its title,
  colour and timestamps from that rather than from the filename.

## What only a human can check: backup files (#38)

File → **Save backup…** and **Restore backup…** each open a native
save/open dialog, and there is no way to drive those from CDP — so the
suite covers everything underneath them (`collectImages` / `writeImages` in
`tests/backup.test.mjs`, the `images:read` / `images:write` IPC and the
protocol in `images.e2e.mjs`) and stops at the dialog. Confirm the ends by
hand before releasing a change to this flow:

1. paste or drop a picture into a note, then File → Save backup…; the JSON
   has a top-level `images` object holding the referenced `<hash>.<ext>`
   files as base64, and nothing else about the file has changed;
2. on a clean profile (`STICKY_USER_DATA=$(mktemp -d)`), File → Restore
   backup… that file: the note renders its picture, and the bytes are back
   under `<userData>/images/`;
3. restore a backup written by 2.1.0 or earlier (no `images` key): it
   restores exactly as it always did, no error;
4. open a new backup in an older build: the notes restore, the pictures are
   simply missing (`withDefaults` drops the unknown key).

## What only a human can check: installing the web app (#60)

`pwa.e2e.mjs` proves the service worker and the offline cache, but the
install itself is Chrome UI. Serve the repo at the GitHub Pages path and
open it in Chrome (localhost counts as secure, so no https needed) — from
the repo root:

```sh
mkdir -p /tmp/pwa-www && ln -sfn "$PWD" /tmp/pwa-www/StickyNotesCanvas
python3 -m http.server 8060 --bind 127.0.0.1 -d /tmp/pwa-www
# then open http://127.0.0.1:8060/StickyNotesCanvas/
```

1. DevTools → Application → Manifest shows the name, the icons (including
   the maskable ones) and no errors or installability warnings;
2. the install icon at the right end of the address bar installs it; the app
   opens in its own window and lands in the launcher;
3. Preferences → Terminal: the window's title bar turns dark with the top bar;
4. stop the server and reopen the app: the notes, fonts and diagrams are all
   there;
5. on a Chromebook, the same at <https://faridjaff.github.io/StickyNotesCanvas/>
   once it is deployed, and the launcher and shelf show the round, full-bleed
   (maskable) icon.
