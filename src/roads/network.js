// Road graph: nodes are grid node indices, edges connect 8-adjacent nodes.
// Edge attributes (road class, lanes, speed…) can later live in a parallel
// Map keyed by edgeKey(a, b).

const EMPTY = new Set();

export function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export class RoadNetwork {
  constructor() {
    this.adj = new Map(); // node -> Set<node>
  }

  hasNode(n) {
    return (this.adj.get(n)?.size ?? 0) > 0;
  }

  hasEdge(a, b) {
    return this.adj.get(a)?.has(b) ?? false;
  }

  neighbors(n) {
    return this.adj.get(n) ?? EMPTY;
  }

  degree(n) {
    return this.adj.get(n)?.size ?? 0;
  }

  nodes() {
    return this.adj.keys();
  }

  *edges() {
    for (const [a, set] of this.adj) {
      for (const b of set) if (a < b) yield [a, b];
    }
  }

  get edgeCount() {
    let n = 0;
    for (const set of this.adj.values()) n += set.size;
    return n / 2;
  }

  addEdge(a, b) {
    if (a === b) return;
    this._link(a, b);
    this._link(b, a);
  }

  removeEdge(a, b) {
    this._unlink(a, b);
    this._unlink(b, a);
  }

  removeNode(n) {
    for (const m of [...this.neighbors(n)]) this.removeEdge(n, m);
    this.adj.delete(n);
  }

  _link(a, b) {
    if (!this.adj.has(a)) this.adj.set(a, new Set());
    this.adj.get(a).add(b);
  }

  _unlink(a, b) {
    const set = this.adj.get(a);
    if (!set) return;
    set.delete(b);
    if (set.size === 0) this.adj.delete(a);
  }

  toJSON() {
    return [...this.edges()];
  }

  static fromJSON(edges) {
    const net = new RoadNetwork();
    for (const [a, b] of edges) net.addEdge(a, b);
    return net;
  }
}
