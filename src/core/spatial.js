// Where things are, by position: a bucket grid of cells one world unit
// square. Each item is an id with an outline (a convex polygon in world
// units, [[x, y], …]); it sits in every cell its bounding box touches.
// One index each for structures and features (World keeps them up to
// date as things are placed and removed). See docs/free-placement-plan.md.
//
//   at(x, y)            ids whose outline holds the point
//   near(x, y, r)       ids whose outline comes within r of the point,
//                       nearest first
//   overlapping(poly)   ids whose outline overlaps the polygon (touching
//                       edges don't count)

const EPS = 1e-9;

export class SpatialIndex {
  constructor(cell = 1) {
    this.cell = cell;
    this.cells = new Map(); // "cx,cy" -> Set of ids
    this.items = new Map(); // id -> { poly, box: [x0, y0, x1, y1] }
  }

  get size() {
    return this.items.size;
  }

  has(id) {
    return this.items.has(id);
  }

  outline(id) {
    return this.items.get(id)?.poly ?? null;
  }

  insert(id, poly) {
    if (this.items.has(id)) this.remove(id);
    const box = boxOf(poly);
    this.items.set(id, { poly, box });
    this._cells(box, (key) => {
      let set = this.cells.get(key);
      if (!set) this.cells.set(key, (set = new Set()));
      set.add(id);
    });
  }

  remove(id) {
    const item = this.items.get(id);
    if (!item) return false;
    this._cells(item.box, (key) => {
      const set = this.cells.get(key);
      set?.delete(id);
      if (set && !set.size) this.cells.delete(key);
    });
    this.items.delete(id);
    return true;
  }

  clear() {
    this.cells.clear();
    this.items.clear();
  }

  at(x, y) {
    const out = [];
    for (const id of this.cells.get(this._key(x, y)) ?? []) {
      if (containsPoint(this.items.get(id).poly, x, y)) out.push(id);
    }
    return out;
  }

  near(x, y, r) {
    const hits = [];
    for (const id of this._candidates([x - r, y - r, x + r, y + r])) {
      const d = distanceToPolygon(this.items.get(id).poly, x, y);
      if (d <= r) hits.push([d, id]);
    }
    return hits.sort((a, b) => a[0] - b[0]).map((h) => h[1]);
  }

  overlapping(poly) {
    const box = boxOf(poly);
    const out = [];
    for (const id of this._candidates(box)) {
      const item = this.items.get(id);
      if (boxesOverlap(box, item.box) && polygonsOverlap(poly, item.poly)) out.push(id);
    }
    return out;
  }

  _key(x, y) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
  }

  _cells([x0, y0, x1, y1], fn) {
    const c = this.cell;
    for (let cy = Math.floor(y0 / c); cy <= Math.floor(y1 / c); cy++) {
      for (let cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++) fn(`${cx},${cy}`);
    }
  }

  _candidates(box) {
    const seen = new Set();
    this._cells(box, (key) => {
      for (const id of this.cells.get(key) ?? []) seen.add(id);
    });
    return seen;
  }
}

// A w × h rectangle centred on (x, y), turned by `angle` (radians):
// the outline of a structure (w across its front, h front to back).
export function rectOutline(x, y, w, h, angle = 0) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
    .map(([lx, ly]) => [x + lx * c - ly * s, y + lx * s + ly * c]);
}

export function boxOf(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function boxesOverlap(a, b) {
  return a[0] < b[2] - EPS && b[0] < a[2] - EPS && a[1] < b[3] - EPS && b[1] < a[3] - EPS;
}

// Inside or on the edge of a convex polygon (either winding).
export function containsPoint(poly, x, y) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (Math.abs(cross) < EPS) continue;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

export function distanceToPolygon(poly, x, y) {
  if (containsPoint(poly, x, y)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

// Convex polygons overlap (more than touching) unless some edge's normal
// separates them – the separating axis test.
export function polygonsOverlap(p, q) {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
      const nx = ay - by, ny = bx - ax;
      const [pmin, pmax] = project(p, nx, ny), [qmin, qmax] = project(q, nx, ny);
      const scale = Math.hypot(nx, ny) || 1;
      if (pmax <= qmin + EPS * scale || qmax <= pmin + EPS * scale) return false;
    }
  }
  return true;
}

function project(poly, nx, ny) {
  let lo = Infinity, hi = -Infinity;
  for (const [x, y] of poly) {
    const d = x * nx + y * ny;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}
