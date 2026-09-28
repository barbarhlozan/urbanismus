// What streets (road segments with sidewalks, world.sidewalks) are fitted
// out with, in world coordinates – the renderer draws it:
//   zebraCrossings  stripes across a street where it meets a junction (with the road ink)
//   streetLamp      one lamp per street segment, beside its middle, just
//                   outside the kerb, on alternate sides along a run (an object, depth sorted)

import { edgeCurve, measurePolyline, pointAt } from './geometry.js';

export const FURNITURE = {
  zebra: { at: 0.32, len: 0.06, stripes: 5 }, // from the junction; stripe length; stripes across the road
  lamp: { off: 0.2, clear: 0.08 },             // from the centre line; room kept from footpaths and railways
};

// Point and unit direction at arc length s.
function frame(poly, s) {
  const [x, y] = pointAt(poly, s);
  const [ax, ay] = pointAt(poly, s - 0.01), [bx, by] = pointAt(poly, s + 0.01);
  const l = Math.hypot(bx - ax, by - ay) || 1;
  return [x, y, (bx - ax) / l, (by - ay) / l];
}

// Every street's crossings: [{ node, a, b, stripes: [[p, q]…] }], `node`
// the junction (three roads or more) it is at.
export function zebraCrossings(world, curve) {
  const layer = world.networks.road;
  const { at, len, stripes: n } = FURNITURE.zebra;
  const w = curve.edge * 0.75;
  const out = [];
  for (const key of world.sidewalks) {
    const [a, b] = key.split('-').map(Number);
    for (const node of [a, b]) {
      if (layer.graph.degree(node) < 3 || world.terrain.isWater(node)) continue;
      const line = edgeCurve(layer, curve, a, b);
      const poly = measurePolyline(node === a ? line : line.slice().reverse());
      if (poly.total < 2 * at + len) continue;
      const [x, y, ux, uy] = frame(poly, at + len / 2);
      const stripes = [];
      for (let i = 0; i < n; i++) {
        const k = -w + (2 * w * i) / (n - 1);
        const [cx, cy] = [x - uy * k, y + ux * k];
        stripes.push([[cx - ux * len / 2, cy - uy * len / 2], [cx + ux * len / 2, cy + uy * len / 2]]);
      }
      out.push({ node, a, b, stripes });
    }
  }
  return out;
}

// Where the lamp of street segment a–b stands, [x, y], or null: over water,
// or no room at its middle nor a little to either side (a footpath coming
// in, a railway crossing, another road passing close). `clear(p)`: no
// footpath or railway near p; `roads`: SegmentIndex of the road centre lines.
export function streetLamp(world, curve, a, b, clear, roads) {
  if (world.terrain.isWater(a) || world.terrain.isWater(b)) return null;
  const [ax, ay] = world.grid.xy(a), [bx, by] = world.grid.xy(b);
  // always along the same way, so the sides alternate down a run
  const [p, q] = ax < bx || (ax === bx && ay < by) ? [a, b] : [b, a];
  const poly = measurePolyline(edgeCurve(world.networks.road, curve, p, q));
  const side = (ax !== bx ? Math.min(ax, bx) : Math.min(ay, by)) % 2 ? 1 : -1;
  const { off } = FURNITURE.lamp;
  for (const t of [0.5, 0.32, 0.68]) {
    const [x, y, ux, uy] = frame(poly, poly.total * t);
    const spot = [x - uy * off * side, y + ux * off * side];
    if (clear(spot) && roads.distance(spot, off - 0.03) === Infinity) return spot;
  }
  return null;
}
