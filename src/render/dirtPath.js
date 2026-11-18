// A footpath's edge as a dirt path is sketched, not a road's kerb: the pen
// follows the edge in strokes of uneven length, lifted and set down again
// – a hair to one side each time, sometimes over the end of the last one,
// sometimes after a break, now and then a longer stretch left out where
// the grass grows over – and the edge itself wanders in and out a little,
// so the path is never quite the same width. Worked out on the ground, the
// same each time for the same line and seed.
//
// A road's edges and kerbs are drawn by the same hand, only steadier
// (ROAD): longer strokes, the breaks short and rare, the edge hardly
// straying, and now and then a stroke gone over twice, a hair beside the
// first – a road drawn by hand along a ruler that wasn't there.

import { mulberry32 } from '../core/random.js';

// grid units throughout
export const PATH = {
  step: 0.04,           // between the points of a stroke
  stroke: [0.2, 0.85],  // a stroke's length, shortest to longest
  over: 0.35,           // how often the next one starts back over its end…
  overlap: [0.02, 0.07],
  gap: [0.02, 0.09],    // …or after a break…
  bare: 0.12,           // …or, this often, a longer one
  bareGap: [0.15, 0.35],
  lift: 0.008,          // how far a stroke may sit to either side of the last
  wander: 0.018,        // how far the edge strays in and out
  wanderLen: 0.35,      // over about this length
  twice: 0,             // how often a stroke is gone over again…
  twiceOff: [0, 0],     // …this far beside the first
};

export const ROAD = {
  ...PATH,
  stroke: [0.45, 1.5],
  over: 0.55, overlap: [0.03, 0.1],
  gap: [0.01, 0.04],
  bare: 0.05, bareGap: [0.05, 0.12],
  lift: 0.006,
  wander: 0.008, wanderLen: 0.6,
  twice: 0.18, twiceOff: [0.008, 0.016],
};

// The strokes along `line` ([[x, y]…], grid units) as polylines, in the
// hand `h` (PATH or ROAD).
export function trodden(line, seed, h = PATH) {
  const rand = mulberry32(seed >>> 0);
  const between = ([lo, hi]) => lo + rand() * (hi - lo);
  // the line measured, and a point and its side at any length along it
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = cum[cum.length - 1];
  if (total < 1e-6) return [];
  let seg = 1;
  const at = (s) => {
    while (seg < cum.length - 1 && cum[seg] < s) seg++;
    while (seg > 1 && cum[seg - 1] > s) seg--;
    const [ax, ay] = line[seg - 1], [bx, by] = line[seg];
    const l = cum[seg] - cum[seg - 1] || 1;
    const t = Math.min(1, Math.max(0, (s - cum[seg - 1]) / l));
    return [ax + (bx - ax) * t, ay + (by - ay) * t, -(by - ay) / l, (bx - ax) / l];
  };
  // the edge's straying: a smooth run between random heights wanderLen apart
  const knots = Array.from({ length: Math.ceil(total / h.wanderLen) + 2 }, () => (rand() * 2 - 1) * h.wander);
  const stray = (s) => {
    const u = s / h.wanderLen, i = Math.floor(u), f = u - i;
    return knots[i] + (knots[i + 1] - knots[i]) * f * f * (3 - 2 * f);
  };
  const point = (s, lift) => {
    const [x, y, nx, ny] = at(s);
    const d = stray(s) + lift;
    return [x + nx * d, y + ny * d];
  };
  const stroke = (from, to, lift) => {
    const pts = [];
    for (let q = from; q < to; q += h.step) pts.push(point(q, lift));
    pts.push(point(to, lift));
    out.push(pts);
  };

  const out = [];
  // (starts somewhere in a stroke or a gap, so neighbouring edges don't line up)
  let s = -rand() * h.stroke[1];
  while (s < total) {
    const len = between(h.stroke);
    const from = Math.max(0, s), to = Math.min(total, s + len);
    const lift = (rand() * 2 - 1) * h.lift;
    if (to - from > 0.03) {
      stroke(from, to, lift);
      // gone over again, a hair to one side, not quite end to end
      if (h.twice && rand() < h.twice) { // (footpaths: the same strokes as ever)
        const side = (rand() < 0.5 ? -1 : 1) * between(h.twiceOff);
        const a = from + (to - from) * rand() * 0.3, b = to - (to - from) * rand() * 0.3;
        if (b - a > 0.1) stroke(a, b, lift + side);
      }
    }
    const r = rand();
    s += len + (r < h.bare ? between(h.bareGap) : r < h.bare + h.over ? -between(h.overlap) : between(h.gap));
  }
  return out;
}
