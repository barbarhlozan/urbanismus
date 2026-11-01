// Exhaust: a tiny curl of smoke a car, truck or bus leaves behind it now
// and then as it drives, close up. Each is carried along behind it a
// little (so it stays close), rises a little and comes and goes in the pen as the chimneys' smoke does
// (particles.js): drawn in along its length, then taken back from where it
// started. Kept per vehicle, a few at a time, so it costs next to nothing.
//
//   puffShapes(variant, u)   the curl at age u (0–1), shapes for the pen

import { shapesOf } from './agentCanvas.js';

export const EXHAUST = {
  every: 0.14,   // grid units driven between puffs, about
  life: 1,       // seconds one lasts
  carry: 0.6,    // share of the way the vehicle drives on that a puff is carried along behind it
  most: 3,       // puffs kept per vehicle
  rise: 0.09,    // grid units of height it rises over its life
  low: 0.012,    // height of the pipe, grid units
  size: [0.5, 1.3], // scene px across, given off and at the end
  in: 0.3,       // share of its life drawn in…
  out: 0.45,     // …and taken back
  steps: 10,     // ages drawn (cached per step)
  variants: 4,
};

// A turn and a bit of a spiral opening out, about 1 across (particles.js curlShape).
function curl(v) {
  const pts = [], turns = 1.1 + 0.15 * v, n = 16;
  for (let j = 0; j <= n; j++) {
    const t = j / n, th = t * turns * Math.PI * 2 + v * 1.7;
    const r = 0.12 + 0.38 * t;
    pts.push([r * Math.cos(th) + 0.18 * t, -r * Math.sin(th) - 0.1 * t]);
  }
  return pts;
}

const r2 = (n) => Math.round(n * 100) / 100;
const cache = new Map();

export function puffShapes(variant, u) {
  const step = Math.min(EXHAUST.steps - 1, Math.floor(u * EXHAUST.steps));
  const key = variant * EXHAUST.steps + step;
  let shapes = cache.get(key);
  if (shapes) return shapes;
  const a = (step + 0.5) / EXHAUST.steps;
  const to = Math.min(1, a / EXHAUST.in), from = a > 1 - EXHAUST.out ? (a - (1 - EXHAUST.out)) / EXHAUST.out : 0;
  const [s0, s1] = EXHAUST.size, s = s0 + (s1 - s0) * a ** 0.7;
  const pts = curl(variant), n = pts.length - 1;
  const part = pts.slice(Math.floor(from * n), Math.max(Math.floor(from * n) + 2, Math.ceil(to * n) + 1));
  const d = `M${part.map(([x, y]) => `${r2(x * s)} ${r2(y * s)}`).join('L')}`;
  shapes = shapesOf(`<path class="fig-line" d="${d}"/>`);
  cache.set(key, shapes);
  return shapes;
}
