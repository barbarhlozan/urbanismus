// A network layer = a graph on its own grid. Roads use the main dot grid;
// footpaths use a grid twice as dense (scale 0.5). Tools, routing, curve
// geometry and drawing work on layers, so a new network type
// (tram, rail, canal…) is mostly a new entry in World's `networks`.
//
// `bridge` (optional): how the layer crosses water (see routing.js) –
//   { water(n), river(n), span, taken(n) }: water dots, which of them may be
//   bridged, the most water dots one bridge may span, and dots another
//   network already uses (a bridge crosses nothing on the way).

import { RoadNetwork } from './network.js';

export class NetworkLayer {
  constructor({ id, grid, scale = 1, isBlocked, conflicts = () => false, occupied = () => false, steep = () => false, maxTurn = null, coarseOf, event, bridge = null }) {
    this.id = id;
    this.grid = grid;
    this.scale = scale;
    this.isBlocked = isBlocked;   // (node) -> bool
    this.conflicts = conflicts;   // (a, b) -> bool: this segment may not be built (e.g. taken by another network)
    this.occupied = occupied;     // (a, b) -> bool: a building stands on this segment (one placed freely)
    this.steep = steep;           // (a, b, { lane }) -> bool: this segment climbs too steeply to be built (as a lane)
    this.maxTurn = maxTurn;       // sharpest bend allowed at a dot, in radians (null = any)
    this.coarseOf = coarseOf;     // (node) -> main-grid node on the same spot, or -1
    this.bridge = bridge;
    this.event = event;
    this.graph = new RoadNetwork();
    this.version = 0; // bumped on every change, for caches
  }

  // Position of the grid dot (in main grid units).
  dot(n) {
    const [x, y] = this.grid.xy(n);
    return [x * this.scale, y * this.scale];
  }

  // Where the network is drawn and travelled at this node: on the curve
  // drawn through it, if one was (World.refreshNetwork), else the dot.
  pos(n) {
    return this.curvePos?.get(n) ?? this.dot(n);
  }

  distance(a, b) {
    return this.grid.distance(a, b) * this.scale;
  }

  nodeAt(x, y) {
    return this.grid.nodeAt(x / this.scale, y / this.scale);
  }
}
