# Contributing to xpad++

The current UI is in `xpad.jsx` and `xpad.css`. `scripts/build-xpad.cjs` uses the
bundled Babel compiler to generate `xpad.js`; commit that generated file with UI
changes. `npm start` and `npm run build` rebuild it automatically.

- `main.js`: Electron window, native menus, IPC, and storage integration.
- `preload.js`: the `window.stickyAPI` renderer bridge.
- `system-fonts.js`: installed font enumeration using Fontconfig.
- `storage.js` and `window-state.js`: inherited data and window persistence.
- `scripts/migrate-xpad.py`: Xpad migration, backups, and GNOME autostart.
- `tests/xpad-smoke.gjs`, `tests/system-fonts.test.mjs`, and
  `tests/xpad-migration-test.py`: checks for the adapted interface.

The original app's renderer and tests are retained for reference. Its folders,
links, Markdown, and preferences UI are not loaded by xpad++.

Keep the interface small. Preserve existing note data and the original MIT notice.
Never commit personal notes, migration previews, configuration, dependencies, or
build artifacts. See README.md for installation and validation commands.
