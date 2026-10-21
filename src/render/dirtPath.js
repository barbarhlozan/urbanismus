// A footpath's edge as a dirt path is sketched, not a road's kerb: the pen
// follows the edge in strokes of uneven length, lifted and set down again
// – a hair to one side each time, sometimes over the end of the last one,
// sometimes after a break, now and then a longer stretch left out where
// the grass grows over – and the edge itself wanders in and out a little,
// so the path is never quite the same width. Worked out on the ground, the
// same each time for the same line and seed.

import { mulberry32 } from '../core/random.js';

const STEP = 0.04;          // grid units between the points of a stroke
const STROKE = [0.2, 0.85]; // a stroke's length, shortest to longest
const OVER = 0.35;          // how often the next one starts back over its end…
const OVERLAP = [0.02, 0.07];
const GAP = [0.02, 0.09];   // …or after a break…
const BARE = 0.12;          // …or, this often, a longer one
const BARE_GAP = [0.15, 0.35];
const LIFT = 0.008;         // how far a stroke may sit to either side of the last
const WANDER = 0.018;       // how far the edge strays in and out
const WANDER_LEN = 0.35;    // over about this length

// The strokes along `line` ([[x, y]…], grid units) as polylines.
export function trodden(line, seed) {
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
  // the edge's straying: a smooth run between random heights WANDER_LEN apart
  const knots = Array.from({ length: Math.ceil(total / WANDER_LEN) + 2 }, () => (rand() * 2 - 1) * WANDER);
  const stray = (s) => {
    const u = s / WANDER_LEN, i = Math.floor(u), f = u - i;
    return knots[i] + (knots[i + 1] - knots[i]) * f * f * (3 - 2 * f);
  };
  const point = (s, lift) => {
    const [x, y, nx, ny] = at(s);
    const d = stray(s) + lift;
    return [x + nx * d, y + ny * d];
  };

  const out = [];
  // (starts somewhere in a stroke or a gap, so neighbouring edges don't line up)
  let s = -rand() * STROKE[1];
  while (s < total) {
    const len = between(STROKE);
    const from = Math.max(0, s), to = Math.min(total, s + len);
    const lift = (rand() * 2 - 1) * LIFT;
    if (to - from > 0.03) {
      const pts = [];
      for (let q = from; q < to; q += STEP) pts.push(point(q, lift));
      pts.push(point(to, lift));
      out.push(pts);
    }
    const r = rand();
    s += len + (r < BARE ? between(BARE_GAP) : r < BARE + OVER ? -between(OVERLAP) : between(GAP));
  }
  return out;
}
