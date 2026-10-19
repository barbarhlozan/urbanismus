// Night, as a pen draws it: the whole sheet hatched over with the lines the
// shadows are drawn with (shadows.js hatchLine – the same lines, so where a
// shadow lies the night just goes on), and later on, the lit places left
// out of it. For now it covers the whole map, to see how it looks
// (cmd.night, the Debug panel):
//
//   over   'all': over everything, the buildings too, like a sheet of
//          tracing paper laid over the drawing; 'ground': on the ground,
//          roads and fences, under the buildings and trees, which stay
//          paper-white
//   every  every so many of the ground hatching's lines (SUN.hatch.gap
//          apart); the line k with k % (2·every) = 0 stays when zoomed
//          out, the others go
//   cross  a second set of lines across the first, as darker ink
//   turn   how far the crossing lines are turned from the first (degrees)
//   step   along a line, the distance between its points (grid units):
//          coarser than the shadows', as the lines are long and many
//
//   nightLines(box, sun, angle)  -> [tier 0, tier 1] world polylines

import { groundDir, hatchLine } from './shadows.js';

export const NIGHT = {
  on: false,
  over: 'all',
  every: 3,
  cross: false,
  turn: 75,
  step: 0.3,
};

// The night's lines over the box [x0, y0, x1, y1] (world), for a view
// turned `angle` (radians): as the ground's hatching (sun.hatch), every
// `every`-th line, and with `cross` a second set turned `turn` degrees.
export function nightLines([x0, y0, x1, y1], sun, angle = 0, opts = NIGHT) {
  const h = sun.hatch, out = [[], []];
  if (!h) return out;
  const n = Math.max(1, Math.round(opts.every));
  const sets = [h.angle, ...(opts.cross ? [h.angle + opts.turn] : [])];
  const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
  for (const deg of sets) {
    const u = groundDir(deg, angle), v = [-u[1], u[0]];
    const cs = corners.map(([x, y]) => x * v[0] + y * v[1]);
    for (let k = Math.ceil(Math.min(...cs) / h.gap / n) * n; k * h.gap <= Math.max(...cs); k += n) {
      // where line k (p·v = c) crosses the box, as t along u
      const c = k * h.gap, ts = [];
      if (Math.abs(u[0]) > 1e-9) for (const x of [x0, x1]) ts.push((x - v[0] * c) / u[0]);
      if (Math.abs(u[1]) > 1e-9) for (const y of [y0, y1]) ts.push((y - v[1] * c) / u[1]);
      const inside = ts.filter((t) => {
        const x = u[0] * t + v[0] * c, y = u[1] * t + v[1] * c;
        return x >= x0 - 1e-6 && x <= x1 + 1e-6 && y >= y0 - 1e-6 && y <= y1 + 1e-6;
      });
      if (inside.length < 2) continue;
      const t0 = Math.min(...inside), t1 = Math.max(...inside);
      if (t1 - t0 < h.gap) continue;
      out[k % (2 * n) === 0 ? 0 : 1].push(hatchLine(k, t0, t1, u, v, h, opts.step));
    }
  }
  return out;
}
