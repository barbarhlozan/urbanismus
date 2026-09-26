// A network layer = a graph on its own grid. Roads use the main dot grid;
// footpaths use a grid twice as dense (scale 0.5). Tools, routing, curve
// geometry and pathfinding all work on layers, so a new network type
// (tram, rail, canal…) is mostly a new entry in World's `networks`.

import { RoadNetwork } from './network.js';

export class NetworkLayer {
  constructor({ id, grid, scale = 1, isBlocked, conflicts = () => false, maxTurn = null, coarseOf, event }) {
    this.id = id;
    this.grid = grid;
    this.scale = scale;
    this.isBlocked = isBlocked;   // (node) -> bool
    this.conflicts = conflicts;   // (a, b) -> bool: this segment may not be built (e.g. taken by another network)
    this.maxTurn = maxTurn;       // sharpest bend allowed at a dot, in radians (null = any)
    this.coarseOf = coarseOf;     // (node) -> main-grid node on the same spot, or -1
    this.event = event;
    this.graph = new RoadNetwork();
    this.version = 0; // bumped on every change, for caches
  }

  // Position of the grid dot (in main grid units).
  dot(n) {
    const [x, y] = this.grid.xy(n);
    return [x * this.scale, y * this.scale];
  }

  // Where the network is drawn and travelled at this node.
  pos(n) {
    return this.dot(n);
  }

  distance(a, b) {
    return this.grid.distance(a, b) * this.scale;
  }

  nodeAt(x, y) {
    return this.grid.nodeAt(x / this.scale, y / this.scale);
  }
}
