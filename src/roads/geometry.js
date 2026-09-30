// Road data is a strict grid graph; this file turns it into organic curves.
// All output is 2D world coordinates – projection happens in the renderer.
//
// Rule: every node where exactly two road segments meet gets a quadratic
// fillet that eats `radius` of each adjoining segment. Junctions and dead ends
// stay sharp. Change the look of roads here without touching the data.

import { SegmentIndex } from '../core/geom2d.js';

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
// `radius` may be a function (index of the corner point) -> radius.
export function smoothPolyline(points, radius, samples) {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const r = typeof radius === 'function' ? radius(i) : radius;
    out.push(...fillet(points[i - 1], points[i], points[i + 1], r, samples));
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
// traffic in opposite directions doesn't overlap. `d` may be a function
// (point) -> offset, to keep a different distance in different places.
export function offsetPolyline(points, d) {
  if (!d || points.length < 2) return points;
  const at = typeof d === 'function' ? d : () => d;
  return points.map((p, i) => {
    const k = at(p);
    const a = points[Math.max(i - 1, 0)];
    const b = points[Math.min(i + 1, points.length - 1)];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    return [p[0] - (ty / l) * k, p[1] + (tx / l) * k];
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

// Footpaths carrying on from a road's dead end (drawn from its last dot):
// the road stays open there and its edges narrow into the footpath's.
// Map road dot -> { fine, to, line: [[left], [right]] }: the footpath's
// dot there and its next one (the most straight-on, if it branches), and
// the two joining lines, from the road's edges to the footpath's `reach`
// along it (the footpath is drawn from there on).
export const JOIN_REACH = 0.16;
export function pathJoins(world, curve, lane, pathCurve) {
  const roads = world.networks.road, paths = world.networks.path;
  const out = new Map();
  for (const n of roads.graph.nodes()) {
    if (roads.graph.degree(n) !== 1) continue;
    const f = world.coarseToFine(n);
    if (!world.paths.hasNode(f)) continue;
    const [m] = roads.graph.neighbors(n);
    const [x, y] = roads.pos(n), [mx, my] = roads.pos(m);
    const l = Math.hypot(x - mx, y - my) || 1;
    const u = [(x - mx) / l, (y - my) / l];
    // the footpath going on ahead (not back along the road)
    let best = null;
    for (const g of world.paths.neighbors(f)) {
      const [gx, gy] = paths.pos(g);
      const k = Math.hypot(gx - x, gy - y) || 1;
      const v = [(gx - x) / k, (gy - y) / k];
      const ahead = u[0] * v[0] + u[1] * v[1];
      if (ahead > 0.3 && (!best || ahead > best.ahead)) best = { g, v, ahead };
    }
    if (!best) continue;
    const w = world.isLane(n, m) ? lane.edge : curve.edge, pw = pathCurve.edge, { v } = best;
    const ahead = [x + v[0] * JOIN_REACH, y + v[1] * JOIN_REACH];
    // side +1 / -1 (as offsetPolyline +w / -w, of the way along)
    const line = [1, -1].map((s) => {
      const e = [x - u[1] * w * s, y + u[0] * w * s];
      const p = [ahead[0] - v[1] * pw * s, ahead[1] + v[0] * pw * s];
      // bend where the road's edge, carried on, meets the footpath's (when
      // it turns), else halfway
      let c = [e[0] + u[0] * JOIN_REACH * 0.5, e[1] + u[1] * JOIN_REACH * 0.5];
      const det = u[0] * v[1] - u[1] * v[0];
      if (Math.abs(det) > 0.2) {
        const k = ((p[0] - e[0]) * v[1] - (p[1] - e[1]) * v[0]) / det;
        if (k > 0 && k < JOIN_REACH) c = [e[0] + u[0] * k, e[1] + u[1] * k];
        else if (k <= 0) c = e;
      }
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t;
        pts.push([a * e[0] + b * c[0] + d * p[0], a * e[1] + b * c[1] + d * p[1]]);
      }
      return pts;
    });
    out.set(n, { fine: f, to: best.g, line });
  }
  return out;
}

// Kerb lines: along every side of a road segment with a sidewalk (both
// sides of a street, the sides of a lane that have one, world.hasKerb),
// `curve.kerb` / `lane.kerb` from the centre line. They are the road's
// edges pushed out to the kerb (roadEdges), so where two sidewalks meet
// at a junction they round the corner like the road does, and a street's
// dead end is walked round. Next to a road side without one they stop
// short, clear of the other road.
// Returns [{ key, line, a, b }] (keys as roadEdges', for the pen).
// `joins` (pathJoins): dead ends a footpath carries on from stay open.
export function streetKerbs(world, curve, lane, joins = new Map()) {
  const layer = world.networks.road;
  const width = (a, b) => {
    if (world.hasSidewalk(a, b)) return curve.kerb;
    if (!world.isLane(a, b)) return curve.edge;
    return world.laneWalks.has(a < b ? `${a}-${b}` : `${b}-${a}`) ? lane.kerb : lane.edge;
  };
  // a side key from roadEdges: the segment's key, then 0 / 1 for the side
  const kerbed = (k) => {
    const [a, b] = k.slice(0, -1).split('-').map(Number);
    return world.hasKerb(a, b, Number(k.slice(-1)));
  };
  const out = [];
  for (const { key, kind, line, a, b, sides } of roadEdges(layer, curve, width, world.roadExits(), (n) => !joins.has(n))) {
    const keep = kind === 'edge' ? kerbed(key) : (kind === 'corner' || kind === 'end') && sides.every(kerbed);
    if (keep) out.push({ key, line, a, b });
  }
  return out;
}

// A road drawn as its two edges, `width` either side of the centre line,
// as on a town plan. The edges are offset along whole runs between
// junctions (so they join smoothly), then cut back into pieces per segment;
// they stop short at a junction and curve round into the next road's edge
// there, like kerb corners (straight across on the side of a T with no
// road). Dead ends get a rounded end; at map exits (`exits`: [{ node, dir }])
// the edges carry on 0.8 past the edge dot, then fade.
// Returns [{ key, kind, line, a, b }]: kind 'edge' (a -> b the segment),
// 'corner' / 'end' (a the node, b a neighbour), 'exit' / 'fade' (a = b the
// exit node); keys stay put while the pieces do (for the pen, ink.js).
// Corners and ends also give `sides`: the keys of the edges they join.
// Works for any network (footpaths too); `capAt(node)` false leaves a dead
// end open (a footpath carrying on as a park's walkway).
// `width` may be a function (a, b) -> width of that segment (lanes and
// roads): runs are split where it changes, and the edges widen over
// `taper` there, going from the narrower segment into the wider one.
export function roadEdges(layer, curve, width, exits = [], capAt = () => true, taper = 0) {
  const { graph } = layer;
  const out = [];
  const widthOf = typeof width === 'function' ? width : () => width;
  // dots where exactly two segments of different widths meet
  const change = (n) => {
    if (graph.degree(n) !== 2) return false;
    const [a, b] = graph.neighbors(n);
    return widthOf(n, a) !== widthOf(n, b);
  };
  const widest = (n) => Math.max(...[...graph.neighbors(n)].map((m) => widthOf(n, m)));
  const arms = new Map(); // junction / dead end -> [{ to, dir, ends: [p, p] }]
  const exitAt = new Map(exits.map((e) => [e.node, e.dir]));
  // How far an edge stops short of a junction n, on the side of the road
  // to `to` that faces the next road round (turn +1, anticlockwise) or the
  // one before (-1): far enough for a corner, and on the inside of a sharp
  // angle past where the two edges meet (w / tan(θ/2) out), so they don't
  // cross into a notch.
  const angleTo = (n, m) => {
    const [x, y] = layer.pos(n), [tx, ty] = layer.pos(m);
    return Math.atan2(ty - y, tx - x);
  };
  const trimAt = (n, to, turn) => {
    if (change(n)) return widthOf(n, to) < widest(n) ? taper : 0;
    if (graph.degree(n) <= 2) return 0;
    const width = widest(n);
    const own = angleTo(n, to);
    let gap = Math.PI * 2;
    for (const m of graph.neighbors(n)) {
      if (m === to) continue;
      const d = ((((angleTo(n, m) - own) * turn) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (d > 1e-6) gap = Math.min(gap, d);
    }
    const meet = gap < Math.PI ? width / Math.tan(gap / 2) : 0;
    return Math.max(width * 1.25, meet + width * 0.4);
  };
  const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  for (const chain of networkChains(graph, change)) {
    const width = widthOf(chain[0], chain[1]);
    // centre line of the run, remembering where each segment starts
    const centre = [], starts = [];
    for (let i = 1; i < chain.length; i++) {
      starts.push(Math.max(0, centre.length - 1));
      for (const p of edgeCurve(layer, curve, chain[i - 1], chain[i])) {
        const q = centre[centre.length - 1];
        if (!q || q[0] !== p[0] || q[1] !== p[1]) centre.push(p);
      }
    }
    starts.push(centre.length - 1);
    if (centre.length < 2) continue;
    const [first, last] = [chain[0], chain[chain.length - 1]];
    const closed = first === last && graph.degree(first) === 2 && !change(first);
    const sides = [offsetPolyline(centre, width), offsetPolyline(centre, -width)];
    // side 0 (offset +w) faces the next road round at the start of the run,
    // the one before at its end; side 1 the other way
    const cut = sides.map((_, k) => [trimAt(first, chain[1], k ? -1 : 1), trimAt(last, chain[chain.length - 2], k ? 1 : -1)]);
    for (let i = 1; i < chain.length; i++) {
      const [a, b] = [chain[i - 1], chain[i]];
      // side 0 / 1 = right / left of the segment going from its lower dot
      const flip = a > b;
      sides.forEach((side, k) => {
        let piece = side.slice(starts[i - 1], starts[i] + 1);
        if (!closed && i === 1) piece = trimStart(piece, cut[k][0]);
        if (!closed && i === chain.length - 1) piece = trimStart(piece.reverse(), cut[k][1]).reverse();
        if (piece.length > 1) out.push({ key: `${pairKey(a, b)}${k ^ flip}`, kind: 'edge', line: piece, a, b });
      });
    }
    if (closed) continue;
    const ends = sides.map((l, k) => [trimStart(l, cut[k][0])[0], trimStart(l.slice().reverse(), cut[k][1])[0]]);
    // (with the edge pieces' keys of the end segment's sides)
    // (`flip`: the run goes from the higher dot of that segment)
    const arm = (n, to, pts, flip) => {
      if (pts.some((p) => !p)) return;
      const [x, y] = layer.pos(n), [tx, ty] = layer.pos(to);
      const l = Math.hypot(tx - x, ty - y) || 1;
      const keys = pts.map((_, k) => `${pairKey(n, to)}${k ^ flip}`);
      (arms.get(n) ?? arms.set(n, []).get(n)).push({ to, dir: [(tx - x) / l, (ty - y) / l], ends: pts, keys });
    };
    arm(first, chain[1], ends.map((e) => e[0]), first > chain[1] ? 1 : 0);
    arm(last, chain[chain.length - 2], ends.map((e) => e[1]), chain[chain.length - 2] > last ? 1 : 0);
  }

  const quad = (p, c, q, n = 8) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t;
      pts.push([a * p[0] + b * c[0] + d * q[0], a * p[1] + b * c[1] + d * q[1]]);
    }
    return pts;
  };
  for (const [n, list] of arms) {
    const [x, y] = layer.pos(n);
    const cross = ([dx, dy], [px, py]) => dx * (py - y) - dy * (px - x);
    if (list.length === 1) {
      const { to, dir: [dx, dy], ends: [e0, e1], keys } = list[0];
      const width = widthOf(n, to);
      const out0 = exitAt.get(n);
      if (out0) {
        // carry the edges on off the map, then fade out
        const [ox, oy] = out0;
        [e0, e1].forEach(([ex, ey], k) => {
          out.push({ key: `x${n}:${k}`, kind: 'exit', line: [[ex, ey], [ex + ox * 0.8, ey + oy * 0.8]], a: n, b: n });
          out.push({ key: `f${n}:${k}`, kind: 'fade', line: [[ex + ox * 0.8, ey + oy * 0.8], [ex + ox * 1.9, ey + oy * 1.9]], a: n, b: n });
        });
      } else if (capAt(n)) {
        out.push({ key: `end${n}`, kind: 'end', line: quad(e0, [x - dx * width * 1.3, y - dy * width * 1.3], e1), a: n, b: to, sides: keys });
      }
      continue;
    }
    // corners between neighbouring roads, going round the junction
    list.sort((a, b) => Math.atan2(a.dir[1], a.dir[0]) - Math.atan2(b.dir[1], b.dir[0]));
    for (let i = 0; i < list.length; i++) {
      const a = list[i], b = list[(i + 1) % list.length];
      const ip = Math.max(0, a.ends.findIndex((e) => cross(a.dir, e) > 0));
      const iq = b.ends.findIndex((e) => cross(b.dir, e) < 0);
      const [p, q] = [a.ends[ip], b.ends[iq < 0 ? 1 : iq]];
      // the two edges, followed back in towards the junction, meet at the
      // corner; roads straight across (or turning away): a straight line
      const det = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
      let c = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (Math.abs(det) > 1e-3) {
        const s = ((q[0] - p[0]) * b.dir[1] - (q[1] - p[1]) * b.dir[0]) / det;
        const u = ((q[0] - p[0]) * a.dir[1] - (q[1] - p[1]) * a.dir[0]) / det;
        if (s < 0 && u < 0) c = [p[0] + a.dir[0] * s, p[1] + a.dir[1] * s];
      }
      out.push({ key: `c${n}:${a.to}:${b.to}`, kind: 'corner', line: quad(p, c, q), a: n, b: b.to, sides: [a.keys[ip], b.keys[iq < 0 ? 1 : iq]] });
    }
  }
  return out;
}

// Where footpaths give way to roads: a test (x, y) -> true for points on
// the roadway, between a plain road's edges or between a street's kerbs
// (a street's sidewalk belongs to the street). Footpaths are drawn up to
// there and no further, so one joining a road ends at its edge, one
// joining a street at its kerb.
// The test says which: 'street', 'road' or 'lane' (a single-track lane,
// between its narrower edges), or false.
export function roadway(world, curve, lane) {
  const layer = world.networks.road;
  const streets = [], plain = [], lanes = [];
  const walked = []; // lanes with a sidewalk (either side: up to its kerb)
  for (const [a, b] of layer.graph.edges()) {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const list = world.sidewalks.has(key) ? streets : !world.lanes.has(key) ? plain : world.laneWalks.has(key) ? walked : lanes;
    list.push(edgeCurve(layer, curve, a, b));
  }
  const s = new SegmentIndex(streets), p = new SegmentIndex(plain), l = new SegmentIndex(lanes), w = new SegmentIndex(walked);
  return (q) => {
    if (s.distance(q, curve.kerb) !== Infinity) return 'street';
    if (p.distance(q, curve.edge) !== Infinity) return 'road';
    return l.distance(q, lane.edge) !== Infinity || w.distance(q, lane.kerb) !== Infinity ? 'lane' : false;
  };
}

// The parts of a polyline where keep(point) holds, as polylines: the
// original points, plus where it goes in or out (found within `step`).
export function keepRuns(pts, keep, step = 0.01) {
  const runs = [];
  let run = keep(pts[0]) ? [pts[0]] : null;
  let last = pts[0]; // the last point looked at
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) {
      const q = k === n ? pts[i] : [ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n];
      if (keep(q)) {
        if (!run) run = [q];                // in: starts here
        else if (k === n) run.push(q);      // an original point
      } else if (run) {
        if (run[run.length - 1] !== last) run.push(last); // out: ends at the last point in
        if (run.length > 1) runs.push(run);
        run = null;
      }
      last = q;
    }
  }
  if (run && run.length > 1) runs.push(run);
  return runs;
}

// Every segment of a network as [a, b], run by run (networkChains), each
// pointing on along its run – so drawn one after another they join up.
export function chainEdges(graph) {
  const out = [];
  for (const chain of networkChains(graph)) for (let i = 1; i < chain.length; i++) out.push([chain[i - 1], chain[i]]);
  return out;
}

// A network split into runs between junctions and dead ends: node lists
// through dots where exactly two segments meet, so each run can be drawn
// as one continuous line (dash patterns don't restart at every dot). Loops
// with no junction come out as one run starting and ending on the same dot.
// `breakAt(node)`: also end runs at these dots.
export function networkChains(graph, breakAt = () => false) {
  const seen = new Set();
  const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const walk = (a, b) => {
    const chain = [a, b];
    seen.add(key(a, b));
    let prev = a, cur = b;
    while (graph.degree(cur) === 2 && !breakAt(cur)) {
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
    if (graph.degree(n) === 2 && !breakAt(n)) continue;
    for (const m of graph.neighbors(n)) if (!seen.has(key(n, m))) chains.push(walk(n, m));
  }
  for (const [a, b] of graph.edges()) if (!seen.has(key(a, b))) chains.push(walk(a, b));
  return chains;
}

// Railway linework, in the map symbol style (a solid line with light dashes
// inside, see styles.css), piece by piece. All world-space polylines:
//   edges    [{ a, b, line }] every segment, run by run (chainEdges), with
//            the same curves as the other networks
//   exits    [{ node, line, fade }] the track carried on 0.8 past a map
//            exit, then its faint continuation off the map
//   buffers  [{ node, line }] a stop across each dead end that isn't a map exit
export function railParts(layer, curve, exits) {
  const { graph } = layer;
  const beyond = (n, [dx, dy], d) => {
    const [x, y] = layer.pos(n);
    return [x + dx * d, y + dy * d];
  };
  const edges = chainEdges(graph).map(([a, b]) => ({ a, b, line: edgeCurve(layer, curve, a, b) }));
  const exitParts = exits.map(({ node, dir }) => ({
    node,
    line: [layer.pos(node), beyond(node, dir, 0.8)],
    fade: [beyond(node, dir, 0.8), beyond(node, dir, 1.9)],
  }));
  const exitAt = new Set(exits.map((e) => e.node));
  const buffers = [];
  for (const n of graph.nodes()) {
    if (graph.degree(n) !== 1 || exitAt.has(n)) continue;
    const [m] = graph.neighbors(n);
    const [px, py] = layer.pos(n), [qx, qy] = layer.pos(m);
    const l = Math.hypot(px - qx, py - qy) || 1;
    const nx = (-(py - qy) / l) * 0.12, ny = ((px - qx) / l) * 0.12;
    buffers.push({ node: n, line: [[px + nx, py + ny], [px - nx, py - ny]] });
  }
  return { edges, exits: exitParts, buffers };
}
