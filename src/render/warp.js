// Map warp: a smooth, seeded distortion applied to every point as it is
// projected (Camera.warp), so the grid, roads, buildings and moving dots all
// bend together and stay aligned.
//   warp    0–1  slow, large-scale drift (up to ~0.45 grid steps)
//   tremor  0–1  fine wobble (up to ~0.07 grid steps)

import { valueNoise2D } from '../core/random.js';

export function makeWarp(seed, warp, tremor) {
  if (!warp && !tremor) return null;
  const ax = valueNoise2D(seed + 101, 7), ay = valueNoise2D(seed + 202, 7);
  const tx = valueNoise2D(seed + 303, 1.4), ty = valueNoise2D(seed + 404, 1.4);
  const W = warp * 5, T = tremor * 0.3;
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
