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

// Hatching over a box, as the roofs on the map are hatched: parallel
// strokes rising to the right, `gap` apart, each one a pen stroke of its
// own – stopping a little short of the edge or running a touch past it,
// never quite parallel to the next.
export function sketchHatch(x, y, w, h, seed, { gap = 5, k = 1 } = {}) {
  const rnd = mulberry32(seed);
  let d = '';
  // lines x + y = c across the box, c from its top-left corner to its bottom-right
  for (let c = gap * (0.3 + 0.4 * rnd()); c < w + h; c += gap * (0.85 + 0.3 * rnd())) {
    // where the line enters (bottom or left edge) and leaves (top or right)
    const a = c <= h ? [x, y + c] : [x + c - h, y + h];
    const b = c <= w ? [x + c, y] : [x + w, y + c - w];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 2) continue;
    // a little short at either end (the overshoot in stroke() may give it back)
    const ua = 0.6 * rnd() * k, ub = 0.6 * rnd() * k;
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    d += stroke([a[0] + ux * ua, a[1] + uy * ua], [b[0] - ux * ub, b[1] - uy * ub], rnd, k, 0.8, 0.6);
  }
  return d;
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

// A box with rounded corners drawn in one go, the way the buildings' walls
// are drawn now: the pen starts along the top, goes round once and closes
// a little past where it began, slightly off it – no strokes running out
// past the corners. Still a hand: each corner turns a little tighter or
// wider than the others and swings a touch out or in, the sides drift
// gently (`waver` px), the line trembles finely along its length
// (`tremor` px), and the end lands up to `slip` px off the start, running
// `lap` px over it.
export function sketchRoundBox(x, y, w, h, seed, { radius = 6, waver = 1, lap = 6, slip = 0.8, tremor = 0.35 } = {}) {
  const rnd = mulberry32(seed);
  const R = Math.max(0, Math.min(radius, w / 2, h / 2));
  // top left, top right, bottom right, bottom left
  const r = [0, 1, 2, 3].map(() => R * (0.6 + 0.8 * rnd()));
  const swing = [0, 1, 2, 3].map(() => (rnd() - 0.4) * Math.min(1.4, R * 0.25));
  const turn = (k, cx, cy, a0) => (t) => {
    const q = a0 + (t * Math.PI) / 2, c = Math.cos(q), s = Math.sin(q);
    return [cx + c * r[k], cy + s * r[k], c, s];
  };
  // the outline, clockwise from the top left after the corner: straight
  // sides and quarter turns, each (t 0–1) -> [x, y, outward normal x, y]
  const arc = (k) => (Math.PI * r[k]) / 2;
  const pieces = [
    [w - r[0] - r[1], (t) => [x + r[0] + t * (w - r[0] - r[1]), y, 0, -1]],
    [arc(1), turn(1, x + w - r[1], y + r[1], -Math.PI / 2)],
    [h - r[1] - r[2], (t) => [x + w, y + r[1] + t * (h - r[1] - r[2]), 1, 0]],
    [arc(2), turn(2, x + w - r[2], y + h - r[2], 0)],
    [w - r[2] - r[3], (t) => [x + w - r[2] - t * (w - r[2] - r[3]), y + h, 0, 1]],
    [arc(3), turn(3, x + r[3], y + h - r[3], Math.PI / 2)],
    [h - r[3] - r[0], (t) => [x, y + h - r[3] - t * (h - r[3] - r[0]), -1, 0]],
    [arc(0), turn(0, x + r[0], y + r[0], Math.PI)],
  ];
  const P = pieces.reduce((n, [len]) => n + len, 0) || 1;
  // where along the outline each corner's middle is (for its swing)
  const mids = [];
  { let d = 0; pieces.forEach(([len], i) => { if (i % 2) mids.push([d + len / 2, [1, 2, 3, 0][(i - 1) / 2]]); d += len; }); }
  const along = (d) => {
    d = ((d % P) + P) % P;
    for (const [len, f] of pieces) {
      if (d <= len && len > 0) return f(d / len);
      d -= len;
    }
    return pieces[0][1](0);
  };
  // slow bends, a fine tremble, and the drift that keeps the end off the start
  const l1 = 140 + rnd() * 120, l2 = 45 + rnd() * 30, l3 = 9 + rnd() * 5, l4 = 4.5 + rnd() * 2;
  const p1 = rnd() * 6.3, p2 = rnd() * 6.3, p3 = rnd() * 6.3, p4 = rnd() * 6.3;
  const drift = (rnd() - 0.5) * 2 * slip, off0 = (rnd() - 0.5) * slip;
  const TAU = 2 * Math.PI;
  const bend = (d) => waver * (0.7 * Math.sin((TAU * d) / l1 + p1) + 0.3 * Math.sin((TAU * d) / l2 + p2));
  const tremble = (d) => tremor * (0.65 * Math.sin((TAU * d) / l3 + p3) + 0.35 * Math.sin((TAU * d) / l4 + p4));
  const corners = (d) => {
    let o = 0;
    for (const [m, k] of mids) {
      let e = Math.abs((((d - m) % P) + P) % P);
      e = Math.min(e, P - e);
      const span = arc(k) * 0.8 + 3;
      if (e < span * 2) o += swing[k] * Math.exp(-((e / span) ** 2));
    }
    return o;
  };
  const start = (0.05 + rnd() * 0.3) * (w - r[0] - r[1]);
  const total = P + lap * (0.6 + 0.4 * rnd());
  const n = Math.max(32, Math.ceil(total / 2));
  let out = '';
  for (let i = 0; i <= n; i++) {
    const u = i / n, d = start + u * total;
    const [px, py, nx, ny] = along(d);
    // the slow bends ease out at the ends, so start and end don't wander apart
    const o = off0 + drift * u + bend(d) * Math.sin(Math.PI * Math.min(1, u * 1.15)) + tremble(d) + corners(d);
    out += `${i ? 'L' : 'M'}${r2(px + nx * o)} ${r2(py + ny * o)}`;
  }
  return out;
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
