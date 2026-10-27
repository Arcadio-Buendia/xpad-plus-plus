# xpad++

Xpad-style sticky notes on a transparent desktop canvas, built for Linux and GNOME.
Keep your notes over your desktop, put them where you want, and find them in the
same place next time.

Built from [StickyNotesCanvas](https://github.com/faridjaff/StickyNotesCanvas) by
[faridjaff](https://github.com/faridjaff). Thank you for the original Electron app,
canvas foundation, and storage implementation. xpad++ adapts that project into a
minimal interface inspired by [Xpad](https://launchpad.net/xpad).

## Features

- Transparent, frameless desktop window that opens maximized.
- Notes without title bars; drag them by their bottom toolbar or Ctrl+drag the text.
- Resize notes using the bottom-right corner.
- Persistent text, positions, dimensions, colors, font settings, and canvas scroll.
- A new note created with **+** inherits its parent's size, background, font, text
  size, and text color, with an empty body and a slightly offset position.
- **Kalam** as the default note font; choose from installed system and user fonts.
- Per-note background and text colors, font family, and text size.
- Small note toolbar with new, undo, redo, properties, and delete controls.
- Close notes without deleting them; restore them with **Show all notes**.
- Confirmation before permanently deleting a note.
- Scrollable canvas with hidden scrollbars.
- Xpad migration that merges notes, preserves their text and colors, backs up the
  existing store, and avoids duplicate imports on repeat runs.
- GNOME login autostart through the migration/setup command.
- Offline browser preview with a separate browser-local note store.

Notes are plain text. Xpad's rich text styling, system tray, and cross-workspace
window features are not implemented. Transparency is confirmed working on the
development GNOME setup; support can vary with the desktop compositor.

## Installation: the setup used for this project

You need Git, Node.js 22 with npm, and Fontconfig (`fc-list`). Python 3 is used by
the optional migration and browser-packaging scripts. Install the Kalam font
through GNOME Fonts or your distribution if it is not already installed:

```bash
fc-match Kalam
```

Check that the reported family is Kalam; Fontconfig otherwise reports a substitute.

### 1. Install Node.js and npm with nvm

This installs them under your user account, without `sudo`:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
source ~/.bashrc
nvm install 22
```

If nvm is already installed, use `nvm use 22` instead.

### 2. Clone, install, and launch

```bash
git clone https://github.com/arcadio-buendia/xpad-plus-plus.git
cd xpad-plus-plus
nvm use 22
npm ci
npm start
```

`npm start` compiles the renderer before launching Electron. The app works offline
after its dependencies are installed. To quit the frameless app, press **Ctrl+Q**.

### 3. Build the desktop app

This is the unpacked Linux build used during development:

```bash
npm run build -- --linux --dir --config.electronDist=node_modules/electron/dist
./dist/linux-unpacked/sticky-notes-canvas
```

Using the installed Electron distribution avoids downloading Electron again while
packaging. To build Linux installers instead:

```bash
npm run build:linux
```

The inherited targets are `.deb`, AppImage, and Snap; these installer formats have
not all been validated for xpad++. The unpacked Linux build has been validated.

## Import Xpad notes and enable GNOME autostart

Build the desktop app first. Xpad notes are read from `$XDG_CONFIG_HOME/xpad`
(default `~/.config/xpad`). Preview the migration without changing either app:

```bash
python3 scripts/migrate-xpad.py
```

Then close xpad++ with **Ctrl+Q** and apply:

```bash
python3 scripts/migrate-xpad.py --apply
npm start
```

The script:

- Merges Xpad notes into the existing canvas store and keeps the Xpad originals.
- Preserves note text, dimensions, background/text colors, and font settings.
- Arranges imported notes below existing ones without overlaps; Xpad positions
  were all recorded as `(0, 0)` in the development GNOME session.
- Creates a timestamped backup under
  `~/.config/sticky-notes-canvas/migration-backups/` (or the equivalent XDG path).
- Installs `~/.config/autostart/sticky-notes-canvas.desktop` to launch the built
  app at GNOME login, and backs up and disables the existing `xpad.desktop`
  autostart entry if present.

The autostart entry points to this checkout's `dist/linux-unpacked` executable.
Keep the checkout in place, or rerun setup after moving and rebuilding it. The
script currently expects the default canvas data folder.

## Controls

| Action | Control |
| --- | --- |
| New note with parent's appearance | **+** on a note |
| New note with defaults | **Ctrl+N**, or double-click empty canvas |
| Move a note | Drag the bottom toolbar, or Ctrl+drag its text area |
| Resize a note | Drag its bottom-right corner |
| Colors, fonts, close, and show all | Right-click a note, or use **⋯** |
| Close the current note, keeping it saved | **Ctrl+W** while editing |
| Delete a note | **−**, then confirm |
| Scroll the canvas | Mouse wheel or touchpad |
| Dismiss a menu or deletion dialog | **Escape** |
| Quit | **Ctrl+Q** |

## Where notes are saved

Desktop notes are stored in `~/.config/sticky-notes-canvas/notes.json` by default
(on Linux), respecting Electron's normal configuration location. The internal
package name stays `sticky-notes-canvas` to preserve existing notes and autostart
paths. Back up this directory before moving between machines.

Local migration previews under `local-migration/` contain personal notes and are
excluded from Git, as are `node_modules/` and `dist/`.

## Browser preview

```bash
npm run build:ui
python3 scripts/package-browser.py
./launch-preview.sh
```

The browser preview stores notes separately in the browser's local storage.
Desktop transparency and system font enumeration require Electron; a browser
window cannot reveal your wallpaper through its page background.

## Development checks

```bash
npm run build:ui
node --check main.js
node --test tests/system-fonts.test.mjs
python3 tests/xpad-migration-test.py
```

If GJS is installed, `gjs tests/xpad-smoke.gjs` also checks the renderer's note
creation, appearance inheritance, persistence, closing, deletion, and load failures.
The repository retains tests from the original application; some target UI
features that xpad++ has removed.

## Credits and license

- **Original project:** [faridjaff/StickyNotesCanvas](https://github.com/faridjaff/StickyNotesCanvas).
- **Interface inspiration:** [Xpad](https://launchpad.net/xpad).
- **xpad++ adaptations:** [arcadio-buendia](https://github.com/arcadio-buendia).

MIT licensed. The original copyright and license are preserved in [LICENSE](LICENSE).
Bundled libraries retain their own license notices.
