// Choosing the data folder (issue #68): notes.json and images/ can live in a
// folder the user picks — typically one a sync tool keeps in step between
// computers — while window.json and the Chromium profile stay in userData.
//
// What these tests hold down:
//   1. the choice is a small per-machine pointer in userData, and anything
//      wrong with it means "default location", never a crash;
//   2. a chosen folder that can't be used at startup is REPORTED, never
//      silently swapped for an empty store — and checking it creates nothing;
//      so is a notes.json that can't be read, in any folder;
//   3. switching copies (pictures first, then an atomic notes.json written
//      inside the target) or adopts what is already there, and a failure at
//      any step leaves the pointer where it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  imageFileName, load,
  DATA_FOLDER_POINTER, readDataFolderPointer, writeDataFolderPointer,
  resolveDataDir, checkDataFolder, copyDataTo, switchDataFolder, samePath, readNotesFile,
} from '../storage.js';

function tmpDir(tag = 'sticky-datafolder-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), tag));
}
const rm = (...dirs) => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); };

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const PNG_NAME = imageFileName(PNG, 'image/png');
const storeWithImage = (name = PNG_NAME) => ({
  notes: [{ id: 'n1', title: 'shot', body: `look ![](sticky-image://${name})` }],
  folders: {},
});

/* ---------------- the pointer ---------------- */

test('no pointer file means the default location', () => {
  const ud = tmpDir();
  try {
    assert.equal(readDataFolderPointer(ud), null);
    assert.deepEqual(resolveDataDir(ud), { dir: ud, isDefault: true, available: true });
  } finally { rm(ud); }
});

test('the pointer round-trips, lives in userData, and null removes it', () => {
  const ud = tmpDir();
  const target = tmpDir();
  try {
    writeDataFolderPointer(ud, target);
    assert.equal(DATA_FOLDER_POINTER, 'data-folder.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ud, DATA_FOLDER_POINTER), 'utf8')), { path: target });
    assert.equal(readDataFolderPointer(ud), target);
    assert.ok(!fs.existsSync(path.join(ud, DATA_FOLDER_POINTER + '.tmp')), 'written atomically, no temp file left');
    writeDataFolderPointer(ud, null);
    assert.ok(!fs.existsSync(path.join(ud, DATA_FOLDER_POINTER)));
    assert.equal(readDataFolderPointer(ud), null);
    writeDataFolderPointer(ud, null);  // removing an absent pointer is fine
  } finally { rm(ud, target); }
});

test('a malformed pointer counts as no choice, with a warning', (t) => {
  const ud = tmpDir();
  const warn = t.mock.method(console, 'warn', () => {});
  try {
    const file = path.join(ud, DATA_FOLDER_POINTER);
    for (const raw of ['{ nope', 'null', '5', '{"path":42}', '{"path":"relative/dir"}', '{}']) {
      fs.writeFileSync(file, raw);
      assert.equal(readDataFolderPointer(ud), null, `pointer ${raw}`);
      assert.equal(resolveDataDir(ud).isDefault, true, `pointer ${raw}`);
    }
    assert.ok(warn.mock.callCount() >= 1, 'unparseable JSON is worth a warning');
  } finally { rm(ud); }
});

/* ---------------- resolving at startup ---------------- */

test('a chosen folder holding notes.json is the data folder', () => {
  const ud = tmpDir();
  const target = tmpDir();
  try {
    fs.writeFileSync(path.join(target, 'notes.json'), '{}');
    writeDataFolderPointer(ud, target);
    assert.deepEqual(resolveDataDir(ud), { dir: target, isDefault: false, available: true });
  } finally { rm(ud, target); }
});

test('a missing chosen folder is reported, not replaced — and not created', () => {
  const ud = tmpDir();
  const parent = tmpDir();
  const gone = path.join(parent, 'unmounted-share', 'notes');
  try {
    writeDataFolderPointer(ud, gone);
    const res = resolveDataDir(ud);
    assert.deepEqual(res, { dir: gone, isDefault: false, available: false, reason: 'missing' },
      'dir stays the chosen path: nothing may quietly fall back to another folder');
    assert.ok(!fs.existsSync(path.join(parent, 'unmounted-share')), 'checking must create nothing');
  } finally { rm(ud, parent); }
});

test('a chosen folder that exists but has no notes.json is unavailable (empty mount point, sync not arrived)', () => {
  const ud = tmpDir();
  const target = tmpDir();
  try {
    writeDataFolderPointer(ud, target);
    assert.deepEqual(resolveDataDir(ud), { dir: target, isDefault: false, available: false, reason: 'no-notes' });
    assert.deepEqual(fs.readdirSync(target), [], 'checking must write nothing into it');
  } finally { rm(ud, target); }
});

test('a chosen path that is a file is unavailable', () => {
  const ud = tmpDir();
  const parent = tmpDir();
  try {
    const file = path.join(parent, 'not-a-folder');
    fs.writeFileSync(file, 'x');
    writeDataFolderPointer(ud, file);
    assert.equal(resolveDataDir(ud).reason, 'not-folder');
    assert.equal(resolveDataDir(ud).available, false);
  } finally { rm(ud, parent); }
});

test('a chosen folder the app may not write is unavailable', { skip: process.getuid?.() === 0 && 'root ignores permissions' }, () => {
  const ud = tmpDir();
  const target = tmpDir();
  try {
    fs.writeFileSync(path.join(target, 'notes.json'), '{}');
    fs.chmodSync(target, 0o500);
    writeDataFolderPointer(ud, target);
    assert.deepEqual(resolveDataDir(ud), { dir: target, isDefault: false, available: false, reason: 'no-access' });
  } finally { fs.chmodSync(target, 0o700); rm(ud, target); }
});

/* ---------------- a notes.json that can't be read ---------------- */

// One comma short: what a hand edit most often leaves behind.
const BROKEN = '{\n  "notes": [\n    { "id": "mine", "title": "MY REAL NOTE" "body": "x" }\n  ]\n}\n';

test('readNotesFile: missing is a first launch ({}), a store comes back as written', () => {
  const dir = tmpDir();
  try {
    assert.deepEqual(readNotesFile(path.join(dir, 'notes.json')), {});
    fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify({ notes: [{ id: 'a' }] }));
    assert.deepEqual(readNotesFile(path.join(dir, 'notes.json')), { notes: [{ id: 'a' }] });
  } finally { rm(dir); }
});

test('readNotesFile throws, with line and column, for a file that is not a JSON object — never {}', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'notes.json');
  try {
    fs.writeFileSync(file, BROKEN);
    assert.throws(() => readNotesFile(file), /line 3 column 45/);
    for (const raw of ['', 'null', '[]', '"notes"']) {
      fs.writeFileSync(file, raw);
      assert.throws(() => readNotesFile(file), undefined, JSON.stringify(raw));
    }
  } finally { rm(dir); }
});

test('the default location with a notes.json that cannot be read is unavailable, and the file is untouched', () => {
  const ud = tmpDir();
  try {
    fs.writeFileSync(path.join(ud, 'notes.json'), BROKEN);
    const res = resolveDataDir(ud);
    assert.equal(res.dir, ud);
    assert.equal(res.isDefault, true);
    assert.equal(res.available, false);
    assert.equal(res.reason, 'unreadable');
    assert.match(res.detail, /line 3 column 45/);
    assert.equal(fs.readFileSync(path.join(ud, 'notes.json'), 'utf8'), BROKEN);
  } finally { rm(ud); }
});

test('a chosen folder with a notes.json that cannot be read is unavailable too', () => {
  const ud = tmpDir();
  const target = tmpDir();
  try {
    fs.writeFileSync(path.join(target, 'notes.json'), BROKEN);
    writeDataFolderPointer(ud, target);
    const res = resolveDataDir(ud);
    assert.deepEqual({ ...res, detail: undefined },
      { dir: target, isDefault: false, available: false, reason: 'unreadable', detail: undefined });
    assert.match(res.detail, /line 3 column 45/);
  } finally { rm(ud, target); }
});

/* ---------------- checking a folder before switching ---------------- */

test('checkDataFolder accepts a writable folder, says whether notes are there, and leaves nothing behind', () => {
  const target = tmpDir();
  try {
    assert.deepEqual(checkDataFolder(target), { ok: true, hasNotes: false });
    assert.deepEqual(fs.readdirSync(target), [], 'the write probe cleans up after itself');
    fs.writeFileSync(path.join(target, 'notes.json'), '{}');
    assert.deepEqual(checkDataFolder(target), { ok: true, hasNotes: true });
    assert.deepEqual(fs.readdirSync(target), ['notes.json']);
  } finally { rm(target); }
});

test('checkDataFolder refuses a missing folder, a file, and a read-only folder with a readable message', () => {
  const parent = tmpDir();
  try {
    const missing = checkDataFolder(path.join(parent, 'nope'));
    assert.equal(missing.ok, false);
    assert.match(missing.error, /doesn.t exist/);
    assert.ok(!fs.existsSync(path.join(parent, 'nope')));

    const file = path.join(parent, 'file');
    fs.writeFileSync(file, 'x');
    assert.deepEqual(checkDataFolder(file), { ok: false, error: 'That is not a folder.' });

    if (process.getuid?.() !== 0) {
      const ro = path.join(parent, 'ro');
      fs.mkdirSync(ro);
      fs.chmodSync(ro, 0o500);
      try {
        const res = checkDataFolder(ro);
        assert.equal(res.ok, false);
        assert.match(res.error, /permission/i);
        assert.deepEqual(fs.readdirSync(ro), []);
      } finally { fs.chmodSync(ro, 0o700); }
    }
  } finally { rm(parent); }
});

/* ---------------- copying the notes over ---------------- */

test('copyDataTo writes notes.json and the referenced pictures, and only those', () => {
  const from = tmpDir();
  const target = tmpDir();
  try {
    const orphan = imageFileName(Buffer.from('orphan'), 'image/png');
    fs.writeFileSync(path.join(from, PNG_NAME), PNG);
    fs.writeFileSync(path.join(from, orphan), Buffer.from('orphan'));
    const data = storeWithImage();
    const res = copyDataTo(target, data, from);
    assert.deepEqual(load(path.join(target, 'notes.json')), data);
    assert.deepEqual(fs.readdirSync(path.join(target, 'images')), [PNG_NAME]);
    assert.ok(fs.readFileSync(path.join(target, 'images', PNG_NAME)).equals(PNG));
    assert.deepEqual(res, { copied: [PNG_NAME], rejected: [] });
    assert.ok(fs.existsSync(path.join(from, PNG_NAME)), 'the source is copied, not moved');
  } finally { rm(from, target); }
});

test('copyDataTo saves atomically INSIDE the target folder', (t) => {
  const target = tmpDir();
  try {
    const renames = [];
    const orig = fs.renameSync.bind(fs);
    t.mock.method(fs, 'renameSync', (a, b) => { renames.push([a, b]); return orig(a, b); });
    copyDataTo(target, { notes: [] }, path.join(target, 'no-images'));
    const notes = path.join(target, 'notes.json');
    assert.deepEqual(renames, [[notes + '.tmp', notes]], 'temp file next to notes.json, so the rename never crosses a filesystem');
  } finally { rm(target); }
});

test('copyDataTo re-hashes pictures, keeps one already there, and skips a missing one', () => {
  const from = tmpDir();
  const target = tmpDir();
  try {
    const tampered = imageFileName(Buffer.from('real'), 'image/png');
    const missing = imageFileName(Buffer.from('gone'), 'image/png');
    fs.writeFileSync(path.join(from, tampered), Buffer.from('not the bytes the name claims'));
    fs.writeFileSync(path.join(from, PNG_NAME), Buffer.from('also tampered, but the target already has it'));
    fs.mkdirSync(path.join(target, 'images'));
    fs.writeFileSync(path.join(target, 'images', PNG_NAME), PNG);
    const data = { notes: [
      { id: 'a', body: `![](sticky-image://${tampered})` },
      { id: 'b', body: `![](sticky-image://${missing})` },
      { id: 'c', body: `![](sticky-image://${PNG_NAME})` },
    ] };
    const res = copyDataTo(target, data, from);
    assert.deepEqual(res, { copied: [], rejected: [tampered] });
    assert.deepEqual(fs.readdirSync(path.join(target, 'images')), [PNG_NAME]);
    assert.ok(fs.readFileSync(path.join(target, 'images', PNG_NAME)).equals(PNG), 'same name = same bytes: never overwritten');
  } finally { rm(from, target); }
});

test('copyDataTo refuses something that is not a store', () => {
  const target = tmpDir();
  try {
    for (const bad of [null, undefined, [], 'notes']) {
      assert.throws(() => copyDataTo(target, bad, target), /no notes to copy/);
    }
    assert.deepEqual(fs.readdirSync(target), []);
  } finally { rm(target); }
});

/* ---------------- switching ---------------- */

test("switching to an empty folder with 'copy' moves the data and records the pointer", () => {
  const ud = tmpDir();
  const target = tmpDir();
  try {
    fs.mkdirSync(path.join(ud, 'images'));
    fs.writeFileSync(path.join(ud, 'images', PNG_NAME), PNG);
    const data = storeWithImage();
    const res = switchDataFolder(ud, { target, mode: 'copy', data, fromImagesDir: path.join(ud, 'images') });
    assert.deepEqual(res, { dir: target, isDefault: false, available: true });
    assert.equal(readDataFolderPointer(ud), target);
    assert.deepEqual(load(path.join(target, 'notes.json')), data);
    assert.ok(fs.existsSync(path.join(target, 'images', PNG_NAME)));
    assert.ok(!fs.existsSync(path.join(target, 'window.json')), 'per-machine files stay behind');
  } finally { rm(ud, target); }
});

test("'use' keeps the notes already in the folder untouched", () => {
  const ud = tmpDir();
  const target = tmpDir();
  try {
    const theirs = { notes: [{ id: 'remote', body: 'from the other computer' }] };
    fs.writeFileSync(path.join(target, 'notes.json'), JSON.stringify(theirs));
    const before = fs.readFileSync(path.join(target, 'notes.json'));
    switchDataFolder(ud, { target, mode: 'use', data: storeWithImage(), fromImagesDir: path.join(ud, 'images') });
    assert.equal(readDataFolderPointer(ud), target);
    assert.ok(fs.readFileSync(path.join(target, 'notes.json')).equals(before), 'adopting must not rewrite their notes');
  } finally { rm(ud, target); }
});

test("'copy' over a folder that has notes replaces them", () => {
  const ud = tmpDir();
  const target = tmpDir();
  try {
    fs.writeFileSync(path.join(target, 'notes.json'), JSON.stringify({ notes: [{ id: 'remote' }] }));
    const mine = { notes: [{ id: 'mine' }] };
    switchDataFolder(ud, { target, mode: 'copy', data: mine, fromImagesDir: path.join(ud, 'images') });
    assert.deepEqual(load(path.join(target, 'notes.json')), mine);
  } finally { rm(ud, target); }
});

test("'use' on a chosen folder without notes is refused and changes nothing", () => {
  const ud = tmpDir();
  const target = tmpDir();
  try {
    assert.throws(() => switchDataFolder(ud, { target, mode: 'use' }), /no notes in that folder/i);
    assert.equal(readDataFolderPointer(ud), null);
    assert.deepEqual(fs.readdirSync(target), []);
  } finally { rm(ud, target); }
});

test('back to the default location: null target removes the pointer, and may be empty like a fresh install', () => {
  const ud = tmpDir();
  const target = tmpDir();
  try {
    writeDataFolderPointer(ud, target);
    const res = switchDataFolder(ud, { target: null, mode: 'use' });
    assert.deepEqual(res, { dir: ud, isDefault: true, available: true });
    assert.equal(readDataFolderPointer(ud), null);

    // Picking the default folder itself in the picker means the same thing.
    writeDataFolderPointer(ud, target);
    switchDataFolder(ud, { target: ud, mode: 'copy', data: { notes: [{ id: 'mine' }] }, fromImagesDir: path.join(target, 'images') });
    assert.equal(readDataFolderPointer(ud), null);
    assert.deepEqual(load(path.join(ud, 'notes.json')), { notes: [{ id: 'mine' }] });
  } finally { rm(ud, target); }
});

test('a switch that fails leaves the pointer where it was', (t) => {
  const ud = tmpDir();
  const old = tmpDir();
  const parent = tmpDir();
  try {
    writeDataFolderPointer(ud, old);
    assert.throws(() => switchDataFolder(ud, { target: path.join(parent, 'missing'), mode: 'copy', data: {} }), /doesn.t exist/);
    assert.throws(() => switchDataFolder(ud, { target: parent, mode: 'merge', data: {} }), /unknown mode/);
    assert.throws(() => switchDataFolder(ud, { target: 'relative/dir', mode: 'copy', data: {} }), /absolute/);
    // The copy itself failing (disk full, say) must not move the pointer either.
    const orig = fs.renameSync.bind(fs);
    t.mock.method(fs, 'renameSync', (a, b) => {
      if (b === path.join(parent, 'notes.json')) throw new Error('ENOSPC: no space left on device');
      return orig(a, b);
    });
    assert.throws(() => switchDataFolder(ud, { target: parent, mode: 'copy', data: { notes: [] } }), /ENOSPC/);
    t.mock.restoreAll();
    assert.equal(readDataFolderPointer(ud), old);
  } finally { rm(ud, old, parent); }
});

test('samePath sees through trailing slashes and symlinks', () => {
  const d = tmpDir();
  try {
    const link = d + '-link';
    fs.symlinkSync(d, link);
    try {
      assert.ok(samePath(d, d + path.sep));
      assert.ok(samePath(d, link));
      assert.ok(!samePath(d, path.join(d, 'sub')));
    } finally { fs.unlinkSync(link); }
  } finally { rm(d); }
});
