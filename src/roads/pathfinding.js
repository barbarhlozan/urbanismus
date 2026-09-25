// A* over a network layer's graph. Edge cost is plain distance for now;
// weight it by congestion / road class later by passing `cost`.

import { MinHeap } from '../core/heap.js';

export function findPath(layer, from, to, cost = (a, b) => layer.distance(a, b)) {
  const { graph } = layer;
  if (!graph.hasNode(from) || !graph.hasNode(to)) return null;
  if (from === to) return [from];

  const g = new Map([[from, 0]]);
  const came = new Map();
  const closed = new Set();
  const open = new MinHeap();
  open.push(from, layer.distance(from, to));

  while (open.size) {
    const n = open.pop();
    if (n === to) {
      const path = [n];
      let c = n;
      while (came.has(c)) path.push((c = came.get(c)));
      return path.reverse();
    }
    if (closed.has(n)) continue;
    closed.add(n);
    for (const m of graph.neighbors(n)) {
      const score = g.get(n) + cost(n, m);
      if (score < (g.get(m) ?? Infinity)) {
        g.set(m, score);
        came.set(m, n);
        open.push(m, score + layer.distance(m, to));
      }
    }
  }
  return null;
}
