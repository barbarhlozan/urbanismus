// What may be built where (World methods; see world.js): slopes and rock,
// dots taken by roads, railways and paths, and whether a structure fits.

import { CONFIG } from '../../config.js';
import { makeElevation } from '../../terrain/elevation.js';
import { makeRocks } from '../../terrain/rocks.js';
import { riverField } from '../../terrain/rivers.js';
import { STRUCTURE_TYPES, footprintOffsets } from '../../../structures/index.js';
import { FEATURE_TYPES } from '../../../features/index.js';
import { BODIES } from '../../../structures/bodies.js';
import { rectOutline, distanceToPolygon, boxOf } from '../spatial.js';
import { segmentDistance } from '../geom2d.js';
import { detourAround } from '../../roads/detour.js';
import { crossingsOf } from '../../roads/curves.js';
import { WAY_KINDS, kindsWhere } from '../../roads/rules.js';
import { mulberry32 } from '../random.js';

// fitsOutline(): how far a building keeps from a way's centre line, past
// the way's own half width (its kerb for a street), and how finely the
// ground under it is sampled for water and slope (world units)
const WAY_CLEAR = 0.04;
// fitsOutline's reasons that are a way in the body's way, and the ways a
// building put down across them bends round (detoursFor) – roads/rules.js
const WAY_REASONS = new Set(Object.values(WAY_KINDS).map((k) => k.blocks).filter(Boolean));
const DETOUR_KINDS = new Set(kindsWhere('goesRound'));
const SAMPLE = 0.5;
// nearestRoadPoint(): how far from a road's centre line a point is still
// by it (a building's yard reaches it). freePlacement(): a building taken
// by a road stands back from its edge by SETBACK plus up to SETBACK_VARY
// more, seeded, so a row of houses isn't ruled
const ROAD_REACH = 1.6;
// …but turns to face it only with the pointer this near the road's edge
// (else it stands where pointed, as the player turned it)
const SNAP_REACH = 0.55;
const SETBACK = 0.1;
const SETBACK_VARY = 0.22;
// joinSnap(): a house this near the place beside a neighbour it could share
// a wall with goes there, if they face within JOIN_FACE of each other
const JOIN_SNAP = 0.45;
const JOIN_FACE = Math.PI / 6;
const JOIN_TWIST = (10 * Math.PI) / 180;
// bodyOf(): how far out beside a village house its own court reaches
// (structures/courts.js, OWN_TO), with the bodies' margin
export const COURT_TO = 0.48;

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

  // (A building placed freely doesn't block by its dots: ways are kept off
  // its body, freeBuildingOn / buildingsOnLine, so they may pass close by.)
  isRoadBlocked(node) {
    if (this.terrain.isWater(node)) return true;
    const s = this.structureAt(node);
    if (s && !s.free) return true;
    const f = this.featureAt(node);
    return !!f && FEATURE_TYPES[f.type]?.blocksRoad === true;
  }

  // Railways keep clear of buildings: no dense dot touching one, nor a
  // feature that blocks roads. Water by the dense dots' own rule (denseWater).
  isRailBlocked(f) {
    return this.denseWater(f) || this.coarseAround(f).some((c) => !this.terrain.isWater(c) && this.isRoadBlocked(c));
  }

  isPathBlocked(f) {
    if (this.denseWater(f)) return true;
    const around = this.coarseAround(f);
    // Blocked only if every surrounding dot belongs to the same building,
    // so paths can squeeze between neighbouring buildings.
    const ids = around.map((c) => this.structureAtNode.get(c));
    if (ids[0] === undefined || !ids.every((id) => id === ids[0])) return false;
    // (one placed freely: its body decides, freeBuildingOn / buildingsOnLine)
    return !this.structures.get(ids[0])?.free;
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

  // A type's body: [x0, y0, x1, y1] local to its middle (front towards -y)
  // – its walls as drawn plus a little margin (structures/bodies.js), or
  // its whole outline for a type without one (parks, squares).
  bodyBox(type) {
    const b = BODIES[type];
    if (b) return b;
    const [w, h] = this.outlineSize(type);
    return [-w / 2, -h / 2, w / 2, h / 2];
  }

  // The body of a structure of `type` with its middle at (x, y), turned by
  // `angle`, as a polygon – `box` (local, as bodyBox) if given.
  bodyAt(type, x, y, angle = 0, box = this.bodyBox(type)) {
    const [x0, y0, x1, y1] = box, c = Math.cos(angle), sn = Math.sin(angle);
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([lx, ly]) => [x + lx * c - ly * sn, y + lx * sn + ly * c]);
  }

  // The ground beside free village house s, on its local -x (dir -1) or +x
  // (dir 1) side, that its own court would wall in (courts.js): out from
  // its walls to COURT_TO, as deep as the walls. Polygon.
  courtSpace(s, dir) {
    const [x0, y0, x1, y1] = this.bodyBox(s.type);
    const box = dir < 0 ? [-COURT_TO, y0, x0, y1] : [x1, y0, COURT_TO, y1];
    return this.bodyAt(s.type, s.x, s.y, s.angle, box);
  }

  // Is there no room for free house s's own court on that side – another
  // building's body or a way in it? (courtSides: it goes the other way, or
  // there's none.)
  courtBlocked(s, dir) {
    const poly = this.courtSpace(s, dir);
    return this.structureIndex.overlapping(poly).some((id) => id !== s.id) || !!this.wayAcross(poly);
  }

  // Free placement (README, Free placement, stage B): may a structure
  // of `type` stand with its middle at (x, y), turned by `angle`? Its
  // outline must stay on the map, its body (bodyBox) overlap no other's
  // (touching is fine) and no way – road, railway, footpath – with its
  // width, and the ground under it be dry, not too steep and free of what
  // can't be cleared. Types with a rule of their own (stations and their track)
  // still stand on the dots. { ok, reason }.
  // `ways: false`: the ways are left out (detoursFor sees to them).
  fitsOutline(type, x, y, angle = 0, ignoreId = null, { ways = true } = {}) {
    const def = STRUCTURE_TYPES[type];
    if (!def) return { ok: false, reason: 'Unknown type' };
    if (def.canPlace) return { ok: false, reason: 'On the grid only' };
    const poly = this.outlineAt(type, x, y, angle);
    const [x0, y0, x1, y1] = boxOf(poly);
    if (x0 < -0.5 || y0 < -0.5 || x1 > this.grid.width - 0.5 || y1 > this.grid.height - 0.5) return { ok: false, reason: 'Off the map' };
    if (poly.some(([px, py]) => !this.land.inside(px, py))) return { ok: false, reason: 'Off the map' };
    // (others and ways are kept off its body, the walls: its plot may reach
    // under a neighbour's garden or up to a footpath)
    const body = this.bodyAt(type, x, y, angle);
    if (this.structureIndex.overlapping(body).some((id) => id !== ignoreId)) return { ok: false, reason: 'Occupied' };
    for (const id of this.featureIndex.overlapping(body)) {
      if (FEATURE_TYPES[this.features.get(id)?.type]?.clearable === false) return { ok: false, reason: 'Blocked' };
    }
    const way = ways && this.wayAcross(body);
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
    const near = this.nearestRoadPoint(x, y);
    const road = near && near.dist - near.half <= SNAP_REACH ? near : null;
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
    let check = this.fitsOutline(type, x, y, angle);
    // across a way: the way bent round it, if it can be (detoursFor)
    if (WAY_REASONS.has(check.reason)) {
      const around = this.detoursFor(type, x, y, angle);
      check = around.ok ? { ok: true, detours: around.detours } : { ok: false, reason: around.reason ?? check.reason };
    }
    return { x, y, angle, road, check };
  }

  // A structure of `type` put down at (x, y, angle) across ways: each way
  // that would run over its body (with the way's width) bent round it
  // (roads/detour.js), the rest of the ground as fitsOutline wants it.
  // { ok, detours: [{ edge (id), pts }], reason }. Nothing changes here:
  // placeStructureAt lays them.
  detoursFor(type, x, y, angle = 0) {
    const fits = this.fitsOutline(type, x, y, angle, null, { ways: false });
    if (!fits.ok) return fits;
    const body = this.bodyAt(type, x, y, angle);
    const [x0, y0, x1, y1] = this.bodyBox(type);
    const box = { x, y, angle, x0, y0, x1, y1 };
    const crossing = (e, pts) => {
      const r = this.wayClear(e.kind, e);
      for (let k = 1; k < pts.length; k++) if (segmentPolygonDistance(pts[k - 1], pts[k], body) < r) return true;
      return false;
    };
    const planned = new Map(); // edge id -> its new line
    const lineOf = (e) => planned.get(e.id) ?? e.pts;
    const hits = [...this.ways.edges.values()].filter((e) => DETOUR_KINDS.has(e.kind) && crossing(e, e.pts));
    if (!hits.length) return { ok: true, detours: [] };
    for (const e of hits) {
      const r = this.wayClear(e.kind, e);
      let found = null, why = 'A junction is in the way';
      // the shorter way round first, a little wider each time
      for (const [grow, pad] of [[0.06, 0.35], [0.14, 0.55], [0.25, 0.8]]) {
        for (const side of [0, 1, -1]) {
          const pts = detourAround(e.pts, box, r + grow, { pad, side });
          if (!pts) continue;
          const check = this.detourCheck(e, pts, body, (o) => lineOf(o));
          if (check.ok) { found = pts; break; }
          why = check.reason;
        }
        if (found) break;
      }
      if (!found) return { ok: false, reason: why };
      planned.set(e.id, found);
    }
    return { ok: true, detours: [...planned].map(([edge, pts]) => ({ edge, pts })) };
  }

  // May way edge `e` run along `pts` instead, round a building to stand on
  // `body`: clear of it and of other buildings, crossing no other way
  // (`lineOf(edge)`: their lines, as planned), and up to the kind's own
  // rules (checkWay: slope, water, bends). { ok, reason }.
  detourCheck(e, pts, body, lineOf) {
    const r = this.wayClear(e.kind, e);
    for (let k = 1; k < pts.length; k++) if (segmentPolygonDistance(pts[k - 1], pts[k], body) < r) return { ok: false, reason: 'Too tight to go round' };
    const check = this.checkWay(e.kind, pts, { lane: !!e.lane, street: !!e.street });
    if (!check.ok) return check;
    const ends = [this.ways.nodes.get(e.a), this.ways.nodes.get(e.b)];
    for (const o of this.ways.edges.values()) {
      if (o.id === e.id) continue;
      for (const c of crossingsOf(pts, lineOf(o))) {
        if (ends.some((n) => Math.hypot(n.x - c.point[0], n.y - c.point[1]) < 0.05)) continue; // (where they meet anyway)
        return { ok: false, reason: 'Crosses another line' };
      }
    }
    return { ok: true };
  }

  // Lays planned detours (detoursFor): each edge's line replaced, the
  // dots and everyone told.
  layDetours(detours) {
    if (!detours?.length) return;
    this.history.touch();
    const kinds = new Map();
    for (const { edge, pts } of detours) {
      const e = this.ways.edges.get(edge);
      if (!e) continue;
      e.pts = pts.map((p) => [...p]);
      const na = this.ways.nodes.get(e.a), nb = this.ways.nodes.get(e.b);
      e.pts[0] = [na.x, na.y];
      e.pts[e.pts.length - 1] = [nb.x, nb.y];
      kinds.set(e.kind, true);
    }
    this.ways.version++;
    for (const kind of kinds.keys()) {
      this.refreshNetwork(kind);
      const layer = this.networks[kind];
      this.events.emit(layer.event, { layer, nodes: [...layer.graph.nodes()], ...(kind === 'road' ? { sidewalks: true } : {}) });
    }
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

  // How far a way of `kind` keeps its centre line from a building's body:
  // its half width (a street's kerb) and WAY_CLEAR – as wayAcross keeps a
  // building off the way.
  wayClear(kind, { lane = false, street = false } = {}) {
    const own = WAY_KINDS[kind]?.half ?? 0;
    const half = kind === 'road' ? (lane ? CONFIG.lane.edge : street ? CONFIG.road.kerb : CONFIG.road.edge)
      : own === 'path' ? CONFIG.path.edge : own;
    return half + WAY_CLEAR;
  }

  // The buildings placed freely that a way of `kind` drawn along `line`
  // (its centre line, as laid) would run into: [{ id, at: [x, y] (the
  // line's point nearest it) }]. `skip(id)`: ones not to count. The same
  // rule as freeBuildingOn, on the line itself rather than its dots.
  buildingsOnLine(kind, line, attrs = {}, skip = () => false) {
    const r = this.wayClear(kind, attrs), out = [], seen = new Set();
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      const box = [[Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r], [Math.max(a[0], b[0]) + r, Math.min(a[1], b[1]) - r],
        [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r], [Math.min(a[0], b[0]) - r, Math.max(a[1], b[1]) + r]];
      for (const id of this.structureIndex.overlapping(box)) {
        const s = this.structures.get(id);
        if (seen.has(id) || !s?.free || skip(id)) continue;
        let hit;
        // a footpath may come up to a park or square, only not through its middle
        if (kind === 'path' && STRUCTURE_TYPES[s.type]?.site) {
          const [w, h] = this.outlineSize(s.type);
          hit = segmentPolygonDistance(a, b, rectOutline(s.x, s.y, Math.max(0.1, w - 0.7), Math.max(0.1, h - 0.7), s.angle)) < 1e-6;
        } else hit = segmentPolygonDistance(a, b, this.structureIndex.outline(id)) < r;
        if (!hit) continue;
        seen.add(id);
        const da = Math.hypot(a[0] - s.x, a[1] - s.y), db = Math.hypot(b[0] - s.x, b[1] - s.y);
        out.push({ id, at: da < db ? a : b });
      }
    }
    return out;
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
    if (n < 0 || !this.land.inside(...this.grid.xy(n))) return 'Off the map';
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
