// Rivers: a smooth centreline across the map, falling from one edge to the
// other – or, for a tributary, from an edge into another river, its water
// meeting that river's at the junction (planned in generate.js, stored in
// Terrain.rivers as
// { points: [[x, y]…], z: [metres…], width, vary, bend, wet, wall, reach },
// the sizes from RIVER or STREAM, each river its own). Everything
// else follows from it: its banks, `width` from the line at the narrowest
// and up to `vary` more (a slow noise raised to `bend`: mostly narrow, now
// and then a wider reach; each bank wanders on its own), the water dots
// (those within the banks, but never less than `wet` from the line – a
// narrow reach still blocks a row of dots, with a strip of bank beside
// it) and the valley cut into the elevation around it. Where rivers meet,
// their channels merge, the corners between them rounded off (JOIN).
//
//   riverField(rivers)  each river's distance to its centreline and the
//                       water's surface height there, sampled once; and how
//                       far inside the banks (and the water dots') a point is

import { valueNoise2D } from '../core/random.js';

export const RIVER = {
  width: 0.35, // grid units from the centreline to a bank at the narrowest…
  vary: 0.8,   // …and up to this much more where it widens
  bend: 2.5,   // power of the noise: higher, wide reaches rarer
  wet: 0.72,   // water dots at least this far out (no less: 1.44 across
               // always holds a row of dots sideways joined, so no road
               // slips across between water dots)
  swing: 3.5,  // grid steps over which a bank swings in and out
  wall: 6,     // metres the valley sides rise per grid step away from the bank
  reach: 7,    // grid units out to which the valley is cut (fading out)
  step: 0.1,   // sampling step of the field
};

const JOIN = 0.35; // grid units over which two channels' banks round into each other

// A stream: the same, smaller – a thin channel in a shallow fold of the
// land. Its water dots are as wide as a river's (`wet`: still a row of
// dots that only a bridge crosses), most of them grass beside the water.
export const STREAM = { ...RIVER, width: 0.1, vary: 0.12, wall: 4, reach: 3.5 };

// The sizes a river is generated with, by name (the New map menu's choice).
export const RIVER_SIZES = { river: RIVER, stream: STREAM };

// { at(x, y) -> { d, z, river } | null: the nearest river's distance,
// surface height and size ({ width, vary, bend, wet, wall, reach,
// bank(x, y): from the line to its banks there }),
// each(x, y) -> the same for every river within its reach,
// depth(x, y) -> grid units inside the banks (negative outside),
// wet(x, y) -> the same for the water dots' band }, or null without
// rivers. Each river is sampled over its own box (plus its reach), then
// read back bilinearly – elevation is asked for at every drawn point.
// (Rivers saved before banks varied have no `width` / `vary`: 0.95, 0;
// before they narrowed no `bend` / `wet`: 2, their width; before streams
// no `wall` / `reach`: RIVER's.)
export function riverField(rivers) {
  if (!rivers?.length) return null;
  const fields = rivers.map(sampleRiver);
  const all = (x, y) => fields.map((f) => f(x, y)).filter(Boolean);
  const out = -RIVER.reach;
  return {
    each: all,
    at(x, y) {
      let best = null;
      for (const r of all(x, y)) if (!best || r.d < best.d) best = r;
      return best;
    },
    depth(x, y) {
      let depth = out;
      for (const r of all(x, y)) depth = smoothMax(depth, r.river.bank(x, y) - r.d, JOIN);
      return depth;
    },
    wet(x, y) {
      let wet = out;
      for (const r of all(x, y)) wet = Math.max(wet, Math.max(r.river.bank(x, y), r.river.wet) - r.d);
      return wet;
    },
  };
}

// max(a, b), rounded off where they are within k of each other
function smoothMax(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
}

// One river's field: (x, y) -> { d, z, river } within its reach, else null.
function sampleRiver({ points, z, width = 0.95, vary = 0, bend = 2, wet = width, wall = RIVER.wall, reach = RIVER.reach }) {
  const { step } = RIVER;
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs) - reach, y0 = Math.min(...ys) - reach;
  const nx = Math.ceil((Math.max(...xs) + reach - x0) / step) + 1;
  const ny = Math.ceil((Math.max(...ys) + reach - y0) / step) + 1;
  const far = reach * 10;
  const dist = new Float32Array(nx * ny).fill(far * far); // squared until the end
  const level = new Float32Array(nx * ny);

  for (let s = 1; s < points.length; s++) {
    const [ax, ay] = points[s - 1], [bx, by] = points[s];
    const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy || 1e-9;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - x0) / step));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + reach - x0) / step));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - reach - y0) / step));
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by) + reach - y0) / step));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = x0 + i * step - ax, py = y0 + j * step - ay;
        const t = Math.min(Math.max((px * vx + py * vy) / len2, 0), 1);
        const ex = px - t * vx, ey = py - t * vy, d = ex * ex + ey * ey;
        const k = j * nx + i;
        if (d >= dist[k]) continue;
        dist[k] = d;
        level[k] = z[s - 1] + (z[s] - z[s - 1]) * t;
      }
    }
  }
  for (let k = 0; k < dist.length; k++) dist[k] = Math.sqrt(dist[k]);

  // its size, and its banks swinging in and out on a noise of its own
  const [px, py] = points[0];
  const noise = valueNoise2D(Math.imul(Math.round(px * 1000), 7919) ^ Math.round(py * 1000), RIVER.swing);
  const river = { width, vary, bend, wet, wall, reach, bank: (x, y) => width + vary * noise(x, y) ** bend };
  return (x, y) => {
    const fx = (x - x0) / step, fy = (y - y0) / step;
    if (fx < 0 || fy < 0 || fx >= nx - 1 || fy >= ny - 1) return null;
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const k = j * nx + i;
    const lerp = (v) => (v[k] + (v[k + 1] - v[k]) * tx) * (1 - ty) + (v[k + nx] + (v[k + nx + 1] - v[k + nx]) * tx) * ty;
    return { d: lerp(dist), z: lerp(level), river };
  };
}
