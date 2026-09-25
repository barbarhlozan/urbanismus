// Road data is a strict grid graph; this file turns it into organic curves.
// All output is 2D world coordinates – projection happens in the renderer.
//
// Rule: every node where exactly two road segments meet gets a quadratic
// fillet that eats `radius` of each adjoining segment. Junctions and dead ends
// stay sharp. Change the look of roads here without touching the data.

function direction(from, to) {
  const vx = to[0] - from[0];
  const vy = to[1] - from[1];
  const l = Math.hypot(vx, vy);
  return l ? [vx / l, vy / l, l] : [0, 0, 0];
}

// Curve from the entry point on (prev→node) to the exit point on (node→next).
export function fillet(prev, node, next, radius, samples) {
  const [ax, ay, la] = direction(node, prev);
  const [bx, by, lb] = direction(node, next);
  const t = radius * Math.min(la, lb);
  const p0 = [node[0] + ax * t, node[1] + ay * t];
  const p2 = [node[0] + bx * t, node[1] + by * t];
  const out = [];
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    out.push([
      a * p0[0] + b * node[0] + c * p2[0],
      a * p0[1] + b * node[1] + c * p2[1],
    ]);
  }
  return out;
}

// Smooth an arbitrary polyline with the same fillet rule (used for previews
// and agent movement so they match the drawn roads).
export function smoothPolyline(points, radius, samples) {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    out.push(...fillet(points[i - 1], points[i], points[i + 1], radius, samples));
  }
  out.push(points[points.length - 1]);
  return out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1]);
}

// Curves for a whole network layer (roads, footpaths…).
export function networkPolylines(layer, { cornerRadius, curveSamples }) {
  const { graph } = layer;
  const pos = (n) => layer.pos(n);
  const trim = new Map();
  const lines = [];

  for (const n of graph.nodes()) {
    if (graph.degree(n) !== 2) continue;
    const [a, b] = graph.neighbors(n);
    trim.set(n, cornerRadius * Math.min(layer.distance(n, a), layer.distance(n, b)));
    lines.push(fillet(pos(a), pos(n), pos(b), cornerRadius, curveSamples));
  }

  for (const [a, b] of graph.edges()) {
    const pa = pos(a);
    const pb = pos(b);
    const [ux, uy, l] = direction(pa, pb);
    const ta = trim.get(a) ?? 0;
    const tb = trim.get(b) ?? 0;
    if (l - ta - tb <= 1e-6) continue;
    lines.push([
      [pa[0] + ux * ta, pa[1] + uy * ta],
      [pb[0] - ux * tb, pb[1] - uy * tb],
    ]);
  }
  return lines;
}

// Shift a polyline sideways by d (to the right of the travel direction), so
// traffic in opposite directions doesn't overlap.
export function offsetPolyline(points, d) {
  if (!d || points.length < 2) return points;
  return points.map((p, i) => {
    const a = points[Math.max(i - 1, 0)];
    const b = points[Math.min(i + 1, points.length - 1)];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    return [p[0] - (ty / l) * d, p[1] + (tx / l) * d];
  });
}

// Arc-length parametrised polyline for moving things along.
export function measurePolyline(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return { points, cum, total: cum[cum.length - 1] };
}

export function pointAt(poly, s) {
  const { points, cum, total } = poly;
  if (s <= 0) return points[0];
  if (s >= total) return points[points.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (s - cum[lo]) / seg;
  const a = points[lo];
  const b = points[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
