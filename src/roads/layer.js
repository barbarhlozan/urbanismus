// A network layer = a graph on its own grid. Roads use the main dot grid;
// footpaths use a grid twice as dense (scale 0.5). Tools, routing, curve
// geometry and pathfinding all work on layers, so a new network type
// (tram, rail, canal…) is mostly a new entry in World's `networks`.

import { RoadNetwork } from './network.js';

export class NetworkLayer {
  constructor({ id, grid, scale = 1, isBlocked, coarseOf, event }) {
    this.id = id;
    this.grid = grid;
    this.scale = scale;
    this.isBlocked = isBlocked;   // (node) -> bool
    this.coarseOf = coarseOf;     // (node) -> main-grid node on the same spot, or -1
    this.event = event;
    this.graph = new RoadNetwork();
    this.version = 0; // bumped on every change, for caches
  }

  // World position (in main grid units).
  pos(n) {
    const [x, y] = this.grid.xy(n);
    return [x * this.scale, y * this.scale];
  }

  distance(a, b) {
    return this.grid.distance(a, b) * this.scale;
  }

  nodeAt(x, y) {
    return this.grid.nodeAt(x / this.scale, y / this.scale);
  }
}
