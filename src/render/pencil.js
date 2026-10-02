// Pencil strokes for long linework drawn by hand (the terrain's contour
// lines, Renderer.renderContours), and cutting it into pieces by where it
// lies so the map draws and culls it in squares.

import { mulberry32 } from '../core/random.js';

// Contour lines drawn by hand (pencil()), per tier (index line, every
// other line, the rest): stroke lengths, the gap or overlap where the pen
// starts again, how far a stroke strays from the true line (grid units),
// and the share of strokes left out, so the minor lines read lighter.
export const PENCIL = [
  { len: [3, 6], gap: [-0.12, 0.08], drift: 0.025, skip: 0 },
  { len: [1.5, 4], gap: [-0.1, 0.18], drift: 0.035, skip: 0.08 },
  { len: [1, 3], gap: [-0.08, 0.25], drift: 0.04, skip: 0.2 },
];

// Contour strokes are traced finely and then thinned to within this many
// grid units of the traced line (under a pixel at the closest zoom): the
// straighter stretches need few points, and fewer points draw faster.
const PENCIL_TOL = 0.005;

// An open polyline thinned (Douglas–Peucker) to within `tol` of itself.
export function thin(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i], [bx, by] = pts[j];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1, worst = tol;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / l;
      if (d > worst) { worst = d; far = k; }
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([i, far], [far, j]);
  }
  return pts.filter((_, k) => keep[k]);
}

// Long linework split by where it lies: lines (world) grouped by the
// `size`-grid-unit square their first point is in. Each group's lines
// stay in their order.
export const CONTOUR_CHUNK = 8;
export function chunked(lines, size) {
  const groups = new Map();
  for (const line of lines) {
    const key = `${Math.floor(line[0][0] / size)},${Math.floor(line[0][1] / size)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }
  return [...groups.values()];
}

// Polylines (world) cut where they pass into the next `size`-grid-unit
// square, the pieces sharing the point at the cut.
export function cut(lines, size) {
  const out = [];
  const cell = ([x, y]) => `${Math.floor(x / size)},${Math.floor(y / size)}`;
  for (const line of lines) {
    let piece = [line[0]], at = cell(line[0]);
    for (let i = 1; i < line.length; i++) {
      piece.push(line[i]);
      const c = cell(line[i]);
      if (c !== at && i < line.length - 1) {
        out.push(piece);
        piece = [line[i]];
        at = c;
      }
    }
    out.push(piece);
  }
  return out;
}

// A polyline (world) as pencil strokes: pieces of random length along it,
// each drifting a little to one side and back, with a small gap or overlap
// where the next one starts, some left out. Seeded by the line itself, so
// the same terrain always comes out the same.
export function pencil(points, level, { len, gap, drift, skip }) {
  if (points.length < 2) return [];
  const rnd = mulberry32(Math.imul(level + 1, 0x9e3779b1) ^ Math.round(points[0][0] * 97) ^ Math.round(points[0][1] * 131));
  const range = ([a, b]) => a + rnd() * (b - a);
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = cum[cum.length - 1];
  // point and unit normal at arc length s
  const at = (s) => {
    let lo = 1, hi = cum.length - 1; // first i with cum[i] >= s
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < s) lo = mid + 1; else hi = mid;
    }
    const i = lo;
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    const l = cum[i] - cum[i - 1] || 1, t = Math.min(1, Math.max(0, (s - cum[i - 1]) / l));
    return [ax + (bx - ax) * t, ay + (by - ay) * t, -(by - ay) / l, (bx - ax) / l];
  };
  const out = [];
  let s = rnd() * len[0] * 0.5;
  while (s < total) {
    const e = Math.min(total, s + range(len));
    if (rnd() >= skip) {
      // a stroke: off the line by d0 at its start, d1 at its end, bowing between
      const d0 = (rnd() - 0.5) * 2 * drift, d1 = (rnd() - 0.5) * 2 * drift, bow = (rnd() - 0.5) * 2 * drift;
      const n = Math.max(2, Math.ceil((e - s) / 0.2));
      const stroke = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const [x, y, nx, ny] = at(s + (e - s) * t);
        const d = d0 + (d1 - d0) * t + bow * Math.sin(Math.PI * t);
        stroke.push([x + nx * d, y + ny * d]);
      }
      out.push(thin(stroke, PENCIL_TOL));
    }
    s = e + range(gap);
  }
  return out;
}
