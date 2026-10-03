// Slopes too steep to build on (CONFIG.steep.build), drawn on the map at
// all times as a few faint contour lines – only where the ground is that
// steep, so the lines start and stop with the steepness and the rest of the
// paper stays white. Rock has its own drawing (rocks.js) and is left out.
//
//   steepLines(world, box, wet)  -> pencil strokes, world polylines

import { CONFIG } from '../config.js';
import { ELEVATION, contours } from '../terrain/elevation.js';
import { pencil } from './pencil.js';

//   on        draw them
//   interval  metres between the lines (a multiple of the contour
//             interval, so they lie on contour lines); twice that on maps
//             hilly enough for wider contours (ELEVATION.steep)
//   rock      rock mask (terrain/rocks.js) from which the ground is rock
//   grid      sampling step of the steepness (grid units)
//   min       shortest piece drawn (grid units)
//   pencil    the pen strokes (pencil.js): light, broken
export const STEEP_LINES = {
  on: true,
  interval: 10,
  rock: 0.3,
  grid: 0.25,
  min: 0.5,
  pencil: { len: [0.6, 1.8], gap: [-0.05, 0.3], drift: 0.03, skip: 0.15 },
};

export function steepLines(world, [x0, y0, x1, y1], wet = () => false, opts = STEEP_LINES) {
  const { interval, rock, grid: g, min } = opts;
  const e = world.elevation, d = 0.5, limit = CONFIG.steep.build;
  // where it is too steep (as World.slopeAt), sampled once
  const nx = Math.ceil((x1 - x0) / g) + 1, ny = Math.ceil((y1 - y0) / g) + 1;
  const steep = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * g, y = y0 + j * g;
      const s = Math.hypot(e(x + d, y) - e(x - d, y), e(x, y + d) - e(x, y - d)) / (2 * d);
      steep[j * nx + i] = s > limit && world.rockAt(x, y) < rock ? 1 : 0;
    }
  }
  const at = (x, y) => steep[Math.min(ny - 1, Math.max(0, Math.round((y - y0) / g))) * nx + Math.min(nx - 1, Math.max(0, Math.round((x - x0) / g)))];
  const skip = (x, y) => !at(x, y) || wet(x, y);
  const every = interval * (world.hilliness >= ELEVATION.steep.from ? 2 : 1);
  const lines = contours(e, [x0, y0, x1, y1], { step: ELEVATION.step, interval: every, index: 1 }, skip);
  const out = [];
  for (const { level, points } of lines) {
    let len = 0;
    for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (len >= min) out.push(...pencil(points, level, opts.pencil));
  }
  return out;
}
