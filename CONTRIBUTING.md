# Contributing to xpad++

The current UI is in `xpad.jsx` and `xpad.css`. `scripts/build-xpad.cjs` uses bundled
Babel to generate `xpad.js`; commit that generated file with UI changes.
`npm start`, `npm test`, and desktop builds regenerate it automatically.

- `main.js`: Electron window, native menus, IPC, and storage integration.
- `preload.js`: the `window.stickyAPI` renderer bridge.
- `system-fonts.js`: optional Fontconfig enumeration with a graceful fallback.
- `assets/fonts/Kalam-*`: the bundled default font, source notice, and OFL license.
- `storage.js` and `window-state.js`: inherited data and window persistence.
- `scripts/desktop_setup.py`: independent XDG desktop-session autostart setup.
- `scripts/migrate-xpad.py`: Xpad migration and backups.
- `tests/xpad-ui.test.mjs` and `tests/system-fonts.test.mjs`: current Node UI checks.
- `tests/test_*.py`: migration, fresh-user setup, and packaging checks.

The original app's renderer and tests are retained for reference. Its folders,
links, Markdown, and preferences UI are not loaded by xpad++.

Keep the interface small. Preserve existing note data, the original MIT notice,
and bundled-font licenses. Avoid required global tools when Node or bundled
assets can do the job. Keep setup paths relative to the checkout or the current
user's configuration and allow explicit overrides. Never commit personal notes,
migration previews, configuration, dependencies, or build artifacts.

See README.md for installation and validation commands. GJS is not required.
