// A network of ways off the dots (docs/free-placement-plan.md, stage C):
// roads, lanes, footpaths, railways and fences as junctions and the
// curves between them, replacing the dot graph (network.js) one kind at a
// time.
//
//   nodes: id -> { id, x, y }                 junctions, ends, and where a
//                                             way changes (a street begins)
//   edges: id -> { id, a, b, kind, pts, … }   pts: the centre line, sampled,
//                                             from node a to node b; the
//                                             rest are its attributes
//                                             (street sides, lane, bridge…)
//
// Lines are kept as given (curves.js makes them); this file only keeps the
// graph whole: adding, splitting an edge at a point (a new junction), removing
// (and the ends nothing else meets), finding what's near, and routes.

import { measurePolyline, pointAt, subPolyline } from './geometry.js';
import { MinHeap } from '../core/heap.js';
import { crossingsOf } from './curves.js';

// What happens where a way of one kind meets one of another (the new
// one's kind first, either order gives the same): 'join' – a junction,
// shared by both (two roads; a footpath onto a road; a level crossing,
// where a road or footpath crosses a railway); 'gap' – they cross
// without meeting (a fence leaves a gap); 'refuse' – not allowed.
const FAMILY = { road: 'road', lane: 'road', path: 'path', rail: 'rail', fence: 'fence' };
export function crossRule(k1, k2) {
  const [a, b] = [FAMILY[k1] ?? k1, FAMILY[k2] ?? k2].sort();
  if (a === 'fence' || b === 'fence') return a === b ? 'join' : 'gap';
  if (a === 'rail' && b === 'rail') return 'refuse';
  return 'join';
}


// The point of a measured polyline nearest (x, y): { s, dist }.
function nearestOn({ points, cum }, x, y) {
  let best = { s: 0, dist: Infinity };
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
    if (d < best.dist) best = { s: cum[i - 1] + t * Math.sqrt(l2), dist: d };
  }
  return best;
}

export class Ways {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.at = new Map(); // node id -> Set of edge ids meeting there
    this.nextId = 1;
    this.version = 0;
  }

  addNode(x, y) {
    const node = { id: this.nextId++, x, y };
    this.nodes.set(node.id, node);
    this.at.set(node.id, new Set());
    this.version++;
    return node;
  }

  // An edge from node a to node b along `pts` (its ends are moved onto the
  // nodes), with attributes `props` (kind and the rest).
  addEdge(a, b, pts, props = {}) {
    const na = this.nodes.get(a), nb = this.nodes.get(b);
    if (!na || !nb || a === b) return null;
    const line = pts.map((p) => [...p]);
    line[0] = [na.x, na.y];
    line[line.length - 1] = [nb.x, nb.y];
    const edge = { kind: 'road', ...props, id: this.nextId++, a, b, pts: line };
    this.edges.set(edge.id, edge);
    this.at.get(a).add(edge.id);
    this.at.get(b).add(edge.id);
    this.version++;
    return edge;
  }

  // Takes an edge away, and its ends if nothing else meets there.
  removeEdge(id) {
    const e = this.edges.get(id);
    if (!e) return false;
    this.edges.delete(id);
    for (const n of [e.a, e.b]) {
      const set = this.at.get(n);
      set?.delete(id);
      if (set && !set.size) {
        this.at.delete(n);
        this.nodes.delete(n);
      }
    }
    this.version++;
    return true;
  }

  edgesAt(node) {
    return [...(this.at.get(node) ?? [])].map((id) => this.edges.get(id));
  }

  // The node at the other end of edge e from node n.
  other(e, n) {
    return e.a === n ? e.b : e.a;
  }

  // An edge's line measured (measurePolyline), cached until it changes.
  measured(e) {
    if (e._m?.pts !== e.pts) e._m = { pts: e.pts, poly: measurePolyline(e.pts) };
    return e._m.poly;
  }

  length(e) {
    return this.measured(e).total;
  }

  // Splits edge `id` at arc length s along it (from a): a new node there,
  // and two edges keeping its attributes. { node, edges: [toward a, toward b] }.
  // At (or very near) an end: that end, nothing split.
  split(id, s) {
    const e = this.edges.get(id);
    if (!e) return null;
    const poly = this.measured(e);
    if (s <= 1e-6) return { node: this.nodes.get(e.a), edges: [e] };
    if (s >= poly.total - 1e-6) return { node: this.nodes.get(e.b), edges: [e] };
    const [x, y] = pointAt(poly, s);
    const { id: _id, a, b, pts: _pts, _m, ...props } = e;
    this.edges.delete(id);
    this.at.get(a).delete(id);
    this.at.get(b).delete(id);
    const node = this.addNode(x, y);
    const first = this.addEdge(a, node.id, subPolyline(poly, 0, s), props);
    const second = this.addEdge(node.id, b, subPolyline(poly, s, poly.total), props);
    return { node, edges: [first, second] };
  }

  // The node within r of (x, y), nearest first, or null.
  nodeNear(x, y, r) {
    let best = null, bd = r;
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d <= bd) [best, bd] = [n, d];
    }
    return best;
  }

  // The nearest point on any edge within r of (x, y): { edge, s (arc
  // length from a), point, dist } or null. `keep(edge)` filters.
  edgeNear(x, y, r, keep = () => true) {
    let best = null;
    for (const e of this.edges.values()) {
      if (!keep(e)) continue;
      const { points, cum } = this.measured(e);
      for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1], [bx, by] = points[i];
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
        const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(x - px, y - py);
        if (d <= r && (!best || d < best.dist)) best = { edge: e, s: cum[i - 1] + t * Math.sqrt(l2), point: [px, py], dist: d };
      }
    }
    return best;
  }

  // Lays a new way along `line` (its centre line, from curves.js) with
  // attributes `props` (its kind and the rest). Its ends join a node
  // within `snap`, or else a way within `snap` (split there into a
  // junction), or else stand on their own. Where it crosses other ways,
  // crossRule says what happens: a junction (both split there), a gap, or
  // it can't be laid. A junction must meet at `minAngle` at least.
  // Nothing changes unless all of it can be laid.
  // { ok: true, edges, nodes } or { ok: false, reason, at: [x, y] }.
  // `refit` (0: off): an end further than `snap` from a node but within
  // `refit` of it – or meeting a way nearer than `refit` to one of its
  // ends, which would leave a stub – takes that node instead, and the node
  // moves to where the stroke ends, the ways at it bent smoothly to follow
  // (bendEnd). An end within `snap` keeps the node where it is and the
  // stroke bends into it the same way, rather than kinking at the last step.
  insert(line, props = {}, { snap = 0.35, minAngle = Math.PI / 6, rule = crossRule, refit = 0 } = {}) {
    const kind = props.kind ?? 'road';
    if (line.length < 2) return { ok: false, reason: 'Too short', at: line[0] };
    const joinsAt = (n) => this.edgesAt(n.id).some((e) => rule(kind, e.kind) === 'join');
    // the ends: what each would join (not changing anything yet)
    const endOf = ([x, y]) => {
      const node = this.nodeNear(x, y, snap);
      if (node) return { node, point: [node.x, node.y] };
      const hit = this.edgeNear(x, y, snap, (e) => rule(kind, e.kind) === 'join');
      // (a node moves only where it stays clear of the other ways)
      const free = (n) => !this.edgeNear(x, y, snap, (e) => e.a !== n.id && e.b !== n.id);
      if (hit && refit) {
        const total = this.length(hit.edge);
        const id = hit.s < refit ? hit.edge.a : total - hit.s < refit ? hit.edge.b : null;
        const n = id && this.nodes.get(id);
        if (n && Math.hypot(n.x - x, n.y - y) <= refit + snap && free(n)) return { node: n, point: [x, y], move: true };
      }
      if (hit) return { hit, point: hit.point };
      const near = refit ? this.nodeNear(x, y, refit) : null;
      if (near && joinsAt(near) && free(near)) return { node: near, point: [x, y], move: true };
      return { point: [x, y] };
    };
    const ends = [endOf(line[0]), endOf(line[line.length - 1])];
    if (ends[0].node && ends[0].node === ends[1].node) return { ok: false, reason: 'Too short', at: line[0] };
    let pts = line.map((p) => [...p]);
    // (into a node it keeps: bent smoothly onto it)
    ends.forEach((end, k) => {
      if (!end.node || end.move) return;
      const p = k ? pts[pts.length - 1] : pts[0];
      pts = bendEnd(pts, !k, [end.point[0] - p[0], end.point[1] - p[1]]);
    });
    pts[0] = ends[0].point;
    pts[pts.length - 1] = ends[1].point;
    const total = measurePolyline(pts).total;
    if (total < snap) return { ok: false, reason: 'Too short', at: pts[0] };
    // crossings along the way (not those at its ends: the ends see to them)
    const joins = [];
    for (const e of this.edges.values()) {
      for (const c of crossingsOf(pts, e.pts)) {
        if (c.sa < snap || c.sa > total - snap) continue;
        const what = rule(kind, e.kind);
        if (what === 'refuse') return { ok: false, reason: 'Crosses another line', at: c.point };
        if (what === 'gap') continue;
        if (c.angle < minAngle) return { ok: false, reason: 'Too shallow a crossing', at: c.point };
        joins.push({ edge: e, t: c.sa, s: c.sb });
      }
    }
    // loose ends of other ways it passes close by: it takes them in
    const taken = new Set(ends.map((e) => e.node?.id ?? e.hit?.edge.a).filter(Boolean));
    const passing = [];
    const along = measurePolyline(pts);
    for (const [id, set] of this.at) {
      if (set.size !== 1 || taken.has(id)) continue;
      const [edge] = this.edgesAt(id);
      if (rule(kind, edge.kind) !== 'join') continue;
      const n = this.nodes.get(id), near = nearestOn(along, n.x, n.y);
      if (near.dist <= snap && near.s > snap && near.s < total - snap) passing.push({ t: near.s, node: n });
    }
    for (const end of ends) {
      if (end.node) {
        // ending at a junction: not alongside a way already leaving it (the
        // two would run on top of each other there – a knot of edge lines)
        const out = leaving(pts, end === ends[0]);
        for (const e of this.edgesAt(end.node.id)) {
          const other = leaving(e.pts, e.a === end.node.id);
          const cos = (out[0] * other[0] + out[1] * other[1]) / ((Math.hypot(...out) * Math.hypot(...other)) || 1);
          if (Math.acos(Math.max(-1, Math.min(1, cos))) < minAngle) return { ok: false, reason: 'Too shallow a crossing', at: end.point };
        }
        continue;
      }
      if (!end.hit) continue;
      // meeting a way end-on: at a sensible angle too
      const e = end.hit.edge, poly = this.measured(e);
      const [p0, p1] = [pointAt(poly, Math.max(0, end.hit.s - 0.1)), pointAt(poly, Math.min(poly.total, end.hit.s + 0.1))];
      const [q0, q1] = end === ends[0] ? [pts[0], pts[Math.min(1, pts.length - 1)]] : [pts[pts.length - 2], pts[pts.length - 1]];
      const da = [p1[0] - p0[0], p1[1] - p0[1]], db = [q1[0] - q0[0], q1[1] - q0[1]];
      const cos = Math.abs(da[0] * db[0] + da[1] * db[1]) / ((Math.hypot(...da) * Math.hypot(...db)) || 1);
      if (Math.acos(Math.min(1, cos)) < minAngle) return { ok: false, reason: 'Too shallow a crossing', at: end.point };
    }

    // all clear: nodes moving to the stroke's ends take their ways along,
    // then split what it meets, then lay it piece by piece
    const moved = [];
    for (const end of ends) {
      if (!end.move) continue;
      const n = end.node, d = [end.point[0] - n.x, end.point[1] - n.y];
      for (const e of this.edgesAt(n.id)) {
        e.pts = bendEnd(e.pts, e.a === n.id, d);
        if (e.a === e.b) continue;
        moved.push(e.id);
      }
      [n.x, n.y] = end.point;
      this.version++;
    }
    const nodeAtEnd = (end) => end.node ?? (end.hit ? this.split(end.hit.edge.id, end.hit.s).node : this.addNode(...end.point));
    // (the ends' ways may be split by a crossing first: found again after)
    const byEdge = new Map();
    for (const j of joins) {
      if (!byEdge.has(j.edge.id)) byEdge.set(j.edge.id, []);
      byEdge.get(j.edge.id).push(j);
    }
    const junctions = [];
    for (const list of byEdge.values()) {
      // from the far end of the edge back, so each split leaves the part
      // toward `a` – where the rest are – with the same arc lengths
      list.sort((p, q) => q.s - p.s);
      let edgeId = list[0].edge.id;
      for (const j of list) {
        const { node, edges } = this.split(edgeId, j.s);
        junctions.push({ t: j.t, node });
        edgeId = edges[0].id;
      }
    }
    const endNode = (end) => end.hit
      ? (() => { const h = this.edgeNear(...end.point, 1e-6, (e) => rule(kind, e.kind) === 'join'); return h ? this.split(h.edge.id, h.s).node : this.addNode(...end.point); })()
      : nodeAtEnd(end);
    const first = endNode(ends[0]), last = endNode(ends[1]);
    const stops = [{ t: 0, node: first }, ...[...junctions, ...passing].sort((p, q) => p.t - q.t), { t: total, node: last }];
    const poly = measurePolyline(pts), edges = [];
    for (let k = 1; k < stops.length; k++) {
      if (stops[k].node === stops[k - 1].node) continue;
      edges.push(this.addEdge(stops[k - 1].node.id, stops[k].node.id, subPolyline(poly, stops[k - 1].t, stops[k].t), props));
    }
    return { ok: true, edges, nodes: stops.map((st) => st.node), moved };
  }

  // The cheapest route from node `from` to node `to`: { nodes, edges } or
  // null. cost(e) defaults to the edge's length (a lane's slowness and the
  // like are the caller's); `pass(e)` filters edges.
  route(from, to, { cost = (e) => this.length(e), pass = () => true } = {}) {
    if (!this.nodes.has(from) || !this.nodes.has(to)) return null;
    const goal = this.nodes.get(to);
    const h = (n) => { const p = this.nodes.get(n); return Math.hypot(p.x - goal.x, p.y - goal.y); };
    const best = new Map([[from, 0]]), via = new Map();
    const open = new MinHeap();
    open.push(from, h(from));
    const done = new Set();
    while (open.size) {
      const n = open.pop();
      if (n === to) break;
      if (done.has(n)) continue;
      done.add(n);
      for (const e of this.edgesAt(n)) {
        if (!pass(e)) continue;
        const m = this.other(e, n), g = best.get(n) + cost(e);
        if (g < (best.get(m) ?? Infinity)) {
          best.set(m, g);
          via.set(m, e);
          open.push(m, g + h(m));
        }
      }
    }
    if (!best.has(to)) return null;
    const nodes = [to], edges = [];
    for (let n = to; n !== from;) {
      const e = via.get(n);
      edges.unshift(e);
      n = this.other(e, n);
      nodes.unshift(n);
    }
    return { nodes, edges, cost: best.get(to) };
  }

  // Where only two edges of one way meet (the same kind and attributes,
  // nothing else there), makes them one again: the edge that remains, or
  // null if they stay apart.
  joinAt(nodeId) {
    const list = this.edgesAt(nodeId);
    if (list.length !== 2 || list[0].id === list[1].id) return null;
    const [p, q] = list;
    const attrs = ({ id, a, b, pts, _m, walks, ...rest }) => JSON.stringify(Object.entries(rest).sort());
    if (attrs(p) !== attrs(q) || p.walks || q.walks) return null;
    const from = this.other(p, nodeId), to = this.other(q, nodeId);
    if (from === to) return null;
    const into = p.b === nodeId ? p.pts : [...p.pts].reverse();
    const out = q.a === nodeId ? q.pts : [...q.pts].reverse();
    const { id: _i, a: _a, b: _b, pts: _p, _m, ...props } = p;
    this.dropNode(nodeId);
    return this.addEdge(from, to, [...into, ...out.slice(1)], props);
  }

  // ---------- for undo (core/history.js): put back exactly as recorded ----------

  // A node or edge as it was ({ id, x, y } / an edge's record), in place
  // of whatever has that id now. Ends of a restored edge must be there.
  restoreNode({ id, x, y }) {
    const n = this.nodes.get(id);
    if (n) [n.x, n.y] = [x, y];
    else {
      this.nodes.set(id, { id, x, y });
      this.at.set(id, new Set());
    }
    this.version++;
  }

  restoreEdge(record) {
    if (this.edges.has(record.id)) this.dropEdge(record.id);
    const e = { ...record, pts: record.pts.map((p) => [...p]) };
    this.edges.set(e.id, e);
    this.at.get(e.a).add(e.id);
    this.at.get(e.b).add(e.id);
    this.version++;
  }

  // An edge or node taken away and nothing else (its ends stay).
  dropEdge(id) {
    const e = this.edges.get(id);
    if (!e) return;
    this.edges.delete(id);
    this.at.get(e.a)?.delete(id);
    this.at.get(e.b)?.delete(id);
    this.version++;
  }

  dropNode(id) {
    for (const e of this.at.get(id) ?? []) this.dropEdge(e);
    this.nodes.delete(id);
    this.at.delete(id);
    this.version++;
  }

  toJSON() {
    return {
      nextId: this.nextId,
      nodes: [...this.nodes.values()].map(({ id, x, y }) => [id, x, y]),
      edges: [...this.edges.values()].map(({ _m, ...e }) => e),
    };
  }

  static fromJSON(data) {
    const w = new Ways();
    for (const [id, x, y] of data?.nodes ?? []) {
      w.nodes.set(id, { id, x, y });
      w.at.set(id, new Set());
    }
    for (const e of data?.edges ?? []) {
      if (!w.nodes.has(e.a) || !w.nodes.has(e.b)) continue;
      w.edges.set(e.id, { ...e });
      w.at.get(e.a).add(e.id);
      w.at.get(e.b).add(e.id);
    }
    w.nextId = data?.nextId ?? 1;
    return w;
  }
}

// Which way a line leaves its start (`fromStart`) or its end: from that
// end to the point LEAVE along it (or its far end, if shorter).
const LEAVE = 0.4;
function leaving(pts, fromStart) {
  const line = fromStart ? pts : [...pts].reverse();
  const [x0, y0] = line[0];
  let q = line[line.length - 1];
  for (const p of line) if (Math.hypot(p[0] - x0, p[1] - y0) >= LEAVE) { q = p; break; }
  return [q[0] - x0, q[1] - y0];
}

// A line with one end moved by d (`atStart`: its first point), the rest
// following smoothly: points near that end move nearly as much, fading to
// none over a stretch a few times the move (at least 1), so the line bends
// into its new end instead of kinking there.
export function bendEnd(pts, atStart, [dx, dy]) {
  const reach = Math.max(1, Math.hypot(dx, dy) * 4);
  const line = atStart ? pts : [...pts].reverse();
  let s = 0;
  const out = line.map((p, i) => {
    if (i) s += Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]);
    if (s >= reach) return [...p];
    const u = s / reach, f = 1 - u * u * (3 - 2 * u);
    return [p[0] + dx * f, p[1] + dy * f];
  });
  return atStart ? out : out.reverse();
}
