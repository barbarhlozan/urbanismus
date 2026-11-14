// The ways as the agents get about on them (AgentSystem methods; see
// agents.js, and sim/wayGraph.js): the drive graph, where it leaves the
// map, its junctions, where a building meets it, and routes as plans.

import { WayGraph } from '../wayGraph.js';

const EDGE = 0.75; // a road ending this near the map's edge goes on off it

export class AgentWays {
  // Roads and lanes (a lane weighed by the time it takes, lane.speed),
  // rebuilt when the ways change.
  driveGraph() {
    const { world } = this;
    const key = `${world.ways.version}|${world.networks.road.version}`;
    if (this._drive?.key !== key) {
      const slow = 1 / this.config.lane.speed;
      const g = new WayGraph(world.ways, { pass: (e) => e.kind === 'road', factor: (e) => (e.lane ? slow : 1), mend: 0.45 });
      this._drive = { key, g, exits: null, junctions: null };
    }
    return this._drive.g;
  }

  // Road ends at the map's edge: [{ node, pos, dir }], dir pointing off it.
  driveExits() {
    const g = this.driveGraph();
    if (!this._drive.exits) {
      const { width, height } = this.world.grid;
      const list = [];
      for (const [n, pieces] of g.adj) {
        if (pieces.length !== 1) continue;
        const [x, y] = g.nodes.get(n);
        const off = [[x, [-1, 0]], [width - 1 - x, [1, 0]], [y, [0, -1]], [height - 1 - y, [0, 1]]].sort((p, q) => p[0] - q[0])[0];
        if (off[0] <= EDGE) list.push({ node: n, pos: [x, y], dir: off[1] });
      }
      this._drive.exits = list;
    }
    return this._drive.exits;
  }

  // Junctions of three roads or more, by unit cell: Map cell -> [{ node, x, y }].
  driveJunctions() {
    const g = this.driveGraph();
    if (!this._drive.junctions) {
      const cells = new Map();
      for (const [n, pieces] of g.adj) {
        if (pieces.length < 3) continue;
        const [x, y] = g.nodes.get(n);
        const k = Math.floor(x) * 65536 + Math.floor(y);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push({ node: n, x, y });
      }
      this._drive.junctions = cells;
    }
    return this._drive.junctions;
  }

  // The junction within r of (x, y), or null.
  junctionAt(x, y, r) {
    const cells = this.driveJunctions();
    for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++) {
      for (let j = Math.floor(y - r); j <= Math.floor(y + r); j++) {
        for (const c of cells.get(i * 65536 + j) ?? []) if ((c.x - x) ** 2 + (c.y - y) ** 2 < r * r) return c;
      }
    }
    return null;
  }

  // Where structure s meets the drive graph: { place (attached), door
  // (its door's point) } or null.
  drivePlace(s) {
    const info = this.world.accessInfo(s);
    if (!info?.point) return null;
    const place = this.driveGraph().attach(info.point[0], info.point[1], 0.6);
    return place && { place, door: info.doorPt };
  }

  // A drive from one place (or graph node) to another: a plan's route
  // fields { pts, joints, ways } or null.
  driveWay(from, to) {
    const r = this.driveGraph().route(from, to);
    return r && { pts: r.pts, joints: r.joints, ways: r.ways };
  }

  // Are the ways a trip was planned on still there: each of its way edges,
  // or (one split by a new junction, say) the ways still run under its
  // route `pts` on graph g?
  waysIntact(g, ids, pts) {
    const edges = this.world.ways.edges;
    if (ids.every((id) => edges.has(id))) return true;
    if (!pts?.length) return false;
    let last = null;
    for (const p of pts) {
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.4) continue;
      last = p;
      if (!g.attach(p[0], p[1], 0.05)) return false;
    }
    return true;
  }
}
