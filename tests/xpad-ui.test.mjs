import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

const source = fs.readFileSync(new URL('../xpad.js', import.meta.url), 'utf8');
function find(element, predicate) {
  if (!element || typeof element !== 'object') return null;
  if (predicate(element)) return element;
  for (const child of element.children || []) {
    const hit = find(child, predicate);
    if (hit) return hit;
  }
  return null;
}
function app(initial = {}, failLoad = false) {
  const slots = [], effects = [], listeners = {};
  let index = 0, saved;
  const context = vm.createContext({
    innerWidth: 1000, innerHeight: 800, crypto: { randomUUID },
    localStorage: {
      getItem() { if (failLoad) throw Error('unreadable'); return JSON.stringify(initial); },
      setItem(key, value) { saved = JSON.parse(value); },
    },
    addEventListener: (name, fn) => { listeners[name] = fn; },
    removeEventListener() {},
    document: { getElementById: () => ({}) },
    React: {
      useState(value) { const n = index++; if (!(n in slots)) slots[n] = value; return [slots[n], v => { slots[n] = typeof v === 'function' ? v(slots[n]) : v; }]; },
      useRef(value) { const n = index++; if (!(n in slots)) slots[n] = { current: value }; return slots[n]; },
      useEffect(fn) { const n = index++; if (!(n in slots)) { slots[n] = true; effects.push(fn); } },
      createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
      Fragment: 'fragment',
    },
    ReactDOM: { createRoot: () => ({ render() {} }) },
  });
  vm.runInContext('globalThis.window = globalThis', context);
  vm.runInContext(source, context);
  const render = () => { index = 0; return vm.runInContext('Xpad()', context); };
  return {
    render, listeners,
    saved: () => saved,
    async load() { render(); for (const effect of effects.splice(0)) effect(); await Promise.resolve(); return render(); },
    font: name => vm.runInContext(`padFontFamily(${JSON.stringify(name)})`, context),
  };
}
const note = tree => find(tree, element => element.props.note);

test('note appearance inheritance, persistence, closing, and confirmed deletion', async () => {
  const canvas = app();
  let pad = note(await canvas.load());
  assert.equal(pad.props.note.body, '');
  pad.props.patch({ body: 'Remember me', color: 'green', padPaper: '#ddead1', padFont: 'Serif Example', padFontSize: 22, padInk: '#123456', x: 350, y: 250, w: 310, h: 280 });
  pad = note(canvas.render());
  pad.props.add();
  const [parent, child] = canvas.saved().notes;
  for (const key of ['w', 'h', 'color', 'padPaper', 'padFont', 'padFontSize', 'padInk']) assert.equal(child[key], parent[key], key);
  assert.equal(child.body, '');
  assert.notEqual(child.id, parent.id);
  assert.equal(child.x, 386);
  assert.equal(child.y, 286);
  assert.ok(child.z > parent.z);
  note(canvas.render()).props.close();
  assert.ok(canvas.saved().notes[0].padClosed);
  assert.equal(find(canvas.render(), e => e.props.note?.id === parent.id), null);
  canvas.listeners.keydown({ ctrlKey: true, key: 'n', preventDefault() {} });
  assert.equal(canvas.saved().notes.length, 3);
  assert.equal(canvas.saved().notes[2].padFont, 'Kalam');
  assert.equal(canvas.saved().notes[2].color, 'yellow');
  note(canvas.render()).props.remove();
  let tree = canvas.render();
  assert.equal(canvas.saved().notes.length, 3);
  assert.ok(find(tree, e => e.props.role === 'alertdialog'));
  find(tree, e => e.type === 'button' && e.children[0] === 'Delete').props.onClick();
  assert.equal(canvas.saved().notes.length, 2);
  const reopened = app(canvas.saved());
  assert.equal(note(await reopened.load()).props.note.id, canvas.saved().notes[1].id);
});

test('failed loading never overwrites notes', async () => {
  const canvas = app({}, true);
  const tree = await canvas.load();
  assert.match(find(tree, e => e.props.className === 'load-message').children[0], /Could not open/);
  assert.equal(canvas.saved(), undefined);
});

test('missing custom fonts fall back to bundled Kalam, while generic choices are retained', async () => {
  const canvas = app();
  await canvas.load();
  assert.equal(canvas.font('Unavailable Font'), '"Unavailable Font", Kalam, cursive');
  assert.equal(canvas.font('Kalam'), '"Kalam", Kalam, cursive');
  assert.equal(canvas.font('monospace'), 'monospace');
});

test('the default font and its redistribution license are shipped with the renderer', () => {
  const font = fs.readFileSync(new URL('../assets/fonts/Kalam-Regular.ttf', import.meta.url));
  assert.equal(font.readUInt32BE(0), 0x00010000);
  assert.match(fs.readFileSync(new URL('../assets/fonts/Kalam-OFL.txt', import.meta.url), 'utf8'), /SIL OPEN FONT LICENSE Version 1.1/);
  assert.match(fs.readFileSync(new URL('../xpad.css', import.meta.url), 'utf8'), /src:url\("\.\/assets\/fonts\/Kalam-Regular.ttf"\)/);
});
