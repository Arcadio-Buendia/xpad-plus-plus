/* Collision rules shared by the browser renderer and Node tests. */
(function (root) {
  const EPS = 1e-8;
  const visibleOthers = (note, notes) => notes.filter(n => n.id !== note.id && !n.padClosed);
  const overlaps = (a, b) => a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS
    && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;

  function freePosition(note, obstacles) {
    const wanted = { ...note, x: Math.max(0, note.x), y: Math.max(0, note.y) };
    if (!obstacles.some(other => overlaps(wanted, other))) return wanted;
    const xs = new Set([wanted.x, 0]), ys = new Set([wanted.y, 0]);
    for (const other of obstacles) {
      xs.add(other.x + other.w); ys.add(other.y + other.h);
      if (other.x >= note.w) xs.add(other.x - note.w);
      if (other.y >= note.h) ys.add(other.y - note.h);
    }
    const candidates = [];
    for (const x of xs) for (const y of ys) candidates.push({ x, y, distance: (x-wanted.x)**2 + (y-wanted.y)**2 });
    candidates.sort((a,b) => a.distance-b.distance || a.y-b.y || a.x-b.x);
    for (const point of candidates) {
      const candidate = { ...wanted, x: point.x, y: point.y };
      if (!obstacles.some(other => overlaps(candidate, other))) return candidate;
    }
    return wanted;
  }

  function settleNotes(notes, previous = []) {
    const existing = new Set(previous.filter(note => !note.padClosed).map(note => note.id));
    // Newly opened notes yield to notes that are already on the canvas.
    const order = [...notes.filter(note => existing.has(note.id)), ...notes.filter(note => !existing.has(note.id))];
    const placed = [], resolved = new Map();
    let changed = false;
    for (const note of order) {
      if (note.padClosed) { resolved.set(note.id,note); continue; }
      const normalized = { ...note,
        x:Number.isFinite(note.x) ? Math.max(0,note.x) : 0,
        y:Number.isFinite(note.y) ? Math.max(0,note.y) : 0,
        w:Number.isFinite(note.w) && note.w>0 ? note.w : 280,
        h:Number.isFinite(note.h) && note.h>0 ? note.h : 260,
      };
      const position = freePosition(normalized, placed);
      const next = ['x','y','w','h'].every(key => position[key]===note[key]) ? note : position;
      placed.push(next);
      resolved.set(note.id,next);
      changed ||= next !== note;
    }
    return changed ? notes.map(note => resolved.get(note.id)) : notes;
  }

  // Sweep through the whole pointer delta, so a fast drag cannot jump a note.
  function impact(note, dx, dy, other) {
    const axis = (position, delta, min, max) => {
      if (Math.abs(delta) < EPS) return position <= min + EPS || position >= max - EPS ? null : [-Infinity, Infinity];
      const a = (min-position)/delta, b = (max-position)/delta;
      return [Math.min(a,b), Math.max(a,b)];
    };
    const tx = axis(note.x, dx, other.x-note.w, other.x+other.w);
    const ty = axis(note.y, dy, other.y-note.h, other.y+other.h);
    if (!tx || !ty) return null;
    const entry = Math.max(tx[0],ty[0]), exit = Math.min(tx[1],ty[1]);
    if (entry < -EPS || entry > 1 || exit <= Math.max(0,entry) + EPS) return null;
    return { t: Math.max(0,entry), blockX: tx[0] >= ty[0]-EPS, blockY: ty[0] >= tx[0]-EPS };
  }

  function moveNote(note, target, notes) {
    const obstacles = visibleOthers(note, notes);
    let result = { ...note }, dx = Math.max(0,target.x)-note.x, dy = Math.max(0,target.y)-note.y;
    for (let step=0; step<3 && (Math.abs(dx)>EPS || Math.abs(dy)>EPS); step++) {
      let time = 1, blockX = false, blockY = false;
      for (const other of obstacles) {
        const hit = impact(result, dx, dy, other);
        if (!hit || hit.t > time+EPS) continue;
        if (hit.t < time-EPS) { time=hit.t; blockX=false; blockY=false; }
        blockX ||= hit.blockX; blockY ||= hit.blockY;
      }
      result.x += dx*time; result.y += dy*time;
      dx = blockX ? 0 : dx*(1-time);
      dy = blockY ? 0 : dy*(1-time);
    }
    return { x:result.x, y:result.y };
  }

  function resizeNote(note, target, notes) {
    const obstacles = visibleOthers(note, notes);
    const wantedW = Math.max(180,target.w), wantedH = Math.max(140,target.h);
    // Shrink first, then grow each edge until it touches another note.
    let w = wantedW, h = Math.min(note.h,wantedH);
    for (const other of obstacles) {
      if (note.y < other.y+other.h-EPS && note.y+h > other.y+EPS && other.x >= note.x+Math.min(note.w,wantedW)-EPS)
        w = Math.min(w,other.x-note.x);
    }
    h = wantedH;
    for (const other of obstacles) {
      if (note.x < other.x+other.w-EPS && note.x+w > other.x+EPS && other.y >= note.y+Math.min(note.h,wantedH)-EPS)
        h = Math.min(h,other.y-note.y);
    }
    return { w,h };
  }

  const api = { overlaps, freePosition, settleNotes, moveNote, resizeNote };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NoteGeometry = api;
})(globalThis);
