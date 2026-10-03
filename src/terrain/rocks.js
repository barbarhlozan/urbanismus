// Rock: where the hills are already steep, the smooth slope breaks into
// cliff bands – flat ledges with steep faces between them – as part of the
// elevation itself, so the rock is drawn, hidden and built around like any
// other ground (the brows outline the faces turned away, render/rocks.js
// draws the ones turned to the viewer).
//
// The slope is not raised, only reshaped: each step of ROCKS.step metres
// keeps its middle height, so the hills keep their shape and their tops.
// Where it happens is the rock mask: the map's steepest ground (by its
// own hills, so a hilly map gets a little rock and the mountains more, not
// all or nothing), broken into patches by a slow noise, faded out near the
// rivers.
// The steps don't follow the contour lines exactly – a second noise shifts
// them up and down – so the bands wander, split and run out like strata.
//
//   makeRocks(seed, elevation, box, { rivers, amount })
//        -> { elevation(x, y) metres, rock(x, y) 0–1 } (rock: the mask)

import { valueNoise2D } from '../core/random.js';

//   share   the steepest share of the map where rock begins / is full...
//   floor   ...but never on ground gentler than this (metres of rise per
//           grid step), so flat and gentle maps have none
//   patch   the mask's noise: cell size (grid steps) and the noise level
//           from which / up to which it is rock (patches, not every slope)
//   step    metres from one ledge to the next
//   face    share of each step that is the face (the rest is ledge)
//   shift   how far the steps wander off the contour lines (share of a step)
//           and the size of that wandering (grid steps)
//   water   grid steps kept free of rock either side of a river
//   grid    sampling step of the mask (grid steps)
export const ROCKS = {
  share: [0.15, 0.03],
  floor: 10,
  patch: { cell: 5, from: 0.38, to: 0.62 },
  step: 32,
  face: 0.3,
  shift: { amount: 0.9, cell: 3 },
  water: 2.5,
  grid: 0.5,
};

const smoothstep = (a, b, v) => {
  const t = Math.min(Math.max((v - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// `amount` 0–1 scales the mask (0: no rock, the elevation unchanged).
// `rivers`: the rivers' field (terrain/rivers.js) or null.
export function makeRocks(seed, elevation, [x0, y0, x1, y1], { rivers = null, amount = 1 } = {}) {
  if (!amount) return { elevation, rock: () => 0 };
  const { share, floor, patch, step, face, shift, water, grid: g } = ROCKS;
  const patchy = valueNoise2D(seed + 5101, patch.cell);
  const drift = valueNoise2D(seed + 5203, shift.cell);

  // the mask, sampled once over the box from the hills' own slope
  const nx = Math.ceil((x1 - x0) / g) + 1, ny = Math.ceil((y1 - y0) / g) + 1;
  const h = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = elevation(x0 + i * g, y0 + j * g);
  const sl = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const at = (a, b) => h[Math.min(ny - 1, Math.max(0, b)) * nx + Math.min(nx - 1, Math.max(0, a))];
      sl[j * nx + i] = Math.hypot(at(i + 1, j) - at(i - 1, j), at(i, j + 1) - at(i, j - 1)) / (2 * g);
    }
  }
  const sorted = Float32Array.from(sl).sort();
  const top = (q) => sorted[Math.floor((1 - q) * (sorted.length - 1))];
  const from = Math.max(floor, top(share[0])), to = Math.max(from + 3, top(share[1]));
  const m = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * g, y = y0 + j * g;
      let v = smoothstep(from, to, sl[j * nx + i]) * smoothstep(patch.from, patch.to, patchy(x, y));
      const r = rivers?.at(x, y);
      if (r) v *= smoothstep(water * 0.6, water, r.d);
      m[j * nx + i] = v * amount;
    }
  }
  const rock = (x, y) => {
    const fx = Math.min(Math.max((x - x0) / g, 0), nx - 1.001);
    const fy = Math.min(Math.max((y - y0) / g, 0), ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const c = j * nx + i;
    return (m[c] + (m[c + 1] - m[c]) * tx) * (1 - ty) + (m[c + nx] + (m[c + nx + 1] - m[c + nx]) * tx) * ty;
  };

  // one step: a ledge, the face (smoothed at both ends), the next ledge
  const lo = (1 - face) / 2;
  const terrace = (e, x, y) => {
    const v = e / step + (drift(x, y) - 0.5) * shift.amount;
    const k = Math.floor(v);
    return (k + smoothstep(lo, 1 - lo, v - k) - (v - e / step)) * step;
  };
  return {
    rock,
    elevation: (x, y) => {
      const e = elevation(x, y);
      const w = rock(x, y);
      return w ? e + (terrace(e, x, y) - e) * w : e;
    },
  };
}
