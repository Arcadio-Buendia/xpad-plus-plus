/* Collision rules shared by the browser renderer and Node tests. */
(function (root) {
  const EPS = 1e-8;
  const visibleOthers = (note, notes) => notes.filter(n => n.id !== note.id && !n.padClosed);
  const overlaps = (a, b) => a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
  function freePosition(note, obstacles) {
    const wanted = {
      ...note,
      x: Math.max(0, note.x),
      y: Math.max(0, note.y)
    };
    if (!obstacles.some(other => overlaps(wanted, other))) return wanted;
    const xs = new Set([wanted.x, 0]),
      ys = new Set([wanted.y, 0]);
    for (const other of obstacles) {
      xs.add(other.x + other.w);
      ys.add(other.y + other.h);
      if (other.x >= note.w) xs.add(other.x - note.w);
      if (other.y >= note.h) ys.add(other.y - note.h);
    }
    const candidates = [];
    for (const x of xs) for (const y of ys) candidates.push({
      x,
      y,
      distance: (x - wanted.x) ** 2 + (y - wanted.y) ** 2
    });
    candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
    for (const point of candidates) {
      const candidate = {
        ...wanted,
        x: point.x,
        y: point.y
      };
      if (!obstacles.some(other => overlaps(candidate, other))) return candidate;
    }
    return wanted;
  }
  function settleNotes(notes, previous = []) {
    const existing = new Set(previous.filter(note => !note.padClosed).map(note => note.id));
    // Newly opened notes yield to notes that are already on the canvas.
    const order = [...notes.filter(note => existing.has(note.id)), ...notes.filter(note => !existing.has(note.id))];
    const placed = [],
      resolved = new Map();
    let changed = false;
    for (const note of order) {
      if (note.padClosed) {
        resolved.set(note.id, note);
        continue;
      }
      const normalized = {
        ...note,
        x: Number.isFinite(note.x) ? Math.max(0, note.x) : 0,
        y: Number.isFinite(note.y) ? Math.max(0, note.y) : 0,
        w: Number.isFinite(note.w) && note.w > 0 ? note.w : 280,
        h: Number.isFinite(note.h) && note.h > 0 ? note.h : 260
      };
      const position = freePosition(normalized, placed);
      const next = ['x', 'y', 'w', 'h'].every(key => position[key] === note[key]) ? note : position;
      placed.push(next);
      resolved.set(note.id, next);
      changed ||= next !== note;
    }
    return changed ? notes.map(note => resolved.get(note.id)) : notes;
  }

  // Sweep through the whole pointer delta, so a fast drag cannot jump a note.
  function impact(note, dx, dy, other) {
    const axis = (position, delta, min, max) => {
      if (Math.abs(delta) < EPS) return position <= min + EPS || position >= max - EPS ? null : [-Infinity, Infinity];
      const a = (min - position) / delta,
        b = (max - position) / delta;
      return [Math.min(a, b), Math.max(a, b)];
    };
    const tx = axis(note.x, dx, other.x - note.w, other.x + other.w);
    const ty = axis(note.y, dy, other.y - note.h, other.y + other.h);
    if (!tx || !ty) return null;
    const entry = Math.max(tx[0], ty[0]),
      exit = Math.min(tx[1], ty[1]);
    if (entry < -EPS || entry > 1 || exit <= Math.max(0, entry) + EPS) return null;
    return {
      t: Math.max(0, entry),
      blockX: tx[0] >= ty[0] - EPS,
      blockY: ty[0] >= tx[0] - EPS
    };
  }
  function moveNote(note, target, notes) {
    const obstacles = visibleOthers(note, notes);
    let result = {
        ...note
      },
      dx = Math.max(0, target.x) - note.x,
      dy = Math.max(0, target.y) - note.y;
    for (let step = 0; step < 3 && (Math.abs(dx) > EPS || Math.abs(dy) > EPS); step++) {
      let time = 1,
        blockX = false,
        blockY = false;
      for (const other of obstacles) {
        const hit = impact(result, dx, dy, other);
        if (!hit || hit.t > time + EPS) continue;
        if (hit.t < time - EPS) {
          time = hit.t;
          blockX = false;
          blockY = false;
        }
        blockX ||= hit.blockX;
        blockY ||= hit.blockY;
      }
      result.x += dx * time;
      result.y += dy * time;
      dx = blockX ? 0 : dx * (1 - time);
      dy = blockY ? 0 : dy * (1 - time);
    }
    return {
      x: result.x,
      y: result.y
    };
  }
  function resizeNote(note, target, notes) {
    const obstacles = visibleOthers(note, notes);
    const wantedW = Math.max(180, target.w),
      wantedH = Math.max(140, target.h);
    // Shrink first, then grow each edge until it touches another note.
    let w = wantedW,
      h = Math.min(note.h, wantedH);
    for (const other of obstacles) {
      if (note.y < other.y + other.h - EPS && note.y + h > other.y + EPS && other.x >= note.x + Math.min(note.w, wantedW) - EPS) w = Math.min(w, other.x - note.x);
    }
    h = wantedH;
    for (const other of obstacles) {
      if (note.x < other.x + other.w - EPS && note.x + w > other.x + EPS && other.y >= note.y + Math.min(note.h, wantedH) - EPS) h = Math.min(h, other.y - note.y);
    }
    return {
      w,
      h
    };
  }
  const api = {
    overlaps,
    freePosition,
    settleNotes,
    moveNote,
    resizeNote
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;else root.NoteGeometry = api;
})(globalThis);

/* A deliberately small, Xpad-style front end. Keeps the original store shape. */
const {
  useState,
  useEffect,
  useRef
} = React;
const PAD_COLORS = {
  yellow: '#fff2a8',
  green: '#d4edb0',
  blue: '#c7e6fa',
  pink: '#f7cedc',
  peach: '#ffdbb8',
  lilac: '#e2d3f3',
  white: '#faf9f5'
};
const GENERIC_FONTS = ['sans-serif', 'serif', 'monospace'];
const DEFAULT_PAD_FONT = 'Kalam';
const padFontFamily = (name = DEFAULT_PAD_FONT) => GENERIC_FONTS.includes(name) ? name : `${JSON.stringify(name || DEFAULT_PAD_FONT)}, Kalam, cursive`;
const newPad = (x = 80, y = 70) => ({
  id: crypto.randomUUID(),
  title: '',
  body: '',
  padFont: DEFAULT_PAD_FONT,
  color: 'yellow',
  x,
  y,
  w: 280,
  h: 260,
  z: 1,
  folder: 'root'
});
function Pad({
  note,
  patch,
  add,
  close,
  remove,
  menu,
  bringForward
}) {
  const editor = useRef(null);
  useEffect(() => {
    if (note.focus) editor.current?.focus();
  }, []);
  const gesture = (e, resize = false) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    bringForward();
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = {
      x: e.clientX,
      y: e.clientY,
      nx: note.x,
      ny: note.y,
      w: note.w,
      h: note.h
    };
    const target = e.currentTarget;
    const move = ev => patch(resize ? {
      w: Math.max(180, start.w + ev.clientX - start.x),
      h: Math.max(140, start.h + ev.clientY - start.y)
    } : {
      x: Math.max(0, start.nx + ev.clientX - start.x),
      y: Math.max(0, start.ny + ev.clientY - start.y)
    });
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };
  return /*#__PURE__*/React.createElement("article", {
    className: "pad",
    "data-note-id": note.id,
    onPointerDown: bringForward,
    onContextMenu: e => {
      e.preventDefault();
      menu(e.clientX, e.clientY, note.id);
    },
    style: {
      left: note.x,
      top: note.y,
      width: note.w,
      height: note.h,
      zIndex: note.z,
      background: note.padPaper || PAD_COLORS[note.color] || PAD_COLORS.yellow
    }
  }, /*#__PURE__*/React.createElement("textarea", {
    ref: editor,
    "aria-label": "Note text",
    spellCheck: "true",
    value: note.body || '',
    style: {
      fontFamily: padFontFamily(note.padFont),
      fontSize: note.padFontSize || 16,
      color: note.padInk || '#292820'
    },
    onChange: e => patch({
      body: e.target.value
    }),
    onPointerDown: e => {
      if (e.ctrlKey) gesture(e);
    },
    onKeyDown: e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault();
        close();
      }
    }
  }), /*#__PURE__*/React.createElement("footer", {
    className: "pad-toolbar",
    onPointerDown: gesture
  }, /*#__PURE__*/React.createElement("button", {
    title: "New note (Ctrl+N)",
    "aria-label": "New note",
    onClick: add
  }, "\uFF0B"), /*#__PURE__*/React.createElement("button", {
    title: "Undo typing",
    "aria-label": "Undo",
    onMouseDown: e => e.preventDefault(),
    onClick: () => {
      editor.current.focus();
      document.execCommand('undo');
    }
  }, "\u21B6"), /*#__PURE__*/React.createElement("button", {
    title: "Redo typing",
    "aria-label": "Redo",
    onMouseDown: e => e.preventDefault(),
    onClick: () => {
      editor.current.focus();
      document.execCommand('redo');
    }
  }, "\u21B7"), /*#__PURE__*/React.createElement("button", {
    title: "Note properties",
    "aria-label": "Note properties",
    onClick: e => {
      const r = e.currentTarget.getBoundingClientRect();
      menu(r.left, r.bottom, note.id);
    }
  }, "\u22EF"), /*#__PURE__*/React.createElement("button", {
    className: "pad-delete",
    title: "Delete note",
    "aria-label": "Delete note",
    onClick: remove
  }, "\u2212"), /*#__PURE__*/React.createElement("span", {
    className: "pad-resize",
    role: "separator",
    "aria-label": "Resize note",
    title: "Drag to resize",
    onPointerDown: e => gesture(e, true)
  }, "\u25E2")));
}
function Xpad() {
  const [store, setStore] = useState(null);
  const [error, setError] = useState('');
  const [context, setContext] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [fonts, setFonts] = useState([]);
  const [fontError, setFontError] = useState('');
  useEffect(() => {
    if (!window.stickyAPI?.listFonts) return;
    let cancelled = false;
    window.stickyAPI.listFonts().then(result => {
      if (cancelled) return;
      if (result.ok) {
        setFonts(result.families);
        setFontError(result.warning || '');
      } else setFontError(result.error);
    }).catch(err => {
      if (!cancelled) setFontError(err.message);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const latest = useRef(null);
  const saveQueue = useRef(Promise.resolve());
  const desk = useRef(null);
  const commit = recipe => {
    const proposed = recipe(latest.current);
    const next = {
      ...proposed,
      notes: NoteGeometry.settleNotes(proposed.notes, latest.current?.notes)
    };
    latest.current = next;
    setStore(next);
    if (window.stickyAPI) {
      saveQueue.current = saveQueue.current.catch(() => {}).then(() => window.stickyAPI.save(next)).then(result => {
        if (!result?.ok) throw new Error(result?.error || 'Could not save notes');
        setError('');
      }).catch(err => setError('Notes could not be saved: ' + err.message));
    } else {
      try {
        localStorage.setItem('stickies.all', JSON.stringify(next));
        setError('');
      } catch (err) {
        setError('Notes could not be saved: ' + err.message);
      }
    }
  };
  useEffect(() => {
    (async () => {
      try {
        const raw = window.stickyAPI ? await window.stickyAPI.load() : JSON.parse(localStorage.getItem('stickies.all') || '{}');
        const loadedNotes = Array.isArray(raw?.notes) ? raw.notes : [newPad()];
        const next = {
          ...raw,
          notes: NoteGeometry.settleNotes(loadedNotes),
          view: raw?.view || {
            x: 0,
            y: 0,
            z: 1
          }
        };
        latest.current = next;
        setStore(next);
        if (next.notes !== loadedNotes) commit(() => next);
      } catch (err) {
        setError('Could not open your notes: ' + err.message);
      }
    })();
    const flush = () => {
      if (latest.current && window.stickyAPI?.saveSync) window.stickyAPI.saveSync(latest.current);
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);
  const patch = (id, changes) => commit(s => ({
    ...s,
    notes: s.notes.map(n => {
      if (n.id !== id) return n;
      let geometry = {};
      if ('x' in changes || 'y' in changes) geometry = NoteGeometry.moveNote(n, {
        x: changes.x ?? n.x,
        y: changes.y ?? n.y
      }, s.notes);
      if ('w' in changes || 'h' in changes) geometry = {
        ...geometry,
        ...NoteGeometry.resizeNote({
          ...n,
          ...geometry
        }, {
          w: changes.w ?? n.w,
          h: changes.h ?? n.h
        }, s.notes)
      };
      return {
        ...n,
        ...changes,
        ...geometry
      };
    })
  }));
  const add = (x, y, parent) => {
    const surface = desk.current;
    const note = newPad(x ?? (surface?.scrollLeft || 0) + 70 + Math.random() * 100, y ?? (surface?.scrollTop || 0) + 60 + Math.random() * 80);
    if (parent) {
      for (const key of ['w', 'h', 'color', 'padPaper', 'padFont', 'padFontSize', 'padInk']) {
        if (parent[key] !== undefined) note[key] = parent[key];
      }
    }
    note.focus = true;
    note.z = Math.max(0, ...latest.current.notes.map(n => n.z || 0)) + 1;
    commit(s => ({
      ...s,
      notes: [...s.notes, note]
    }));
    setContext(null);
  };
  useEffect(() => {
    const key = e => {
      if (!latest.current) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        add();
      }
      if (e.key === 'Escape') {
        setContext(null);
        setDeleting(null);
      }
    };
    const off = window.stickyAPI?.onNewPad(() => add());
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      off?.();
    };
  }, []);
  useEffect(() => {
    if (store && desk.current && !desk.current.dataset.restored) {
      desk.current.scrollLeft = store.padScroll?.x || 0;
      desk.current.scrollTop = store.padScroll?.y || 0;
      desk.current.dataset.restored = 'yes';
    }
  }, [store]);
  if (!store) return /*#__PURE__*/React.createElement("div", {
    className: "load-message"
  }, error || 'Opening notes…');
  const selected = store.notes.find(n => n.id === context?.id);
  const openMenu = (x, y, id) => setContext({
    x: Math.max(8, Math.min(x, innerWidth - 242)),
    y: Math.max(8, Math.min(y, innerHeight - 410)),
    id
  });
  const visible = store.notes.filter(n => !n.padClosed);
  const maxZ = Math.max(0, ...store.notes.map(n => n.z || 0));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("main", {
    ref: desk,
    className: "pad-desk",
    "aria-label": "Notes canvas",
    onScroll: e => {
      const el = e.currentTarget;
      if (el.dataset.restored) commit(s => ({
        ...s,
        padScroll: {
          x: el.scrollLeft,
          y: el.scrollTop
        }
      }));
    },
    onPointerDown: e => {
      if (e.target === e.currentTarget || e.target.className === 'pad-surface') setContext(null);
    },
    onDoubleClick: e => {
      if (e.target.className === 'pad-surface') add(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    },
    onContextMenu: e => {
      if (e.target.className === 'pad-surface') {
        e.preventDefault();
        openMenu(e.clientX, e.clientY, null);
      }
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "pad-surface",
    style: {
      width: Math.max(innerWidth, ...visible.map(n => n.x + n.w + 240)),
      height: Math.max(innerHeight, ...visible.map(n => n.y + n.h + 240))
    }
  }, visible.map(n => /*#__PURE__*/React.createElement(Pad, {
    key: n.id,
    note: n,
    patch: v => patch(n.id, v),
    add: () => add(n.x + 36, n.y + 36, n),
    close: () => patch(n.id, {
      padClosed: true
    }),
    remove: () => setDeleting(n.id),
    menu: openMenu,
    bringForward: () => {
      if (n.z !== maxZ) patch(n.id, {
        z: maxZ + 1
      });
    }
  })))), !visible.length && /*#__PURE__*/React.createElement("div", {
    className: "empty-pad"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => add()
  }, "\uFF0B New note"), /*#__PURE__*/React.createElement("p", null, "Double-click the canvas to create a note."), store.notes.length > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => commit(s => ({
      ...s,
      notes: s.notes.map(n => ({
        ...n,
        padClosed: false
      }))
    }))
  }, "Show saved notes")), error && /*#__PURE__*/React.createElement("div", {
    role: "alert",
    className: "save-error"
  }, error), context && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "menu-backdrop",
    onPointerDown: () => setContext(null),
    onContextMenu: e => {
      e.preventDefault();
      setContext(null);
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "pad-menu",
    role: "menu",
    style: {
      left: context.x,
      top: context.y
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => add()
  }, "New note ", /*#__PURE__*/React.createElement("kbd", null, "Ctrl+N")), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      commit(s => ({
        ...s,
        notes: s.notes.map(n => ({
          ...n,
          padClosed: false
        }))
      }));
      setContext(null);
    }
  }, "Show all notes"), selected && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("hr", null), /*#__PURE__*/React.createElement("label", null, "Note color"), /*#__PURE__*/React.createElement("div", {
    className: "color-options"
  }, Object.entries(PAD_COLORS).map(([name, color]) => /*#__PURE__*/React.createElement("button", {
    key: name,
    title: name,
    "aria-label": name,
    "aria-pressed": selected.color === name,
    style: {
      background: color
    },
    onClick: () => patch(selected.id, {
      color: name,
      padPaper: null
    })
  }))), /*#__PURE__*/React.createElement("label", null, "Font ", /*#__PURE__*/React.createElement("select", {
    value: selected.padFont || DEFAULT_PAD_FONT,
    onChange: e => patch(selected.id, {
      padFont: e.target.value
    })
  }, /*#__PURE__*/React.createElement("option", {
    value: "sans-serif"
  }, "Sans"), /*#__PURE__*/React.createElement("option", {
    value: "serif"
  }, "Serif"), /*#__PURE__*/React.createElement("option", {
    value: "monospace"
  }, "Monospace"), [...new Set([DEFAULT_PAD_FONT, ...fonts, ...(selected.padFont && !GENERIC_FONTS.includes(selected.padFont) ? [selected.padFont] : [])])].sort((a, b) => a.localeCompare(b)).map(font => /*#__PURE__*/React.createElement("option", {
    key: font,
    value: font,
    style: {
      fontFamily: padFontFamily(font)
    }
  }, font)))), fontError && /*#__PURE__*/React.createElement("p", {
    className: "font-status",
    role: "status"
  }, fontError), /*#__PURE__*/React.createElement("label", null, "Text size ", /*#__PURE__*/React.createElement("input", {
    type: "number",
    min: "10",
    max: "40",
    value: selected.padFontSize || 16,
    onChange: e => patch(selected.id, {
      padFontSize: Math.min(40, Math.max(10, Number(e.target.value) || 16))
    })
  })), /*#__PURE__*/React.createElement("label", null, "Text color ", /*#__PURE__*/React.createElement("input", {
    type: "color",
    value: selected.padInk || '#292820',
    onChange: e => patch(selected.id, {
      padInk: e.target.value
    })
  })), /*#__PURE__*/React.createElement("hr", null), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      patch(selected.id, {
        padClosed: true
      });
      setContext(null);
    }
  }, "Close note"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setDeleting(selected.id);
      setContext(null);
    }
  }, "Delete note\u2026")))), deleting && /*#__PURE__*/React.createElement("div", {
    className: "dialog-backdrop"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pad-dialog",
    role: "alertdialog",
    "aria-modal": "true",
    "aria-labelledby": "delete-title"
  }, /*#__PURE__*/React.createElement("p", {
    id: "delete-title"
  }, "Delete this note permanently?"), /*#__PURE__*/React.createElement("button", {
    autoFocus: true,
    onClick: () => setDeleting(null)
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      commit(s => ({
        ...s,
        notes: s.notes.filter(n => n.id !== deleting)
      }));
      setDeleting(null);
    }
  }, "Delete"))));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(Xpad, null));
