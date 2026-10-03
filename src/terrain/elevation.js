// Elevation: the lie of the land, drawn as contour lines. It is worked out
// from the map seed (so it needs no saving) and is only drawn for now –
// nothing stands higher for it (that is Terrain.height).
//
//   makeElevation(seed, rivers, hilliness)  (x, y) -> metres, smooth hills
//                                plus a little roughness, with river valleys
//                                cut in (use World.elevation, which caches it)
//   contours(elev, box, opts)  polylines of equal elevation (marching squares)

import { valueNoise2D } from '../core/random.js';
import { RIVER } from './rivers.js';

export const ELEVATION = {
  relief: 160,   // metres from the lowest to the highest possible point
                 // (times the map's hilliness when that is above 1)
  base: 500,     // metres above sea of elevation 0, for the contour labels
                 // (a multiple of interval * index, so labels stay round)
  interval: 5,   // metres between contour lines
  index: 4,      // every n-th line is an index line (brighter, labelled);
                 // every other line is kept at mid zoom, the rest only close up
  steep: { from: 2, interval: 10 }, // hilliness from which lines are spaced wider
  step: 0.2,     // sampling step in grid units (smaller = smoother, slower)
};

// `rivers`: a riverField (terrain/rivers.js) or null. Around a river the
// ground is shaped into a valley: flat at the water across the channel,
// then rising by RIVER.wall per step. Higher ground is cut down to it,
// blended in softly and fading out by RIVER.reach – so the contour lines
// bend upstream where they cross – and ground lower than the water is
// banked up right beside the channel, so no river runs along a hillside.
// `hilliness` scales the hills (1 = as generated, below 1 flatter, above
// steeper; chosen for a new map, kept in the save).
export function makeElevation(seed, rivers = null, hilliness = 1) {
  const hills = makeHills(seed, hilliness);
  if (!rivers) return hills;
  const { wall, reach } = RIVER;
  const fade = (d, from, to) => {
    const t = Math.min(Math.max((d - from) / (to - from), 0), 1);
    return 1 - t * t * (3 - 2 * t);
  };
  return (x, y) => {
    const e = hills(x, y);
    const r = rivers.at(x, y);
    if (!r || r.d >= reach) return e;
    const bank = rivers.halfWidth(x, y);
    const valley = r.z + Math.max(0, r.d - bank) * wall;
    if (e < valley) return e + (valley - e) * fade(r.d, bank, bank + 2);
    return e - (e - softMin(e, valley, 4)) * fade(r.d, reach / 2, reach);
  };
}

// min(a, b), rounded off where they are within k of each other
function softMin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

// Mountains (hilliness past Steep's 1.45, fully at 2.5) get more contrast:
// the octaves add up towards the middle, so without it most of the land
// would sit in a narrow band. `rugged` 0–1 ramps it in; at 1 the spurs and
// knolls weigh more (more separate peaks) and an S-curve of `contrast`
// spreads the heights out (`contrast` 4 would start flattening the tops).
const MOUNTAINS = { from: 1.45, to: 2.5, spur: 0.4, knoll: 0.06, contrast: 3 };

function makeHills(seed, k = 1) {
  const rugged = Math.min(Math.max((k - MOUNTAINS.from) / (MOUNTAINS.to - MOUNTAINS.from), 0), 1);
  // octaves: big hills, spurs, small knolls, then roughness for wiggly lines
  const octaves = [[18, 1], [8, 0.5 + MOUNTAINS.spur * rugged], [3.5, 0.22 + MOUNTAINS.knoll * rugged], [1.3, 0.07]]
    .map(([cell, amp], i) => [valueNoise2D(seed + 911 + i * 37, cell), amp]);
  const total = octaves.reduce((s, [, a]) => s + a, 0);
  const c = MOUNTAINS.contrast * rugged;
  const spread = c ? (t) => 0.5 + Math.tanh(c * (t - 0.5)) / (2 * Math.tanh(c / 2)) : (t) => t;
  return (x, y) => {
    let v = 0;
    for (const [n, a] of octaves) v += n(x, y) * a;
    // stretch the middle apart, so slopes are steep and tops / bottoms flatter
    const t = spread(v / total);
    const s = t * t * (3 - 2 * t);
    // flatter land sits at mid height rather than at the bottom
    return ((0.35 * t + 0.65 * s) * k + Math.max(0, (1 - k) / 2)) * ELEVATION.relief;
  };
}

// Contour polylines over box = [x0, y0, x1, y1] in world units.
// Returns [{ level, tier, points: [[x, y]…] }], tier 0 = index line,
// 1 = every other line, 2 = the rest. `skip(x, y)` hides segments
// (e.g. over water), breaking the line there.
export function contours(elev, [x0, y0, x1, y1], { step, interval, index }, skip = null) {
  const nx = Math.ceil((x1 - x0) / step) + 1;
  const ny = Math.ceil((y1 - y0) / step) + 1;
  const v = new Float32Array(nx * ny);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const e = elev(x0 + i * step, y0 + j * step);
      v[j * nx + i] = e;
      lo = Math.min(lo, e);
      hi = Math.max(hi, e);
    }
  }

  const out = [];
  for (let k = Math.ceil(lo / interval); k * interval <= hi; k++) {
    const level = k * interval;
    // Edge ids: horizontal edge (i, j)-(i+1, j) = 2 * (j * nx + i),
    // vertical edge (i, j)-(i, j+1) = 2 * (j * nx + i) + 1.
    const point = (edge) => {
      const c = edge >> 1, i = c % nx, j = (c - i) / nx;
      const a = v[c], b = v[edge & 1 ? c + nx : c + 1];
      const t = (level - a) / (b - a);
      return edge & 1 ? [x0 + i * step, y0 + (j + t) * step] : [x0 + (i + t) * step, y0 + j * step];
    };
    // segments between cell edges, linked both ways
    const links = new Map();
    const link = (a, b) => {
      (links.get(a) ?? links.set(a, []).get(a)).push(b);
      (links.get(b) ?? links.set(b, []).get(b)).push(a);
    };
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const c = j * nx + i;
        const tl = v[c] > level, tr = v[c + 1] > level, bl = v[c + nx] > level, br = v[c + nx + 1] > level;
        const code = tl | (tr << 1) | (br << 2) | (bl << 3);
        if (code === 0 || code === 15) continue;
        if (skip?.(x0 + (i + 0.5) * step, y0 + (j + 0.5) * step)) continue;
        const T = 2 * c, L = 2 * c + 1, B = 2 * (c + nx), R = 2 * (c + 1) + 1;
        switch (code) {
          case 1: case 14: link(T, L); break;
          case 2: case 13: link(T, R); break;
          case 3: case 12: link(L, R); break;
          case 4: case 11: link(R, B); break;
          case 6: case 9: link(T, B); break;
          case 7: case 8: link(L, B); break;
          case 5: link(T, R); link(L, B); break;  // saddles: pick one pairing
          case 10: link(T, L); link(R, B); break;
        }
      }
    }
    // walk the links into polylines, starting from open ends first
    const used = new Set();
    const walk = (start) => {
      const chain = [start];
      used.add(start);
      let cur = start;
      for (;;) {
        const next = links.get(cur).find((n) => !used.has(n));
        if (next === undefined) break;
        used.add(next);
        chain.push(next);
        cur = next;
      }
      // closed loop: repeat the first point
      if (chain.length > 2 && links.get(cur).includes(start)) chain.push(start);
      return chain;
    };
    const starts = [...links.keys()].sort((a, b) => links.get(a).length - links.get(b).length);
    for (const s of starts) {
      if (used.has(s)) continue;
      const chain = walk(s);
      if (chain.length > 1) out.push({ level, tier: k % index === 0 ? 0 : k % 2 === 0 ? 1 : 2, points: chain.map(point) });
    }
  }
  return out;
}
