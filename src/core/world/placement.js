// What may be built where (World methods; see world.js): slopes and rock,
// dots taken by roads, railways and paths, and whether a structure fits.

import { CONFIG } from '../../config.js';
import { makeElevation } from '../../terrain/elevation.js';
import { makeRocks } from '../../terrain/rocks.js';
import { riverField } from '../../terrain/rivers.js';
import { STRUCTURE_TYPES, footprintOffsets } from '../../../structures/index.js';
import { FEATURE_TYPES } from '../../../features/index.js';
import { rectOutline, distanceToPolygon, boxOf } from '../spatial.js';
import { segmentDistance } from '../geom2d.js';
import { mulberry32 } from '../random.js';

// fitsOutline(): how far a building keeps from a way's centre line, past
// the way's own half width (its kerb for a street), and how finely the
// ground under it is sampled for water and slope (world units)
const WAY_CLEAR = 0.04;
const SAMPLE = 0.5;
// freePlacement(): a road this near the pointer (from its centre line)
// takes the building; it stands back from the road's edge by SETBACK plus
// up to SETBACK_VARY more, seeded, so a row of houses isn't ruled
const ROAD_REACH = 1.6;
const SETBACK = 0.1;
const SETBACK_VARY = 0.22;
// joinSnap(): a house this near the place beside a neighbour it could share
// a wall with goes there, if they face within JOIN_FACE of each other
const JOIN_SNAP = 0.45;
const JOIN_FACE = Math.PI / 6;
const JOIN_TWIST = (10 * Math.PI) / 180;

// grade(): how finely a segment's climb is measured along it (grid units)
const GRADE_STEP = 0.2;

export class WorldPlacement {
  // How much rock there is at a world position, 0–1 (terrain/rocks.js).
  rockAt(x, y) {
    return this.relief().rock(x, y);
  }

  // Too steep at this main dot to put up a building (CONFIG.steep.build);
  // never for a `type` laid out on any slope (parks).
  tooSteepToBuild(node, type = null) {
    if (STRUCTURE_TYPES[type]?.anySlope) return false;
    return this.slopeAt(node) > CONFIG.steep.build;
  }

  // How steep the ground is at a main dot (metres of rise per grid step,
  // either way along its steepest line), worked out once per relief.
  slopeAt(node) {
    const r = this.relief();
    if (!r.slopes) {
      const e = r.elevation, d = 0.5;
      r.slopes = new Float32Array(this.grid.size);
      for (let i = 0; i < this.grid.size; i++) {
        const [x, y] = this.grid.xy(i);
        r.slopes[i] = Math.hypot(e(x + d, y) - e(x - d, y), e(x, y + d) - e(x, y - d)) / (2 * d);
      }
    }
    return r.slopes[node];
  }

  // How steeply a segment of a network climbs: metres per grid step of its
  // length, at its steepest – measured piece by piece along it, so a stretch
  // whose ends sit at the same height can't hide a steep climb in between.
  grade(layer, a, b) {
    const [ax, ay] = layer.pos(a), [bx, by] = layer.pos(b);
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) return 0;
    const n = Math.max(2, Math.ceil(len / GRADE_STEP));
    let worst = 0, prev = this.elevation(ax, ay);
    for (let k = 1; k <= n; k++) {
      const z = this.elevation(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
      worst = Math.max(worst, Math.abs(z - prev));
      prev = z;
    }
    return worst / (len / n);
  }

  relief() {
    const rivers = this.terrain.rivers;
    if (this._relief?.rivers !== rivers) {
      const field = riverField(rivers);
      const { width, height } = this.grid;
      const rocks = makeRocks(this.seed, makeElevation(this.seed, field, this.hilliness), [-3, -3, width + 2, height + 2], { rivers: field, amount: this.rockiness });
      this._relief = { rivers, field, elevation: rocks.elevation, rock: rocks.rock };
    }
    return this._relief;
  }

  isRoadBlocked(node) {
    if (this.terrain.isWater(node)) return true;
    if (this.structureAt(node)) return true;
    const f = this.featureAt(node);
    return !!f && FEATURE_TYPES[f.type]?.blocksRoad === true;
  }

  // Railways keep clear of buildings: no dense dot touching one, nor a
  // feature that blocks roads.
  isRailBlocked(f) {
    return this.coarseAround(f).some((c) => this.isRoadBlocked(c));
  }

  isPathBlocked(f) {
    const around = this.coarseAround(f);
    if (around.some((c) => this.terrain.isWater(c))) return true;
    // Blocked only if every surrounding dot belongs to the same building,
    // so paths can squeeze between neighbouring buildings.
    const ids = around.map((c) => this.structureAtNode.get(c));
    if (ids[0] === undefined || !ids.every((id) => id === ids[0])) return false;
    // (a park or square placed freely: its outline decides, freeBuildingOn)
    const s = this.structures.get(ids[0]);
    return !(s?.free && STRUCTURE_TYPES[s.type]?.site);
  }

  // Free ground for the footprint, plus the type's own rule (def.canPlace,
  // e.g. a station needs room for its track).
  canPlaceStructure(type, node, rotation = 0, ignoreId = null) {
    const fits = this.fitsStructure(type, node, rotation, ignoreId);
    const rule = STRUCTURE_TYPES[type]?.canPlace;
    return fits.ok && rule ? rule(this, this.footprintNodes(type, node, rotation), rotation) : fits;
  }

  // Where to put a structure the player points at: as asked, or – for types
  // with their own rule – turned half round over the same dots if only that
  // fits, or if that way it uses what's there rather than building its own
  // (a station facing existing track instead of laying some: check.lay).
  // { node, rotation, check }.
  placementFor(type, node, rotation = 0) {
    const check = this.canPlaceStructure(type, node, rotation);
    if ((check.ok && !check.lay) || !STRUCTURE_TYPES[type]?.canPlace || node < 0) return { node, rotation, check };
    const offs = footprintOffsets(STRUCTURE_TYPES[type], rotation);
    const [sx, sy] = [0, 1].map((k) => Math.min(...offs.map((o) => o[k])) + Math.max(...offs.map((o) => o[k])));
    const flipped = this.grid.offset(node, sx, sy);
    const turned = (rotation + 2) % 4;
    const other = flipped >= 0 ? this.canPlaceStructure(type, flipped, turned) : { ok: false };
    if (other.ok && (!other.lay || !check.ok)) return { node: flipped, rotation: turned, check: other };
    return { node, rotation, check };
  }

  fitsStructure(type, node, rotation = 0, ignoreId = null) {
    if (!STRUCTURE_TYPES[type]) return { ok: false, reason: 'Unknown type' };
    if (node < 0) return { ok: false, reason: 'Off the map' };
    const nodes = this.footprintNodes(type, node, rotation);
    for (const n of nodes) {
      const reason = this.dotBlocked(n, type, ignoreId);
      if (reason) return { ok: false, reason };
    }
    if (this.fineCoveredBy(nodes).some((f) => this.paths.hasNode(f))) return { ok: false, reason: 'Footpath' };
    return { ok: true };
  }

  // The size of a type's outline in its own coordinates: [across its
  // front, front to back] – the footprint's dots, a unit each.
  outlineSize(type) {
    const offs = STRUCTURE_TYPES[type]?.footprint ?? [[0, 0]];
    const span = (k) => Math.max(...offs.map((o) => o[k])) - Math.min(...offs.map((o) => o[k])) + 1;
    return [span(0), span(1)];
  }

  // A structure of `type` with its middle at (x, y), its front looking
  // along `angle` (radians, see World.poseStructure): its outline.
  outlineAt(type, x, y, angle = 0) {
    const [w, h] = this.outlineSize(type);
    return rectOutline(x, y, w, h, angle);
  }

  // Free placement (docs/free-placement-plan.md, stage B): may a structure
  // of `type` stand with its middle at (x, y), turned by `angle`? Its
  // outline must stay on the map, overlap no other structure (touching is
  // fine) and no way – road, railway, footpath – with its width, and the
  // ground under it be dry, not too steep and free of what can't be
  // cleared. Types with a rule of their own (stations and their track)
  // still stand on the dots. { ok, reason }.
  fitsOutline(type, x, y, angle = 0, ignoreId = null) {
    const def = STRUCTURE_TYPES[type];
    if (!def) return { ok: false, reason: 'Unknown type' };
    if (def.canPlace) return { ok: false, reason: 'On the grid only' };
    const poly = this.outlineAt(type, x, y, angle);
    const [x0, y0, x1, y1] = boxOf(poly);
    if (x0 < -0.5 || y0 < -0.5 || x1 > this.grid.width - 0.5 || y1 > this.grid.height - 0.5) return { ok: false, reason: 'Off the map' };
    if (this.structureIndex.overlapping(poly).some((id) => id !== ignoreId)) return { ok: false, reason: 'Occupied' };
    for (const id of this.featureIndex.overlapping(poly)) {
      if (FEATURE_TYPES[this.features.get(id)?.type]?.clearable === false) return { ok: false, reason: 'Blocked' };
    }
    const way = this.wayAcross(poly);
    if (way) return { ok: false, reason: way };
    // the ground: points over the outline, its corners pulled in a little
    const [w, h] = this.outlineSize(type), c = Math.cos(angle), sn = Math.sin(angle);
    const nx = Math.max(1, Math.round(w / SAMPLE)), ny = Math.max(1, Math.round(h / SAMPLE));
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= ny; j++) {
        const lx = (i / nx - 0.5) * (w - 0.1), ly = (j / ny - 0.5) * (h - 0.1);
        const n = this.grid.nodeAt(x + lx * c - ly * sn, y + lx * sn + ly * c);
        if (n < 0) return { ok: false, reason: 'Off the map' };
        if (this.terrain.isWater(n)) return { ok: false, reason: 'Water' };
        if (this.tooSteepToBuild(n, type)) return { ok: false, reason: 'Too steep' };
      }
    }
    return { ok: true };
  }

  // The nearest point on a road's centre line within `reach` of (x, y):
  // { point, dir (unit, along the road), dist, half (its half width),
  // edge: [a, b] } or null. (Still the straight lines between road dots.)
  nearestRoadPoint(x, y, reach = ROAD_REACH) {
    const layer = this.networks.road;
    let best = null;
    for (const [a, b] of layer.graph.edges()) {
      const [ax, ay] = layer.pos(a), [bx, by] = layer.pos(b);
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      if (!l2) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      const px = ax + dx * t, py = ay + dy * t, dist = Math.hypot(x - px, y - py);
      if (dist > reach || (best && dist >= best.dist)) continue;
      const len = Math.sqrt(l2);
      const half = this.isLane(a, b) ? CONFIG.lane.edge : this.hasSidewalk(a, b) ? CONFIG.road.kerb : CONFIG.road.edge;
      best = { point: [px, py], dir: [dx / len, dy / len], dist, half, edge: [a, b] };
    }
    return best;
  }

  // Where a structure of `type` the player points at (x, y) would stand,
  // placed freely: near a road, its front turned to the road and stood
  // back from its edge (SETBACK, plus a seeded bit more), then `turn`
  // quarter turns more (side or back to the road); with no road near, at
  // the pointer, facing quarter turn `rotation`.
  // { x, y, angle, road (the nearestRoadPoint or null), check }.
  freePlacement(type, x, y, { rotation = 0, turn = 0, twist = 0, seed = 1 } = {}) {
    twist += (turn * Math.PI) / 2; // (quarter turns: the dev command's, a park's)
    const road = this.nearestRoadPoint(x, y);
    let angle = (rotation * Math.PI) / 2 + twist;
    if (road) {
      const [px, py] = road.point;
      // from the road towards the pointer (straight off it if it's on the line)
      let nx = x - px, ny = y - py;
      const d = Math.hypot(nx, ny);
      if (d < 1e-6) [nx, ny] = [-road.dir[1], road.dir[0]];
      else [nx, ny] = [nx / d, ny / d];
      const [, depth] = this.outlineSize(type);
      const back = SETBACK + SETBACK_VARY * mulberry32((seed ^ 0x5e7b4c) >>> 0)();
      const out = road.half + WAY_CLEAR + back + depth / 2;
      [x, y] = [px + nx * out, py + ny * out];
      // front (sin a, -cos a) looking back at the road: -n
      angle = Math.atan2(-nx, ny) + twist;
    }
    // a park or square keeps square with the dots' directions (its ground
    // and walkways are laid out by quarter turns): the nearest one
    if (STRUCTURE_TYPES[type]?.site) angle = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
    // beside a house it could share a wall with: flush to its side (not
    // once the player has turned it away)
    const flush = Math.abs(twist) < JOIN_TWIST && this.joinSnap(type, x, y, angle);
    if (flush) [x, y, angle] = flush;
    return { x, y, angle, road, check: this.fitsOutline(type, x, y, angle) };
  }

  // For a structure of a type that joins (def.join) about to stand at
  // (x, y, angle): the place wall to wall with a free neighbour of its
  // group facing about the same way, if one is within JOIN_SNAP of where it
  // would stand – [x, y, angle] there, turned as the neighbour – else null.
  joinSnap(type, x, y, angle) {
    const join = STRUCTURE_TYPES[type]?.join;
    if (!join || (STRUCTURE_TYPES[type].footprint ?? [[0, 0]]).length !== 1) return null;
    const [w] = this.outlineSize(type);
    let best = null;
    for (const id of this.structureIndex.near(x, y, w + JOIN_SNAP)) {
      const o = this.structures.get(id);
      if (!o?.free || o.data?.turn || STRUCTURE_TYPES[o.type]?.join?.group !== join.group) continue;
      if (Math.cos(o.angle - angle) < Math.cos(JOIN_FACE)) continue;
      const [ow] = this.outlineSize(o.type), d = (w + ow) / 2;
      for (const dir of [-1, 1]) {
        const px = o.x + dir * Math.cos(o.angle) * d, py = o.y + dir * Math.sin(o.angle) * d;
        const dist = Math.hypot(px - x, py - y);
        if (dist > JOIN_SNAP || (best && dist >= best.dist)) continue;
        if (this.fitsOutline(type, px, py, o.angle).ok) best = { dist, at: [px, py, o.angle] };
      }
    }
    return best?.at ?? null;
  }

  // Does a building placed freely stand on the segment a–b of network
  // `kind`, with `half` its half width? (Those on the dots are kept off by
  // their dots – isRoadBlocked and the like.)
  freeBuildingOn(kind, a, b, half) {
    const layer = this.networks[kind];
    const pa = layer.pos(a), pb = layer.pos(b), r = half + WAY_CLEAR;
    const box = [[Math.min(pa[0], pb[0]) - r, Math.min(pa[1], pb[1]) - r], [Math.max(pa[0], pb[0]) + r, Math.min(pa[1], pb[1]) - r],
      [Math.max(pa[0], pb[0]) + r, Math.max(pa[1], pb[1]) + r], [Math.min(pa[0], pb[0]) - r, Math.max(pa[1], pb[1]) + r]];
    for (const id of this.structureIndex.overlapping(box)) {
      const s = this.structures.get(id);
      if (!s?.free) continue;
      // a footpath may come up to a park or square (its walkways start
      // there), only not through its middle
      if (kind === 'path' && STRUCTURE_TYPES[s.type]?.site) {
        const [w, h] = this.outlineSize(s.type);
        if (segmentPolygonDistance(pa, pb, rectOutline(s.x, s.y, Math.max(0.1, w - 0.7), Math.max(0.1, h - 0.7), s.angle)) < 1e-6) return true;
        continue;
      }
      if (segmentPolygonDistance(pa, pb, this.structureIndex.outline(id)) < r) return true;
    }
    return false;
  }

  // The first way whose width the polygon would stand on: 'Road',
  // 'Railway', 'Footpath' – or null. (Ways are still on the dots, so each
  // segment is the straight line between two of them.)
  wayAcross(poly) {
    const [x0, y0, x1, y1] = boxOf(poly);
    const ways = [
      ['road', 'Road', (a, b) => (this.isLane(a, b) ? CONFIG.lane.edge : this.hasSidewalk(a, b) ? CONFIG.road.kerb : CONFIG.road.edge)],
      ['rail', 'Railway', () => 0.12],
      ['path', 'Footpath', () => CONFIG.path.edge],
    ];
    for (const [kind, reason, half] of ways) {
      const layer = this.networks[kind];
      for (const [a, b] of layer.graph.edges()) {
        const pa = layer.pos(a), pb = layer.pos(b);
        const reach = half(a, b) + WAY_CLEAR;
        if (Math.max(pa[0], pb[0]) < x0 - reach || Math.min(pa[0], pb[0]) > x1 + reach) continue;
        if (Math.max(pa[1], pb[1]) < y0 - reach || Math.min(pa[1], pb[1]) > y1 + reach) continue;
        if (segmentPolygonDistance(pa, pb, poly) < reach) return reason;
      }
    }
    return null;
  }

  // Why a structure of `type` can't have main dot `n` among its dots, or
  // null if it can: what fitsStructure checks dot by dot – and what the dots
  // round the pointer show while building (OverlayKit.nearDots), so a dot is
  // drawn exactly where the thing in hand could stand. (A footpath running
  // between two of its dots, and a type's own canPlace rule, are the whole
  // footprint's business.)
  dotBlocked(n, type = null, ignoreId = null) {
    if (n < 0) return 'Off the map';
    if (this.terrain.isWater(n)) return 'Water';
    const sid = this.structureAtNode.get(n);
    if (sid !== undefined && sid !== ignoreId) return 'Occupied';
    if (this.hasRoad(n)) return 'Road';
    if (this.railNear(n)) return 'Railway';
    const f = this.featureAt(n);
    if (f && FEATURE_TYPES[f.type]?.clearable === false) return 'Blocked';
    if (this.tooSteepToBuild(n, type)) return 'Too steep';
    if (this.paths.hasNode(this.coarseToFine(n))) return 'Footpath';
    return null;
  }
}

// How near a segment comes to a convex polygon: 0 if it crosses or
// enters it.
function segmentPolygonDistance(a, b, poly) {
  let best = Math.min(distanceToPolygon(poly, ...a), distanceToPolygon(poly, ...b));
  for (let i = 0; i < poly.length && best > 0; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    if (segmentsCross(a, b, p, q)) return 0;
    best = Math.min(best, segmentDistance(p, a, b));
  }
  return best;
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
