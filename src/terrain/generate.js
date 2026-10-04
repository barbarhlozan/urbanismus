// Procedural environment for a fresh map. Each pass is independent, so new
// passes (hills, rivers, rock outcrops…) can be appended to generateWorld().

import { mulberry32, valueNoise2D } from '../core/random.js';
import { makeElevation } from './elevation.js';
import { RIVER_SIZES, STREAM } from './rivers.js';

export function generateWorld(world, config) {
  const rng = mulberry32(world.seed);
  generateRiver(world, rng, config.terrain);
  generateTributaries(world, rng, config.terrain);
  generateLakes(world, rng, config.terrain);
  generateTrees(world, rng, config.terrain);
}

function mapCenter(grid) {
  return [(grid.width - 1) / 2, (grid.height - 1) / 2];
}

// Lakes fill hollows in the elevation, as rain would: water runs off the
// map edges, and wherever it can't it collects and rises until it
// overflows – a pit spilling into a neighbouring one fills along with it.
// Each flooded patch is one lake with a flat surface, lower than all the dry
// ground around it, so its shore follows the lie of the land (and the
// renderer can draw it as a contour). Of the lakes, a few of the larger
// ones are kept – lowered when too big or too near the map centre.
// A river across the map, from one edge to the opposite one, along the low
// ground: the cheapest way over the dots, where higher ground costs more,
// with a little noise so it meanders, keeping out of the map centre and off
// the side edges. Smoothed into a curve that runs out past both edges; its
// water falls steadily from the higher end, and World.elevation cuts the
// valley for it. `opts.riverSize`: 'river' or 'stream' (RIVER_SIZES), or
// null for either.
function generateRiver(world, rng, opts) {
  if (rng() >= opts.riverChance) return;
  const { grid, terrain } = world;
  const { width, height, size } = grid;
  const [mx, my] = mapCenter(grid);
  const hills = makeElevation(world.seed, null, world.hilliness);
  const h = new Float32Array(size);
  for (let i = 0; i < size; i++) h[i] = hills(...grid.xy(i));
  const lo = Math.min(...h), hi = Math.max(...h);
  const meander = valueNoise2D(world.seed + 37, 4);

  // across the map along x or along y; `u` along the flow, `v` across it
  const alongX = rng() < 0.5;
  const uv = (i) => {
    const [x, y] = grid.xy(i);
    return alongX ? [x, y] : [y, x];
  };
  const [uMax, vMax] = alongX ? [width - 1, height - 1] : [height - 1, width - 1];
  const cost = (i) => {
    const [x, y] = grid.xy(i);
    const [, v] = uv(i);
    let c = 1 + 4 * (h[i] - lo) / (hi - lo) + 3 * meander(x, y);
    if (Math.hypot(x - mx, y - my) < opts.clearRadius) c += 20;
    const edge = Math.min(v, vMax - v);
    if (edge < 6) c += (6 - edge) * 2;
    return c;
  };

  // Dijkstra from every dot on the first edge to the nearest on the far one
  const total = new Float32Array(size).fill(Infinity);
  const prev = new Int32Array(size).fill(-1);
  const queue = new MinHeap((a, b) => total[a] - total[b]);
  for (let i = 0; i < size; i++) {
    const [u, v] = uv(i);
    if (u === 0 && v >= 6 && v <= vMax - 6) { total[i] = cost(i); queue.push(i); }
  }
  let end = -1;
  while (queue.size) {
    const n = queue.pop();
    if (uv(n)[0] === uMax) { end = n; break; }
    const [nx, ny] = grid.xy(n);
    for (const m of grid.neighbors(n)) {
      const [x, y] = grid.xy(m);
      const t = total[n] + Math.hypot(x - nx, y - ny) * cost(m);
      if (t < total[m]) { total[m] = t; prev[m] = n; queue.push(m); }
    }
  }
  if (end < 0) return;

  // The route, as its offset across the map at every step along it (the
  // mean where it runs sideways), smoothed into a gentle curve and then set
  // meandering: a wide bend and a smaller wiggle, from random phases, each
  // swelling and fading along the way so no two bends are alike. It runs
  // out past both edges and is eased away from the side edges and the map
  // centre (softly, so it bends off rather than running along them).
  const across = new Float32Array(uMax + 1), hits = new Float32Array(uMax + 1);
  for (let n = end; n >= 0; n = prev[n]) {
    const [u, v] = uv(n);
    across[u] += v;
    hits[u]++;
  }
  for (let u = 0; u <= uMax; u++) across[u] /= hits[u] || 1;
  const smooth = (u) => {
    let sum = 0, weight = 0;
    for (let k = -9; k <= 9; k++) {
      const w = Math.exp(-(k * k) / 18); // a Gaussian, 3 steps wide
      sum += across[Math.min(Math.max(Math.round(u) + k, 0), uMax)] * w;
      weight += w;
    }
    return sum / weight;
  };
  const waves = [[opts.meander[0], 14], [opts.meander[1], 6]].map(([amp, length], i) => ({
    amp, length, phase: rng() * Math.PI * 2, swell: valueNoise2D(world.seed + 41 + i, 10),
  }));
  // x kept above `lo`: unchanged well above it, bending off as it nears
  const above = (x, lo, k = 2) => (x >= lo + k ? x : lo + k * Math.exp((x - lo - k) / k));
  let points = [];
  for (let u = -4; u <= uMax + 4; u += 0.5) {
    let v = smooth(u);
    for (const { amp, length, phase, swell } of waves) v += amp * (0.3 + 1.4 * swell(u, 0)) * Math.sin((u / length) * Math.PI * 2 + phase);
    v = vMax - above(vMax - above(v, 4), 4);
    let [x, y] = alongX ? [u, v] : [v, u];
    const d = Math.hypot(x - mx, y - my) || 1, r = above(d, opts.clearRadius + 1);
    [x, y] = [mx + ((x - mx) / d) * r, my + ((y - my) / d) * r];
    points.push([x, y]);
  }
  for (let pass = 0; pass < 2; pass++) points = chaikin(points);
  if (hills(...points[0]) < hills(...points[points.length - 1])) points.reverse();

  const z = waterLevels(points, hills);

  const { width: w, vary, bend, wet, wall, reach } = RIVER_SIZES[opts.riverSize ?? (rng() < 0.5 ? 'river' : 'stream')];
  terrain.rivers = [{ points, z, width: w, vary, bend, wet, wall, reach }];
  const field = world.riverField;
  for (let i = 0; i < size; i++) if (field.wet(...grid.xy(i)) > 0) terrain.water[i] = 2;
}

// The water's surface along a river's points: it falls all the way, never
// above the ground it has come over (the lowest near its line, as the
// meanders swing it up the valley sides), and a little lower with every step.
function waterLevels(points, hills) {
  const lowest = (x, y) => {
    let e = hills(x, y);
    for (let r = 1; r <= 3; r++) {
      for (let a = 0; a < 8 * r; a++) {
        const t = (a / (8 * r)) * Math.PI * 2;
        e = Math.min(e, hills(x + Math.cos(t) * r, y + Math.sin(t) * r));
      }
    }
    return e;
  };
  const z = [];
  for (let k = 0; k < points.length; k++) {
    const ground = lowest(...points[k]);
    if (!k) { z.push(ground); continue; }
    z.push(Math.min(ground, z[k - 1] - FALL * dist(points[k], points[k - 1])));
  }
  return z;
}

const FALL = 0.15; // metres the water drops at least per grid step
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// the distance along a line to each of its points
const arcLengths = (points) => points.reduce((out, p, j) => (out.push(j ? out[j - 1] + dist(p, points[j - 1]) : 0), out), []);

// Tributaries: `opts.tributaries` streams from the map's edge into the
// river (or into one another; fewer when there is no room). Each starts
// high on an edge, away from the rivers and the other starts, and takes
// the cheapest way down to the nearest river dot – as the river does,
// higher ground costing more, with a little noise – keeping out of the
// map centre. Smoothed and set meandering, it runs out past its edge and
// at the other end bends downstream into the river, where its water comes
// down to meet the river's.
const TRIBUTARY = {
  apart: 10,      // grid steps a start keeps from the rivers…
  spread: 12,     // …and from the other starts
  corner: 6,      // and from the map's corners
  mouth: 6,       // grid steps a junction keeps from the map edges
  edge: 6,        // grid steps from the edges within which it costs more (so it leaves its edge, not runs along it)
  downstream: 1,  // grid steps down the river from the nearest point that it joins
  meander: [[1.1, 9], [0.4, 4]], // bends: grid steps it swings to the sides, and the length of a swing
  meet: 5,        // grid steps over which it comes down (or up) to the river's level
};

function generateTributaries(world, rng, opts) {
  if (!opts.tributaries || !world.terrain.rivers.length) return;
  const { grid, terrain } = world;
  const { width, height, size } = grid;
  const [mx, my] = mapCenter(grid);
  const hills = makeElevation(world.seed, null, world.hilliness);
  const h = new Float32Array(size);
  for (let i = 0; i < size; i++) h[i] = hills(...grid.xy(i));
  const lo = Math.min(...h), hi = Math.max(...h);
  const meander = valueNoise2D(world.seed + 53, 4);
  const toEdge = (x, y) => Math.min(x, y, width - 1 - x, height - 1 - y);
  const cost = (i) => {
    const [x, y] = grid.xy(i);
    let c = 1 + 4 * (h[i] - lo) / (hi - lo) + 3 * meander(x, y);
    if (Math.hypot(x - mx, y - my) < opts.clearRadius) c += 20;
    const edge = toEdge(x, y);
    if (edge < TRIBUTARY.edge) c += (TRIBUTARY.edge - edge) * 2;
    return c;
  };
  const starts = [];

  for (let k = 0; k < opts.tributaries; k++) {
    const field = world.riverField;
    // the start: the highest of a few edge dots far enough from everything
    const edge = [];
    for (let i = 0; i < size; i++) {
      const [x, y] = grid.xy(i);
      if (toEdge(x, y) > 0) continue;
      if (Math.min(x, width - 1 - x) < TRIBUTARY.corner && Math.min(y, height - 1 - y) < TRIBUTARY.corner) continue;
      if ((field.at(x, y)?.d ?? Infinity) < TRIBUTARY.apart) continue;
      if (starts.some((s) => dist(grid.xy(s), [x, y]) < TRIBUTARY.spread)) continue;
      edge.push(i);
    }
    if (!edge.length) return;
    let start = -1;
    for (let n = 0; n < 12; n++) {
      const i = edge[Math.floor(rng() * edge.length)];
      if (start < 0 || h[i] > h[start]) start = i;
    }
    starts.push(start);

    // the cheapest way to a river dot clear of the edges
    const total = new Float32Array(size).fill(Infinity);
    const prev = new Int32Array(size).fill(-1);
    const queue = new MinHeap((a, b) => total[a] - total[b]);
    total[start] = cost(start);
    queue.push(start);
    let end = -1;
    while (queue.size) {
      const n = queue.pop();
      if (terrain.isRiver(n) && toEdge(...grid.xy(n)) >= TRIBUTARY.mouth) { end = n; break; }
      const [nx, ny] = grid.xy(n);
      for (const m of grid.neighbors(n)) {
        const t = total[n] + dist(grid.xy(m), [nx, ny]) * cost(m);
        if (t < total[m]) { total[m] = t; prev[m] = n; queue.push(m); }
      }
    }
    if (end < 0) continue;
    const route = [];
    for (let n = end; n >= 0; n = prev[n]) route.unshift(grid.xy(n));

    // where it joins: a little downstream of the river's nearest point
    const join = joinPoint(terrain.rivers, route[route.length - 1], TRIBUTARY.downstream);

    // smoothed (a Gaussian over the route, its ends kept), out past the
    // edge, meandering (not near the junction), and into the river
    const last = route.length - 1;
    let points = route.map((p, k) => {
      if (k === 0 || k === last) return p;
      let sx = 0, sy = 0, sw = 0;
      for (let j = Math.max(0, k - 3); j <= Math.min(last, k + 3); j++) {
        const w = Math.exp(-((j - k) ** 2) / 4);
        sx += route[j][0] * w; sy += route[j][1] * w; sw += w;
      }
      return [sx / sw, sy / sw];
    });
    const [x0, y0] = route[0];
    const out = [x0 === 0 ? -1 : x0 === width - 1 ? 1 : 0, y0 === 0 ? -1 : y0 === height - 1 ? 1 : 0];
    points.unshift([x0 + out[0] * 4, y0 + out[1] * 4], [x0 + out[0] * 2, y0 + out[1] * 2]);
    points.push(join.point);
    let along = arcLengths(points), length = along[along.length - 1];
    const bends = TRIBUTARY.meander.map(([amp, wave]) => ({ amp, wave, phase: rng() * Math.PI * 2 }));
    points = points.map((p, j) => {
      if (j === 0 || j === points.length - 1) return p;
      const [ax, ay] = points[j - 1], [bx, by] = points[j + 1];
      const l = Math.hypot(bx - ax, by - ay) || 1;
      const fade = smoothstep(0, 3, length - along[j]);
      const o = fade * bends.reduce((sum, { amp, wave, phase }) => sum + amp * Math.sin((along[j] / wave) * Math.PI * 2 + phase), 0);
      return [p[0] - ((by - ay) / l) * o, p[1] + ((bx - ax) / l) * o];
    });
    for (let pass = 0; pass < 2; pass++) points = chaikin(points);

    // its water falls to the river's level at the junction: the last few
    // steps brought down to it, or (rarely, where the river runs higher)
    // raised so it still falls all the way
    const z = waterLevels(points, hills);
    along = arcLengths(points);
    length = along[along.length - 1];
    const over = Math.max(0, z[z.length - 1] - join.z);
    for (let j = 0; j < z.length; j++) z[j] -= over * smoothstep(TRIBUTARY.meet, 0, length - along[j]);
    z[z.length - 1] = join.z;
    for (let j = z.length - 2; j >= 0; j--) z[j] = Math.max(z[j], z[j + 1] + FALL * dist(points[j], points[j + 1]));

    const { width: w, vary, bend, wet, wall, reach } = STREAM;
    terrain.rivers = [...terrain.rivers, { points, z, width: w, vary, bend, wet, wall, reach }];
    const wider = world.riverField;
    for (let i = 0; i < size; i++) if (wider.wet(...grid.xy(i)) > 0) terrain.water[i] = 2;
  }
}

// The point `ahead` grid steps downstream of the rivers' line nearest to
// `at`, and the water's height there: { point, z }.
function joinPoint(rivers, at, ahead) {
  let best = null;
  for (const { points, z } of rivers) {
    for (let s = 1; s < points.length; s++) {
      const a = points[s - 1], b = points[s];
      const vx = b[0] - a[0], vy = b[1] - a[1], len2 = vx * vx + vy * vy || 1e-9;
      const t = Math.min(Math.max(((at[0] - a[0]) * vx + (at[1] - a[1]) * vy) / len2, 0), 1);
      const d = Math.hypot(a[0] + vx * t - at[0], a[1] + vy * t - at[1]);
      if (!best || d < best.d) best = { d, points, z, s, t };
    }
  }
  // walk on down the line (points run downstream)
  let { points, z, s, t } = best, left = ahead;
  while (true) {
    const a = points[s - 1], b = points[s], len = dist(a, b);
    const rest = (1 - t) * len;
    if (rest >= left || s === points.length - 1) {
      t = Math.min(1, t + (len ? left / len : 0));
      return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], z: z[s - 1] + (z[s] - z[s - 1]) * t };
    }
    left -= rest;
    s++;
    t = 0;
  }
}

function smoothstep(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

// Corner cutting: each segment's middle half kept, ends fixed.
function chaikin(points) {
  const out = [points[0]];
  for (let k = 1; k < points.length; k++) {
    const [ax, ay] = points[k - 1], [bx, by] = points[k];
    if (k > 1) out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
    if (k < points.length - 1) out.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
  }
  out.push(points[points.length - 1]);
  return out;
}

const POND = 3; // nodes: the smallest hollow kept as water

function generateLakes(world, rng, opts) {
  const { grid, terrain } = world;
  const { size } = grid;
  const [mx, my] = mapCenter(grid);
  const [minSize, maxSize] = opts.lakeSize;
  const wanted = opts.lakes[0] + Math.floor(rng() * (opts.lakes[1] - opts.lakes[0] + 1));
  const elevation = world.elevation;
  const h = new Float32Array(size);
  for (let i = 0; i < size; i++) h[i] = elevation(...grid.xy(i));
  const clear = (i) => {
    const [x, y] = grid.xy(i);
    return Math.hypot(x - mx, y - my) < opts.clearRadius + 2;
  };

  const surface = fillDepressions(grid, h);
  const flooded = (i) => surface[i] > h[i];
  const seen = new Uint8Array(size);
  const candidates = [];
  for (let i = 0; i < size; i++) {
    if (seen[i] || !flooded(i)) continue;
    const patch = floodPatch(grid, i, (n) => flooded(n) && !seen[n]);
    for (const n of patch) seen[n] = 1;
    const lake = lowerLake(grid, h, patch, maxSize, clear);
    if (lake.length < POND) continue;
    // bigger lakes more likely, but not always the same ones; hollows
    // under minSize only as ponds when there are too few big ones
    const score = lake.length * (0.4 + rng()) - (lake.length < minSize ? 1e6 : 0);
    candidates.push({ lake, score });
  }
  candidates.sort((a, b) => b.score - a.score);

  // keep lakes at least a dot of dry land apart (from the river too), so
  // they stay separate
  const taken = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (!terrain.isRiver(i)) continue;
    taken[i] = 1;
    for (const m of grid.neighbors(i)) taken[m] = 1;
  }
  let count = 0;
  for (const { lake } of candidates) {
    if (count >= wanted) break;
    if (lake.some((n) => taken[n])) continue;
    for (const n of lake) {
      terrain.water[n] = 1;
      taken[n] = 1;
      for (const m of grid.neighbors(n)) taken[m] = 1;
    }
    count++;
  }
}

// Water level per node once every hollow is filled to its overflow (priority
// flood from the map edges: Barnes et al. 2014). Equal to h on dry ground.
function fillDepressions(grid, h) {
  const { width, height, size } = grid;
  const surface = new Float32Array(size);
  const done = new Uint8Array(size);
  const queue = new MinHeap((a, b) => surface[a] - surface[b]);
  for (let i = 0; i < size; i++) {
    const [x, y] = grid.xy(i);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
      surface[i] = h[i];
      done[i] = 1;
      queue.push(i);
    }
  }
  while (queue.size) {
    const n = queue.pop();
    for (const m of grid.neighbors(n, false)) {
      if (done[m]) continue;
      done[m] = 1;
      surface[m] = Math.max(h[m], surface[n]);
      queue.push(m);
    }
  }
  return surface;
}

// Nodes connected to `start` (sideways, not diagonally) that pass `test`.
function floodPatch(grid, start, test) {
  const patch = [start];
  const seen = new Set(patch);
  for (let k = 0; k < patch.length; k++) {
    for (const m of grid.neighbors(patch[k], false)) {
      if (!seen.has(m) && test(m)) { seen.add(m); patch.push(m); }
    }
  }
  return patch;
}

// A flooded patch as a lake of at most `maxSize` nodes, none of them
// `blocked`: if need be the water is let down, keeping the deepest part
// that is still one piece. The lake stays below all dry ground around it.
function lowerLake(grid, h, patch, maxSize, blocked) {
  const sorted = patch.slice().sort((a, b) => h[a] - h[b]);
  let level = Infinity;
  if (sorted.length > maxSize) level = h[sorted[maxSize]];
  for (const n of patch) if (blocked(n)) level = Math.min(level, h[n]);
  if (level === Infinity) return patch;
  const inPatch = new Set(patch);
  return floodPatch(grid, sorted[0], (n) => inPatch.has(n) && h[n] < level);
}

class MinHeap {
  constructor(less) {
    this.less = less;
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(v) {
    const a = this.items;
    a.push(v);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (this.less(a[i], a[p]) >= 0) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }

  pop() {
    const a = this.items;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m]) < 0) m = l;
        if (r < a.length && this.less(a[r], a[m]) < 0) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

function generateTrees(world, rng, opts) {
  if (!opts.treeDensity) return;
  const { grid, terrain } = world;
  const [mx, my] = mapCenter(grid);
  const forest = valueNoise2D(world.seed + 23, 6);
  const threshold = opts.forestThreshold;

  for (let i = 0; i < grid.size; i++) {
    if (terrain.isWater(i)) continue;
    const [x, y] = grid.xy(i);
    if (Math.hypot(x - mx, y - my) < opts.clearRadius) continue;
    const n = forest(x, y);
    if (n < threshold || rng() > (n - threshold) * 3.2 * opts.treeDensity) continue;
    const ox = (rng() - 0.5) * 0.5, oy = (rng() - 0.5) * 0.5;
    const variant = rng() < 0.6 ? 0 : 1, scale = 0.8 + rng() * 0.45;
    // not out in a lake (its shore reaches up to 0.75 from the water dots)
    if (grid.neighbors(i).some((m) => {
      const [wx, wy] = grid.xy(m);
      return terrain.isWater(m) && Math.hypot(x + ox - wx, y + oy - wy) < 0.85;
    })) continue;
    world.addFeature('tree', i, { ox, oy, variant, scale });
  }
}
