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
