// Pen-drawn shapes as SVG path data, for things drawn in screen space: UI
// frames, hover circles, crosses, tooltips. The same idea as the Painter's
// LOOK.sketch (bowed edges, lines running on past the corners), but for flat
// shapes given in pixels.
//
// Every shape takes a `seed`, so a given frame or circle is drawn the same
// way every frame instead of flickering; different seeds give different
// strokes. `k` scales every wobble (pass 1 / zoom when drawing in scene
// coordinates, so the wobble stays the same size on screen).

import { mulberry32 } from '../core/random.js';

const r2 = (n) => Math.round(n * 100) / 100;

// A stable seed from a few numbers (positions, ids…).
export function seedOf(...nums) {
  let h = 0x811c9dc5;
  for (const n of nums) h = Math.imul(h ^ (Math.round(n * 100) | 0), 0x01000193);
  return h >>> 0;
}

// One bowed stroke from a to b, running past both ends by up to `over`.
function stroke([ax, ay], [bx, by], rnd, k, over, bowMax) {
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / len, uy = (by - ay) / len;
  const oa = over * (0.25 + 0.75 * rnd()) * k, ob = over * (0.25 + 0.75 * rnd()) * k;
  const na = (rnd() - 0.5) * 1.4 * k, nb = (rnd() - 0.5) * 1.4 * k; // sideways slip at the ends
  const x0 = ax - ux * oa - uy * na, y0 = ay - uy * oa + ux * na;
  const x1 = bx + ux * ob - uy * nb, y1 = by + uy * ob + ux * nb;
  const bow = (rnd() - 0.5) * 2 * Math.min(bowMax * k, len * 0.02);
  const cx = (x0 + x1) / 2 - uy * bow, cy = (y0 + y1) / 2 + ux * bow;
  return `M${r2(x0)} ${r2(y0)}Q${r2(cx)} ${r2(cy)} ${r2(x1)} ${r2(y1)}`;
}

// A line from a to b.
export function sketchLine(a, b, seed, { k = 1, over = 0, bow = 1.2 } = {}) {
  return stroke(a, b, mulberry32(seed), k, over, bow);
}

// A polyline as separate strokes, one per segment (leader lines).
export function sketchPolyline(points, seed, { k = 1, bow = 1 } = {}) {
  const rnd = mulberry32(seed);
  let d = '';
  for (let i = 1; i < points.length; i++) d += stroke(points[i - 1], points[i], rnd, k, 0.6, bow);
  return d;
}

// A rectangle drawn as four strokes that cross at the corners.
export function sketchRect(x, y, w, h, seed, { k = 1, over = 3, bow = 1.2 } = {}) {
  const rnd = mulberry32(seed);
  const c = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  return [0, 1, 2, 3].map((i) => stroke(c[i], c[(i + 1) % 4], rnd, k, over, bow)).join('');
}

// A box drawn freehand, for the UI's frames: like sketchRect, but each side
// wavers along its length (a cubic, pulled a little either way at its
// thirds), runs on further past the corners, starts and ends a little off
// the line, and a long side may be drawn in two goes – the pen lifted and
// set down again, the strokes overlapping a little.
export function sketchBox(x, y, w, h, seed, { over = 7, waver = 2.2, slip = 1.6 } = {}) {
  const rnd = mulberry32(seed);
  const c = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const side = ([ax, ay], [bx, by], from, to) => {
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    const at = (t, off) => [ax + (bx - ax) * t - uy * off, ay + (by - ay) * t + ux * off];
    const span = (to - from) * len;
    const amp = Math.min(waver, span * 0.03);
    const [x0, y0] = at(from, (rnd() - 0.5) * 2 * slip);
    const [x1, y1] = at(from + (to - from) / 3, (rnd() - 0.5) * 2 * amp);
    const [x2, y2] = at(from + (to - from) * 2 / 3, (rnd() - 0.5) * 2 * amp);
    const [x3, y3] = at(to, (rnd() - 0.5) * 2 * slip);
    return `M${r2(x0)} ${r2(y0)}C${r2(x1)} ${r2(y1)} ${r2(x2)} ${r2(y2)} ${r2(x3)} ${r2(y3)}`;
  };
  let d = '';
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    // past the corners: each end its own way, at least a bit
    const from = -(over * (0.35 + 0.65 * rnd())) / len;
    const to = 1 + (over * (0.35 + 0.65 * rnd())) / len;
    if (len > 150 && rnd() < 0.55) {
      const cut = 0.35 + rnd() * 0.3, lap = (2 + rnd() * 5) / len;
      d += side(a, b, from, cut + lap) + side(a, b, cut - lap, to);
    } else {
      d += side(a, b, from, to);
    }
  }
  return d;
}

// An ellipse drawn in one go the way a pen circles a spot: a bit more than
// one turn, slightly lumpy, the end missing the start.
export function sketchEllipse(cx, cy, rx, ry, seed, { k = 1, turns = 1.12, lump = 0.06 } = {}) {
  const rnd = mulberry32(seed);
  const t0 = rnd() * Math.PI * 2;
  const p1 = rnd() * 6.3, p2 = rnd() * 6.3;
  const drift = (0.04 + rnd() * 0.05) * (rnd() < 0.5 ? -1 : 1); // spirals in or out a little
  const n = 36;
  let d = '';
  for (let i = 0; i <= n * turns; i++) {
    const f = i / n;
    const t = t0 + f * Math.PI * 2;
    const s = 1 + lump * (0.6 * Math.sin(2 * t + p1) + 0.4 * Math.sin(3 * t + p2)) + drift * f;
    const px = cx + Math.cos(t) * rx * s, py = cy + Math.sin(t) * ry * s;
    d += `${i ? 'L' : 'M'}${r2(px)} ${r2(py)}`;
  }
  return d;
}
