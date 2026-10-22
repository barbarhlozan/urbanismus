// Woods far out (config.render.forest). Below its zoom the trees that stand
// together in a wood aren't drawn one by one: each wood is one shape, its
// edge a run of small bumps about a tree crown across, the way an old map
// draws woodland by hand – the pen lifted and set down again now and then –
// hatched only in a band just inside that edge, with a tree drawn here and
// there further in (the game's own trees, features/trees.js, at their
// plainest). Lone trees and small groups stay trees.
//
//   findForests(world, cfg, ways)    { trees: Set of feature ids in woods, loops, woods }
//   forestSVG({ woods, cover }, project, cfg, camera) the layer's SVG (Renderer.renderForest)
//
// The outline is the line where the woods' cover (each tree's crown,
// fading out over `reach`) is half full: the contours of that field, then
// straightened – every point that lies within `straighten` of a straight
// line between its neighbours is dropped – and rounded off again on the
// map (scallops) before the bumps go along it. Roads and railways are cut
// out of the cover (`ways`), so a wood stops at their edge. The hatching's
// spacing is set on screen by the renderer as the zoom changes
// (Renderer.forestHatch, the pattern #forest-hatch).

import { contours } from '../terrain/elevation.js';
import { seedOf } from './sketch.js';
import { mulberry32 } from '../core/random.js';
import { Painter } from './painter.js';
import { mergeRuns } from './order.js';
import { drawTree } from '../../features/trees.js';

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
  if (!wood.length) return { trees: new Set(), loops: [], woods: [], woodOf: new Map(), cover: () => 0 };

  // the cover: 1 at a tree, 0 from `reach` away; the outline at 0.5
  const woodCells = buckets(wood, cfg.reach);
  const cover = (x, y) => {
    // (the nearest tree's, by its squared distance: sampled all over the woods)
    let d2 = cfg.reach * cfg.reach;
    near(woodCells, cfg.reach, x, y, (i) => {
      const dx = wood[i].x - x, dy = wood[i].y - y, e = dx * dx + dy * dy;
      if (e < d2) d2 = e;
    });
    let c = 1 - Math.sqrt(d2) / cfg.reach;
    // half full right at the clearance off a road, nothing nearer it
    if (c > 0 && ways) c = Math.min(c, 0.5 + Math.min(1, ways.distance([x, y], cfg.clear + 1) - cfg.clear));
    return c;
  };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of wood) {
    x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x); y1 = Math.max(y1, t.y);
  }
  // the outline sampled from the cover on a grid, laid tree by tree (each
  // over the samples within its reach) rather than asked sample by sample
  const pad = cfg.reach + cfg.step, step = cfg.step;
  const X0 = x0 - pad, Y0 = y0 - pad;
  const nx = Math.ceil((x1 + pad - X0) / step) + 1, ny = Math.ceil((y1 + pad - Y0) / step) + 1;
  const reach2 = cfg.reach * cfg.reach, n = Math.ceil(cfg.reach / step);
  const d2 = new Float64Array(nx * ny).fill(reach2);
  for (const t of wood) {
    const ci = Math.round((t.x - X0) / step), cj = Math.round((t.y - Y0) / step);
    for (let j = Math.max(0, cj - n); j <= Math.min(ny - 1, cj + n); j++) {
      const dy = Y0 + j * step - t.y;
      for (let i = Math.max(0, ci - n); i <= Math.min(nx - 1, ci + n); i++) {
        const dx = X0 + i * step - t.x, e = dx * dx + dy * dy;
        if (e < d2[j * nx + i]) d2[j * nx + i] = e;
      }
    }
  }
  const grid = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let c = 1 - Math.sqrt(d2[k]) / cfg.reach;
      if (c > 0 && ways) c = Math.min(c, 0.5 + Math.min(1, ways.distance([X0 + i * step, Y0 + j * step], cfg.clear + 1) - cfg.clear));
      grid[k] = c;
    }
  }
  const sampled = (x, y) => grid[Math.round((y - Y0) / step) * nx + Math.round((x - X0) / step)];
  const lines = contours(sampled, [X0, Y0, x1 + pad, y1 + pad], { step, interval: 0.5, index: 1, only: 0.5 });
  const loops = lines.map((l) => straighten(l.points, cfg.straighten)).filter((p) => p.length > 3);
  return { trees: new Set(wood.map((t) => t.id)), loops, ...woodsOf(loops, wood, root, trees), cover };
}

// The woods one by one, so each can turn into its shape at its own zoom
// (Renderer.updateWoods): `woods`, each { id, loops, trees } – its outline
// and the clearings in it, the ids of the trees it stands for, and its id
// (its lowest tree id, so it keeps it as trees come and go elsewhere) –
// and `woodOf`, tree id -> wood id. A tree the straightened outline left
// out goes with the wood of the others in its group.
function woodsOf(loops, wood, root, trees) {
  // (each outline's box, to pass most of them over at once)
  const boxes = loops.map((l) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of l) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return [x0, y0, x1, y1];
  });
  const within = (k, x, y) => {
    const b = boxes[k];
    return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && inside(loops[k], x, y);
  };
  // a loop inside an odd number of others is a clearing in the innermost
  const depth = loops.map((l, i) => loops.reduce((n, o, k) => n + (k !== i && within(k, ...l[0]) ? 1 : 0), 0));
  const woods = [];
  const at = new Map(); // loop index of an outline -> its wood
  loops.forEach((l, i) => {
    if (depth[i] % 2) return;
    const w = { id: Infinity, loops: [l], trees: [] };
    at.set(i, w);
    woods.push(w);
  });
  loops.forEach((l, i) => {
    if (!(depth[i] % 2)) return;
    const j = loops.findIndex((o, k) => depth[k] === depth[i] - 1 && within(k, ...l[0]));
    at.get(j)?.loops.push(l);
  });
  const index = new Map(trees.map((t, i) => [t.id, i]));
  const byGroup = new Map(), lost = [];
  const outlines = [...at.keys()];
  for (const t of wood) {
    // the innermost outline around it
    let best = -1;
    for (const i of outlines) if ((best < 0 || depth[i] > depth[best]) && within(i, t.x, t.y)) best = i;
    if (best < 0) { lost.push(t); continue; }
    at.get(best).trees.push(t.id);
    byGroup.set(root(index.get(t.id)), at.get(best));
  }
  for (const t of lost) byGroup.get(root(index.get(t.id)))?.trees.push(t.id);
  const woodOf = new Map();
  for (const w of woods) {
    for (const id of w.trees) {
      w.id = Math.min(w.id, id);
      woodOf.set(id, w.id);
    }
  }
  return { woods: woods.filter((w) => w.trees.length), woodOf };
}

// The woods given: each one's shape filled with the paper colour, its edge
// drawn by hand in bumps (scallops), hatched in a band `cfg.band` grid
// steps wide just inside it (the edge stroked wide with the hatching,
// clipped to the shape), and its tree signs (signs()). `project(x, y)`
// gives the scene point of a world point; `camera` draws the signs' trees.
// `hatch`: the hatching's spacing in scene px.
export function forestSVG({ woods, cover }, project, cfg, camera, hatch = cfg.hatch) {
  const loops = woods.flatMap((w) => w.loops);
  if (!loops.length) return '';
  const size = cfg.scallop * camera.tile;
  let fill = '', edge = '';
  for (const w of woods) {
    w.loops.forEach((loop, i) => {
      const pts = loop.slice(0, -1).map((p) => project(...p));
      // the bumps stand out of the wood: out of its outline, into its clearings (i > 0)
      const out = scallops(pts, size, seedOf(w.id, i, 11), i === 0);
      fill += out.fill;
      edge += out.edge;
    });
  }
  const s = hatch, band = cfg.band * camera.tile * 2;
  return `<defs><pattern id="forest-hatch" patternUnits="userSpaceOnUse" width="${r2(s)}" height="${r2(s)}" patternTransform="rotate(-35)">`
    + `<line class="forest-hatch" x1="0" y1="${r2(s / 2)}" x2="${r2(s)}" y2="${r2(s / 2)}"/></pattern>`
    + `<clipPath id="forest-clip"><path d="${fill}" clip-rule="evenodd"/></clipPath></defs>`
    + `<path class="forest" d="${fill}"/>`
    + `<path class="forest-band" d="${fill}" stroke-width="${r2(band)}" clip-path="url(#forest-clip)"/>`
    + `<path class="forest-edge" d="${edge}"/>`
    + signs(loops, cover, project, cfg, camera);
}

// A wood's edge on the map (a closed loop of scene points, not repeated at
// the end): first rounded off (two rounds of corner cutting), then gone
// round in arcs about `size` px across, each its own length (±30 %), each
// bulging a third of that out of the wood – `out`: out of the loop (an
// outline), or into it (a clearing). `fill`: one closed path; `edge`: the
// same drawn by hand, each arc a little off, the pen now and then lifted
// and set down again a touch off the line.
function scallops(loop, size, seed, out) {
  const rnd = mulberry32(seed);
  let pts = loop;
  for (let k = 0; k < 2; k++) {
    pts = pts.flatMap((a, i) => {
      const b = pts[(i + 1) % pts.length];
      return [[a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]];
    });
  }
  // the arcs' ends, at seeded lengths along the loop
  const lens = pts.map((a, i) => Math.hypot(pts[(i + 1) % pts.length][0] - a[0], pts[(i + 1) % pts.length][1] - a[1]));
  const total = lens.reduce((a, b) => a + b, 0);
  const n = Math.max(6, Math.round(total / size));
  const steps = Array.from({ length: n }, () => 0.7 + rnd() * 0.6);
  const sum = steps.reduce((a, b) => a + b, 0);
  const ends = [];
  let seg = 0, along = 0, at = 0;
  for (const st of steps) {
    const [ax, ay] = pts[seg], [bx, by] = pts[(seg + 1) % pts.length];
    const t = lens[seg] ? (at - along) / lens[seg] : 0;
    ends.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    at += (st / sum) * total;
    while (seg < pts.length - 1 && along + lens[seg] < at) along += lens[seg++];
  }
  // which side is out: the loop's turn (shoelace) says where its inside is
  let area = 0;
  pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; });
  const side = (area > 0 ? -1 : 1) * (out ? 1 : -1);
  let fill = `M${r2(ends[0][0])} ${r2(ends[0][1])}`, edge = fill;
  ends.forEach((a, i) => {
    const b = ends[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const bulge = len * (0.55 + rnd() * 0.2) * side;
    const c = [(a[0] + b[0]) / 2 - (dy / len) * bulge, (a[1] + b[1]) / 2 + (dx / len) * bulge];
    fill += `Q${r2(c[0])} ${r2(c[1])} ${r2(b[0])} ${r2(b[1])}`;
    // by hand: the bulge a little off, and now and then a fresh stroke
    const j = () => (rnd() - 0.5) * len * 0.12;
    if (i && rnd() < 0.14) edge += `M${r2(a[0] + j())} ${r2(a[1] + j())}`;
    edge += `Q${r2(c[0] + j())} ${r2(c[1] + j())} ${r2(b[0])} ${r2(b[1])}`;
  });
  return { fill: fill + 'Z', edge };
}

// Trees standing in the woods, as a map marks a forest: one about every
// `cfg.signs` grid steps (a jittered grid), well inside a wood (where its
// cover is at least `cfg.signCover`). They're the game's own trees
// (features/trees.js) at their plainest – a few drawn once (SIGN_KINDS),
// then copied into place (not <use>: the copies would miss the map's styles,
// which go by the layer they're in) – `cfg.signSize` grid steps tall,
// `cfg.spruces` of them spruces.
function signs(loops, cover, project, cfg, camera) {
  const g = cfg.signs;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const loop of loops) for (const [x, y] of loop) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const placed = [];
  for (let gy = Math.floor(y0 / g); gy <= y1 / g; gy++) {
    for (let gx = Math.floor(x0 / g); gx <= x1 / g; gx++) {
      // stagger every other row, and jitter each a little
      const rnd = mulberry32(seedOf(gx, gy, 7));
      const x = (gx + 0.5 + (gy % 2) * 0.5 + (rnd() - 0.5) * 0.5) * g, y = (gy + 0.5 + (rnd() - 0.5) * 0.5) * g;
      if (cover(x, y) < cfg.signCover || !loops.some((l) => inside(l, x, y))) continue;
      const spruce = rnd() < cfg.spruces;
      const kinds = SIGN_KINDS.map((k, i) => [k, i]).filter(([k]) => (k === 'spruce') === spruce);
      const [, i] = kinds[Math.floor(rnd() * kinds.length)];
      placed.push([i, ...project(x, y)]);
    }
  }
  if (!placed.length) return '';
  // each tree drawn at the map's origin, moved so its foot is at 0, 0
  const [ax, ay] = camera.project(0, 0, 0);
  const art = SIGN_KINDS.map((kind, i) => {
    const painter = new Painter(camera, { x: 0, y: 0, z: 0 }, 0, 9173 + i * 7919);
    painter.rigid = [0, 0];
    painter.detail = 2;
    drawTree(painter, 0, 0, kind, cfg.signSize * (kind === 'spruce' ? 1.2 : 1), true);
    return mergeRuns(painter.toSVG());
  });
  // back to front, so nearer trees overlap those behind
  placed.sort((a, b) => a[2] - b[2]);
  return placed.map(([i, sx, sy]) => `<g transform="translate(${r2(sx - ax)} ${r2(sy - ay)})">${art[i]}</g>`).join('');
}

// The trees the signs are drawn from (features/trees.js kinds), two of each
// look so neighbours differ.
const SIGN_KINDS = ['spruce', 'spruce', 'spreading', 'spreading', 'sapling'];

// Is world point (x, y) inside the closed loop (even–odd)?
function inside(loop, x, y) {
  let n = false;
  for (let i = 1; i < loop.length; i++) {
    const [ax, ay] = loop[i - 1], [bx, by] = loop[i];
    if ((ay > y) !== (by > y) && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) n = !n;
  }
  return n;
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
// (cells keyed by a number: the cover asks for them hundreds of thousands of times)
const cellKey = (i, j) => (i + 32768) * 65536 + (j + 32768);

function buckets(list, size) {
  const cells = new Map();
  list.forEach((t, i) => {
    const k = cellKey(Math.floor(t.x / size), Math.floor(t.y / size));
    (cells.get(k) ?? cells.set(k, []).get(k)).push(i);
  });
  return { cells, size };
}

function near({ cells, size }, r, x, y, fn) {
  const n = Math.ceil(r / size);
  const cx = Math.floor(x / size), cy = Math.floor(y / size);
  for (let i = cx - n; i <= cx + n; i++) {
    for (let j = cy - n; j <= cy + n; j++) {
      const list = cells.get(cellKey(i, j));
      if (list) for (const k of list) fn(k);
    }
  }
}

const r2 = (n) => Math.round(n * 100) / 100;
