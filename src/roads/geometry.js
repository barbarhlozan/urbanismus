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

// The drawn centre line of one segment a -> b of a network (the same curves
// as networkPolylines: half of the corner fillet at each end that bends).
export function edgeCurve(layer, { cornerRadius, curveSamples }, a, b) {
  const { graph } = layer;
  const pos = (n) => layer.pos(n);
  const half = curveSamples / 2;
  const out = [];
  if (graph.degree(a) === 2) {
    const [x] = [...graph.neighbors(a)].filter((n) => n !== b);
    out.push(...fillet(pos(x), pos(a), pos(b), cornerRadius, curveSamples).slice(Math.floor(half)));
  } else {
    out.push(pos(a));
  }
  if (graph.degree(b) === 2) {
    const [c] = [...graph.neighbors(b)].filter((n) => n !== a);
    out.push(...fillet(pos(a), pos(b), pos(c), cornerRadius, curveSamples).slice(0, Math.ceil(half) + 1));
  } else {
    out.push(pos(b));
  }
  return out;
}

// Cut `d` off the start of a polyline.
export function trimStart(points, d) {
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const l = Math.hypot(bx - ax, by - ay);
    if (l > d) {
      const t = d / l;
      return [[ax + (bx - ax) * t, ay + (by - ay) * t], ...points.slice(i)];
    }
    d -= l;
  }
  return [];
}

// Kerb lines on both sides of every street segment (road segments with
// sidewalks), `width` from the centre line. They stop short of junctions so
// they don't cut across the other roads there.
export function streetKerbs(world, curve, width) {
  const layer = world.networks.road;
  const { graph } = layer;
  const lines = [];
  for (const key of world.sidewalks) {
    const [a, b] = key.split('-').map(Number);
    let line = edgeCurve(layer, curve, a, b);
    if (graph.degree(a) > 2) line = trimStart(line, width * 1.5);
    if (graph.degree(b) > 2) line = trimStart(line.reverse(), width * 1.5).reverse();
    if (line.length < 2) continue;
    lines.push(offsetPolyline(line, width), offsetPolyline(line, -width));
  }
  return lines;
}

// A network split into runs between junctions and dead ends: node lists
// through dots where exactly two segments meet, so each run can be drawn
// as one continuous line (dash patterns don't restart at every dot). Loops
// with no junction come out as one run starting and ending on the same dot.
export function networkChains(graph) {
  const seen = new Set();
  const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const walk = (a, b) => {
    const chain = [a, b];
    seen.add(key(a, b));
    let prev = a, cur = b;
    while (graph.degree(cur) === 2) {
      const next = [...graph.neighbors(cur)].find((m) => m !== prev);
      if (next === undefined || seen.has(key(cur, next))) break;
      seen.add(key(cur, next));
      chain.push(next);
      prev = cur;
      cur = next;
    }
    return chain;
  };
  const chains = [];
  for (const n of graph.nodes()) {
    if (graph.degree(n) === 2) continue;
    for (const m of graph.neighbors(n)) if (!seen.has(key(n, m))) chains.push(walk(n, m));
  }
  for (const [a, b] of graph.edges()) if (!seen.has(key(a, b))) chains.push(walk(a, b));
  return chains;
}

// Railway linework, in the map symbol style (a solid line with light dashes
// inside, see styles.css). All world-space polylines:
//   lines    one smoothed polyline per run between junctions (networkChains),
//            carried on 0.8 past map exits
//   fades    their faint continuation off the map
//   buffers  a stop across each dead end that isn't a map exit
export function railLines(layer, curve, exits) {
  const { graph } = layer;
  const exitAt = new Map(exits.map((e) => [e.node, e.dir]));
  const lines = [], fades = [], buffers = [];
  const beyond = (n, d) => {
    const [x, y] = layer.pos(n);
    const [dx, dy] = exitAt.get(n);
    return [x + dx * d, y + dy * d];
  };
  for (const chain of networkChains(graph)) {
    const pts = chain.map((n) => layer.pos(n));
    const first = chain[0], last = chain[chain.length - 1];
    if (exitAt.has(first)) pts.unshift(beyond(first, 0.8));
    if (exitAt.has(last)) pts.push(beyond(last, 0.8));
    lines.push(smoothPolyline(pts, curve.cornerRadius, curve.curveSamples));
  }
  for (const n of exitAt.keys()) fades.push([beyond(n, 0.8), beyond(n, 1.9)]);
  for (const n of graph.nodes()) {
    if (graph.degree(n) !== 1 || exitAt.has(n)) continue;
    const [m] = graph.neighbors(n);
    const [px, py] = layer.pos(n), [qx, qy] = layer.pos(m);
    const l = Math.hypot(px - qx, py - qy) || 1;
    const nx = (-(py - qy) / l) * 0.12, ny = ((px - qx) / l) * 0.12;
    buffers.push([[px + nx, py + ny], [px - nx, py - ny]]);
  }
  return { lines, fades, buffers };
}
