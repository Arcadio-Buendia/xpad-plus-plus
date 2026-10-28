# xpad++

Xpad-style sticky notes on a transparent desktop canvas, built for Linux desktops.
Keep your notes over your desktop, put them where you want, and find them in the
same place next time. Developed on GNOME; other desktops need a compositor that
supports transparent Electron windows.

Built from [StickyNotesCanvas](https://github.com/faridjaff/StickyNotesCanvas) by
[faridjaff](https://github.com/faridjaff). Thank you for the original Electron app,
canvas foundation, and storage implementation. xpad++ adapts that project into a
minimal interface inspired by [Xpad](https://launchpad.net/xpad).

## Features

- Transparent, frameless desktop window that always opens maximized.
- Notes without title bars; drag them by their bottom toolbar or Ctrl+drag the text.
- Resize notes using the bottom-right corner.
- Optional Xpad migration with backups and duplicate-import detection.
- Optional desktop-session autostart, independent of whether Xpad is installed.

Notes are plain text. Xpad's rich text styling, system tray, and cross-workspace
window features are not implemented. Desktop transparency depends on the
compositor; browser windows cannot show the desktop through their page background.

## Install and run

The desktop app targets Linux. You need Git and **Node.js 22+ with npm**, plus a
normal graphical desktop capable of running Electron. Python 3 is only needed for
the optional setup, migration, and browser-packaging scripts. Fontconfig (`fc-list`)
is optional: it enables the system-font list, but is not needed for Kalam or
basic note editing. Neither GJS nor a system-installed Kalam font is required.

The Node.js setup used during development was nvm, installed without `sudo`:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
source ~/.bashrc
nvm install 22
```

This example assumes Bash; other shells should load nvm using its own setup
instructions. If you already have a supported Node.js installation, skip nvm.

```bash
git clone https://github.com/arcadio-buendia/xpad-plus-plus.git
cd xpad-plus-plus
# If using nvm, select the version from .nvmrc:
nvm use
npm ci
npm start
```

`npm start` builds the renderer before launching Electron. Once dependencies are
installed, the app and its default font work offline. Quit with **Ctrl+Q**.

## Build a standalone desktop app

```bash
npm run build:desktop
```

This uses the Electron distribution already installed by `npm ci`, avoiding a
second Electron download during packaging. On Linux x64, launch the result with:

```bash
./dist/linux-unpacked/sticky-notes-canvas
```

On ARM64 the output directory is `dist/linux-arm64-unpacked`. The setup script
below selects the build directory for the current architecture automatically. This
packaging path has been validated locally on Linux x64; ARM64 is not yet tested on
hardware.

`npm run build:linux` also exposes the inherited `.deb`, AppImage, and Snap targets.
These installer formats have not all been validated for xpad++; Snap packaging
requires additional Snap tooling. Use the unpacked build above for the documented
installation path.

## Start at desktop login

Build the app, then enable autostart for your current user:

```bash
python3 scripts/desktop_setup.py --apply
```

This does **not** require Xpad or any imported notes. It writes a Desktop Entry
under `$XDG_CONFIG_HOME/autostart` (normally `~/.config/autostart`), backing up a
previous xpad++ entry before replacing it. Leave off `--apply` to preview it.
Autostart runs the built executable directly, so nvm and npm need not be loaded
by your desktop session.

The entry points to the build in this checkout. Keep it there, rerun setup after
moving it, or use a stable installation/AppImage path:

```bash
python3 scripts/desktop_setup.py --apply --executable /path/to/xpad-app
```

Use `--replace-xpad` if you also want to back up and disable Xpad's login entry.
Other startup applications are left alone. This setup is intended for Linux
sessions that support XDG autostart, including GNOME.

## Import Xpad notes

Migration is optional. By default, the script reads `$XDG_CONFIG_HOME/xpad`
(normally `~/.config/xpad`), falling back to the older `~/.xpad` location.
It merges with your existing canvas notes, preserves Xpad's text, dimensions,
colors, and font settings, and arranges the imported notes without overlaps.
Original Xpad files are kept unchanged; repeated imports skip already imported
notes. The app also honors its configured custom data folder.

Preview first, then close xpad++ with **Ctrl+Q** and apply:

```bash
python3 scripts/migrate-xpad.py
python3 scripts/migrate-xpad.py --apply
```

The default `--apply` also enables xpad++ autostart and backs up and disables
Xpad's autostart entry if present. Use `--skip-autostart` to migrate only, including
when you have not built the standalone app. Source, profile, and layout options
are available for other installations:

```bash
python3 scripts/migrate-xpad.py --source /path/to/xpad --skip-autostart
python3 scripts/migrate-xpad.py --apply --source /path/to/xpad --user-data-dir /path/to/canvas-profile --canvas-width 1920 --skip-autostart
```

The script reports its timestamped backup location. Private previews in
`local-migration/` are excluded from Git.

## Controls

| Action | Control |
| --- | --- |
| New note with parent's appearance | **+** on a note |
| New note with defaults | **Ctrl+N**, or double-click empty canvas |
| Move a note | Drag its bottom toolbar, or Ctrl+drag the text area |
| Resize a note | Drag its bottom-right corner |
| Colors, fonts, close, and show all | Right-click a note, or use **⋯** |
| Close a note, keeping it saved | **Ctrl+W** while editing |
| Delete a note | **−**, then confirm |
| Scroll the canvas | Mouse wheel or touchpad |
| Dismiss a menu or deletion dialog | **Escape** |
| Quit | **Ctrl+Q** |

## Where notes are saved

Linux desktop notes normally live in
`$XDG_CONFIG_HOME/sticky-notes-canvas/notes.json` (default
`~/.config/sticky-notes-canvas/notes.json`). The internal package name remains
`sticky-notes-canvas` to preserve existing notes and autostart entries.
`STICKY_USER_DATA` can select a separate profile, and migration's
`--user-data-dir` option accepts the same directory. Back up your profile before
moving between machines. Custom fonts other than bundled Kalam must be installed
on the destination machine to render identically.

## Browser preview

```bash
npm run build:ui
python3 scripts/package-browser.py
./launch-preview.sh
```

You can also open `dist/xpad-browser/index.html` directly. The preview and ZIP
include Kalam and its license. Browser notes live separately in localStorage;
keep using the same browser and file path to reopen them. Desktop transparency
and installed-font discovery require Electron.

## Development checks

```bash
npm test
python3 -m unittest discover -s tests
node --check main.js
npm run build:desktop
```

`npm test` rebuilds the renderer and checks font discovery/fallback, bundled font
assets, note creation and appearance inheritance, persistence, closing, deletion,
and load failures. Python checks cover migration, clean-user autostart, XDG and
legacy paths, custom data folders, ARM build discovery, and browser packaging.
These checks do not replace testing transparency on a real desktop.

Tests from StickyNotesCanvas are retained separately as `npm run test:upstream`;
some cover features removed from xpad++. Its inherited `test:e2e` suite also targets
the old UI and is not a current xpad++ acceptance suite.

## Credits and license

- **Original project:** [faridjaff/StickyNotesCanvas](https://github.com/faridjaff/StickyNotesCanvas).
- **Interface inspiration:** [Xpad](https://launchpad.net/xpad).
- **xpad++ adaptations:** [arcadio-buendia](https://github.com/arcadio-buendia).
- **Kalam:** Indian Type Foundry, designed by Lipi Raval and Jonny Pinhorn;
  [font source and notices](assets/fonts/Kalam-README.md),
  [SIL Open Font License 1.1](assets/fonts/Kalam-OFL.txt).

App code is MIT licensed. The original copyright and license are preserved in
[LICENSE](LICENSE). Bundled fonts and libraries retain their own licenses.
