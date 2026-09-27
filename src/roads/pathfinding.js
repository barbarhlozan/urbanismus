// A* over a network layer's graph. Edge cost is the layer's (distance, or
// longer for slow segments such as lanes); pass `cost` to weigh it otherwise.

import { MinHeap } from '../core/heap.js';
import { turnAngle } from './routing.js';

export function findPath(layer, from, to, cost = layer.cost) {
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

// A* for trains: they can't reverse or take a sharp branch, so the search
// state is (node, the node it came from) and each step may bend by at most
// layer.maxTurn. `fromPoint` is where the train is coming from (a position,
// e.g. off the map beyond an exit), or null to set off either way.
export function findTrackPath(layer, from, fromPoint, to) {
  const { graph, grid } = layer;
  if (!graph.hasNode(from) || !graph.hasNode(to)) return null;
  if (from === to) return [from];
  const limit = (layer.maxTurn ?? Math.PI) + 1e-6;
  const pos = (n) => layer.dot(n); // the grid's angles, not the smoothed track's

  // state key: prev * size + node (prev = -1 for the start, stored as size)
  const size = grid.size;
  const key = (prev, n) => (prev < 0 ? size : prev) * size + n;
  const start = key(-1, from);
  const g = new Map([[start, 0]]);
  const came = new Map();
  const closed = new Set();
  const open = new MinHeap();
  open.push(start, layer.distance(from, to));

  while (open.size) {
    const k = open.pop();
    if (closed.has(k)) continue;
    closed.add(k);
    const n = k % size;
    const p = Math.floor(k / size);
    const prev = p === size ? -1 : p;
    if (n === to) {
      const path = [n];
      let c = k;
      while (came.has(c)) {
        c = came.get(c);
        path.push(c % size);
      }
      return path.reverse();
    }
    const behind = prev >= 0 ? pos(prev) : fromPoint;
    for (const m of graph.neighbors(n)) {
      if (m === prev) continue;
      if (behind && turnAngle(behind, pos(n), pos(m)) > limit) continue;
      const mk = key(n, m);
      const score = g.get(k) + layer.distance(n, m);
      if (score < (g.get(mk) ?? Infinity)) {
        g.set(mk, score);
        came.set(mk, k);
        open.push(mk, score + layer.distance(m, to));
      }
    }
  }
  return null;
}
