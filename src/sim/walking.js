// Where people can walk: every footpath, plus pavements along every road.
// Both are merged into one weighted graph on the dense (fine) grid, so where
// a footpath meets a road dot or crosses the middle of a road segment, people
// can switch between them. Pavements cost a bit more, so footpaths are
// preferred when there's a choice.
//
// Parks and squares are walkable too: their site paths (world.sitePaths) join
// the exits on their sides through a hub, and exits facing a road connect to
// the pavement.
//
// The graph is rebuilt lazily after roads, paths or buildings change.

import { MinHeap } from '../core/heap.js';
import { STRUCTURE_TYPES } from '../../structures/index.js';

export class WalkNetwork {
  constructor(world, config) {
    this.world = world;
    this.config = config.walk;
    this.adj = null;
    const dirty = () => (this.adj = null);
    world.events.on('roads:changed', dirty);
    world.events.on('paths:changed', dirty);
    world.events.on('structure:added', dirty);
    world.events.on('structure:removed', dirty);
    world.events.on('structure:changed', dirty);
  }

  get graph() {
    if (!this.adj) this.rebuild();
    return this.adj;
  }

  rebuild() {
    const { world } = this;
    const adj = new Map();
    const link = (a, b, cost) => {
      if (!adj.has(a)) adj.set(a, new Map());
      if (!adj.has(b)) adj.set(b, new Map());
      const cur = adj.get(a).get(b);
      if (cur === undefined || cost < cur) {
        adj.get(a).set(b, cost);
        adj.get(b).set(a, cost);
      }
    };

    const paths = world.networks.path;
    for (const [a, b] of world.paths.edges()) link(a, b, paths.distance(a, b));

    // Each road segment becomes two half-segments on the fine grid.
    const k = this.config.sidewalkCost;
    for (const [a, b] of world.roads.edges()) {
      const fa = world.coarseToFine(a);
      const fb = world.coarseToFine(b);
      const [ax, ay] = world.fine.xy(fa);
      const [bx, by] = world.fine.xy(fb);
      const mid = world.fine.index((ax + bx) / 2, (ay + by) / 2);
      const half = (world.grid.distance(a, b) / 2) * k;
      link(fa, mid, half);
      link(mid, fb, half);
    }
    // Through parks and squares.
    for (const s of world.structures.values()) {
      if (!STRUCTURE_TYPES[s.type]?.site) continue;
      const { hub, hubPos, exits } = world.sitePaths(s);
      for (const e of exits) {
        link(hub, e.node, Math.hypot(e.pos[0] - hubPos[0], e.pos[1] - hubPos[1]) * 0.9);
        if (e.road >= 0) link(e.node, world.coarseToFine(e.road), 0.5 * k);
      }
    }
    this.adj = adj;
  }

  hasNode(n) {
    return this.graph.has(n);
  }

  hasEdge(a, b) {
    return this.graph.get(a)?.has(b) ?? false;
  }

  // Walkable nodes a structure's residents can step onto: Map node -> { cost, door }.
  entries(s) {
    const { world } = this;
    const g = this.graph;
    const reach = this.config.reach;
    const r = Math.ceil(reach * 2);
    const out = new Map();
    for (const door of world.nodesOf(s)) {
      const [x, y] = world.grid.xy(door);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const d = Math.hypot(dx, dy) / 2;
          if (d > reach) continue;
          const fx = 2 * x + dx;
          const fy = 2 * y + dy;
          if (!world.fine.inBounds(fx, fy)) continue;
          const f = world.fine.index(fx, fy);
          if (!g.has(f) || world.isPathBlocked(f)) continue;
          const prev = out.get(f);
          if (!prev || d < prev.cost) out.set(f, { cost: d, door });
        }
      }
    }
    return out;
  }

  // Cheapest walk between two structures within maxCost:
  // { nodes, cost, fromDoor, toDoor } or null.
  route(from, to, maxCost = Infinity) {
    const starts = this.entries(from);
    const ends = this.entries(to);
    if (!starts.size || !ends.size) return null;

    const { dist, came, order } = this.explore(starts, maxCost);
    let best = null;
    for (const n of order) {
      const end = ends.get(n);
      if (!end) continue;
      const total = dist.get(n) + end.cost;
      if (total <= maxCost && (!best || total < best.cost)) best = { node: n, cost: total };
    }
    if (!best) return null;
    const nodes = reconstruct(came, best.node);
    return { nodes, cost: best.cost, fromDoor: starts.get(nodes[0]).door, toDoor: ends.get(best.node).door };
  }

  // A walk from a structure to a random footpath spot between minCost and maxCost away.
  stroll(from, minCost, maxCost) {
    const starts = this.entries(from);
    if (!starts.size) return null;
    const { dist, came, order } = this.explore(starts, maxCost);
    const spots = order.filter((n) => dist.get(n) >= minCost && this.world.paths.hasNode(n));
    if (!spots.length) return null;
    const target = spots[Math.floor(Math.random() * spots.length)];
    const nodes = reconstruct(came, target);
    return { nodes, cost: dist.get(target), fromDoor: starts.get(nodes[0]).door, toDoor: null };
  }

  // Dijkstra from several start nodes, up to maxCost.
  explore(starts, maxCost) {
    const g = this.graph;
    const dist = new Map();
    const came = new Map();
    const done = new Set();
    const order = [];
    const heap = new MinHeap();
    for (const [n, { cost }] of starts) {
      dist.set(n, cost);
      heap.push(n, cost);
    }
    while (heap.size) {
      const n = heap.pop();
      if (done.has(n)) continue;
      const dn = dist.get(n);
      if (dn > maxCost) break;
      done.add(n);
      order.push(n);
      for (const [m, c] of g.get(n) ?? []) {
        const nd = dn + c;
        if (nd < (dist.get(m) ?? Infinity)) {
          dist.set(m, nd);
          came.set(m, n);
          heap.push(m, nd);
        }
      }
    }
    return { dist, came, order };
  }
}

function reconstruct(came, end) {
  const nodes = [end];
  let c = end;
  while (came.has(c)) nodes.push((c = came.get(c)));
  return nodes.reverse();
}
