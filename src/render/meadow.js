// Grass and wild flowers on open ground: sparse pen marks, like the tufts
// on a sketched map, on every dot with nothing built, planted or flowing
// on it. They are decoration only – not part of the world, not saved –
// grown at draw time from the map seed and the dot, so the same meadow
// always comes back the same, and building next door doesn't reshuffle it.
//
// Where what grows (see plant()):
//   meadow   tufts in patches (slow noise), some taller seed-head grasses,
//            daisies, dandelions, a thistle now and then,
//            field stones, molehills in short runs
//   verges   by roads and footpaths: poppies, cornflowers, daisies
//   shores   round lakes and along rivers: cattails and reeds
//   yards    just outside buildings' plots: nettles
//
// Detail tiers, each shown from a zoom up (the renderer sets mz0/1/2 on the
// layer, styles.css hides the rest):
//   0  a few tufts – always
//   1  the other tufts, stones, molehills, cattails – from render.lod.medium
//   2  flowers, seed heads, thistles, nettles – from MEADOW.close
//
// The map is drawn in square chunks of MEADOW.chunk dots, each a handful of
// merged <path>s (one per tier and pen), so the whole meadow is a few
// hundred elements, culled with the view and rebuilt only near a change.
//
// The glyphs are screen-facing polylines in grid units (u right, v up),
// like the trees in features/trees.js.

import { mulberry32, valueNoise2D } from '../core/random.js';
import { freeTest, railIndex } from './lots.js';

export const MEADOW = {
  chunk: 8,       // dots per chunk side
  tries: 3,       // candidate spots per dot
  // chance a candidate spot grows something: in the thick of a meadow
  // patch, by the water, on a verge, by a plot
  chance: { meadow: 0.12, shore: 0.3, verge: 0.12, yard: 0.05 },
  patch: 4.5,     // size of the grass patches, grid steps
  verge: 0.4,     // how far from a road or footpath the verge flowers reach
  close: 1.5,     // zoom from which tier 2 shows
  runs: 0.008,     // chance a dot starts a run of molehills
};

// ---------- where ----------

// Everything a chunk needs to know about the ground, worked out once per
// rebuild: (x, y, r) -> is a mark of radius r clear there, and what's near.
export function meadowGround(world, config) {
  const free = freeTest(world, config);
  const rails = railIndex(world, config);
  const { grid, terrain } = world;
  const field = world.riverField;
  const patch = valueNoise2D(world.seed ^ 0x6d6561, MEADOW.patch);
  const detail = valueNoise2D(world.seed ^ 0x677261, MEADOW.patch / 3);

  // nearest thing of a kind among the dots around (x, y): Euclidean for
  // water, Chebyshev (square plots) for structures and trees
  const nearest = (x, y, r, test, cheb) => {
    let best = Infinity;
    const cx = Math.round(x), cy = Math.round(y);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const n = grid.nodeAt(cx + dx, cy + dy);
        if (n < 0 || !test(n)) continue;
        const ex = Math.abs(cx + dx - x), ey = Math.abs(cy + dy - y);
        best = Math.min(best, cheb ? Math.max(ex, ey) : Math.hypot(ex, ey));
      }
    }
    return best;
  };

  return {
    // Is (x, y) open ground? null if not, else what's around it.
    at(x, y) {
      if (x < -0.45 || y < -0.45 || x > grid.width - 0.55 || y > grid.height - 0.55) return null;
      const built = nearest(x, y, 1, (n) => world.structureAt(n), true);
      if (built < 0.75) return null;                   // plots and yards
      if (nearest(x, y, 1, (n) => world.featureAt(n), true) < 0.5) return null; // tree clumps
      let shore = nearest(x, y, 2, (n) => terrain.isWater(n) && !terrain.isRiver(n), false) - 0.8;
      if (field) shore = Math.min(shore, -field.depth(x, y) - 0.1);
      if (shore < 0) return null;                      // in the water
      if (!free(x, y, 0.06) || rails.distance([x, y], 0.14) !== Infinity) return null;
      return {
        // thick in the patches, a stray tuft between them
        patch: (0.15 + 0.85 * smoothstep(0.3, 0.7, patch(x, y))) * (0.6 + 0.4 * detail(x, y)),
        shore,
        verge: !free(x, y, MEADOW.verge),
        yard: built < 1.3,
      };
    },
  };
}

const smoothstep = (a, b, t) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

// The painter's randomness API (range / int / chance / random) on a seed.
function rng(seed) {
  const random = mulberry32(seed);
  return {
    random,
    range: (a, b) => a + (b - a) * random(),
    int: (a, b) => a + Math.floor(random() * (b - a + 1)),
    chance: (p) => random() < p,
  };
}

const hash = (seed, x, y, k) => {
  let h = seed ^ Math.imul(x + 1000, 374761393) ^ Math.imul(y + 1000, 668265263) ^ Math.imul(k + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

// What grows on one dot: [{ x, y, tier, parts }…]. Each candidate spot has
// its own seed, so one lost to a new road leaves the others as they were.
export function plant(world, ground, cx, cy) {
  const out = [];
  const node = world.grid.nodeAt(cx, cy);
  if (node < 0 || world.terrain.isWater(node) || world.structureAt(node) || world.featureAt(node)) return out;
  const grow = (x, y, g, draw, h, tier) => out.push({ x, y, tier, parts: draw(g, h) });

  for (let i = 0; i < MEADOW.tries; i++) {
    const g = rng(hash(world.seed, cx, cy, i));
    const x = cx + g.range(-0.5, 0.5), y = cy + g.range(-0.5, 0.5);
    const roll = g.random(), pick = g.random();
    const at = ground.at(x, y);
    if (!at) continue;
    if (at.shore < 0.45) {
      if (roll < MEADOW.chance.shore) grow(x, y, g, pick < 0.6 ? cattail : tuft, pick < 0.6 ? 0.2 : 0.12, 1);
    } else if (at.verge) {
      if (roll < MEADOW.chance.verge) grow(x, y, g, pick < 0.35 ? poppies : pick < 0.55 ? daisy : pick < 0.65 ? dandelion : tuft, 0.1, pick < 0.65 ? 2 : 1);
    } else if (at.yard) {
      if (roll < MEADOW.chance.yard) grow(x, y, g, pick < 0.5 ? nettles : tuft, pick < 0.5 ? 0.15 : 0.11, pick < 0.5 ? 2 : 1);
    } else if (roll < MEADOW.chance.meadow * at.patch) {
      if (pick < 0.62) grow(x, y, g, tuft, g.range(0.09, 0.13), g.chance(0.4) ? 0 : 1);
      else if (pick < 0.76) grow(x, y, g, seedGrass, 0.13, 2);
      else if (pick < 0.83) grow(x, y, g, daisy, 0.08, 2);
      else if (pick < 0.89) grow(x, y, g, dandelion, 0.09, 2);
      else if (pick < 0.92) grow(x, y, g, thistle, 0.14, 2);
      else grow(x, y, g, stones, 0.1, 1);
    }
  }

  // a run of molehills across the meadow, a hill every ~0.3 steps
  const g = rng(hash(world.seed, cx, cy, 99));
  if (g.chance(MEADOW.runs)) {
    let a = g.range(0, Math.PI * 2);
    const n = g.int(3, 5);
    let [x, y] = [cx + g.range(-0.3, 0.3), cy + g.range(-0.3, 0.3)];
    for (let k = 0; k < n; k++, a += g.range(-0.5, 0.5)) { // the mole wanders
      const at = ground.at(x, y);
      if (at && at.patch > 0.3 && at.shore > 0.45 && !at.verge) grow(x, y, g, molehill, 0.065, 1);
      x += Math.cos(a) * g.range(0.22, 0.36);
      y += Math.sin(a) * g.range(0.22, 0.36);
    }
  }
  return out;
}

// ---------- drawing ----------

// A chunk's SVG: its dots' glyphs, anchored at `project(x, y)` (scene px),
// one <path> per tier and pen. `tile`: scene px per grid step.
export function chunkSVG(world, ground, x0, y0, project, tile) {
  const size = MEADOW.chunk;
  const runs = new Map(); // `${tier} ${pen}` -> path data
  const r1 = (n) => Math.round(n * 10) / 10;
  for (let cy = y0; cy < y0 + size; cy++) {
    for (let cx = x0; cx < x0 + size; cx++) {
      for (const { x, y, tier, parts } of plant(world, ground, cx, cy)) {
        const [sx, sy] = project(x, y);
        for (const [lines, pen] of parts) {
          if (!lines.length) continue;
          const key = `${tier} ${pen}`;
          let d = runs.get(key) ?? '';
          for (const pts of lines) d += pts.map(([u, v], i) => `${i ? 'L' : 'M'}${r1(sx + u * tile)} ${r1(sy - v * tile)}`).join('');
          runs.set(key, d);
        }
      }
    }
  }
  let svg = '';
  for (const [key, d] of [...runs].sort()) {
    const [tier, pen] = key.split(' ');
    svg += `<path class="t${tier}${pen ? ` ${pen}` : ''}" d="${d}"/>`;
  }
  return svg;
}

const polar = (a, r) => [Math.sin(a) * r, Math.cos(a) * r];
const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
const ring = (c, r, n, g) => Array.from({ length: n + 1 }, (_, i) => add(c, polar((i % n) / n * Math.PI * 2, r * g.range(0.85, 1.15))));

// Each glyph: (g, h) -> [[lines, pen]…], h its height in grid units; pen
// '' (the plain line), 'thin' or 'ink' (filled).

// Trs trávy – a tuft, one zigzag stroke: up the outer edge of each blade
// to a sharp tip and straight back down, middle blades tallest, outer ones
// leaning out; now and then a ground stroke running on past both ends.
function tuft(g, h, n = g.int(3, 6)) {
  const pts = [], bw = h * 0.13;
  let u = -n * bw / 2;
  const ground = g.chance(0.35);
  if (ground) pts.push([u - h * g.range(0.2, 0.45), 0]);
  pts.push([u, 0]);
  for (let i = 0; i < n; i++) {
    const c = n > 1 ? i / (n - 1) - 0.5 : 0;
    const H = h * (1 - Math.abs(c) * g.range(0.4, 0.9)) * g.range(0.6, 1.05);
    const lean = c * h * g.range(0.25, 0.6) + g.range(-0.06, 0.06) * h;
    pts.push([u + lean * 0.25 - Math.sign(c) * h * 0.02, H * 0.5], [u + lean + bw * 0.4, H]);
    u += bw * g.range(0.7, 1.3);
    pts.push([u, g.range(0, 0.12) * h]);
  }
  if (ground) pts.push([u + h * g.range(0.2, 0.5), 0]);
  return [[[pts], '']];
}

// Lipnice, bojínek, ovsík – a thin tuft with a few taller stalks: timothy
// with a closed spike, or oat grass with a nodding head.
function seedGrass(g, h) {
  const parts = tuft(g, h * 0.55, g.int(3, 4));
  const lines = [], ink = [];
  for (let i = g.int(1, 3); i > 0; i--) {
    const b = [g.range(-0.08, 0.08) * h, 0], a = g.range(-0.35, 0.35), H = h * g.range(0.9, 1.3);
    const top = add(b, polar(a, H)), mid = add(b, add(polar(a * 0.5, H * 0.55), [g.range(-0.04, 0.04) * h, 0]));
    if (g.chance(0.55)) {
      lines.push([b, mid, top]);
      const L = h * g.range(0.18, 0.26), w = h * 0.03, d = polar(a, 1), nrm = [d[1], -d[0]];
      const at = (t, s) => [top[0] + d[0] * L * t + nrm[0] * w * s, top[1] + d[1] * L * t + nrm[1] * w * s];
      ink.push([at(0, 0), at(0.25, 1), at(0.8, 0.9), at(1, 0), at(0.8, -0.9), at(0.25, -1), at(0, 0)]);
    } else {
      const tip = add(top, [Math.sign(a || 1) * h * 0.18, -h * 0.12]);
      lines.push([b, mid, top, tip]);
      for (let k = 0; k < 3; k++) {
        const t = 0.3 + k * 0.3, p = [top[0] + (tip[0] - top[0]) * t, top[1] + (tip[1] - top[1]) * t];
        lines.push([p, add(p, [g.range(-0.02, 0.03) * h, -h * g.range(0.07, 0.11)])]);
      }
    }
  }
  return [...parts, [lines, 'thin'], [ink, 'ink']];
}

// Kopretina, sedmikráska – a daisy: stem, a dot and a ring of petal ticks.
function daisy(g, h) {
  const top = [g.range(-0.1, 0.1) * h, h * g.range(0.75, 1)];
  const lines = [[[0, 0], [top[0] * 0.3 + h * g.range(-0.04, 0.04), top[1] * 0.5], top], [[0, h * 0.15], [h * g.range(0.1, 0.18), h * 0.3]]];
  const r0 = h * 0.045, r1 = h * g.range(0.14, 0.18), n = g.int(7, 9), rot = g.random();
  for (let i = 0; i < n; i++) {
    const a = (i + rot) / n * Math.PI * 2;
    lines.push([add(top, polar(a, r0 * 1.4)), add(top, polar(a, r1 * g.range(0.8, 1)))]);
  }
  return [[lines, 'thin'], [[ring(top, r0, 6, g)], 'ink']];
}

// Pampeliška – a dandelion clock: stem, a loose ring of seed ticks, a
// jagged leaf or two at the foot.
function dandelion(g, h) {
  const top = [g.range(-0.12, 0.12) * h, h * g.range(0.85, 1.1)];
  const lines = [[[0, 0], [top[0] * 0.2, top[1] * 0.5], top]];
  const r0 = h * 0.06, r1 = h * g.range(0.15, 0.2), n = g.int(10, 13);
  for (let i = 0; i < n; i++) {
    const a = (i + g.range(-0.2, 0.2)) / n * Math.PI * 2;
    lines.push([add(top, polar(a, r0)), add(top, polar(a, r1))]);
  }
  lines.push([[-h * 0.25, h * 0.02], [-h * 0.17, h * 0.1], [-h * 0.13, h * 0.05], [-h * 0.06, h * 0.12], [0, 0]]);
  if (g.chance(0.5)) lines.push([[0, 0], [h * 0.08, h * 0.1], [h * 0.12, h * 0.05], [h * 0.22, h * 0.1]]);
  return [[lines, 'thin']];
}

// Vlčí mák, chrpa – verge flowers: 2–3 stems, poppy heads inked in,
// cornflowers as small spiky stars, a little grass at the foot.
function poppies(g, h) {
  const lines = [], ink = [];
  for (let i = g.int(2, 3); i > 0; i--) {
    const b = [g.range(-0.2, 0.2) * h, 0], top = add(b, [g.range(-0.2, 0.2) * h, h * g.range(0.7, 1.1)]);
    lines.push([b, [(b[0] + top[0]) / 2 + g.range(-0.05, 0.05) * h, top[1] * 0.5], top]);
    if (g.chance(0.65)) {
      const r = h * g.range(0.07, 0.1);
      ink.push([[-r, r * 0.3], [-r * 0.7, r * 1.2], [0, r * 0.8], [r * 0.7, r * 1.2], [r, r * 0.3], [r * 0.3, -r * 0.2], [-r * 0.3, -r * 0.2], [-r, r * 0.3]].map((p) => add(top, p)));
    } else {
      const c = add(top, [0, h * 0.06]);
      for (let k = 0; k < 7; k++) lines.push([c, add(c, polar(k / 7 * Math.PI * 2 + g.random(), h * g.range(0.06, 0.1)))]);
    }
  }
  lines.push(...tuft(g, h * 0.4, 3)[0][0]);
  return [[lines, 'thin'], [ink, 'ink']];
}

// Bodlák – a thistle: stiff stem, jagged leaves, an inked cup and a spray.
function thistle(g, h) {
  const top = [g.range(-0.05, 0.05) * h, h];
  const lines = [[[0, 0], [top[0] * 0.5, h * 0.5], top]];
  for (const [v, s] of [[0.3, -1], [0.5, 1], [0.7, -1]]) {
    const p = [top[0] * v, h * v], L = h * g.range(0.18, 0.26) * s;
    lines.push([p, [p[0] + L * 0.35, p[1] + h * 0.08], [p[0] + L * 0.45, p[1] + h * 0.02], [p[0] + L * 0.75, p[1] + h * 0.1], [p[0] + L * 0.8, p[1] + h * 0.04], [p[0] + L, p[1] + h * 0.12]]);
  }
  const w = h * 0.09;
  const cup = [[-w, h * 0.08], [-w * 0.6, -h * 0.02], [w * 0.6, -h * 0.02], [w, h * 0.08], [-w, h * 0.08]].map((p) => add(top, p));
  for (let k = 0; k < 6; k++) {
    const u = -w + 2 * w * k / 5;
    lines.push([add(top, [u, h * 0.08]), add(top, [u * 1.5, h * g.range(0.18, 0.24)])]);
  }
  return [[lines, 'thin'], [[cup], 'ink']];
}

// Kopřivy – a nettle patch: upright stems with pairs of leaves pointing up.
function nettles(g, h) {
  const lines = [];
  for (let i = g.int(3, 5); i > 0; i--) {
    const b = [g.range(-0.3, 0.3) * h, 0], H = h * g.range(0.7, 1.05), lean = g.range(-0.08, 0.08) * h;
    lines.push([b, [b[0] + lean, H]]);
    for (let k = 1; k <= 3; k++) {
      const t = k / 4 + 0.08, p = [b[0] + lean * t, H * t], L = h * 0.13 * (1.1 - t * 0.5);
      lines.push([[p[0] - L, p[1] + L * 0.8], [p[0] - L * 0.6, p[1] + L * 0.2], p, [p[0] + L * 0.6, p[1] + L * 0.2], [p[0] + L, p[1] + L * 0.8]]);
    }
  }
  return [[lines, 'thin']];
}

// Krtina – a molehill: a lumpy mound on a ground stroke, shading down the
// right flank, crumbs of soil beside it.
function molehill(g, h) {
  const w = h * g.range(0.9, 1.15), H = h * g.range(0.55, 0.7);
  const out = [];
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI * (1 - i / 8);
    out.push([Math.cos(a) * w, Math.sin(a) * H * g.range(0.92, 1.1)]);
  }
  const lines = [[[-w - h * g.range(0.1, 0.3), 0], ...out, [w + h * g.range(0.1, 0.35), 0]]];
  for (let k = 0; k < 3; k++) {
    const a = 0.25 + k * 0.3, p = [Math.cos(a) * w * 0.72, Math.sin(a) * H * 0.72];
    lines.push([p, [p[0] + h * 0.1, Math.max(0, p[1] - h * 0.18)]]);
  }
  for (const s of [-1, 1]) {
    if (!g.chance(0.7)) continue;
    const p = [s * w * g.range(1.15, 1.4), h * 0.06];
    lines.push([p, add(p, [h * 0.05, h * 0.03])]);
  }
  return [[lines, 'thin']];
}

// Orobinec, rákos – cattails and reeds: long arching blades and a stalk or
// two with an inked cob, or a reed plume.
function cattail(g, h) {
  const lines = [], ink = [];
  for (let i = g.int(4, 6); i > 0; i--) {
    const b = [g.range(-0.12, 0.12) * h, 0], a = g.range(-0.45, 0.45), H = h * g.range(0.6, 1);
    lines.push([b, add(b, polar(a * 0.6, H * 0.55)), add(b, polar(a, H))]);
  }
  for (let i = g.int(1, 2); i > 0; i--) {
    const b = [g.range(-0.08, 0.08) * h, 0], a = g.range(-0.12, 0.12), H = h * g.range(1.05, 1.3);
    const top = add(b, polar(a, H));
    lines.push([b, top, add(top, polar(a, h * 0.12))]);
    if (g.chance(0.75)) {
      const d = polar(a, 1), nrm = [d[1], -d[0]], L = h * 0.24, w = h * 0.045;
      const at = (t, s) => [top[0] - d[0] * L * (1 - t) + nrm[0] * w * s, top[1] - d[1] * L * (1 - t) + nrm[1] * w * s];
      ink.push([at(0, -0.7), at(0, 0.7), at(0.1, 1), at(0.9, 1), at(1, 0.6), at(1, -0.6), at(0.9, -1), at(0.1, -1), at(0, -0.7)]);
    } else {
      for (let k = 0; k < 4; k++) lines.push([top, add(top, polar(a + 0.6 + k * 0.25, h * g.range(0.1, 0.16)))]);
    }
  }
  return [[lines, 'thin'], [ink, 'ink']];
}

// Kamení – a field stone or two.
function stones(g, h) {
  const lines = [];
  for (let i = g.int(1, 3); i > 0; i--) {
    const c = g.range(-0.5, 0.5) * h, w = h * g.range(0.18, 0.32), H = w * g.range(0.5, 0.8);
    lines.push([[c - w, 0], [c - w * 0.8, H * 0.7], [c - w * 0.2, H], [c + w * 0.6, H * 0.8], [c + w, 0.05 * h], [c - w - h * 0.05, 0]]);
    lines.push([[c + w * 0.3, H * 0.5], [c + w * 0.7, H * 0.15]]);
  }
  return [[lines, '']];
}
