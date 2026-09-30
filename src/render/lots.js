// Fitting ground plots to the roads as they are actually drawn (with their
// curves), rather than to the grid dots they're built on.
//
//   fitYard(world, config, frame)  surroundings between a building and its road
//                                  (or a footpath in front)
//   fitSite(world, config, site)   parks / squares on every side facing a road
//
// Both cast short rays from the plot towards the road and put the plot's edge
// ROAD_GAP short of where they hit, so plots shrink where a curve cuts in and
// stay put where the road bends away.

import { rotateQuarter } from '../core/grid.js';
import { SegmentIndex } from '../core/geom2d.js';
import { networkPolylines, streetKerbs } from '../roads/geometry.js';

const ROAD_GAP = 0.11;  // clearance from the road centre line
const STEP = 0.05;      // sampling along plot edges
const YARD_MAX = -0.92; // yards never reach past this (just short of the road dot)
const YARD_OPEN = -0.62; // depth where no road is in front

const PATH_GAP = 0.07;   // clearance from a footpath centre line

const caches = new Map(); // kind -> { layer, version, index }

// Spatial index of a network's drawn curves (rebuilt when it changes).
function networkIndex(world, config, kind) {
  const layer = world.networks[kind];
  const c = caches.get(kind);
  if (c && c.layer === layer && c.version === layer.version) return c.index;
  const lines = networkPolylines(layer, config[kind]);
  if (kind === 'road') lines.push(...streetKerbs(world, config.road, config.lane).map((k) => k.line)); // lots stop at the kerb
  const index = new SegmentIndex(lines);
  caches.set(kind, { layer, version: layer.version, index });
  return index;
}

export function roadIndex(world, config) {
  return networkIndex(world, config, 'road');
}

export function pathIndex(world, config) {
  return networkIndex(world, config, 'path');
}

export function railIndex(world, config) {
  return networkIndex(world, config, 'rail');
}

// World-space test: is a circle of radius r at (x, y) clear of footpaths and
// roads? Footpaths have priority over anything drawn in lots.
export function freeTest(world, config) {
  const roads = roadIndex(world, config);
  const paths = pathIndex(world, config);
  return (x, y, r = 0) =>
    paths.distance([x, y], PATH_GAP + r) === Infinity &&
    roads.distance([x, y], ROAD_GAP + r) === Infinity;
}

function samples(a, b) {
  const n = Math.max(2, Math.ceil(Math.abs(b - a) / STEP));
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
}

// Adds to a yard frame (see Renderer.yardFrame / structures/yards.js):
//   profile  [[x, y]…]  the road-side edge, following the road
//   frontAt(x)          edge depth at x
//   outline  polygon of the whole yard
//   y0                  shallowest point of the edge (safe for props)
//   flat                true when the edge is straight
export function fitYard(world, config, frame) {
  const roads = roadIndex(world, config);
  const paths = pathIndex(world, config);
  const { origin: [dx, dy], rotation, x0, x1, y1 } = frame;
  const toWorld = (lx, ly) => {
    const [wx, wy] = rotateQuarter(lx, ly, rotation);
    return [dx + wx, dy + wy];
  };
  const dir = rotateQuarter(0, -1, rotation);
  const reach = y1 - YARD_MAX + ROAD_GAP;

  // depth: short of the road, or YARD_OPEN where there's none – and never
  // over a footpath crossing in front
  const depth = (from) => {
    const r = roads.cast(from, dir, reach);
    const p = paths.cast(from, dir, reach);
    const t = r === null ? y1 - YARD_OPEN : r - ROAD_GAP;
    return p === null ? t : Math.min(t, p - PATH_GAP);
  };
  const profile = samples(x0, x1).map((x) => {
    const y = y1 - depth(toWorld(x, y1));
    return [x, Math.min(Math.max(y, YARD_MAX), y1 - 0.1)];
  });

  const frontAt = (x) => {
    if (x <= profile[0][0]) return profile[0][1];
    for (let i = 1; i < profile.length; i++) {
      const [xb, yb] = profile[i];
      if (x <= xb) {
        const [xa, ya] = profile[i - 1];
        return ya + ((yb - ya) * (x - xa)) / (xb - xa || 1);
      }
    }
    return profile[profile.length - 1][1];
  };

  const ys = profile.map((p) => p[1]);
  return {
    ...frame,
    profile,
    frontAt,
    outline: [[x0, y1], [x1, y1], ...profile.slice().reverse()],
    y0: Math.max(...ys),
    flat: Math.max(...ys) - Math.min(...ys) < 0.03,
  };
}

// site = { rect: [x0, y0, x1, y1], inner: [x0, y0, x1, y1], road: [left, top, right, bottom] }
// in world coordinates. Returns the outline polygon (world) with road sides
// following the road.
export function fitSite(world, config, site) {
  const index = roadIndex(world, config);
  const [X0, Y0, X1, Y1] = site.rect;
  const [I0, J0, I1, J1] = site.inner; // footprint dots' extent
  const [left, top, right, bottom] = site.road;

  // Depth of one side at position s along it: cast outward from just outside
  // the footprint; stop short of the road, never beyond the rectangle.
  const edge = (fromX, fromY, d, limit) => {
    const start = [fromX, fromY];
    const t = index.cast(start, d, limit + ROAD_GAP);
    return t === null ? limit : Math.max(Math.min(t - ROAD_GAP, limit), 0.05);
  };

  const pts = [];
  // top (-y), left to right
  if (top) for (const x of samples(X0, X1)) pts.push([x, J0 - 0.3 - edge(x, J0 - 0.3, [0, -1], J0 - 0.3 - Y0)]);
  else pts.push([X0, Y0], [X1, Y0]);
  // right (+x), top to bottom
  if (right) for (const y of samples(Y0, Y1)) pts.push([I1 + 0.3 + edge(I1 + 0.3, y, [1, 0], X1 - I1 - 0.3), y]);
  else pts.push([X1, Y0], [X1, Y1]);
  // bottom (+y), right to left
  if (bottom) for (const x of samples(X1, X0)) pts.push([x, J1 + 0.3 + edge(x, J1 + 0.3, [0, 1], Y1 - J1 - 0.3)]);
  else pts.push([X1, Y1], [X0, Y1]);
  // left (-x), bottom to top
  if (left) for (const y of samples(Y1, Y0)) pts.push([I0 - 0.3 - edge(I0 - 0.3, y, [-1, 0], I0 - 0.3 - X0), y]);
  else pts.push([X0, Y1], [X0, Y0]);

  return pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
}
