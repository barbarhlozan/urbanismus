// A way bent round a building put down across it (World.detoursFor): the
// stretch of its line that comes within `clear` of the building's body
// replaced by a rounded bend round it – a squircle through the corners of
// the body grown by `clear`, so the bend hugs the walls without a kink –
// leaving the way a little before and rejoining it a little after.
//
// detourAround(pts, box, clear, { pad, side }) -> new pts, or null if the
// way doesn't come near, or ends too close to go round.
//   box: { x, y, angle, x0, y0, x1, y1 } – the body's middle, turn and
//        local extent (as World.bodyBox)
//   side: 1 or -1, which way round (0: the shorter way)

import { measurePolyline, pointAt, subPolyline } from './geometry.js';

const SAMPLE = 0.02; // how finely the line is looked along for where it comes near
const STEPS = 28;    // points along the bend
const SMOOTH = 0.6;  // how far either side of the bend its joins are eased
const WINDOW = 5;    // …averaging this many points either side (of 0.04 apart)

export function detourAround(pts, box, clear, { pad = 0.35, side = 0 } = {}) {
  const c = Math.cos(box.angle), s = Math.sin(box.angle);
  const toLocal = ([x, y]) => {
    const dx = x - box.x, dy = y - box.y;
    return [dx * c + dy * s, -dx * s + dy * c];
  };
  const toWorld = ([u, v]) => [box.x + u * c - v * s, box.y + u * s + v * c];
  // the body grown by `clear`, centred (a body box needn't be)
  const mx = (box.x0 + box.x1) / 2, my = (box.y0 + box.y1) / 2;
  const hw = (box.x1 - box.x0) / 2 + clear, hh = (box.y1 - box.y0) / 2 + clear;
  const near = ([u, v]) => Math.abs(u - mx) < hw && Math.abs(v - my) < hh;

  const local = pts.map(toLocal);
  const poly = measurePolyline(local);
  let sIn = null, sOut = null;
  for (let d = 0; d <= poly.total; d += SAMPLE) {
    if (!near(pointAt(poly, d))) continue;
    sIn ??= d;
    sOut = d;
  }
  if (sIn === null) return null;
  const s0 = sIn - pad, s1 = sOut + pad;
  if (s0 <= 0 || s1 >= poly.total) return null; // (an end under the building: nothing to go round)
  const A = pointAt(poly, s0), B = pointAt(poly, s1);

  // the squircle through the grown body's corners: radius at angle t
  const a = hw * 2 ** 0.25, b = hh * 2 ** 0.25;
  const rim = (t) => (Math.abs(Math.cos(t) / a) ** 4 + Math.abs(Math.sin(t) / b) ** 4) ** -0.25;
  const polar = ([u, v]) => [Math.atan2(v - my, u - mx), Math.hypot(u - mx, v - my)];
  const [tA, dA] = polar(A), [tB, dB] = polar(B);
  let sweep = Math.atan2(Math.sin(tB - tA), Math.cos(tB - tA)); // the shorter way round
  if (side && Math.sign(sweep) !== side) sweep += side * 2 * Math.PI;
  // not a drawn half-circle but a way trodden round: its widest point off
  // the middle (the sweep run unevenly), and a slow waver outwards – never
  // in, so it keeps clear of the walls. Seeded by where the building
  // stands, so the preview and the laid way are the same.
  const rnd = seeded(box.x, box.y);
  const lean = 0.7 + 0.6 * rnd(), w1 = 0.12 + 0.1 * rnd(), w2 = 0.05 + 0.06 * rnd();
  const p1 = 6.28 * rnd(), p2 = 6.28 * rnd(), k1 = 1.5 + rnd(), k2 = 3 + 2 * rnd();
  const bend = [];
  for (let k = 1; k < STEPS; k++) {
    const g = k / STEPS, f = g ** lean, t = tA + sweep * f;
    const ends = dA * (1 - f) + dB * f;
    // out onto the squircle (never inside it) and eased back to the way's
    // own line at both ends
    const ease = Math.sin(Math.PI * f) ** 0.6;
    const waver = 1 + ease * (w1 * (0.5 + 0.5 * Math.sin(k1 * Math.PI * g + p1)) + w2 * (0.5 + 0.5 * Math.sin(k2 * Math.PI * g + p2)));
    const r = (ends + Math.max(0, rim(t) - ends) * Math.min(1, 2.2 * ease)) * waver;
    bend.push([mx + Math.cos(t) * r, my + Math.sin(t) * r]);
  }
  const raw = measurePolyline([...subPolyline(poly, 0, s0), ...bend, ...subPolyline(poly, s1, poly.total)]);
  // where it leaves the way and comes back: the kinks eased, by averaging
  // the points round them (evenly spaced first) – the rest left as it was
  const step = 0.04, n = Math.ceil(raw.total / step), even = [];
  for (let k = 0; k <= n; k++) even.push(pointAt(raw, Math.min(raw.total, k * step)));
  const from = Math.max(1, Math.floor((s0 - SMOOTH) / step)), to = Math.min(n - 1, Math.ceil((raw.total - (poly.total - s1) + SMOOTH) / step));
  let line = even;
  for (let round = 0; round < 3; round++) {
    const next = line.map((p) => [...p]);
    for (let k = from; k <= to; k++) {
      let sx = 0, sy = 0, m = 0;
      for (let j = Math.max(0, k - WINDOW); j <= Math.min(n, k + WINDOW); j++) { sx += line[j][0]; sy += line[j][1]; m++; }
      next[k] = [sx / m, sy / m];
    }
    line = next;
  }
  return line.map(toWorld);
}

// A small seeded random source (0–1) from a position.
function seeded(x, y) {
  let h = (Math.imul(Math.round(x * 1000) + 7919, 374761393) ^ Math.imul(Math.round(y * 1000) + 104729, 668265263)) >>> 0;
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let v = Math.imul(h ^ (h >>> 15), 1 | h);
    v ^= v + Math.imul(v ^ (v >>> 7), 61 | v);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}
