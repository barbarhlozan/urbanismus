// The shadows the hills cast: where the ground lies below the sun's light
// – behind a rise, or on a slope turned away from a low sun – it is
// hatched as the buildings' shadows are (shadows.js), on the very same
// strokes, in the same mask (Renderer: its outline traced on the ground,
// hillShadeRings), so a house's shadow and the hill's it stands in read as
// one, as dense as each other.
//
//   hillShade(height, box, sun)            -> the shade, (x, y) -> depth
//   hillShadeRings(shade, box, wet)        -> the shade's outlines, world rings
//   hillShadowPaths(shade, box, sun, project, wet)  -> [tier 0, tier 1] path data
//
// The light is swept across the map along the sun, once for each position
// of the sun (DAY): every point keeps the height of the light over it –
// the highest ground towards the sun, less the fall of the light since –
// and is in shadow where its own ground lies deeper than that. The hatching
// over it is the paper's (hatch.js), the same strokes as the buildings'
// shadows and the night's, so it is drawn again for each turn of the view,
// from the same shade.

import { hash, hatchRuns } from './shadows.js';
import { contours } from '../terrain/elevation.js';
import { hatchFrame, hatchStrokes } from './hatch.js';

//   on      draw them
//   low     the sun as the hills have it: SUN.length (a shadow's length
//           per unit of height) times this – lower than for the buildings,
//           as the map's relief is gentle and a 45° sun would leave nearly
//           all of it lit
//   most    but a shadow at most this long per unit of height
//   grid    the step the light is swept in (grid units)
//   deep    how far below the light the ground must lie to be in shadow
//           (grid units of height)
//   every   every so many of the paper's lines (by day: at dusk they
//           thicken, DAY.steps `hills`); the line k with k % (2·every) = 0
//           stays when zoomed out, the others go
//   cell    the step the shade is traced in, for the screen (grid units)
//   ragged  how unevenly a line stops at the shadow's edge (grid units)
//   min     the shortest piece of line drawn (grid units)
export const HILL_SHADOWS = {
  on: true,
  low: 3,
  most: 40,
  grid: 0.125,
  deep: 0.02,
  every: 4,
  cell: 0.1,
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

// The shade's outlines over the box, where it is deeper than `deep` and
// not on water (`wet(x, y)`): closed rings of world points, traced every
// `cell` grid units, the lit places inside the shade rings of their own
// (to be filled even-odd). Outside the box it is lit, so every ring
// closes.
export function hillShadeRings(shade, [x0, y0, x1, y1], wet = () => false, opts = HILL_SHADOWS) {
  const g = opts.cell;
  const f = (x, y) => (x < x0 || x > x1 || y < y0 || y > y1 || wet(x, y) ? -1 : shade(x, y) - opts.deep);
  return contours(f, [x0 - g, y0 - g, x1 + g, y1 + g], { step: g, interval: 1, index: 1, only: 0 }).map((c) => c.points);
}

// The hatching over the shade in the box, as path data in two tiers (the
// lines that stay when zoomed out, and the rest): the paper's strokes
// (hatch.js), every `every`-th of its lines, where the shade lies on
// screen. The shade is traced cell by cell (`cell` grid units) where it
// is deeper than `deep` – a cell's part in shadow cut along its edges, as
// contours are – and projected (`project(x, y)`: a ground point -> scene
// px, with the relief); `wet(x, y)`: water, which has its own lines.
export function hillShadowPaths(shade, [x0, y0, x1, y1], sun, project, wet = () => false, opts = HILL_SHADOWS, every = opts.every) {
  const h = sun.hatch, out = ['', ''];
  if (!h) return out;
  const px = sun.px ?? 32, f = hatchFrame(h), gap = f.gap * px, n = every;
  const g = opts.cell, nx = Math.ceil((x1 - x0) / g), ny = Math.ceil((y1 - y0) / g);
  // the lattice: how deep in shade, and where on screen
  const val = new Float32Array((nx + 1) * (ny + 1)), scr = new Float64Array((nx + 1) * (ny + 1) * 2);
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * g, y = y0 + j * g, c = j * (nx + 1) + i;
      val[c] = wet(x, y) ? -1 : shade(x, y) - opts.deep;
      const [sx, sy] = project(x, y);
      scr[2 * c] = sx;
      scr[2 * c + 1] = sy;
    }
  }
  const polys = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const cs = [j * (nx + 1) + i, j * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i];
      const vs = cs.map((c) => val[c]);
      if (vs.every((x) => x <= 0)) continue;
      const at = (c) => [scr[2 * c], scr[2 * c + 1]];
      if (vs.every((x) => x > 0)) {
        polys.push(cs.map(at));
        continue;
      }
      // the part in shade: the corners in it, and where the edges leave it
      const poly = [];
      for (let e = 0; e < 4; e++) {
        const a = cs[e], b = cs[(e + 1) % 4], va = vs[e], vb = vs[(e + 1) % 4];
        if (va > 0) poly.push(at(a));
        if ((va > 0) !== (vb > 0)) {
          const t = va / (va - vb), [ax, ay] = at(a), [bx, by] = at(b);
          poly.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
        }
      }
      if (poly.length >= 3) polys.push(poly);
    }
  }
  const rag = opts.ragged * px, min = opts.min * px;
  for (const [k, a, b] of hatchRuns(polys, f.u, f.v, gap, 0.5)) {
    if (((k % n) + n) % n) continue;
    const s0 = a + rag * hash(k, a / px), s1 = b - rag * hash(b / px, k);
    if (s1 - s0 < min) continue;
    out[((k % (2 * n)) + 2 * n) % (2 * n) === 0 ? 0 : 1] += hatchStrokes(k, s0, s1, h, px, f);
  }
  return out;
}
