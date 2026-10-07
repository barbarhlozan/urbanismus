// Woods far out (config.render.forest). Below its zoom the trees that stand
// together in a wood aren't drawn one by one: each wood is one shape,
// hatched inside, its outline straight sides with sharp corners, the way a
// map draws the edge of a forest. Lone trees and small groups stay trees.
//
//   findForests(world, cfg, ways)    { trees: Set of feature ids in woods, loops }
//   forestSVG(forests, project, cfg) the layer's SVG (Renderer.renderForest)
//
// The outline is the line where the woods' cover (each tree's crown,
// fading out over `reach`) is half full: the contours of that field, then
// straightened – every point that lies within `straighten` of a straight
// line between its neighbours is dropped, so what's left are the corners.
// Roads and railways are cut out of the cover (`ways`), so a wood stops at
// their edge.

import { contours } from '../terrain/elevation.js';

// Trees in woods and the woods' outlines (world units, closed loops).
// `ways`: a SegmentIndex (core/geom2d.js) of the roads' and railways' centre
// lines, kept `cfg.clear` clear of the woods.
export function findForests(world, cfg, ways = null) {
  const trees = [];
  for (const f of world.features.values()) {
    if (f.type !== 'tree') continue;
    const [x, y] = world.grid.xy(f.node);
    trees.push({ id: f.id, x: x + (f.ox ?? 0), y: y + (f.oy ?? 0) });
  }
  const cells = buckets(trees, cfg.link);

  // woods: groups of trees within `link` of one another, at least minTrees
  const parent = trees.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  trees.forEach((t, i) => near(cells, cfg.link, t.x, t.y, (j) => {
    if (j > i && Math.hypot(trees[j].x - t.x, trees[j].y - t.y) <= cfg.link) parent[root(j)] = root(i);
  }));
  const size = new Map();
  trees.forEach((_, i) => size.set(root(i), (size.get(root(i)) ?? 0) + 1));
  const wood = trees.filter((_, i) => size.get(root(i)) >= cfg.minTrees);
  if (!wood.length) return { trees: new Set(), loops: [], cover: () => 0 };

  // the cover: 1 at a tree, 0 from `reach` away; the outline at 0.5
  const woodCells = buckets(wood, cfg.reach);
  const cover = (x, y) => {
    let c = 0;
    near(woodCells, cfg.reach, x, y, (i) => { c = Math.max(c, 1 - Math.hypot(wood[i].x - x, wood[i].y - y) / cfg.reach); });
    // half full right at the clearance off a road, nothing nearer it
    if (c > 0 && ways) c = Math.min(c, 0.5 + Math.min(1, ways.distance([x, y], cfg.clear + 1) - cfg.clear));
    return c;
  };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of wood) {
    x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x); y1 = Math.max(y1, t.y);
  }
  const pad = cfg.reach + cfg.step;
  const lines = contours(cover, [x0 - pad, y0 - pad, x1 + pad, y1 + pad], { step: cfg.step, interval: 0.5, index: 1, only: 0.5 });
  return { trees: new Set(wood.map((t) => t.id)), loops: lines.map((l) => straighten(l.points, cfg.straighten)).filter((p) => p.length > 3), cover };
}

// Each wood: its outline filled with the paper colour, and the same shape
// hatched. `project(x, y)` gives the scene point of a world point.
export function forestSVG({ loops }, project, cfg) {
  if (!loops.length) return '';
  let d = '';
  for (const loop of loops) {
    loop.slice(0, -1).forEach((p, i) => {
      const [x, y] = project(...p);
      d += `${i ? 'L' : 'M'}${r2(x)} ${r2(y)}`;
    });
    d += 'Z';
  }
  const s = cfg.hatch;
  return `<defs><pattern id="forest-hatch" patternUnits="userSpaceOnUse" width="${s}" height="${s}" patternTransform="rotate(-35)">`
    + `<line class="forest-hatch" x1="0" y1="${s / 2}" x2="${s}" y2="${s / 2}"/></pattern></defs>`
    + `<path class="forest" d="${d}"/><path class="forest-fill" d="${d}"/>`;
}

// A closed loop (first point repeated last) as few straight sides as keep
// it within `tolerance` of where it ran (Douglas–Peucker): its corners.
function straighten(loop, tolerance) {
  const pts = loop.slice(0, -1);
  if (pts.length < 4) return loop;
  // split it in two at the point farthest from the first, then each half
  let far = 0, best = -1;
  pts.forEach(([x, y], i) => {
    const d = Math.hypot(x - pts[0][0], y - pts[0][1]);
    if (d > best) [best, far] = [d, i];
  });
  const half = (a, b) => keep(pts, a, b, tolerance);
  return [pts[0], ...half(0, far), pts[far], ...half(far, pts.length), pts[0]];
}

// The points strictly between a and b (b may be pts.length: the first
// again) that the line a → b misses by more than `tolerance`, in order.
function keep(pts, a, b, tolerance) {
  const at = (i) => pts[i % pts.length];
  const [ax, ay] = at(a), [bx, by] = at(b);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let worst = -1, w = -1;
  for (let i = a + 1; i < b; i++) {
    const [x, y] = at(i);
    const d = Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / len;
    if (d > worst) [worst, w] = [d, i];
  }
  if (worst <= tolerance) return [];
  return [...keep(pts, a, w, tolerance), at(w), ...keep(pts, w, b, tolerance)];
}

// Trees by grid square of `size`, to find those near a point.
function buckets(list, size) {
  const cells = new Map();
  list.forEach((t, i) => {
    const k = `${Math.floor(t.x / size)},${Math.floor(t.y / size)}`;
    (cells.get(k) ?? cells.set(k, []).get(k)).push(i);
  });
  return { cells, size };
}

function near({ cells, size }, r, x, y, fn) {
  const n = Math.ceil(r / size);
  const cx = Math.floor(x / size), cy = Math.floor(y / size);
  for (let i = cx - n; i <= cx + n; i++) for (let j = cy - n; j <= cy + n; j++) for (const k of cells.get(`${i},${j}`) ?? []) fn(k);
}

const r2 = (n) => Math.round(n * 100) / 100;
