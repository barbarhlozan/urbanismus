// Map distortions, applied to every point as it is projected, so the grid,
// roads, buildings and moving dots all bend together and stay aligned.
//
//   makeLift   Camera.lift: raises every point by the terrain elevation, so
//              the drawing rises and falls with the contour lines
//   makeWarp   Camera.warp: a seeded sideways drift, unrelated to the terrain
//     warp    0–1  slow, large-scale drift (up to ~0.45 grid steps)
//     tremor  0–1  fine wobble (up to ~0.07 grid steps)

import { valueNoise2D } from '../core/random.js';

// `relief` is the lift, in grid steps, between the lowest and the highest
// possible ground (terrain/elevation.js); the middle stays put. Elevation is
// sampled once over `box` and interpolated, as this runs for every point drawn.
export function makeLift(elevation, maxElevation, relief, [x0, y0, x1, y1], step = 0.25) {
  if (!relief) return null;
  const nx = Math.ceil((x1 - x0) / step) + 1;
  const ny = Math.ceil((y1 - y0) / step) + 1;
  const v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) v[j * nx + i] = (elevation(x0 + i * step, y0 + j * step) / maxElevation - 0.5) * relief;
  }
  return (x, y) => {
    const fx = Math.min(Math.max((x - x0) / step, 0), nx - 1.001);
    const fy = Math.min(Math.max((y - y0) / step, 0), ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const c = j * nx + i;
    return (v[c] + (v[c + 1] - v[c]) * tx) * (1 - ty) + (v[c + nx] + (v[c + nx + 1] - v[c + nx]) * tx) * ty;
  };
}

export function makeWarp(seed, warp, tremor) {
  if (!warp && !tremor) return null;
  const ax = valueNoise2D(seed + 101, 7), ay = valueNoise2D(seed + 202, 7);
  const tx = valueNoise2D(seed + 303, 1.4), ty = valueNoise2D(seed + 404, 1.4);
  const W = warp * 2, T = tremor * 0.3;
  return (x, y) => [
    x + (ax(x, y) - 0.5) * W + (tx(x, y) - 0.5) * T,
    y + (ay(x, y) - 0.5) * W + (ty(x, y) - 0.5) * T,
  ];
}

// Split long segments so the warp shows along them.
export function densify(points, step = 0.15) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}
