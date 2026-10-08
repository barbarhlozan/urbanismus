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
const YARD_LOOK = 0.35;  // rays look this much past YARD_MAX for the road

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

// A polyline with the points that lie within `tol` of the line through
// their neighbours left out (Douglas–Peucker): a straight stretch of a
// sampled edge becomes one stroke, a curve keeps enough points to follow.
// (The hand-drawn pen nudges every point; fewer of them, a calmer line.)
const SIMPLIFY = 0.006;
export function simplify(pts, tol = SIMPLIFY) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i], [bx, by] = pts[j];
    const l = Math.hypot(bx - ax, by - ay);
    let far = -1, best = tol;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = pts[k];
      const d = l < 1e-9 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / l;
      if (d > best) [far, best] = [k, d];
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([i, far], [far, j]);
  }
  return pts.filter((_, k) => keep[k]);
}

function samples(a, b) {
  const n = Math.max(2, Math.ceil(Math.abs(b - a) / STEP));
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
}

// Adds to a yard frame (see Renderer.yardFrame / structures/yards.js; its
// optional `tilt` turns it on top of its rotation, like the building):
//   profile  [[x, y]…]  the road-side edge, following the road
//   frontAt(x)          edge depth at x
//   outline  polygon of the whole yard
//   y0                  shallowest point of the edge (safe for props)
//   flat                true when the edge is straight
export function fitYard(world, config, frame) {
  const roads = roadIndex(world, config);
  const paths = pathIndex(world, config);
  const { origin: [dx, dy], rotation, tilt = 0, x0, x1, y1 } = frame;
  // local -> world: the frame's tilt (a yard turned with its building to
  // a diagonal road), then its quarter turn – as in Painter._turn
  const [c, s] = [Math.cos(tilt), Math.sin(tilt)];
  const turn = (lx, ly) => rotateQuarter(lx * c - ly * s, lx * s + ly * c, rotation);
  const toWorld = (lx, ly) => {
    const [wx, wy] = turn(lx, ly);
    return [dx + wx, dy + wy];
  };
  const dir = turn(0, -1);
  // (looking a little past the deepest a yard goes, so a road bending away
  // is still found and the yard reaches as far as it may towards it)
  const reach = y1 - YARD_MAX + ROAD_GAP + YARD_LOOK;

  // depth: short of the road – and never over a footpath crossing in front.
  // Where a ray misses the road (it bends away past their reach, or ends)
  // but others hit it, the edge carries on from theirs: filled in between
  // hits, held level past the last one. Otherwise rays on a curve right at
  // the edge of their reach would flip between the road and YARD_OPEN, a
  // saw-tooth edge. With no road in front at all: YARD_OPEN.
  const xs = samples(x0, x1);
  const hits = xs.map((x) => {
    const r = roads.cast(toWorld(x, y1), dir, reach);
    return r === null ? null : r - ROAD_GAP;
  });
  const known = hits.map((h, i) => (h === null ? -1 : i)).filter((i) => i >= 0);
  const road = hits.map((h, i) => {
    if (h !== null) return h;
    if (!known.length) return y1 - YARD_OPEN;
    const next = known.find((k) => k > i), prev = known.findLast((k) => k < i);
    if (prev === undefined) return hits[next];
    if (next === undefined) return hits[prev];
    return hits[prev] + ((hits[next] - hits[prev]) * (i - prev)) / (next - prev);
  });
  const profile = simplify(xs.map((x, i) => {
    const p = paths.cast(toWorld(x, y1), dir, reach);
    const y = y1 - (p === null ? road[i] : Math.min(road[i], p - PATH_GAP));
    return [x, Math.min(Math.max(y, YARD_MAX), y1 - 0.1)];
  }));

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
// in world coordinates. Returns the outline polygon (world): the rectangle,
// cut back ROAD_GAP short of any road that crosses it. Each point of the
// rectangle's edge is looked at from the middle of the footprint and pulled
// in to the first road in the way – so it follows a road on any side, a
// diagonal one or a curve too, and never reaches past one – but never into
// the footprint (its dots and SITE_KEEP round them).
const SITE_KEEP = 0.3;
export function fitSite(world, config, site) {
  const index = roadIndex(world, config);
  const [X0, Y0, X1, Y1] = site.rect;
  const [I0, J0, I1, J1] = site.inner; // footprint dots' extent
  const cx = (I0 + I1) / 2, cy = (J0 + J1) / 2;
  const [K0, L0, K1, L1] = [I0 - SITE_KEEP, J0 - SITE_KEEP, I1 + SITE_KEEP, J1 + SITE_KEEP];

  // how far a ray from the middle runs inside the box [a0, b0, a1, b1]
  const exit = (dx, dy, [a0, b0, a1, b1]) => {
    const tx = dx > 0 ? (a1 - cx) / dx : dx < 0 ? (a0 - cx) / dx : Infinity;
    const ty = dy > 0 ? (b1 - cy) / dy : dy < 0 ? (b0 - cy) / dy : Infinity;
    return Math.min(tx, ty);
  };
  const fit = ([x, y]) => {
    const len = Math.hypot(x - cx, y - cy);
    if (len < 1e-6) return [x, y];
    const dx = (x - cx) / len, dy = (y - cy) / len;
    const keep = exit(dx, dy, [K0, L0, K1, L1]);
    const hit = index.cast([cx, cy], [dx, dy], len + ROAD_GAP);
    let t = hit === null ? len : Math.min(len, hit - ROAD_GAP);
    // (a road met at a slant: back off until it's ROAD_GAP clear)
    while (t > keep && index.distance([cx + dx * t, cy + dy * t], ROAD_GAP) !== Infinity) t -= 0.02;
    t = Math.max(t, Math.min(keep, len));
    return [cx + dx * t, cy + dy * t];
  };

  // round the rectangle: top, right, bottom, left – each side thinned on
  // its own, so the corners stay put (each side's last point is the next
  // one's first)
  const sides = [
    samples(X0, X1).map((x) => [x, Y0]),
    samples(Y0, Y1).map((y) => [X1, y]),
    samples(X1, X0).map((x) => [x, Y1]),
    samples(Y1, Y0).map((y) => [X0, y]),
  ];
  return sides.flatMap((side) => simplify(side.map(fit)).slice(0, -1));
}

// The ground a plot claims, in half-dot squares ("quarters": [i/2, i/2 + .5]
// × [j/2, j/2 + .5], world coordinates). Its own dots are its own; a plot
// that spreads (gardens, SPREAD in structures/plots.js) also takes the empty
// dots round it – no building, forest, water or railway on them – up to
// `reach` dots out, so a house with nobody around, or in a road's bend
// where nothing else could stand, has its garden right up to the road.
// Every quarter goes to the nearest structure that may have it, so two
// gardens split an empty dot between them; the dots a front yard looks
// over go only to that structure (they're its yard's, not a neighbour's).
// Quarters across a road or railway from the plot are cut off by `seen`.
//
//   others   [{ id, dots: [[x, y]…], spreads, front: Set(node) }]  structures round about
//   me       the same for this one
// Returns { owner(i, j) -> id | null, seen(x, y) -> bool }.
export function plotClaim(world, config, me, others, reach) {
  const all = [me, ...others];
  const byNode = new Map();
  for (const o of all) for (const [x, y] of o.dots) byNode.set(world.grid.nodeAt(x, y), o.id);
  const cache = new Map();
  const owner = (i, j) => {
    const key = `${i},${j}`;
    if (cache.has(key)) return cache.get(key);
    const cx = i / 2 + 0.25, cy = j / 2 + 0.25;
    const n = world.grid.nodeAt(cx, cy);
    let id = null;
    if (n >= 0) {
      if (byNode.has(n)) id = byNode.get(n);
      else if (!world.structureAt(n) && !world.featureAt(n) && !world.terrain.isWater(n) && !world.railNear(n)) {
        // (nearest by dots – a square's worth – then straight-line, so
        // two gardens split an empty dot along a straight line)
        const fronts = all.some((o) => o.front.has(n));
        let best = [Infinity, Infinity];
        for (const o of all) {
          const d = [Infinity, Infinity];
          for (const [x, y] of o.dots) {
            const dx = Math.abs(cx - x), dy = Math.abs(cy - y);
            const c = Math.max(dx, dy), e = Math.hypot(dx, dy);
            if (c < d[0] || (c === d[0] && e < d[1])) [d[0], d[1]] = [c, e];
          }
          if (fronts ? !o.front.has(n) : !(o.spreads && d[0] <= reach + 0.25)) continue;
          if (d[0] < best[0] || (d[0] === best[0] && (d[1] < best[1] - 1e-9 || (Math.abs(d[1] - best[1]) < 1e-9 && o.id < id)))) [best, id] = [d, o.id];
        }
      }
    }
    cache.set(key, id);
    return id;
  };
  const roads = roadIndex(world, config);
  const rails = railIndex(world, config);
  // in sight of the nearest own dot – no road or railway in between
  const seen = (x, y) => {
    let o = me.dots[0], od = Infinity;
    for (const p of me.dots) {
      const d = Math.hypot(x - p[0], y - p[1]);
      if (d < od) [o, od] = [p, d];
    }
    if (od < 1e-6) return true;
    const dir = [(x - o[0]) / od, (y - o[1]) / od];
    const block = (index, gap) => {
      const t = index.cast(o, dir, od + gap);
      return t !== null && t <= od + gap;
    };
    return !block(roads, ROAD_GAP) && !block(rails, ROAD_GAP);
  };
  return { owner, seen };
}
