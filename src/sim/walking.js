// Where people can walk: every footpath, the sidewalks of streets (road
// edges with `street`) and single-track lanes (`lane`, shared with the
// cars) – all on the ways themselves (sim/wayGraph.js), so where a
// footpath meets a road people can switch between them. Sidewalks cost a
// bit more, so footpaths are preferred when there's a choice.
//
// Cyclists get their own network ({ allRoads: true }): footpaths plus every
// road, sidewalks or not, at no extra cost.
//
// Parks and squares are walkable too: their site paths (world.sitePaths) join
// the exits on their sides through a hub (with a single exit there's only
// the way in: it ends at a loop, see roads/siteWalks.js), each exit cut
// into the footpath or street it meets; neighbouring sites share the exit
// between them.
//
// The graph is rebuilt lazily after the ways or buildings change. Routes
// are the way graph's: { pts, joints, ways, cost, fromDoor, toDoor } – the
// doors as points.

import { STRUCTURE_TYPES } from '../../structures/index.js';
import { WayGraph } from './wayGraph.js';
import { pointAt, subPolyline } from '../roads/geometry.js';

const MEND = 0.45; // a footpath ending this near a street steps onto it

export class WalkNetwork {
  constructor(world, config, { allRoads = false } = {}) {
    this.world = world;
    this.config = config.walk;
    this.laneCost = config.lane.walkCost;
    this.allRoads = allRoads;
    this.g = null;
    const dirty = () => (this.g = null);
    world.events.on('roads:changed', dirty);
    world.events.on('paths:changed', dirty);
    world.events.on('rails:changed', dirty);
    world.events.on('structure:added', dirty);
    world.events.on('structure:removed', dirty);
    world.events.on('structure:changed', dirty);
  }

  get graph() {
    if (!this.g || this.version !== this.world.ways.version) this.rebuild();
    return this.g;
  }

  rebuild() {
    const { world, allRoads } = this;
    const pass = (e) => e.kind === 'path' || (e.kind === 'road' && (allRoads || e.lane || e.street));
    const factor = (e) => (e.kind === 'path' || allRoads ? 1 : e.lane ? this.laneCost : this.config.sidewalkCost);
    // parks' and squares' exits: cut into the way each meets
    const sites = [], cuts = [];
    for (const s of world.structures.values()) {
      if (!STRUCTURE_TYPES[s.type]?.site) continue;
      const paths = world.sitePaths(s);
      sites.push({ s, paths });
      paths.exits.forEach((e, k) => {
        if (e.site < 0) cuts.push({ key: `${s.id}:${k}`, x: e.pos[0], y: e.pos[1], reach: e.road >= 0 ? 1.1 : 0.8 });
      });
    }
    const g = new WayGraph(world.ways, { pass, factor, cuts, mend: MEND });
    for (const { s, paths: { hubPos, exits } } of sites) {
      const hub = `h${s.id}`;
      exits.forEach((e, k) => {
        // to a neighbouring site: a spot on the side they share
        const at = e.site >= 0 ? `x${[s.id, e.site].sort().join('-')}` : g.tapOf(`${s.id}:${k}`);
        if (at == null) return;
        const tap = g.nodes.get(at) ?? e.pos;
        if (exits.length > 1) {
          g.link(hub, at, Math.hypot(e.pos[0] - hubPos[0], e.pos[1] - hubPos[1]) * 0.9, [hubPos, e.pos, tap]);
        } else if (e.site < 0) {
          g.link(`i${s.id}`, at, Math.hypot(tap[0] - e.pos[0], tap[1] - e.pos[1]) || 0.01, [e.pos, tap]); // the way in
        }
      });
    }
    this.g = g;
    this.version = world.ways.version;
  }

  hasNode(n) {
    return this.graph.hasNode(n);
  }

  // Where a structure's people step onto the walkable ways: [{ place,
  // cost, door }] – from each of its dots, the nearest point of each way
  // within reach.
  entries(s) {
    const { world } = this;
    const g = this.graph;
    const reach = this.config.reach;
    const out = [];
    const doors = s.free ? [[s.x, s.y]] : world.nodesOf(s).map((n) => world.grid.xy(n));
    const info = world.accessInfo(s);
    if (info?.doorPt && !doors.some((d) => d[0] === info.doorPt[0] && d[1] === info.doorPt[1])) doors.push(info.doorPt);
    for (const door of doors) {
      for (const at of g.attachAll(door[0], door[1], reach)) out.push({ place: at, cost: at.dist, door });
    }
    return out;
  }

  plan(r) {
    return r && { pts: r.pts, joints: r.joints, ways: r.ways, cost: r.cost, fromDoor: r.from?.door ?? null, toDoor: r.to?.door ?? null };
  }

  // Cheapest walk between two structures within maxCost, or null.
  route(from, to, maxCost = Infinity) {
    const starts = this.entries(from), ends = this.entries(to);
    if (!starts.length || !ends.length) return null;
    return this.plan(this.graph.routeMany(starts, ends, { maxCost }));
  }

  // Dijkstra from a structure's entries: the way graph's explore().
  explore(from, maxCost, weight = null) {
    const g = this.graph;
    const starts = [];
    for (const e of this.entries(from)) for (const st of g.startsOf(e.place, e.cost)) starts.push({ ...st, entry: e });
    return starts.length ? g.explore(starts, { maxCost, weight }) : null;
  }

  // Is graph node n on a footpath?
  onPath(n) {
    return (this.graph.adj.get(n) ?? []).some((p) => p.kind === 'path');
  }

  // Spots a walk may end at, from explore(): the nodes it reached and
  // points every `step` along the pieces from them, between minCost and
  // maxCost: [{ node, cost, point, piece?, s? }].
  spots(found, minCost, maxCost, step = 1) {
    const g = this.graph;
    const out = [];
    for (const n of found.order) {
      const d = found.dist.get(n);
      if (d >= minCost) out.push({ node: n, cost: d, point: g.nodes.get(n) });
      for (const piece of g.adj.get(n) ?? []) {
        if (!piece.way) continue; // (not through a park's own links)
        const fromA = piece.a === n;
        for (let k = step; k < piece.len - step / 2; k += step) {
          const c = d + k * piece.factor;
          if (c < minCost) continue;
          if (c > maxCost) break;
          const s = fromA ? k : piece.len - k;
          out.push({ node: n, cost: c, piece, s, point: pointOn(piece, s) });
        }
      }
    }
    return out;
  }

  // The route explore() found to a spot (spots()).
  traceTo(found, spot) {
    const g = this.graph;
    if (!spot.piece) return g.trace(found, spot.node);
    const { piece, s, node } = spot;
    const poly = { points: piece.pts, cum: piece.cum, total: piece.len };
    const pts = piece.a === node ? subPolyline(poly, 0, s) : subPolyline(poly, s, piece.len).reverse();
    return g.trace(found, node, { pts, cost: spot.cost - found.dist.get(node), way: piece.way });
  }

  // A loop walk from a structure: out to a random spot between minCost and
  // maxCost away (on a footpath if there is one in reach, else anywhere
  // walkable) and home another way where there is one – the way out counts
  // `detour` times its length on the way back.
  // { pts, joints, ways, cost, fromDoor, toDoor: null, backPts, backJoints,
  // backWays, backDoor } or null.
  stroll(from, minCost, maxCost, detour = 4) {
    const g = this.graph;
    const found = this.explore(from, maxCost);
    if (!found) return null;
    const far = this.spots(found, minCost, maxCost);
    const onPath = far.filter((p) => (p.piece ? p.piece.kind === 'path' : this.onPath(p.node)));
    const spots = onPath.length ? onPath : far;
    if (!spots.length) return null;
    const target = spots[Math.floor(Math.random() * spots.length)];
    const out = this.traceTo(found, target);

    const used = new Set();
    if (target.piece) used.add(target.piece);
    for (let n = target.node; found.came.has(n);) {
      const piece = found.came.get(n);
      used.add(piece);
      n = g.other(piece, n);
    }
    const there = target.piece ? { piece: target.piece, s: target.s, point: target.point } : target.node;
    const back = g.routeMany([{ place: there, cost: 0 }], this.entries(from), { maxCost: maxCost * detour * 2, weight: (p) => (used.has(p) ? detour : 1) });
    const home = back ?? { pts: out.pts.slice().reverse(), joints: out.joints.map((i) => out.pts.length - 1 - i).reverse(), ways: out.ways.slice().reverse(), to: out.from };
    return {
      pts: out.pts, joints: out.joints, ways: out.ways, cost: target.cost,
      fromDoor: out.from?.door ?? null, toDoor: null,
      backPts: home.pts, backJoints: home.joints, backWays: home.ways, backDoor: home.to?.door ?? null,
    };
  }

  // A walk from a structure out to a spot where `test([x, y])` holds – one
  // of the `nearest` such spots, at least minCost and at most maxCost away
  // (to the edge of the nearest wood, not across the map to a far one).
  // { pts, joints, ways, cost, fromDoor, toDoor: null } or null.
  toward(from, test, minCost, maxCost, nearest = 5) {
    const found = this.explore(from, maxCost);
    if (!found) return null;
    const spots = this.spots(found, minCost, maxCost, 0.5).filter((p) => test(p.point)).sort((p, q) => p.cost - q.cost).slice(0, nearest);
    if (!spots.length) return null;
    const target = spots[Math.floor(Math.random() * spots.length)];
    return { ...this.plan(this.traceTo(found, target)), cost: target.cost, toDoor: null };
  }
}

function pointOn(piece, s) {
  return pointAt({ points: piece.pts, cum: piece.cum, total: piece.len }, s);
}
