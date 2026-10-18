// The shadows the hills cast: where the ground lies below the sun's light
// – behind a rise, or on a slope turned away from a low sun – it is
// hatched as the buildings' shadows are (shadows.js), on the very same
// lines of the ground's hatching, so a house's shadow and the hill's it
// stands in read as one. Only every few of those lines, though, and with
// a finer pen: a hill's shadow is a large thing, and the paper should
// still show through it.
//
//   hillShade(height, box, sun)            -> the shade, (x, y) -> depth
//   hillShadowLines(shade, box, sun, wet)  -> [tier 0, tier 1] world polylines
//
// The light is swept across the map along the sun, once for each position
// of the sun (DAY): every point keeps the height of the light over it –
// the highest ground towards the sun, less the fall of the light since –
// and is in shadow where its own ground lies deeper than that. The hatching
// over it depends on the view (the lines lie the same way on screen), so
// it is drawn again for each turn, from the same shade.

import { groundDir, hash, hatchLine } from './shadows.js';

//   on      draw them
//   low     the sun as the hills have it: SUN.length (a shadow's length
//           per unit of height) times this – lower than for the buildings,
//           as the map's relief is gentle and a 45° sun would leave nearly
//           all of it lit
//   most    but a shadow at most this long per unit of height
//   grid    the step the light is swept in (grid units)
//   deep    how far below the light the ground must lie to be in shadow
//           (grid units of height)
//   every   every so many of the ground hatching's lines; the line k with
//           k % (2·every) = 0 stays when zoomed out, the others go
//   step    along a line, how often to look whether it is in shadow
//   ragged  how unevenly a line stops at the shadow's edge (grid units)
//   min     the shortest piece of line drawn (grid units)
export const HILL_SHADOWS = {
  on: true,
  low: 3,
  most: 6,
  grid: 0.125,
  deep: 0.02,
  every: 4,
  step: 0.06,
  ragged: 0.18,
  min: 0.25,
};

// The shade over the box [x0, y0, x1, y1] (world): depth(x, y), how far
// below the light the ground there lies (0: lit). `height(x, y)` is the
// ground's height as drawn; `sun` as sunFor gives it.
export function hillShade(height, [x0, y0, x1, y1], sun, opts = HILL_SHADOWS) {
  const [sx, sy] = sun.cast;
  const L = Math.min(opts.most, Math.hypot(sx, sy) * opts.low);
  const l = Math.hypot(sx, sy) || 1;
  const u = [sx / l, sy / l], v = [-u[1], u[0]]; // u: the way shadows fall
  const g = opts.grid, drop = g / L;
  // the box in (a along u, b across) – a lattice turned with the sun
  const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
  const as = corners.map(([x, y]) => x * u[0] + y * u[1]), bs = corners.map(([x, y]) => x * v[0] + y * v[1]);
  const a0 = Math.min(...as), b0 = Math.min(...bs);
  const na = Math.ceil((Math.max(...as) - a0) / g) + 1, nb = Math.ceil((Math.max(...bs) - b0) / g) + 1;
  const depth = new Float32Array(na * nb);
  for (let j = 0; j < nb; j++) {
    const b = b0 + j * g;
    let top = -Infinity;
    for (let i = 0; i < na; i++) {
      const a = a0 + i * g;
      const x = a * u[0] + b * v[0], y = a * u[1] + b * v[1];
      const h = height(Math.min(x1, Math.max(x0, x)), Math.min(y1, Math.max(y0, y)));
      top = Math.max(h, top - drop);
      depth[j * na + i] = top - h;
    }
  }
  return (x, y) => {
    const fa = Math.min(Math.max((x * u[0] + y * u[1] - a0) / g, 0), na - 1.001);
    const fb = Math.min(Math.max((x * v[0] + y * v[1] - b0) / g, 0), nb - 1.001);
    const i = Math.floor(fa), j = Math.floor(fb), ta = fa - i, tb = fb - j, c = j * na + i;
    return (depth[c] * (1 - ta) + depth[c + 1] * ta) * (1 - tb) + (depth[c + na] * (1 - ta) + depth[c + na + 1] * ta) * tb;
  };
}

// The hatching over the shade in the box, for a view turned `angle`
// (radians), as world polylines in two tiers: the lines that stay when
// zoomed out, and the rest. `wet(x, y)`: water, which has its own lines.
export function hillShadowLines(shade, [x0, y0, x1, y1], sun, angle = 0, wet = () => false, opts = HILL_SHADOWS) {
  const h = sun.hatch, out = [[], []];
  if (!h) return out;
  const u = groundDir(h.angle, angle), v = [-u[1], u[0]];
  const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
  const ts = corners.map(([x, y]) => x * u[0] + y * u[1]), cs = corners.map(([x, y]) => x * v[0] + y * v[1]);
  const tA = Math.min(...ts), tB = Math.max(...ts);
  const n = opts.every;
  const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  for (let k = Math.ceil(Math.min(...cs) / h.gap / n) * n; k * h.gap <= Math.max(...cs); k += n) {
    const c = k * h.gap;
    let from = null;
    const end = (t) => {
      // ragged ends, seeded by where they are
      const s = from + opts.ragged * hash(k, from), e = t - opts.ragged * hash(t, k);
      if (e - s >= opts.min) out[k % (2 * n) === 0 ? 0 : 1].push(hatchLine(k, s, e, u, v, h));
      from = null;
    };
    for (let t = tA; t <= tB; t += opts.step) {
      const x = u[0] * t + v[0] * c, y = u[1] * t + v[1] * c;
      const dark = inside(x, y) && shade(x, y) > opts.deep && !wet(x, y);
      if (dark && from === null) from = t;
      else if (!dark && from !== null) end(t);
    }
    if (from !== null) end(tB);
  }
  return out;
}
