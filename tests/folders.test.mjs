import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// utils.jsx is a browser-global script (no module exports). Same loading
// trick as lists.test.mjs: run it in a vm sandbox with light shims and read
// the pure helpers back off the shimmed `window`.
const dir = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(dir, '..', 'utils.jsx'), 'utf8');
const sandbox = { React: {}, window: {}, document: {}, navigator: {}, console, Math, JSON, Date };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const {
  sanitizeFolderParents, folderSubtreeIds, canMoveFolder, folderPath,
  flattenFolderTree, withDefaults, FOLDER_COLORS, FOLDER_HUES,
} = sandbox.window;

// Values built inside the vm belong to another realm (different Object /
// Array prototypes), which strict deepEqual rejects. Round-trip through
// JSON to get host-realm plain values before comparing.
const plain = (x) => JSON.parse(JSON.stringify(x));

// Compact folder-map builder: mk(['a','root'], ['b','a']) →
// {root: {...}, a: {id:'a', parent:'root', ...}, b: {id:'b', parent:'a', ...}}
function mk(...pairs) {
  const folders = { root: { id: 'root', name: 'All notes', parent: null, hue: '#888' } };
  for (const [id, parent] of pairs) {
    folders[id] = { id, name: id.toUpperCase(), parent, hue: '#d97757' };
  }
  return folders;
}

/* ---------------- sanitizeFolderParents ---------------- */

test('sanitize keeps a valid nested tree untouched', () => {
  const f = mk(['a', 'root'], ['b', 'a'], ['c', 'b']);
  assert.deepEqual(plain(sanitizeFolderParents(f)), f);
});

test('sanitize re-parents unknown parents to root', () => {
  const f = mk(['a', 'ghost']);
  assert.equal(sanitizeFolderParents(f).a.parent, 'root');
});

test('sanitize re-parents missing/self parents to root', () => {
  const f = mk(['a', null], ['b', 'b']);
  const out = sanitizeFolderParents(f);
  assert.equal(out.a.parent, 'root');
  assert.equal(out.b.parent, 'root');
});

test('sanitize breaks parent cycles instead of hanging', () => {
  const f = mk(['a', 'b'], ['b', 'a']);
  const out = sanitizeFolderParents(f);
  // One side of the cycle is re-attached to root; the other becomes a
  // valid descendant. No folder may remain in a cycle.
  const reachesRoot = (id) => {
    const seen = new Set();
    let cur = id;
    while (cur && cur !== 'root' && !seen.has(cur)) { seen.add(cur); cur = out[cur].parent; }
    return cur === 'root';
  };
  assert.ok(reachesRoot('a'));
  assert.ok(reachesRoot('b'));
});

test('sanitize creates the root entry when absent', () => {
  const out = sanitizeFolderParents({ a: { id: 'a', name: 'A', parent: 'root', hue: '#000' } });
  assert.ok(out.root);
  assert.equal(out.root.id, 'root');
});

/* ---------------- folderSubtreeIds ---------------- */

test('subtree includes the folder itself and all descendants', () => {
  const f = mk(['a', 'root'], ['b', 'a'], ['c', 'b'], ['x', 'root']);
  assert.deepEqual(plain([...folderSubtreeIds(f, 'a')].sort()), ['a', 'b', 'c']);
});

test('subtree of a leaf is just itself', () => {
  const f = mk(['a', 'root'], ['b', 'a']);
  assert.deepEqual(plain([...folderSubtreeIds(f, 'b')]), ['b']);
});

test('subtree of root spans every folder', () => {
  const f = mk(['a', 'root'], ['b', 'a']);
  assert.deepEqual(plain([...folderSubtreeIds(f, 'root')].sort()), ['a', 'b', 'root']);
});

/* ---------------- canMoveFolder ---------------- */

test('canMoveFolder allows a legal nest and un-nest', () => {
  const f = mk(['a', 'root'], ['b', 'root']);
  assert.ok(canMoveFolder(f, 'a', 'b'));
  assert.ok(canMoveFolder(f, 'a', 'root'));
});

test('canMoveFolder refuses self, own subtree, and unknown targets', () => {
  const f = mk(['a', 'root'], ['b', 'a']);
  assert.equal(canMoveFolder(f, 'a', 'a'), false);   // into itself
  assert.equal(canMoveFolder(f, 'a', 'b'), false);   // into own child
  assert.equal(canMoveFolder(f, 'a', 'ghost'), false);
  assert.equal(canMoveFolder(f, 'root', 'a'), false); // root is not movable
});

/* ---------------- folderPath ---------------- */

test('folderPath walks names from the top level down', () => {
  const f = mk(['a', 'root'], ['b', 'a'], ['c', 'b']);
  assert.deepEqual(plain(folderPath(f, 'c')), ['A', 'B', 'C']);
  assert.deepEqual(plain(folderPath(f, 'a')), ['A']);
});

test('folderPath is empty for root and unknown ids', () => {
  const f = mk(['a', 'root']);
  assert.deepEqual(plain(folderPath(f, 'root')), []);
  assert.deepEqual(plain(folderPath(f, 'nope')), []);
});

/* ---------------- flattenFolderTree ---------------- */

test('flatten yields DFS order with depths and hasChildren', () => {
  const f = mk(['a', 'root'], ['b', 'a'], ['x', 'root']);
  assert.deepEqual(plain(flattenFolderTree(f, ['a', 'x'])), [
    { id: 'a', depth: 0, hasChildren: true },
    { id: 'b', depth: 1, hasChildren: false },
    { id: 'x', depth: 0, hasChildren: false },
  ]);
});

test('flatten orders siblings by folderOrder, then unordered alphabetically', () => {
  const f = mk(['zeta', 'root'], ['alpha', 'root'], ['mid', 'root']);
  // Only zeta is ranked; alpha and mid follow alphabetically (by name).
  assert.deepEqual(plain(flattenFolderTree(f, ['zeta']).map(r => r.id)), ['zeta', 'alpha', 'mid']);
});

test('flatten ignores stale ids in folderOrder', () => {
  const f = mk(['a', 'root']);
  assert.deepEqual(plain(flattenFolderTree(f, ['deleted', 'a']).map(r => r.id)), ['a']);
});

test('flatten sorts nested siblings independently of top-level ones', () => {
  const f = mk(['p', 'root'], ['c2', 'p'], ['c1', 'p']);
  assert.deepEqual(plain(flattenFolderTree(f, ['p', 'c2', 'c1']).map(r => r.id)), ['p', 'c2', 'c1']);
  assert.deepEqual(plain(flattenFolderTree(f, ['p', 'c1', 'c2']).map(r => r.id)), ['p', 'c1', 'c2']);
});

/* ---------------- withDefaults integration ---------------- */

test('withDefaults repairs broken folder parents from old/imported stores', () => {
  const raw = { folders: { root: { id: 'root', name: 'All notes', parent: null, hue: '#888' },
    a: { id: 'a', name: 'A', parent: 'ghost', hue: '#000' } } };
  const out = withDefaults(raw);
  assert.equal(out.folders.a.parent, 'root');
});

test('withDefaults seed data forms a valid tree with nested folders', () => {
  const out = withDefaults(null);
  const rows = flattenFolderTree(out.folders, out.folderOrder);
  // Every seeded folder shows up exactly once in the flattened tree.
  const seeded = Object.keys(out.folders).filter(id => id !== 'root').sort();
  assert.deepEqual(plain(rows.map(r => r.id).sort()), seeded);
  // The seed nests Sprints and Reviews under Workflow.
  assert.ok(rows.some(r => r.id === 'sprints' && r.depth === 1));
  assert.ok(rows.some(r => r.id === 'reviews' && r.depth === 1));
});

/* ---------------- folder colours (#55) ---------------- */

test('FOLDER_COLORS names every folder hue, in the order new folders cycle through', () => {
  // The "Change color…" list offers exactly the palette new folders are
  // dealt from, so every colour a folder can already have is pickable and
  // the palette itself is unchanged — existing folders keep their look.
  assert.deepEqual(plain(FOLDER_COLORS.map(c => c.hue)), plain(FOLDER_HUES));
  assert.deepEqual(plain(FOLDER_HUES),
    ['#d97757', '#5a82c9', '#8a6fbf', '#4c9e6b', '#c4843a', '#b84a6b', '#3fa89a', '#8a8f3d']);
  for (const c of FOLDER_COLORS) assert.ok(typeof c.name === 'string' && c.name, `${c.hue} needs a name`);
  assert.equal(new Set(FOLDER_COLORS.map(c => c.name)).size, FOLDER_COLORS.length, 'names are distinct');
});

test('withDefaults keeps a chosen folder colour and never invents one', () => {
  // A backup is the store as JSON; restoring runs it back through
  // withDefaults. A recoloured folder must come back recoloured, and a
  // folder written without any hue must stay without one (it renders as it
  // always has) rather than being dealt a colour on load.
  const backup = JSON.stringify({ folders: {
    root: { id: 'root', name: 'All notes', parent: null, hue: '#888' },
    a: { id: 'a', name: 'A', parent: 'root', hue: '#b84a6b' },
    b: { id: 'b', name: 'B', parent: 'a' },
  } });
  const out = withDefaults(JSON.parse(backup));
  assert.equal(out.folders.a.hue, '#b84a6b');
  assert.equal('hue' in out.folders.b, false);
});
