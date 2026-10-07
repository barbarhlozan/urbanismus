// Woods far out (config.render.forest). Below its zoom the trees that stand
// together in a wood aren't drawn one by one: each wood is one shape, its
// outline with a bumpy canopy edge and hatched inside, the way a hand-drawn
// map shows a forest. Lone trees and small groups stay trees.
//
//   findForests(world, cfg, ways)    { trees: Set of feature ids in woods, loops }
//   forestSVG(forests, project, cfg) the layer's SVG (Renderer.renderForest)
//
// The outline is the line where the woods' cover is half full: the
// contours of that field. Each tree covers a square around the middle of
// its cell, a square of `cell` dots on the map grid (fading out over
// `reach`), so a wood is outlined like a plot – in long straight runs along
// the grid with corners – not as a round blob. Roads and railways are cut
// out of it (`ways`), so a wood stops at their edge.

import { contours } from '../terrain/elevation.js';

// Trees in woods and the woods' outlines (world units, closed loops).
// `ways`: a SegmentIndex (core/geom2d.js) of the roads' and railways' centre
// lines, kept `cfg.clear` clear of the woods.
export function findForests(world, cfg, ways = null) {
  const trees = [];
  for (const f of world.features.values()) {
    if (f.type !== 'tree') continue;
    const [x, y] = world.grid.xy(f.node);
    trees.push({ id: f.id, x, y }); // on its dot: the outline follows the grid
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

  // the cover: 1 in the middle of a cell with a tree, 0 `reach` away along
  // either axis (a square); the outline at 0.5
  const mid = (v) => (Math.floor(v / cfg.cell) + 0.5) * cfg.cell;
  const spots = [...new Map(wood.map((t) => [`${mid(t.x)},${mid(t.y)}`, { x: mid(t.x), y: mid(t.y) }])).values()];
  const spotCells = buckets(spots, cfg.reach);
  const cover = (x, y) => {
    let c = 0;
    near(spotCells, cfg.reach, x, y, (i) => { c = Math.max(c, 1 - Math.max(Math.abs(spots[i].x - x), Math.abs(spots[i].y - y)) / cfg.reach); });
    // half full right at the clearance off a road, nothing nearer it
    if (c > 0 && ways) c = Math.min(c, 0.5 + Math.min(1, ways.distance([x, y], cfg.clear + 1) - cfg.clear));
    return c;
  };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of wood) {
    x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x); y1 = Math.max(y1, t.y);
  }
  const pad = cfg.reach + cfg.cell + cfg.step;
  const lines = contours(cover, [x0 - pad, y0 - pad, x1 + pad, y1 + pad], { step: cfg.step, interval: 0.5, index: 1, only: 0.5 });
  return { trees: new Set(wood.map((t) => t.id)), loops: lines.map((l) => corners(l.points)).filter((p) => p.length > 3), cover };
}

// Each wood: its outline (each side bulging out in bumps about cfg.bump
// long, the corners kept) filled with the paper colour, and the same shape
// hatched. `project(x, y)` gives the scene point of a world point.
export function forestSVG({ loops, cover }, project, cfg) {
  if (!loops.length) return '';
  let d = '';
  for (const loop of loops) {
    const pts = bumps(loop, cfg.bump);
    if (pts.length < 3) continue;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      let nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len; // a normal of a → b…
      if (cover(mx + nx * 0.05, my + ny * 0.05) > 0.5) [nx, ny] = [-nx, -ny]; // …the one pointing out of the wood
      const h = cfg.bump * cfg.bulge * (0.8 + 0.4 * wobble(mx, my));
      const [ax, ay] = project(...a), [cx, cy] = project(mx + nx * h, my + ny * h), [bx, by] = project(...b);
      d += i ? '' : `M${r2(ax)} ${r2(ay)}`;
      d += `Q${r2(cx)} ${r2(cy)} ${r2(bx)} ${r2(by)}`;
    }
    d += 'Z';
  }
  const s = cfg.hatch;
  return `<defs><pattern id="forest-hatch" patternUnits="userSpaceOnUse" width="${s}" height="${s}" patternTransform="rotate(-35)">`
    + `<line class="forest-hatch" x1="0" y1="${s / 2}" x2="${s}" y2="${s / 2}"/></pattern></defs>`
    + `<path class="forest" d="${d}"/><path class="forest-fill" d="${d}"/>`;
}

// A closed loop (first point repeated last) with only its corners: the
// points where it turns, the straight runs between them as single sides.
function corners(loop) {
  const pts = loop.slice(0, -1), out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-6) out.push(b);
  }
  return [...out, out[0]];
}

// The points of a closed loop with each side split into equal pieces about
// `step` long (at least one): every corner stays a point.
function bumps(loop, step) {
  const out = [];
  for (let i = 0; i < loop.length - 1; i++) {
    const [ax, ay] = loop[i], [bx, by] = loop[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
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

// 0..1, the same for the same point: the bumps aren't all alike.
function wobble(x, y) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

const r2 = (n) => Math.round(n * 100) / 100;
