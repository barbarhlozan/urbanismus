// Pastures: ground closed in all round by fences (the 'fence' network, on
// the dense dots). Found by filling in from the edge of the map: whatever
// the fill can't reach is fenced in, and each piece of it apart is one
// pasture. A fence piece where a road or railway crosses it leaves a gap –
// a road through a pasture opens it.
//
// The fill runs over the squares between the dense dots, each cut into
// four triangles (top, right, bottom, left, meeting in the middle), so a
// fence running diagonally across a square closes it off too.
//
// findPastures(world) -> { list: [{ id, tris, area, nodes, slope }],
//   at(x, y): the pasture's index at a world position (-1 outside),
//   pick(p, rnd): a random world position in pasture p }
// `area` in grid squares, `nodes` the main dots inside (not on the fence), `slope` their
// average (World.slopeAt).

import { edgeKey } from '../roads/network.js';

// Triangles of a square: 0 top, 1 right, 2 bottom, 3 left.
const N = 0, E = 1, S = 2, W = 3;

export function findPastures(world) {
  const fine = world.fine, fences = world.fences;
  const cw = fine.width - 1, ch = fine.height - 1;
  const at = (i, j) => fine.index(i, j);
  // a fence between two dense dots that still stands closed (no road or
  // railway through it)
  const gap = (f) => world.roadAtFine(f) || world.rails.hasNode(f);
  const fenced = (a, b) => fences.hasEdge(a, b) && !gap(a) && !gap(b);

  const empty = { list: [], at: () => -1, pick: () => null };
  if (!fences.edgeCount) return empty;

  // the triangle's neighbours that nothing fences off: [triangle, …], -1 the outside
  const around = (k) => {
    const cell = k >> 2, t = k & 3, i = cell % cw, j = (cell - i) / cw;
    const TL = at(i, j), TR = at(i + 1, j), BL = at(i, j + 1), BR = at(i + 1, j + 1);
    const out = [];
    const tri = (ci, cj, tt) => (ci < 0 || cj < 0 || ci >= cw || cj >= ch ? -1 : ((cj * cw + ci) << 2) | tt);
    // across the square's side
    if (t === N && !fenced(TL, TR)) out.push(tri(i, j - 1, S));
    if (t === S && !fenced(BL, BR)) out.push(tri(i, j + 1, N));
    if (t === W && !fenced(TL, BL)) out.push(tri(i - 1, j, E));
    if (t === E && !fenced(TR, BR)) out.push(tri(i + 1, j, W));
    // within the square, unless a diagonal runs between
    const d1 = fenced(TL, BR), d2 = fenced(TR, BL);
    const inner = { [N]: [[E, d2], [W, d1]], [E]: [[N, d2], [S, d1]], [S]: [[E, d1], [W, d2]], [W]: [[N, d1], [S, d2]] }[t];
    for (const [tt, cut] of inner) if (!cut) out.push((cell << 2) | tt);
    return out;
  };

  // fill in from the outside: every triangle on the map's edge open to it
  const count = cw * ch * 4;
  const region = new Int32Array(count).fill(-2); // -2 not reached yet, -1 outside, else pasture
  const queue = [];
  const seed = (k) => {
    if (region[k] !== -2) return;
    if (around(k).includes(-1)) {
      region[k] = -1;
      queue.push(k);
    }
  };
  for (let i = 0; i < cw; i++) {
    seed((i << 2) | N);
    seed((((ch - 1) * cw + i) << 2) | S);
  }
  for (let j = 0; j < ch; j++) {
    seed(((j * cw) << 2) | W);
    seed(((j * cw + cw - 1) << 2) | E);
  }
  flood(queue, region, around, -1);

  // what's left, in pieces
  const list = [];
  for (let k = 0; k < count; k++) {
    if (region[k] !== -2) continue;
    const id = list.length;
    region[k] = id;
    const tris = flood([k], region, around, id);
    list.push({ id, tris, area: tris.length / 16 });
  }
  if (!list.length) return empty;

  // where in the triangles a world position is
  const triAt = (x, y) => {
    const fx = 2 * x, fy = 2 * y;
    const i = Math.min(cw - 1, Math.max(0, Math.floor(fx))), j = Math.min(ch - 1, Math.max(0, Math.floor(fy)));
    const u = fx - i, v = fy - j;
    const t = v <= u && v <= 1 - u ? N : u >= v && u >= 1 - v ? E : v >= u && v >= 1 - u ? S : W;
    return ((j * cw + i) << 2) | t;
  };
  const inside = (x, y) => (x < 0 || y < 0 || x > (fine.width - 1) / 2 || y > (fine.height - 1) / 2 ? -1 : region[triAt(x, y)]);

  // the main dots in each, and how steep it is there
  for (const p of list) p.nodes = [];
  for (let n = 0; n < world.grid.size; n++) {
    if (fences.hasNode(world.coarseToFine(n))) continue; // (on the fence itself)
    const [x, y] = world.grid.xy(n);
    const r = inside(x + 0.1, y + 0.2); // (just off the dot, in one of its triangles)
    if (r >= 0) list[r].nodes.push(n);
  }
  for (const p of list) p.slope = p.nodes.length ? p.nodes.reduce((a, n) => a + world.slopeAt(n), 0) / p.nodes.length : 0;

  // a random spot in a triangle of the pasture
  const pick = (p, rnd = Math.random) => {
    const k = list[p].tris[Math.floor(rnd() * list[p].tris.length)];
    const cell = k >> 2, t = k & 3, i = cell % cw, j = (cell - i) / cw;
    const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
    const a = corners[t], b = corners[(t + 1) % 4], c = [i + 0.5, j + 0.5];
    let u = rnd(), v = rnd();
    if (u + v > 1) [u, v] = [1 - u, 1 - v];
    return [(a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v) / 2, (a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v) / 2];
  };

  return { list, at: inside, pick };
}

// Spread `label` from the triangles in `queue` to all they reach.
function flood(queue, region, around, label) {
  for (let q = 0; q < queue.length; q++) {
    for (const m of around(queue[q])) {
      if (m < 0 || region[m] !== -2) continue;
      region[m] = label;
      queue.push(m);
    }
  }
  return queue;
}

// Gates: where a footpath goes through a fence. Walkers pass, the pasture
// stays closed. { at: fence dots a path runs through (it has a path step
// that isn't along the fence), across: edgeKeys of diagonal fence pieces a
// diagonal path crosses in the middle of their square }.
export function fenceGates(world) {
  const fences = world.fences, paths = world.paths, fine = world.fine;
  const at = new Set(), across = new Set();
  for (const n of fences.nodes()) {
    if (paths.hasNode(n) && [...paths.neighbors(n)].some((m) => !fences.hasEdge(n, m))) at.add(n);
  }
  for (const [a, b] of fences.edges()) {
    const [ax, ay] = fine.xy(a), [bx, by] = fine.xy(b);
    if (ax === bx || ay === by) continue;
    if (paths.hasEdge(fine.index(bx, ay), fine.index(ax, by))) across.add(edgeKey(a, b));
  }
  return { at, across };
}
