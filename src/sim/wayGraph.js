// Getting about on the ways themselves (docs/free-placement-plan.md,
// stage D): one graph per way of going – driving, walking, cycling –
// derived from world.ways, with routes travelled by arc length along the
// ways' own curves.
//
//   new WayGraph(ways, { pass(e), factor(e), cuts })
//     pass(e)    which way edges belong (drive: roads; walk: footpaths,
//                streets, lanes…)
//     factor(e)  cost per unit length (a lane's slowness, a sidewalk's
//                being less liked than a footpath)
//     cuts       [{ key, x, y, reach, skip }]: points that cut the edge
//                nearest them (not edge `skip`) into two (a park's exit, a
//                footpath ending at a kerb), so something can be linked
//                there: tapOf(key)
//     mend       a way's loose end this near another way (or its node)
//                is joined to it, as the dots joined them (ways laid dot
//                by dot don't always share their node)
//
// Graph nodes are the ways' node ids (numbers) and the cuts' ('c' + key);
// pieces are the stretches of way edges between them:
//   { id, a, b, pts, len, cost, way (edge id or null), kind }
// link(a, b, cost, pts) adds a piece of one's own (through a park).
//
// A place on the graph – a door, a stop – is attached to the nearest
// piece: { piece, s, point, dist }. Routes go from attached places (or
// nodes) to attached places (or nodes):
//   { pts, cost, ways: [way edge ids], nodes: [graph nodes passed],
//     joints: [indices into pts where it passes a node] }

import { MinHeap } from '../core/heap.js';
import { measurePolyline, subPolyline } from '../roads/geometry.js';

const CELL = 1;
const cellKey = (i, j) => i * 65536 + j;

// The point of a measured polyline nearest (x, y): { s, dist, point }.
export function nearestOn({ points, cum }, x, y) {
  let best = { s: 0, dist: Infinity, point: points[0] };
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const px = ax + dx * t, py = ay + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best.dist) best = { s: cum[i - 1] + t * Math.sqrt(l2), dist: d, point: [px, py] };
  }
  return best;
}

export class WayGraph {
  constructor(ways, { pass = () => true, factor = () => 1, cuts = [], mend = 0 } = {}) {
    this.ways = ways;
    this.nodes = new Map(); // id -> [x, y]
    this.adj = new Map();   // id -> [piece]
    this.pieces = [];
    this.cells = new Map(); // cell -> [piece]
    this.taps = new Map();  // cut key -> node id
    this.minFactor = 1;

    const edges = [...ways.edges.values()].filter(pass);
    // loose ends: joined to a node near, or cut into a way near
    const mends = [];
    if (mend > 0) {
      const count = new Map();
      for (const e of edges) for (const n of [e.a, e.b]) count.set(n, (count.get(n) ?? 0) + 1);
      const own = new Map();
      for (const e of edges) for (const n of [e.a, e.b]) if (count.get(n) === 1) own.set(n, e);
      const passing = [...count.keys()].map((id) => ways.nodes.get(id));
      for (const [n, e] of own) {
        const p = ways.nodes.get(n), far = ways.other(e, n);
        let best = null, bd = mend;
        for (const q of passing) {
          if (q.id === n || q.id === far) continue;
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < bd) [best, bd] = [q, d];
        }
        if (best) {
          if (!mends.some((m) => m.a === best.id && m.b === n)) mends.push({ a: n, b: best.id });
        } else {
          cuts = [...cuts, { key: 'mend' + n, x: p.x, y: p.y, reach: mend, skip: e.id }];
          mends.push({ a: n, tap: 'mend' + n });
        }
      }
    }
    // where the cuts fall: edge id -> [{ s, id }]
    const cutsOn = new Map();
    if (cuts.length) {
      const index = new Map();
      for (const e of edges) this.bucket(index, ways.measured(e).points, e);
      for (const c of cuts) {
        let best = null;
        for (const e of this.around(index, c.x, c.y, c.reach ?? 0.5)) {
          if (e.id === c.skip) continue;
          const at = nearestOn(ways.measured(e), c.x, c.y);
          if (at.dist <= (c.reach ?? 0.5) && (!best || at.dist < best.at.dist)) best = { e, at };
        }
        if (!best) continue;
        const len = ways.length(best.e);
        const id = 'c' + c.key;
        if (best.at.s < 0.05) this.taps.set(c.key, best.e.a);
        else if (best.at.s > len - 0.05) this.taps.set(c.key, best.e.b);
        else {
          if (!cutsOn.has(best.e.id)) cutsOn.set(best.e.id, []);
          const list = cutsOn.get(best.e.id);
          const same = list.find((o) => Math.abs(o.s - best.at.s) < 0.05);
          this.taps.set(c.key, same ? same.id : id);
          if (!same) list.push({ s: best.at.s, id });
        }
      }
    }
    for (const e of edges) {
      const poly = ways.measured(e);
      const f = factor(e);
      if (!(f > 0) || !Number.isFinite(f)) continue;
      this.minFactor = Math.min(this.minFactor, f);
      const na = ways.nodes.get(e.a), nb = ways.nodes.get(e.b);
      this.nodes.set(e.a, [na.x, na.y]);
      this.nodes.set(e.b, [nb.x, nb.y]);
      const stops = [{ s: 0, id: e.a }, ...(cutsOn.get(e.id) ?? []).sort((p, q) => p.s - q.s), { s: poly.total, id: e.b }];
      for (let k = 1; k < stops.length; k++) {
        const [p, q] = [stops[k - 1], stops[k]];
        const pts = stops.length === 2 ? poly.points : subPolyline(poly, p.s, q.s);
        if (!this.nodes.has(q.id)) this.nodes.set(q.id, pts[pts.length - 1]);
        if (!this.nodes.has(p.id)) this.nodes.set(p.id, pts[0]);
        this.add(p.id, q.id, pts, f, e);
      }
    }
    for (const m of mends) {
      const b = m.tap ? this.tapOf(m.tap) : m.b;
      if (b == null || !this.nodes.has(m.a) || !this.nodes.has(b)) continue;
      const [p, q] = [this.nodes.get(m.a), this.nodes.get(b)];
      this.link(m.a, b, Math.hypot(q[0] - p[0], q[1] - p[1]), [p, q]);
    }
  }

  add(a, b, pts, f, e = null) {
    const m = measurePolyline(pts);
    const piece = { id: this.pieces.length, a, b, pts, cum: m.cum, len: m.total, cost: m.total * f, factor: f, way: e?.id ?? null, kind: e?.kind ?? null, edge: e };
    this.pieces.push(piece);
    for (const n of [a, b]) {
      if (!this.adj.has(n)) this.adj.set(n, []);
      this.adj.get(n).push(piece);
    }
    this.bucket(this.cells, pts, piece);
    return piece;
  }

  // A piece of one's own between two nodes (a park's walk): cost as given.
  link(a, b, cost, pts = null) {
    if (a == null || b == null || a === b) return null;
    pts ??= [this.nodes.get(a), this.nodes.get(b)];
    if (!pts[0] || !pts[pts.length - 1]) return null;
    for (const [n, p] of [[a, pts[0]], [b, pts[pts.length - 1]]]) if (!this.nodes.has(n)) this.nodes.set(n, p);
    const piece = this.add(a, b, pts, 1, null);
    piece.cost = cost;
    piece.factor = piece.len > 0 ? cost / piece.len : 1;
    this.minFactor = Math.min(this.minFactor, piece.factor);
    return piece;
  }

  tapOf(key) {
    return this.taps.get(key) ?? null;
  }

  hasNode(n) {
    return this.adj.has(n);
  }

  degree(n) {
    return this.adj.get(n)?.length ?? 0;
  }

  other(piece, n) {
    return piece.a === n ? piece.b : piece.a;
  }

  bucket(map, pts, item) {
    const seen = new Set();
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      const k = cellKey(Math.floor(x / CELL), Math.floor(y / CELL));
      if (seen.has(k)) continue;
      seen.add(k);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    }
  }

  around(map, x, y, r) {
    const out = new Set();
    const r1 = r + CELL; // a long straight segment may cross a cell with no point in it
    for (let i = Math.floor((x - r1) / CELL); i <= Math.floor((x + r1) / CELL); i++) {
      for (let j = Math.floor((y - r1) / CELL); j <= Math.floor((y + r1) / CELL); j++) {
        for (const it of map.get(cellKey(i, j)) ?? []) out.add(it);
      }
    }
    return out;
  }

  // The nearest piece to (x, y) within r: { piece, s, point, dist } or
  // null. `keep(piece)` filters.
  attach(x, y, r = 0.5, keep = null) {
    let best = null;
    for (const piece of this.around(this.cells, x, y, r)) {
      if (keep && !keep(piece)) continue;
      const at = nearestOn({ points: piece.pts, cum: piece.cum }, x, y);
      if (at.dist <= r && (!best || at.dist < best.dist)) best = { piece, ...at };
    }
    return best;
  }

  // The nearest point of every piece within r of (x, y), nearest first:
  // [{ piece, s, point, dist }].
  attachAll(x, y, r = 0.5) {
    const out = [];
    for (const piece of this.around(this.cells, x, y, r)) {
      const at = nearestOn({ points: piece.pts, cum: piece.cum }, x, y);
      if (at.dist <= r) out.push({ piece, ...at });
    }
    return out.sort((p, q) => p.dist - q.dist);
  }

  // Every node near (x, y), nearest first: [{ node, dist }].
  nodesNear(x, y, r) {
    const out = [];
    for (const piece of this.around(this.cells, x, y, r)) {
      for (const n of [piece.a, piece.b]) {
        const [px, py] = this.nodes.get(n);
        const d = Math.hypot(px - x, py - y);
        if (d <= r && !out.some((o) => o.node === n)) out.push({ node: n, dist: d });
      }
    }
    return out.sort((p, q) => p.dist - q.dist);
  }

  // Where a route may start: a node, or an attached place ({ piece, s }),
  // with an extra cost (from a door to the way). [{ node, cost, pre }]:
  // pre – the points from the place to that node.
  startsOf(place, extra = 0) {
    if (place == null) return [];
    if (typeof place !== 'object') return this.adj.has(place) ? [{ node: place, cost: extra, pre: [this.nodes.get(place)] }] : [];
    const { piece, s } = place;
    const poly = { points: piece.pts, cum: piece.cum, total: piece.len };
    return [
      { node: piece.a, cost: extra + s * piece.factor, pre: subPolyline(poly, 0, s).reverse() },
      { node: piece.b, cost: extra + (piece.len - s) * piece.factor, pre: subPolyline(poly, s, piece.len) },
    ];
  }

  // Dijkstra (A* with `goal` [x, y]) from starts [{ node, cost, pre }],
  // up to maxCost, `weight(piece)` scaling a piece's cost. Stops early
  // once `done(node, cost)` says so. { dist, came, from, order }.
  explore(starts, { maxCost = Infinity, weight = null, goal = null, stop = null } = {}) {
    const dist = new Map(), came = new Map(), from = new Map(), order = [];
    const closed = new Set();
    const heap = new MinHeap();
    const h = goal ? (n) => { const p = this.nodes.get(n); return Math.hypot(p[0] - goal[0], p[1] - goal[1]) * this.minFactor; } : () => 0;
    for (const st of starts) {
      if (st.cost < (dist.get(st.node) ?? Infinity)) {
        dist.set(st.node, st.cost);
        from.set(st.node, st);
        heap.push(st.node, st.cost + h(st.node));
      }
    }
    while (heap.size) {
      const n = heap.pop();
      if (closed.has(n)) continue;
      const dn = dist.get(n);
      if (dn > maxCost) break;
      if (stop?.(n, dn, dn + h(n))) break;
      closed.add(n);
      order.push(n);
      for (const piece of this.adj.get(n) ?? []) {
        const m = this.other(piece, n);
        const nd = dn + (weight ? piece.cost * weight(piece) : piece.cost);
        if (nd < (dist.get(m) ?? Infinity)) {
          dist.set(m, nd);
          came.set(m, piece);
          from.delete(m);
          heap.push(m, nd + h(m));
        }
      }
    }
    return { dist, came, from, order, closed };
  }

  // The route explore() found to node `end`, then on along `post` (the
  // points from it to the place it ends at, if any).
  trace(found, end, post = null) {
    const chain = [];
    let n = end;
    while (found.came.has(n)) {
      const piece = found.came.get(n);
      chain.unshift({ piece, to: n });
      n = this.other(piece, n);
    }
    const start = found.from.get(n);
    const pts = start ? start.pre.slice() : [this.nodes.get(n)];
    const nodes = [n], ways = [], joints = [pts.length - 1];
    const origin = start?.entry?.place?.piece?.way;
    if (origin != null) ways.push(origin);
    for (const { piece, to } of chain) {
      const line = piece.a === to ? piece.pts.slice().reverse() : piece.pts;
      for (let i = 1; i < line.length; i++) pts.push(line[i]);
      nodes.push(to);
      joints.push(pts.length - 1);
      if (piece.way != null && ways[ways.length - 1] !== piece.way) ways.push(piece.way);
    }
    if (post) {
      for (let i = 1; i < post.pts.length; i++) pts.push(post.pts[i]);
      if (post.way != null && ways[ways.length - 1] !== post.way) ways.push(post.way);
    }
    return { pts: dedupe(pts), cost: (found.dist.get(end) ?? 0) + (post?.cost ?? 0), ways, nodes, joints, from: start?.entry ?? null };
  }

  // The cheapest route from one place to another (nodes or attached
  // places, with extra costs at either end), within maxCost, or null.
  route(fromPlace, toPlace, { maxCost = Infinity, fromCost = 0, toCost = 0, weight = null } = {}) {
    return this.routeMany([{ place: fromPlace, cost: fromCost }], [{ place: toPlace, cost: toCost }], { maxCost, weight });
  }

  // As route, from any of several entries to any of several:
  // [{ place, cost, … }]. The route also says which it took: from, to.
  routeMany(froms, tos, { maxCost = Infinity, weight = null } = {}) {
    const starts = [];
    for (const f of froms) for (const st of this.startsOf(f.place, f.cost)) starts.push({ ...st, entry: f });
    const ends = new Map();
    for (const t of tos) {
      for (const st of this.startsOf(t.place, t.cost)) {
        if (st.cost < (ends.get(st.node)?.cost ?? Infinity)) {
          ends.set(st.node, { cost: st.cost, pts: st.pre.slice().reverse(), way: typeof t.place === 'object' ? t.place.piece.way : null, entry: t });
        }
      }
    }
    if (!starts.length || !ends.size) return null;
    let best = null;
    // two on one piece: straight along it
    for (const f of froms) {
      for (const t of tos) {
        if (typeof f.place !== 'object' || typeof t.place !== 'object' || f.place.piece !== t.place.piece) continue;
        const { piece } = f.place;
        const poly = { points: piece.pts, cum: piece.cum, total: piece.len };
        const [s0, s1] = [f.place.s, t.place.s];
        const cost = f.cost + t.cost + Math.abs(s1 - s0) * piece.factor;
        if (cost > maxCost || cost >= (best?.cost ?? Infinity)) continue;
        const pts = s0 <= s1 ? subPolyline(poly, s0, s1) : subPolyline(poly, s1, s0).reverse();
        best = { pts: dedupe(pts), cost, ways: piece.way != null ? [piece.way] : [], nodes: [], joints: [], from: f, to: t };
      }
    }
    // heading for the nearest end (an underestimate for the others: no
    // goal unless there's one end place)
    const goal = tos.length === 1 ? (typeof tos[0].place === 'object' ? tos[0].place.point : this.nodes.get(tos[0].place)) : null;
    let bound = best?.cost ?? Infinity;
    const found = this.explore(starts, {
      maxCost: Math.min(maxCost, bound), weight, goal,
      // (an end is final once taken off the heap; nothing cheaper is left
      // once the heap's best is past the cheapest end so far)
      stop: (n, d, f) => {
        if (f >= bound) return true;
        const e = ends.get(n);
        if (e) bound = Math.min(bound, d + e.cost);
        return false;
      },
    });
    let end = null;
    for (const [n, e] of ends) {
      const d = found.dist.get(n);
      if (d === undefined || !found.closed.has(n)) continue;
      const total = d + e.cost;
      if (total <= maxCost && total < (best?.cost ?? Infinity) && (!end || total < end.total)) end = { n, e, total };
    }
    if (end) {
      const r = this.trace(found, end.n, end.e);
      best = { ...r, to: end.e.entry };
    }
    return best;
  }

  // The nodes a route may end at, for a place: Map node -> { cost, pts, way }.
  endsOf(place, extra = 0) {
    const out = new Map();
    for (const st of this.startsOf(place, extra)) {
      out.set(st.node, { cost: st.cost, pts: st.pre.slice().reverse(), way: typeof place === 'object' ? place.piece.way : null });
    }
    return out;
  }
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) out.push(p);
  }
  return out;
}
