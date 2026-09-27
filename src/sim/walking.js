// Where people can walk: every footpath, the sidewalks of streets (road
// segments with sidewalks, world.sidewalks) and single-track lanes
// (world.lanes, shared with the cars). All are merged into one
// weighted graph on the dense (fine) grid, so where a footpath meets a road
// dot or crosses the middle of a road segment, people can switch between
// them. Sidewalks cost a bit more, so footpaths are preferred when there's
// a choice.
//
// Cyclists get their own network ({ allRoads: true }): footpaths plus every
// road, sidewalks or not, at no extra cost.
//
// Parks and squares are walkable too: their site paths (world.sitePaths) join
// the exits on their sides through a hub, and exits facing a road connect to
// the street's sidewalk (if it has one).
//
// The graph is rebuilt lazily after roads, paths or buildings change.

import { MinHeap } from '../core/heap.js';
import { STRUCTURE_TYPES } from '../../structures/index.js';

export class WalkNetwork {
  constructor(world, config, { allRoads = false } = {}) {
    this.world = world;
    this.config = config.walk;
    this.laneCost = config.lane.walkCost;
    this.allRoads = allRoads;
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

    // Each street segment becomes two half-segments on the fine grid.
    const street = [];
    for (const [a, b] of world.roads.edges()) {
      const lane = world.isLane(a, b);
      if (!this.allRoads && !lane && !world.hasSidewalk(a, b)) continue;
      const k = this.allRoads ? 1 : lane ? this.laneCost : this.config.sidewalkCost;
      const fa = world.coarseToFine(a);
      const fb = world.coarseToFine(b);
      const [ax, ay] = world.fine.xy(fa);
      const [bx, by] = world.fine.xy(fb);
      const mid = world.fine.index((ax + bx) / 2, (ay + by) / 2);
      const half = (world.grid.distance(a, b) / 2) * k;
      link(fa, mid, half);
      link(mid, fb, half);
      street.push(fa, mid, fb);
    }
    // Footpaths ending right beside a street (at its kerb) step onto it.
    const fine = world.fine;
    for (const n of street) {
      for (const m of fine.neighbors(n)) {
        if (world.paths.hasNode(m)) link(n, m, paths.distance(n, m));
      }
    }
    // Through parks and squares.
    for (const s of world.structures.values()) {
      if (!STRUCTURE_TYPES[s.type]?.site) continue;
      const { hub, hubPos, exits } = world.sitePaths(s);
      for (const e of exits) {
        link(hub, e.node, Math.hypot(e.pos[0] - hubPos[0], e.pos[1] - hubPos[1]) * 0.9);
        if (e.road < 0) continue;
        const walkable = this.allRoads || world.sidewalksAt(e.road).length || [...world.roads.neighbors(e.road)].some((m) => world.isLane(e.road, m));
        if (walkable) link(e.node, world.coarseToFine(e.road), 0.5 * (this.allRoads ? 1 : this.config.sidewalkCost));
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

  // A loop walk from a structure: out to a random spot between minCost and
  // maxCost away (on a footpath if there is one in reach, else anywhere
  // walkable) and home another way where there is one – the way out counts
  // `detour` times its length on the way back.
  // { nodes, cost, fromDoor, toDoor: null, backNodes, backDoor } or null.
  stroll(from, minCost, maxCost, detour = 4) {
    const starts = this.entries(from);
    if (!starts.size) return null;
    const { dist, came, order } = this.explore(starts, maxCost);
    const far = order.filter((n) => dist.get(n) >= minCost);
    const onPath = far.filter((n) => this.world.paths.hasNode(n));
    const spots = onPath.length ? onPath : far;
    if (!spots.length) return null;
    const target = spots[Math.floor(Math.random() * spots.length)];
    const nodes = reconstruct(came, target);

    const used = new Set();
    for (let i = 1; i < nodes.length; i++) used.add(`${nodes[i - 1]}|${nodes[i]}`).add(`${nodes[i]}|${nodes[i - 1]}`);
    const back = this.explore(new Map([[target, { cost: 0 }]]), maxCost * detour * 2, (a, b) => (used.has(`${a}|${b}`) ? detour : 1));
    let best = null;
    for (const [n, { cost }] of starts) {
      const d = back.dist.get(n);
      if (d !== undefined && (!best || d + cost < best.cost)) best = { node: n, cost: d + cost };
    }
    const backNodes = best ? reconstruct(back.came, best.node) : nodes.slice().reverse();
    const backDoor = starts.get(backNodes[backNodes.length - 1]).door;
    return { nodes, cost: dist.get(target), fromDoor: starts.get(nodes[0]).door, toDoor: null, backNodes, backDoor };
  }

  // Dijkstra from several start nodes, up to maxCost. `weight(a, b)`
  // optionally scales the cost of stepping from a to b.
  explore(starts, maxCost, weight = null) {
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
        const nd = dn + (weight ? c * weight(n, m) : c);
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
