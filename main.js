const { app, BrowserWindow, clipboard, ipcMain, Menu, dialog, net, protocol, screen, shell } = require('electron');
const path = require('node:path');
const { listSystemFonts } = require('./system-fonts.js');
ipcMain.handle('fonts:list', () => listSystemFonts());
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  readNotesFile, save: saveNotes,
  saveImage, saveImageFromFile, sweepOrphanImages, readMarkdownFile, IMAGE_FILE_RE,
  referencedImageNames, readImages, collectImages, writeImages,
  CLIPBOARD_IMAGE_BUDGET,
  resolveDataDir, checkDataFolder, switchDataFolder, readDataFolderPointer, samePath,
} = require('./storage.js');
const { windowStateOf, restoreWindowState } = require('./window-state.js');

// E2E test hook: when STICKY_USER_DATA is set, store all app data (notes.json,
// window.json, the Chromium profile) under that directory instead of the real
// user profile. Must run before app ready — everything below resolves paths
// through app.getPath('userData'). Tests point this at a throwaway tmp dir so
// they can seed known notes and never touch real user data. The data-folder
// pointer (see dataDir below) lives there too, so a fresh test profile is
// always on the default location unless a test seeds one.
if (process.env.STICKY_USER_DATA) {
  app.setPath('userData', process.env.STICKY_USER_DATA);
}

// Synchronous IPC for the preload script to fetch the running app's version
// at load time, so the renderer can compare it to whatever the GitHub
// Releases API reports as the latest tag.
ipcMain.on('app:version-sync', (e) => { e.returnValue = app.getVersion(); });

// Open external URLs (e.g. the release download link) in the user's default
// browser instead of inside the Electron BrowserWindow.
ipcMain.handle('shell:open-external', async (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false };
  try { await shell.openExternal(url); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});

const userDataDir = () => app.getPath('userData');

// Where notes.json and images/ live (issue #68): the data folder chosen under
// File → Choose where notes are saved…, or userData by default (storage.js resolveDataDir has the
// rules). dataDir() is the ONE answer to "where are the notes?" — every
// read and write of notes or pictures goes through it, and so should
// anything that watches notes.json. Resolved on first use and again each
// time the renderer loads the notes (startup, after a folder switch, after
// "Try again"), so it always describes the folder the page is showing.
let dataFolder = null;
function refreshDataFolder() {
  dataFolder = resolveDataDir(userDataDir());
  return dataFolder;
}
const dataDir   = () => (dataFolder || refreshDataFolder()).dir;
const notesPath = () => path.join(dataDir(), 'notes.json');

// Is this a genuine first install? The renderer uses it to tell a fresh
// install (stay quiet) apart from an upgrade by someone whose previous
// version never recorded a version number — everyone coming from 1.8.0 or
// earlier is in that state, since the recording only began in 2.0.0.
// Answered when the preload asks (after the legacy-userData migration, and
// before the renderer can save anything), then cached so later windows agree.
// Someone who has chosen a data folder is never a first install, even when
// that folder can't be reached right now.
let firstRunFlag = null;
ipcMain.on('app:first-run-sync', (e) => {
  if (firstRunFlag === null) {
    firstRunFlag = !readDataFolderPointer(userDataDir()) && !fs.existsSync(notesPath());
  }
  e.returnValue = firstRunFlag;
});
const windowPath  = () => path.join(userDataDir(), 'window.json');
const imagesDir   = () => path.join(dataDir(), 'images');

// May notes.json be written? Not until the renderer has loaded the notes
// from the current data folder, and not again from the moment the folder
// changes until the reloaded page has loaded from the new one — so a save
// still in flight from the old page can never land in the new folder, and a
// folder that couldn't be reached at startup is never written at all.
let notesWritable = false;

// Every write into the data folder checks this first. A chosen folder that
// has gone away since startup (share unmounted, drive unplugged) must not
// be re-created by a recursive mkdir: the notes would land on the bare
// mount point, to be hidden under the real ones once it's mounted again.
function assertDataFolder() {
  const f = dataFolder || refreshDataFolder();
  if (!f.available || (!f.isDefault && !fs.existsSync(f.dir))) {
    throw new Error(`the data folder is not available: ${f.dir}`);
  }
}

function writeNotes(data) {
  if (!notesWritable) throw new Error('the notes have not been loaded from the data folder');
  assertDataFolder();
  saveNotes(notesPath(), data);
}

// The images dir for a WRITE: the same folder as imagesDir(), behind the
// same guard as notes.json.
function writableImagesDir() {
  assertDataFolder();
  return imagesDir();
}

// One-time migration: until v1.2.3 the package was named "sticky-notes" and
// userData lived at ~/.config/sticky-notes/. v1.3.0 renamed the package to
// "sticky-notes-canvas" (so the snap name could match what's available on
// the Snap Store) which moved userData to ~/.config/sticky-notes-canvas/.
// On first launch of the new build, if there's no notes.json in the new
// path but the old one exists, copy notes.json + window.json over so
// existing deb users don't lose their data on upgrade. Snap installs are
// sandboxed and won't see the old path either way (no migration needed).
function migrateLegacyUserData() {
  try {
    const newDir = userDataDir();
    const newNotes = path.join(newDir, 'notes.json');
    if (fs.existsSync(newNotes)) return;  // new path already populated, nothing to do
    const legacyDir = path.join(path.dirname(newDir), 'sticky-notes');
    const legacyNotes = path.join(legacyDir, 'notes.json');
    if (!fs.existsSync(legacyNotes)) return;  // no legacy data either, fresh install
    fs.mkdirSync(newDir, { recursive: true });
    fs.copyFileSync(legacyNotes, newNotes);
    const legacyWin = path.join(legacyDir, 'window.json');
    if (fs.existsSync(legacyWin)) {
      fs.copyFileSync(legacyWin, path.join(newDir, 'window.json'));
    }
    console.log(`[main] migrated userData from ${legacyDir} → ${newDir}`);
  } catch (err) {
    console.warn('[main] userData migration failed:', err.message);
  }
}

let mainWindow = null;
let pendingSave = null;
let isQuitting  = false;

// window.json: the window's normal bounds plus maximized / fullScreen flags
// (window-state.js). Missing or unreadable means null — the default size.
function loadWindowState() {
  try {
    if (fs.existsSync(windowPath())) {
      return JSON.parse(fs.readFileSync(windowPath(), 'utf8'));
    }
  } catch {}
  return null;
}

function saveWindowState(state) {
  try {
    fs.mkdirSync(path.dirname(windowPath()), { recursive: true });
    fs.writeFileSync(windowPath(), JSON.stringify(state));
  } catch (err) {
    console.warn('[main] failed to save window state:', err.message);
  }
}

// Linux/Windows draw the application menu as a bar inside the window; macOS
// puts it in the system menu bar, where it belongs and where hiding it isn't
// possible (or wanted). Everything the app itself offers is reachable from
// the page — top chrome, status bar, note context menus, Preferences — so
// that in-window bar is dead chrome (#42).
const HIDE_MENU_BAR = process.platform !== 'darwin';

function createWindow() {
  const state = restoreWindowState(loadWindowState(), {
    workAreas: screen.getAllDisplays().map((d) => d.workArea),
    primary: screen.getPrimaryDisplay().workArea,
  });
  const workArea = screen.getDisplayMatching(state.bounds).workArea;
  mainWindow = new BrowserWindow({
    // Start at the saved display's work area even if its window manager
    // ignores maximize() for a non-resizable transparent window.
    ...workArea,
    // Shown below, once maximized.
    show: false,
    minWidth: Math.min(800, workArea.width),
    minHeight: Math.min(600, workArea.height),
    // Both the native surface and the page must be transparent.
    frame: false,
    transparent: true,
    hasShadow: false,
    // Electron transparency can break on platforms with resizable windows.
    resizable: false,
    maximizable: true,
    backgroundColor: '#00000000',
    title: 'xpad++',
    icon: path.join(__dirname, 'build', 'icon.png'),
    // Hidden, not removed: Alt still summons it for the one-off items that
    // live nowhere else (Reload, Toggle DevTools, Full screen).
    autoHideMenuBar: HIDE_MENU_BAR,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // autoHideMenuBar alone leaves the bar showing on some window managers
  // until the first Alt; this starts it hidden everywhere.
  if (HIDE_MENU_BAR) mainWindow.setMenuBarVisibility(false);

  // Always open maximized, regardless of the previously saved window state.
  mainWindow.maximize();
  mainWindow.show();

  // The user can pin the bar open from Preferences; the renderer tells us
  // whenever that preference loads or changes. macOS has no in-window bar.
  ipcMain.removeHandler('window:menu-bar');
  ipcMain.handle('window:menu-bar', (_e, show) => {
    if (!HIDE_MENU_BAR || !mainWindow) return { ok: false };
    mainWindow.setAutoHideMenuBar(!show);
    mainWindow.setMenuBarVisibility(!!show);
    return { ok: true };
  });

  mainWindow.loadFile('index.html');

  // The renderer can't reload itself: location.reload() is a navigation
  // like any other and the will-navigate guard below cancels it. A switch of
  // data folder needs a fresh page (issue #68), so it asks for one here.
  ipcMain.removeHandler('window:reload');
  ipcMain.handle('window:reload', (e) => { e.sender.reload(); return { ok: true }; });

  // Note bodies can contain web links; the renderer opens them via the
  // shell:open-external IPC. These guards make the window itself inert:
  // no click, middle-click, or URL drag-drop may navigate it or spawn a
  // child window — http(s) attempts are routed to the default browser.
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', () => {
    if (mainWindow) saveWindowState(windowStateOf(mainWindow));
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// The application menu stays registered even though its bar is hidden in the
// window (see HIDE_MENU_BAR). Setting it is what gives the app its keyboard
// layer: the Ctrl/Cmd+, accelerator, and — the part that is easy to miss —
// the Edit roles, which are how Electron wires Ctrl+C/V/X/A and undo/redo to
// the focused text field. Menu.setApplicationMenu(null) would take the bar
// away and those shortcuts with it.
function buildMenu() {
  // Retain native editing accelerators while keeping the application menu small.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Notes', submenu: [
      { label: 'New note', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu:newPad') },
      { role: 'quit' },
    ]},
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ]},
  ]));
}

// Flush the latest renderer state before its window closes.
ipcMain.on('notes:save-sync', (event, data) => {
  try { writeNotes(data); pendingSave = null; event.returnValue = { ok: true }; }
  catch (err) { event.returnValue = { ok: false, error: err.message }; }
});

// Loading re-resolves the data folder, so a page that reloads after a
// folder switch or a "Try again" reads from wherever the pointer says now.
// A folder that can't be used, or a notes.json that can't be read, is an
// error, never an empty store: the renderer asks data-folder:get first and
// shows what's wrong instead.
ipcMain.handle('notes:load', async () => {
  notesWritable = false;
  const f = refreshDataFolder();
  if (!f.available) throw new Error(`the data folder is not available (${f.reason}): ${f.dir}`);
  const data = readNotesFile(notesPath());
  notesWritable = true;
  return data;
});

ipcMain.handle('notes:save', async (_e, data) => {
  if (!notesWritable) return { ok: false, error: 'the data folder is not available' };
  pendingSave = { data };
  try {
    writeNotes(data);
    pendingSave = null;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* ---------- The data folder (issue #68) ----------
 * File → Choose where notes are saved…. The renderer asks where the notes are, opens
 * the picker through data-folder:choose, decides with the user what to do
 * when the folder already holds notes, then calls data-folder:set and
 * reloads the page — which loads from the new folder through notes:load.
 */

ipcMain.handle('data-folder:get', async () => {
  const f = refreshDataFolder();
  if (!f.available) notesWritable = false;
  return {
    path: f.dir,
    isDefault: f.isDefault,
    available: f.available,
    reason: f.reason || null,
    detail: f.detail || null,
    notesFile: path.join(f.dir, 'notes.json'),
    defaultPath: userDataDir(),
    defaultHasNotes: fs.existsSync(path.join(userDataDir(), 'notes.json')),
  };
});

// The folder picker — the file-chooser portal in directory mode under
// flatpak, where the app has no filesystem access of its own: the portal
// hands back a /run/user/<uid>/doc/… path that this process may use, and
// that grant is kept across restarts by the document store. The choice is
// checked here (a real write + rename inside it) but nothing changes yet.
ipcMain.handle('data-folder:choose', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder for your notes',
    buttonLabel: 'Use this folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths?.length) return { ok: false, canceled: true };
  const dir = filePaths[0];
  const check = checkDataFolder(dir);
  if (!check.ok) return { ok: false, path: dir, error: check.error };
  return {
    ok: true, path: dir, hasNotes: check.hasNotes,
    isCurrent: samePath(dir, dataDir()), isDefault: samePath(dir, userDataDir()),
  };
});

// Switch: req = { path (null: the default location), mode, data } where
// mode 'use' keeps the notes already there and 'copy' writes `data` (the
// renderer's current store) and its pictures there first. On success the
// caller reloads the page; until it has loaded from the new folder, no
// save is accepted.
ipcMain.handle('data-folder:set', async (_e, req) => {
  const { path: target = null, mode, data = null } = req || {};
  try {
    // 'use' leaves the open notes behind: write their latest state to the
    // folder they came from first, so the last half second of typing isn't
    // lost. A folder that has gone away can't take it, and must not stop
    // the user from moving on.
    if (mode === 'use' && data && notesWritable) {
      try { writeNotes(data); } catch (err) { console.warn('[main] final save before switching failed:', err.message); }
    }
    switchDataFolder(userDataDir(), { target, mode, data, fromImagesDir: imagesDir() });
    notesWritable = false;
    pendingSave = null;
    refreshDataFolder();
    console.log(`[main] data folder is now ${dataDir()}`);
    return { ok: true, path: dataDir(), isDefault: dataFolder.isDefault };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// A picture pasted into a note body: the renderer sends the raw bytes +
// mime type, storage.js writes them content-hashed under <data folder>/images/,
// and the resolved sticky-image:// reference goes back into the markdown.
ipcMain.handle('images:save', async (_e, bytes, mime) => {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    return { ok: false, error: 'invalid image data' };
  }
  try {
    const name = saveImage(writableImagesDir(), Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), mime);
    return { ok: true, ref: `sticky-image://${name}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Save whatever image is on the system clipboard right now. The renderer's
// own paste path reads the clipboard File, whose backing temp file is
// unreadable inside the flatpak sandbox ("NotFoundError" on arrayBuffer), so
// the renderer asks for this instead and only falls back to its File when
// the clipboard holds no image. Read here, in the main process, straight
// from the OS clipboard — no temp file involved. Everything is re-encoded to
// PNG, which is what nativeImage gives us (an animated GIF loses animation).
ipcMain.handle('images:save-clipboard', async () => {
  try {
    const img = clipboard.readImage();
    if (!img || img.isEmpty()) return { ok: false, error: 'no image on the clipboard' };
    const name = saveImage(writableImagesDir(), img.toPNG(), 'image/png');
    return { ok: true, ref: `sticky-image://${name}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// What is on the clipboard, for a note's context-menu "Paste" (#59): asked
// when the menu opens (an empty clipboard greys the item out) and again on
// the click. Read here, like the image above, so the menu never leans on the
// renderer's clipboard access — that is what broke image pasting inside the
// flatpak sandbox. `image` only says a picture is there (availableFormats, no
// decoding on every right-click); images:save-clipboard reads and stores it.
ipcMain.handle('clipboard:read', async () => {
  try {
    const image = clipboard.availableFormats().some(f => /^image\//.test(f));
    return { ok: true, text: clipboard.readText(), image };
  } catch (err) {
    return { ok: false, text: '', image: false, error: err.message };
  }
});

// The one place a picture that lives on disk gets stored, shared by the two
// file routes below. Reading happens here, in main, because that is where
// the flatpak portals' file access lands: a path handed over by a drag-and-
// drop has been rewritten by the document portal to /run/user/<uid>/doc/…,
// and a file picked through the file-chooser portal is granted to this
// process — the app itself has no filesystem permission at all.
function storeImageFile(filePath) {
  if (typeof filePath !== 'string' || !filePath) return { ok: false, error: 'no file path' };
  try {
    return { ok: true, ref: `sticky-image://${saveImageFromFile(writableImagesDir(), filePath)}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// An image file dropped onto a note. The renderer resolves the File to a
// path with webUtils.getPathForFile (Electron 32 removed File.path) and
// sends it here; if the drop carries no usable path it falls back to
// reading the File's own bytes and the images:save handler above.
ipcMain.handle('images:save-file', async (_e, filePath) => storeImageFile(filePath));

// Context-menu "Insert image…": one round trip — main opens the picker
// (the file-chooser portal under flatpak), reads the chosen picture, stores
// it, and returns the reference the note body embeds.
ipcMain.handle('images:pick', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Insert image',
    buttonLabel: 'Insert',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths || !filePaths.length) return { ok: false, canceled: true };
  return storeImageFile(filePaths[0]);
});

/* ---------- Backup files (issue #38) ----------
 * A backup used to carry only the store, so its notes referenced pictures
 * that existed on that machine alone. It now carries them: one extra
 * top-level "images" key, { "<hash>.<ext>": "<base64>" }, holding exactly
 * the pictures the exported notes reference. The rest of the file is
 * unchanged, so an OLD build reads a new backup exactly as it reads its own
 * (withDefaults keeps only the known keys and drops "images"), and a new
 * build reads an old backup exactly as before (no images key, nothing to
 * restore). A store with no pictures still exports byte-for-byte what it
 * did before — the key is omitted entirely rather than written empty.
 */

// Put a backup's images back on disk. Untrusted input, so storage.js
// re-hashes every entry before writing, and only images the restored notes
// actually reference are considered. Fails soft as a whole and per picture:
// a restore always completes, a picture that can't be written is logged and
// simply missing. Returns a small count summary (or null) for logging.
function restoreBackupImages(images, data) {
  try {
    const referenced = referencedImageNames(data);
    const wanted = {};
    for (const [name, b64] of Object.entries(images || {})) {
      if (referenced.has(name)) wanted[name] = b64;
    }
    const { written, skipped, rejected } = writeImages(writableImagesDir(), wanted);
    for (const r of rejected) console.warn(`[main] backup image refused (${r.name}): ${r.reason}`);
    return { written: written.length, skipped: skipped.length, rejected: rejected.length };
  } catch (err) {
    console.warn('[main] restoring backup images failed:', err.message);
    return null;
  }
}

// Copying notes: hand the renderer the bytes behind a list of hash-named
// pictures, base64-encoded, so it can bundle them into the clipboard
// payload. Capped at CLIPBOARD_IMAGE_BUDGET — over that the set comes back
// empty and the notes are copied with their references alone, which is
// exactly how they travelled before. Names are filtered by IMAGE_FILE_RE,
// so this can never read anything but a stored picture.
ipcMain.handle('images:read', async (_e, names) => {
  try {
    return { ok: true, images: readImages(imagesDir(), Array.isArray(names) ? names : [], CLIPBOARD_IMAGE_BUDGET) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Pasting notes: put the pictures a payload carries back on disk. The
// clipboard is untrusted input, so storage.js re-hashes every entry and
// refuses anything whose bytes don't match the name they claim.
ipcMain.handle('images:write', async (_e, images) => {
  try {
    const { written, skipped, rejected } = writeImages(writableImagesDir(), images);
    for (const r of rejected) console.warn(`[main] pasted image refused (${r.name}): ${r.reason}`);
    return { ok: true, written, skipped, rejected };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('notes:export', async (_e, data) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save backup',
    defaultPath: 'notes-backup.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    let payload = data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      // Bundling must never cost the user their backup: if reading the
      // pictures fails, write the store on its own, as before.
      let images = {};
      try { images = collectImages(imagesDir(), data); } catch (err) {
        console.warn('[main] bundling backup images failed:', err.message);
      }
      const count = Object.keys(images).length;
      if (count) {
        payload = { ...data, images };
        console.log(`[main] backup includes ${count} image(s)`);
      }
    }
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Context-menu "Download": save one note's content as a markdown file. The
// renderer supplies both the suggested filename (derived from the note's
// title / first line, already sanitized) and the full file content.
ipcMain.handle('notes:export-markdown', async (_e, payload) => {
  const { filename, content } = payload || {};
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Download note',
    defaultPath: typeof filename === 'string' && filename ? filename : 'note.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(filePath, typeof content === 'string' ? content : '', 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Desk context-menu "Import markdown file…": the exact inverse of the
// Download above — each chosen .md file becomes a note, its contents the
// body and its filename the title. One round trip, like images:pick: main
// opens the picker (the file-chooser portal under flatpak), reads every
// chosen file and hands back their names and contents; the renderer turns
// them into notes. Reading happens here for the same reason as the image
// file routes — the sandboxed app has no filesystem permission of its own,
// the portal grants the chosen file to this process. Per-file failures ride
// along in the same array as { name, error }, so one unreadable file can't
// sink the rest of the selection.
ipcMain.handle('notes:import-markdown', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Import markdown',
    buttonLabel: 'Import',
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (canceled || !filePaths || !filePaths.length) return { ok: false, canceled: true };
  return { ok: true, files: filePaths.map(readMarkdownFile) };
});

ipcMain.handle('notes:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Restore backup',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths?.length) return { ok: false, canceled: true };
  try {
    const raw = fs.readFileSync(filePaths[0], 'utf8');
    const parsed = JSON.parse(raw);
    // Pictures first, store second — so by the time the renderer swaps in
    // the restored notes their images are already on disk. An old backup
    // has no images key and takes this path unchanged.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.images) {
      const { images, ...data } = parsed;
      const report = restoreBackupImages(images, data);
      if (report) console.log(`[main] restored images: ${JSON.stringify(report)}`);
      // The renderer gets the store exactly as it always did — the base64
      // never reaches it, so it can never end up back in notes.json.
      return { ok: true, data, images: report || undefined };
    }
    return { ok: true, data: parsed };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(() => {
  // Run any one-time migrations before anything reads notes.json.
  migrateLegacyUserData();

  // Serve pasted note images over the app-private sticky-image:// scheme.
  // mdToHtml only emits <img> tags for this exact reference shape, and this
  // handler only serves hash-named files out of <data folder>/images/ — no path
  // traversal, no arbitrary file reads reachable from note content.
  protocol.handle('sticky-image', (request) => {
    let name = '';
    try { name = new URL(request.url).hostname; } catch {}
    const file = path.join(imagesDir(), name);
    if (!IMAGE_FILE_RE.test(name) || !fs.existsSync(file)) {
      return new Response('not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });

  // Deleting a note (or undoing an image paste) leaves its image files
  // behind; sweep them now, before any renderer exists — the only moment
  // an image can't be mid-paste. Never in a chosen data folder: another
  // computer syncing it may already have delivered a picture whose notes
  // haven't arrived yet, and deleting it here would delete it there too.
  // Nor next to a notes.json that can't be read: its references can't be
  // trusted, and the user hasn't decided what to do with it yet.
  try {
    const folder = refreshDataFolder();
    if (folder.isDefault && folder.available) {
      const removed = sweepOrphanImages(imagesDir(), notesPath());
      if (removed.length) console.log(`[main] removed ${removed.length} orphan image(s)`);
    }
  } catch (err) {
    console.warn('[main] orphan image sweep failed:', err.message);
  }

  // On macOS in dev mode (`npm start`), Electron shows its default icon in the
  // dock because there's no .app bundle with an Info.plist. Packaged .dmg builds
  // get the correct icon automatically from electron-builder. This closes the
  // gap during development.
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, 'build', 'icon.png')); } catch {}
  }
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (isQuitting) return;
  isQuitting = true;
  if (pendingSave) {
    try {
      writeNotes(pendingSave.data);
    } catch (err) {
      console.warn('[main] final save failed:', err.message);
    }
  }
});
