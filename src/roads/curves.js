// Ways drawn point by point (docs/free-placement-plan.md, stage C): the
// points the player clicks become a smooth centre line – a centripetal
// Catmull-Rom curve through them, which never loops or overshoots between
// close points – resampled evenly for drawing and for travel by arc
// length (measurePolyline / pointAt in geometry.js).
//
//   curveThrough(points, step)   the centre line through the control points
//   tightestBend(line)           the smallest radius along a sampled line
//   easeBends(points, radius)    a centre line through them bending no
//                                tighter than radius: the curve, or its
//                                corners rounded with arcs (null if one
//                                won't fit)

import { measurePolyline, pointAt } from './geometry.js';

const ALPHA = 0.5; // centripetal

// The centre line through `points` (at least two), sampled about every
// `step` world units; the ends are the first and last points exactly.
export function curveThrough(points, step = 0.1) {
  if (points.length < 2) return points.map((p) => [...p]);
  if (points.length === 2) return resample([points[0], points[1]], step);
  // mirrored ends, so the curve starts and ends heading along its first
  // and last segments
  const ext = [mirror(points[1], points[0]), ...points, mirror(points[points.length - 2], points[points.length - 1])];
  const dense = [];
  for (let i = 1; i < ext.length - 2; i++) {
    const [p0, p1, p2, p3] = [ext[i - 1], ext[i], ext[i + 1], ext[i + 2]];
    const n = Math.max(2, Math.ceil(dist(p1, p2) / (step / 2)));
    for (let k = 0; k < n; k++) dense.push(catmullRom(p0, p1, p2, p3, k / n));
  }
  dense.push([...points[points.length - 1]]);
  return resample(dense, step);
}

// The smallest radius of curvature along a sampled line (Infinity for a
// straight one): the circle through each three points in a row.
export function tightestBend(line) {
  let best = Infinity;
  for (let i = 1; i < line.length - 1; i++) best = Math.min(best, circumradius(line[i - 1], line[i], line[i + 1]));
  return best;
}

// A centre line through `points` that bends no tighter than `radius`: the
// smooth curve if it holds; else the points joined by straight legs, each
// inner corner rounded as a road builder would – a circular arc of that
// radius tangent to both legs (taking at most half of each, the rest is
// the next bend's). The ends stay. Returns the line sampled about every
// `step`, or null where an arc won't fit on its legs.
export function easeBends(points, radius, { step = 0.1 } = {}) {
  const smooth = curveThrough(points, step);
  if (tightestBend(smooth) >= radius) return smooth;
  const line = [[...points[0]]];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], a = points[i - 1], b = points[i + 1];
    const la = dist(p, a), lb = dist(p, b);
    const ua = [(a[0] - p[0]) / la, (a[1] - p[1]) / la], ub = [(b[0] - p[0]) / lb, (b[1] - p[1]) / lb];
    const inner = Math.acos(Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1]))); // between the legs
    if (Math.PI - inner < 1e-3) { line.push([...p]); continue; }
    const t = radius / Math.tan(inner / 2); // tangent length
    if (t > Math.min(la, lb) / 2 + 1e-9) return null;
    const s0 = [p[0] + ua[0] * t, p[1] + ua[1] * t], s1 = [p[0] + ub[0] * t, p[1] + ub[1] * t];
    const bis = [ua[0] + ub[0], ua[1] + ub[1]], bl = Math.hypot(...bis), h = radius / Math.sin(inner / 2);
    const c = [p[0] + (bis[0] / bl) * h, p[1] + (bis[1] / bl) * h];
    const a0 = Math.atan2(s0[1] - c[1], s0[0] - c[0]);
    let sweep = Math.atan2(s1[1] - c[1], s1[0] - c[0]) - a0;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    const n = Math.max(2, Math.ceil((Math.abs(sweep) * radius) / step));
    for (let k = 0; k <= n; k++) line.push([c[0] + radius * Math.cos(a0 + (sweep * k) / n), c[1] + radius * Math.sin(a0 + (sweep * k) / n)]);
  }
  line.push([...points[points.length - 1]]);
  return resample(line, step);
}

// A polyline cut into even pieces about `step` long.
export function resample(line, step) {
  const poly = measurePolyline(line);
  if (poly.total === 0) return [[...line[0]]];
  const n = Math.max(1, Math.round(poly.total / step));
  const out = [];
  for (let k = 0; k <= n; k++) out.push(pointAt(poly, (poly.total * k) / n));
  out[0] = [...line[0]];
  out[n] = [...line[line.length - 1]];
  return out;
}

function catmullRom(p0, p1, p2, p3, u) {
  // centripetal parametrisation (Barry–Goldman pyramid)
  const t0 = 0;
  const t1 = t0 + Math.max(1e-6, dist(p0, p1) ** ALPHA);
  const t2 = t1 + Math.max(1e-6, dist(p1, p2) ** ALPHA);
  const t3 = t2 + Math.max(1e-6, dist(p2, p3) ** ALPHA);
  const t = t1 + (t2 - t1) * u;
  const lerp = (a, b, ta, tb) => [
    ((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta),
    ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta),
  ];
  const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

function mirror(p, about) {
  return [2 * about[0] - p[0], 2 * about[1] - p[1]];
}

function dist(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function circumradius(a, b, c) {
  const ab = dist(a, b), bc = dist(b, c), ca = dist(c, a);
  const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return area2 < 1e-12 ? Infinity : (ab * bc * ca) / (2 * area2);
}
