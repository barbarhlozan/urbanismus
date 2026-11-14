// The ways (ways.js) seen as dots, for what still reads the dot graph
// while the game moves off it (docs/free-placement-plan.md, "The switch",
// step 1): each kind's edges traced onto that kind's dots into a
// RoadNetwork, with where each dot sits on its curve. Derived, never saved
// or edited – the ways are the truth.
//
//   traceWays(ways, kind, grid, scale) -> {
//     graph,      RoadNetwork of the dots the edges pass
//     pos,        Map dot -> [x, y] on the curve nearest it (world units)
//     edgeOf,     Map edgeKey -> way edge id the dot step came from
//     sidewalks,  Set of edgeKey: steps of edges with `street`
//     lanes,      Set of edgeKey: steps of edges with `lane`
//     laneWalks,  Map edgeKey -> sides (as World.laneWalks: bit 1 left of
//                 the way from the lower dot to the higher, bit 2 right),
//                 from an edge's `walks` (the same bits, from a to b)
//   }
//
// `kind` may be a list (roads and lanes share the road dots).

import { RoadNetwork, edgeKey } from './network.js';
import { measurePolyline, pointAt } from './geometry.js';

// The dots one line passes, in order, each 8-adjacent to the next, with
// the point of the line nearest each. A corner the line only clips
// (a, b, c where a and c are neighbours already) is left out, so a
// slant runs as diagonals, not a staircase.
export function traceLine(pts, grid, scale = 1) {
  const poly = measurePolyline(pts);
  const step = scale * 0.2;
  const out = []; // { n, p, d }
  const steps = Math.max(1, Math.ceil(poly.total / step));
  for (let k = 0; k <= steps; k++) {
    const p = pointAt(poly, (poly.total * k) / steps);
    const n = grid.nodeAt(p[0] / scale, p[1] / scale);
    if (n < 0) continue;
    const [gx, gy] = grid.xy(n);
    const d = Math.hypot(gx * scale - p[0], gy * scale - p[1]);
    const last = out[out.length - 1];
    if (last?.n === n) {
      if (d < last.d) [last.p, last.d] = [p, d];
      continue;
    }
    out.push({ n, p, d });
  }
  const near = (a, b) => {
    const [ax, ay] = grid.xy(a), [bx, by] = grid.xy(b);
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= 1;
  };
  for (let i = 1; i < out.length - 1; i++) {
    if (near(out[i - 1].n, out[i + 1].n)) out.splice(i--, 1);
  }
  return out;
}

export function traceWays(ways, kind, grid, scale = 1) {
  const kinds = new Set([kind].flat());
  const graph = new RoadNetwork();
  const pos = new Map(), best = new Map();
  const edgeOf = new Map(), sidewalks = new Set(), lanes = new Set(), laneWalks = new Map();
  for (const e of ways.edges.values()) {
    if (!kinds.has(e.kind)) continue;
    const dots = traceLine(e.pts, grid, scale);
    for (const { n, p, d } of dots) {
      if (d < (best.get(n) ?? Infinity)) {
        best.set(n, d);
        pos.set(n, p);
      }
    }
    for (let i = 1; i < dots.length; i++) {
      const a = dots[i - 1].n, b = dots[i].n;
      graph.addEdge(a, b);
      const key = edgeKey(a, b);
      edgeOf.set(key, e.id);
      if (e.lane) {
        lanes.add(key);
        if (e.walks) {
          // the edge runs a -> b here; the key's way is lower -> higher
          const sides = a < b ? e.walks : ((e.walks & 1) << 1) | ((e.walks & 2) >> 1);
          laneWalks.set(key, sides);
        }
      } else if (e.street) sidewalks.add(key);
    }
  }
  return { graph, pos, edgeOf, sidewalks, lanes, laneWalks };
}
