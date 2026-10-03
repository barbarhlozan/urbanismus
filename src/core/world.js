// The single source of truth for game state. Everything that changes the
// world goes through a World method, which validates it and emits an event.
// Everything here is plain data and round-trips through toJSON/fromJSON.
//
// Two grids:
//   grid – the main dots (buildings, roads)
//   fine – twice as dense (footpaths, railways – so their curves can be
//          gentler). Fine node (2x, 2y) sits on main dot (x, y).

import { EventBus } from './events.js';
import { CONFIG } from '../config.js';
import { townName } from './townName.js';
import { Grid, ORTHO, DIAG } from './grid.js';
import { Terrain } from '../terrain/terrain.js';
import { makeElevation } from '../terrain/elevation.js';
import { makeRocks } from '../terrain/rocks.js';
import { findHills } from '../terrain/hills.js';
import { riverField } from '../terrain/rivers.js';
import { RoadNetwork, edgeKey } from '../roads/network.js';
import { NetworkLayer } from '../roads/layer.js';
import { validateRoute } from '../roads/routing.js';
import { STRUCTURE_TYPES, footprintOffsets, maxLevel, newSeed } from '../../structures/index.js';
import { mulberry32 } from './random.js';
import { FEATURE_TYPES } from '../../features/index.js';

export const SAVE_VERSION = 3; // 3: railways on the fine grid

export class World {
  constructor({ width, height, seed = 1, name, hilliness = 1, rockiness = 1 }) {
    this.seed = seed;
    this.hilliness = hilliness; // scales the seed's hills (terrain/elevation.js)
    this.rockiness = rockiness; // 0–1, how much of the steep ground is rock (terrain/rocks.js)
    this.name = name || townName(seed); // what the player calls the town (older saves: from the seed)
    this.events = new EventBus();
    this.grid = new Grid(width, height);
    this.fine = new Grid(2 * width - 1, 2 * height - 1);
    this.terrain = new Terrain(this.grid);
    this.structures = new Map();      // id -> { id, type, node, rotation, level, seed, data }
    this.features = new Map();        // id -> { id, type, node, ox, oy, variant, scale }
    this.structureAtNode = new Map(); // node -> structure id (every footprint node)
    this.featureAtNode = new Map();   // node -> feature id
    this.nextId = 1;
    this.time = 0; // simulated seconds the town has been running (the clock, kept in the save)
    this.story = { seen: [], vars: {}, unlocks: [] }; // what the story has told and unlocked (src/story/)
    this.chronicle = { entries: [], marks: [] }; // the town's chronicle (src/sim/chronicle.js)

    this.sidewalks = new Set(); // edgeKey of road segments that are streets (have sidewalks)
    this.lanes = new Set();     // edgeKey of road segments that are single-track lanes (never streets)
    this.laneWalks = new Map(); // edgeKey of lanes -> sides with a sidewalk: bit 1 left of the way from
                                // the lower dot to the higher (offsetPolyline +), bit 2 right (see sideOf)

    this.networks = {
      road: new NetworkLayer({
        id: 'road',
        grid: this.grid,
        scale: 1,
        isBlocked: (n) => this.isRoadBlocked(n),
        conflicts: (a, b) => this.railAlong(a, b),
        steep: (a, b) => this.grade(this.networks.road, a, b) > CONFIG.steep.road,
        coarseOf: (n) => n,
        // drivers weigh a lane by the time it takes (CONFIG.lane.speed)
        cost: (a, b) => this.grid.distance(a, b) / (this.isLane(a, b) ? CONFIG.lane.speed : 1),
        event: 'roads:changed',
        bridge: this.bridgeRule(2, (n) => this.railNear(n)),
      }),
      // Railways are on the dense grid, like footpaths, so bends (45° at
      // most per dot) can follow each other closely enough for smooth
      // curves. They cross roads and footpaths (level crossings) but never
      // share a segment with one, and keep clear of buildings.
      rail: new NetworkLayer({
        id: 'rail',
        grid: this.fine,
        scale: 0.5,
        isBlocked: (f) => this.isRailBlocked(f),
        conflicts: (f, g) => !!this.roadOn(...this.fine.xy(f), ...this.fine.xy(g)) || this.paths.hasEdge(f, g),
        steep: (f, g) => this.grade(this.networks.rail, f, g) > CONFIG.steep.rail,
        maxTurn: Math.PI / 4,
        coarseOf: (f) => this.fineToCoarse(f),
        event: 'rails:changed',
        bridge: {
          water: (f) => this.coarseAround(f).some((c) => this.terrain.isWater(c)),
          river: (f) => this.coarseAround(f).every((c) => !this.terrain.isWater(c) || this.terrain.isRiver(c)),
          span: 5,
          taken: (f) => this.roadAtFine(f),
        },
      }),
      path: new NetworkLayer({
        id: 'path',
        grid: this.fine,
        scale: 0.5,
        isBlocked: (f) => this.isPathBlocked(f),
        conflicts: (f, g) => this.rails.hasEdge(f, g),
        coarseOf: (f) => this.fineToCoarse(f),
        event: 'paths:changed',
        // a dense dot is over water if a main dot around it is; a two-dot
        // river takes up to five of them
        bridge: {
          water: (f) => this.coarseAround(f).some((c) => this.terrain.isWater(c)),
          river: (f) => this.coarseAround(f).every((c) => !this.terrain.isWater(c) || this.terrain.isRiver(c)),
          span: 5,
          taken: () => false,
        },
      }),
    };
    this.networks.rail.pos = (f) => this.railPos(f);
  }

  // Where a railway runs at dense dot f. Track drawn as a staircase of
  // dense dots (bends of 45° close together) is smoothed along each run
  // into one even curve: every dot where the line just passes through is
  // eased towards its neighbours a few times, then kept within MAX_SHIFT of
  // its dot. Junctions, ends, bridges and the track in front of stations
  // stay put (and straight stretches stay straight). Trains, the drawing
  // and level crossings all use these positions; the rules (sharpest bend,
  // straight bridges) use the dots.
  railPos(f) {
    const layer = this.networks.rail;
    const key = `${layer.version}|${this.structureVersion ?? 0}`;
    if (this._railPos?.key !== key) this._railPos = { key, pos: this.smoothRails() };
    return this._railPos.pos.get(f) ?? layer.dot(f);
  }

  smoothRails() {
    const RUNS = 6, MAX_SHIFT = 0.2;
    const layer = this.networks.rail;
    const graph = layer.graph;
    const pinned = new Set();
    for (const s of this.structures.values()) {
      if (!STRUCTURE_TYPES[s.type]?.railStop) continue;
      for (const n of this.nodesOf(s)) {
        const [x, y] = this.grid.xy(n);
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (this.fine.inBounds(2 * x + dx, 2 * y + dy)) pinned.add(this.fine.index(2 * x + dx, 2 * y + dy));
          }
        }
      }
    }
    const free = [];
    const pos = new Map();
    for (const f of graph.nodes()) {
      pos.set(f, layer.dot(f));
      if (graph.degree(f) === 2 && !pinned.has(f) && !layer.bridge.water(f)) free.push(f);
    }
    for (let k = 0; k < RUNS; k++) {
      const next = new Map();
      for (const f of free) {
        const [a, b] = [...graph.neighbors(f)].map((m) => pos.get(m));
        const p = pos.get(f);
        next.set(f, [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4]);
      }
      for (const [f, p] of next) pos.set(f, p);
    }
    for (const f of free) {
      const [x, y] = layer.dot(f), [px, py] = pos.get(f);
      const d = Math.hypot(px - x, py - y);
      if (d > MAX_SHIFT) pos.set(f, [x + ((px - x) * MAX_SHIFT) / d, y + ((py - y) * MAX_SHIFT) / d]);
    }
    return pos;
  }

  // Bridges for roads and railways (NetworkLayer.bridge): over river dots,
  // `span` of them at most; `taken(n)`: the other network is there.
  bridgeRule(span, taken) {
    return {
      water: (n) => this.terrain.isWater(n),
      river: (n) => this.terrain.isRiver(n),
      span,
      taken,
    };
  }

  // After part of a network is removed: bridges it cut (water dots no
  // longer reaching land at both ends) go too – the whole span. Returns the
  // dots removed.
  pruneBridges(layer, touched) {
    const { bridge, graph } = layer;
    if (!bridge) return [];
    const gone = [];
    const seen = new Set();
    for (const start of touched) {
      if (seen.has(start) || !graph.hasNode(start) || !bridge.water(start)) continue;
      const span = [start], ends = new Set();
      seen.add(start);
      for (let k = 0; k < span.length; k++) {
        for (const m of graph.neighbors(span[k])) {
          if (!bridge.water(m)) ends.add(m);
          else if (!seen.has(m)) { seen.add(m); span.push(m); }
        }
      }
      if (ends.size >= 2) continue;
      for (const n of span) graph.removeNode(n);
      gone.push(...span, ...ends);
    }
    return gone;
  }

  get roads() {
    return this.networks.road.graph;
  }

  get paths() {
    return this.networks.path.graph;
  }

  get rails() {
    return this.networks.rail.graph;
  }

  // ---------- fine grid ----------

  coarseToFine(node) {
    const [x, y] = this.grid.xy(node);
    return this.fine.index(2 * x, 2 * y);
  }

  fineToCoarse(f) {
    const [fx, fy] = this.fine.xy(f);
    return fx % 2 || fy % 2 ? -1 : this.grid.index(fx / 2, fy / 2);
  }

  // Main dots touching a fine node: 1 (on a dot), 2 (between two), 4 (middle of a square).
  coarseAround(f) {
    const [fx, fy] = this.fine.xy(f);
    const xs = fx % 2 ? [(fx - 1) / 2, (fx + 1) / 2] : [fx / 2];
    const ys = fy % 2 ? [(fy - 1) / 2, (fy + 1) / 2] : [fy / 2];
    const out = [];
    for (const y of ys) for (const x of xs) out.push(this.grid.index(x, y));
    return out;
  }

  // Fine nodes lying completely inside a set of main dots (a building's area).
  fineCoveredBy(nodes) {
    const set = new Set(nodes);
    const out = new Set();
    for (const n of nodes) {
      const [x, y] = this.grid.xy(n);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const fx = 2 * x + dx;
          const fy = 2 * y + dy;
          if (!this.fine.inBounds(fx, fy)) continue;
          const f = this.fine.index(fx, fy);
          if (this.coarseAround(f).every((c) => set.has(c))) out.add(f);
        }
      }
    }
    return [...out];
  }

  // ---------- queries ----------

  structureAt(node) {
    const id = this.structureAtNode.get(node);
    return id === undefined ? null : this.structures.get(id);
  }

  featureAt(node) {
    const id = this.featureAtNode.get(node);
    return id === undefined ? null : this.features.get(id);
  }

  hasRoad(node) {
    return this.roads.hasNode(node);
  }

  // Railway on the main dot `node`.
  hasRail(node) {
    return this.rails.hasNode(this.coarseToFine(node));
  }

  // Railway on the dense dots at or right round main dot `node` (where it
  // would run into a building standing there).
  railNear(node) {
    const [x, y] = this.grid.xy(node);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.fine.inBounds(2 * x + dx, 2 * y + dy) && this.rails.hasNode(this.fine.index(2 * x + dx, 2 * y + dy))) return true;
      }
    }
    return false;
  }

  // Main-dot segment a–b as its two dense-grid steps: [[fa, mid], [mid, fb]].
  fineSegment(a, b) {
    const fa = this.coarseToFine(a), fb = this.coarseToFine(b);
    const [ax, ay] = this.fine.xy(fa), [bx, by] = this.fine.xy(fb);
    const mid = this.fine.index((ax + bx) / 2, (ay + by) / 2);
    return [[fa, mid], [mid, fb]];
  }

  // Railway along road segment a–b (on the dense dots it covers).
  railAlong(a, b) {
    return this.fineSegment(a, b).some(([f, g]) => this.rails.hasEdge(f, g));
  }

  // A road on dense dot f: on its dot, or through it halfway along a segment.
  roadAtFine(f) {
    const around = this.coarseAround(f);
    if (around.length === 1) return this.roads.hasNode(around[0]);
    if (around.length === 2) return this.roads.hasEdge(around[0], around[1]);
    return this.roads.hasEdge(around[0], around[3]) || this.roads.hasEdge(around[1], around[2]);
  }

  footprintNodes(type, node, rotation = 0) {
    return footprintOffsets(STRUCTURE_TYPES[type], rotation).map(([dx, dy]) => this.grid.offset(node, dx, dy));
  }

  nodesOf(s) {
    return this.footprintNodes(s.type, s.node, s.rotation);
  }

  // Ground height in metres at a world position: the seed's hills with the
  // river valleys cut in (terrain/elevation.js) and the steepest slopes
  // broken into cliff bands (terrain/rocks.js). `riverField` is the rivers'
  // distance field (terrain/rivers.js), null without rivers. Both are worked
  // out once per set of rivers.
  get elevation() {
    return this.relief().elevation;
  }

  get riverField() {
    return this.relief().field;
  }

  // How much rock there is at a world position, 0–1 (terrain/rocks.js).
  rockAt(x, y) {
    return this.relief().rock(x, y);
  }

  // The named hills (terrain/hills.js), highest first, found once per relief.
  get hills() {
    const r = this.relief();
    r.hills ??= findHills(r.elevation, this.grid, this.seed, {
      isWater: (x, y) => {
        const n = this.grid.nodeAt(Math.round(x), Math.round(y));
        return n >= 0 && this.terrain.isWater(n);
      },
    });
    return r.hills;
  }

  // Too steep at this main dot to put up a building (CONFIG.steep.build).
  tooSteepToBuild(node) {
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
  // length, between its two ends.
  grade(layer, a, b) {
    const [ax, ay] = layer.pos(a), [bx, by] = layer.pos(b);
    const len = Math.hypot(bx - ax, by - ay);
    return len ? Math.abs(this.elevation(bx, by) - this.elevation(ax, ay)) / len : 0;
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

  // Middle of a structure in world coordinates.
  centerOf(s) {
    const pts = this.nodesOf(s).map((n) => this.grid.xy(n));
    return [
      pts.reduce((a, p) => a + p[0], 0) / pts.length,
      pts.reduce((a, p) => a + p[1], 0) / pts.length,
    ];
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
    return ids[0] !== undefined && ids.every((id) => id === ids[0]);
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
      if (n < 0) return { ok: false, reason: 'Off the map' };
      if (this.terrain.isWater(n)) return { ok: false, reason: 'Water' };
      const sid = this.structureAtNode.get(n);
      if (sid !== undefined && sid !== ignoreId) return { ok: false, reason: 'Occupied' };
      if (this.hasRoad(n)) return { ok: false, reason: 'Road' };
      if (this.railNear(n)) return { ok: false, reason: 'Railway' };
      const f = this.featureAt(n);
      if (f && FEATURE_TYPES[f.type]?.clearable === false) return { ok: false, reason: 'Blocked' };
      if (this.tooSteepToBuild(n)) return { ok: false, reason: 'Too steep' };
    }
    if (this.fineCoveredBy(nodes).some((f) => this.paths.hasNode(f))) return { ok: false, reason: 'Footpath' };
    return { ok: true };
  }

  // Where a structure meets the road: { door: footprint node, road: road node }.
  // Straight neighbours are preferred over diagonal ones.
  accessInfo(s) {
    return this.accessFor(this.nodesOf(s));
  }

  accessFor(nodes) {
    for (const dirs of [ORTHO, DIAG]) {
      for (const n of nodes) {
        for (const [dx, dy] of dirs) {
          const m = this.grid.offset(n, dx, dy);
          if (m >= 0 && this.hasRoad(m) && !this.terrain.isWater(m)) return { door: n, road: m }; // not off a bridge
        }
      }
    }
    return null;
  }

  // Ground a `site` structure (park, square) may fill, in world coordinates:
  //   rect   [x0, y0, x1, y1] – up to the road on sides facing a road, halfway
  //          to a neighbouring site structure (so they merge), else a margin
  //   inner  [x0, y0, x1, y1] – the footprint dots' extent
  //   road   [left, top, right, bottom] – which sides face a road
  // The renderer then fits road sides to the drawn road curves (render/lots.js).
  siteArea(type, node, rotation = 0) {
    const pts = this.footprintNodes(type, node, rotation).map((n) => this.grid.xy(n));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const reach = (x, y) => {
      if (!this.grid.inBounds(x, y)) return 0.42;
      const n = this.grid.index(x, y);
      if (this.hasRoad(n)) return 0.9;
      const o = this.structureAt(n);
      return o && STRUCTURE_TYPES[o.type]?.site ? 0.5 : 0.42;
    };
    const side = (dots) => Math.max(...dots.map(([x, y]) => reach(x, y)));
    const ext = [
      side(pts.filter(([x]) => x === x0).map(([x, y]) => [x - 1, y])),
      side(pts.filter(([, y]) => y === y0).map(([x, y]) => [x, y - 1])),
      side(pts.filter(([x]) => x === x1).map(([x, y]) => [x + 1, y])),
      side(pts.filter(([, y]) => y === y1).map(([x, y]) => [x, y + 1])),
    ];
    return {
      rect: [x0 - ext[0], y0 - ext[1], x1 + ext[2], y1 + ext[3]],
      inner: [x0, y0, x1, y1],
      road: ext.map((e) => e > 0.8),
    };
  }

  // Walkable paths through a site (park, square), joined at a hub in the
  // middle. There are exits only where something arrives, on the footpath
  // grid on the footprint's sides:
  //   - a footpath reaching the side (every one coming in; one running just
  //     along the side gets a single exit, the nearest to the middle)
  //   - a street (sidewalks) or lane along it: in the middle of the side
  //   - a neighbouring site: in the middle of the stretch they share, so
  //     their walkways meet – but only when that group of sites has a way
  //     in of its own
  // With none the site is left without walkways (see roads/siteWalks.js).
  //   { hub, hubPos, half, exits: [{ node, pos: [x, y], dir: [dx, dy], road, site }] }
  // node = fine-grid index; road = the street / lane dot it leads to, or -1;
  // site = the neighbouring site's id, or -1; half = half the footprint's
  // narrower side, plus half a dot (1x1: 0.5, 2x2: 1).
  sitePaths(s) {
    const own = this.siteExits(s);
    if (!own.exits.some((e) => e.site >= 0) || this.siteGroupOpen(s)) return own;
    return { ...own, exits: own.exits.filter((e) => e.site < 0) };
  }

  // Does the group of touching sites `s` belongs to have a way in (an exit
  // that isn't just to another site of the group)?
  siteGroupOpen(s) {
    const seen = new Set([s.id]);
    const queue = [s];
    while (queue.length) {
      const { exits } = this.siteExits(queue.pop());
      for (const e of exits) {
        if (e.site < 0) return true;
        if (seen.has(e.site)) continue;
        seen.add(e.site);
        const o = this.structures.get(e.site);
        if (o) queue.push(o);
      }
    }
    return false;
  }

  // A site's exits before sitePaths drops those to a closed group; cached
  // until the roads, footpaths or structures change.
  siteExits(s) {
    const stamp = `${this.networks.road.version}|${this.networks.path.version}|${this.structureVersion}`;
    if (this.siteCache?.stamp !== stamp) this.siteCache = { stamp, map: new Map() };
    const key = `${s.id}|${s.type}|${s.node}|${s.rotation}`; // (previews have no id of their own)
    const hit = this.siteCache.map.get(key);
    if (hit) return hit;

    const pts = this.nodesOf(s).map((n) => this.grid.xy(n));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const fineAt = (x, y) => (this.fine.inBounds(2 * x, 2 * y) ? this.fine.index(2 * x, 2 * y) : -1);
    const walkable = (n) => n >= 0 && this.hasRoad(n) && !this.terrain.isWater(n) &&
      [...this.roads.neighbors(n)].some((m) => this.hasSidewalk(n, m) || this.isLane(n, m));

    const exits = [];
    const add = (pos, dir, road, site) => {
      const node = fineAt(...pos);
      if (node < 0 || exits.some((e) => e.node === node)) return;
      exits.push({ node, pos, dir, road, site });
    };
    // each side: where along it (t) is which point on it
    const sides = [
      { dir: [-1, 0], at: (t) => [x0 - 0.5, t], span: [y0, y1] },
      { dir: [1, 0], at: (t) => [x1 + 0.5, t], span: [y0, y1] },
      { dir: [0, -1], at: (t) => [t, y0 - 0.5], span: [x0, x1] },
      { dir: [0, 1], at: (t) => [t, y1 + 0.5], span: [x0, x1] },
    ];
    for (const { dir: [dx, dy], at, span: [a, b] } of sides) {
      const mid = (a + b) / 2;
      // footpaths: coming in from outside, or else only running along (a
      // corner counts only for one coming in diagonally, from both sides)
      const arriving = [], along = [];
      for (let t = a - 0.5; t <= b + 0.5; t += 0.5) {
        const f = fineAt(...at(t));
        if (f < 0 || !this.paths.hasNode(f)) continue;
        const [fx, fy] = this.fine.xy(f);
        const corner = t < a || t > b;
        const [ox, oy] = !corner ? [0, 0] : dx ? [0, t < a ? -1 : 1] : [t < a ? -1 : 1, 0];
        const comes = [...this.paths.neighbors(f)].some((m) => {
          const [mx, my] = this.fine.xy(m);
          return (mx - fx) * dx + (my - fy) * dy > 0 && (!corner || (mx - fx) * ox + (my - fy) * oy > 0);
        });
        if (comes) arriving.push(t);
        else if (!corner) along.push(t);
      }
      const near = along.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid)).slice(0, 1);
      for (const t of arriving.length ? arriving : near) add(at(t), [dx, dy], -1, -1);
      // the dots just outside: a street or lane, neighbouring sites
      const outside = [];
      for (let t = a; t <= b; t++) {
        const [px, py] = at(t);
        outside.push({ t, n: this.grid.nodeAt(px + dx * 0.5, py + dy * 0.5) });
      }
      const road = outside.find((o) => walkable(o.n));
      if (road) add(at(mid), [dx, dy], road.n, -1);
      const shared = new Map();
      for (const { t, n } of outside) {
        const o = n >= 0 ? this.structureAt(n) : null;
        if (!o || o.id === s.id || !STRUCTURE_TYPES[o.type]?.site) continue;
        if (!shared.has(o.id)) shared.set(o.id, []);
        shared.get(o.id).push(t);
      }
      for (const [id, ts] of shared) add(at((Math.min(...ts) + Math.max(...ts)) / 2), [dx, dy], -1, id);
    }
    const out = { hub: fineAt(cx, cy), hubPos: [cx, cy], half: Math.min(x1 - x0, y1 - y0) / 2 + 0.5, exits };
    this.siteCache.map.set(key, out);
    return out;
  }

  // Which way a structure's front looks: { door, dir: [dx, dy], road }.
  // Towards its road if it has one (road = that road dot), else towards the
  // nearest footpath within 1.5 dots (road = -1), else null.
  frontFor(nodes) {
    const access = this.accessFor(nodes);
    if (access) {
      const [dx, dy] = this.grid.xy(access.door);
      const [rx, ry] = this.grid.xy(access.road);
      const ox = Math.sign(rx - dx), oy = Math.sign(ry - dy);
      return { door: access.door, dir: ox !== 0 ? [ox, 0] : [0, oy], road: access.road };
    }
    const own = new Set(nodes);
    for (let k = 1; k <= 3; k++) {
      for (const n of nodes) {
        const [x, y] = this.grid.xy(n);
        for (const [dx, dy] of ORTHO) {
          if (own.has(this.grid.offset(n, dx, dy))) continue; // an inner side
          const fx = 2 * x + k * dx, fy = 2 * y + k * dy;
          if (this.fine.inBounds(fx, fy) && this.paths.hasNode(this.fine.index(fx, fy))) return { door: n, dir: [dx, dy], road: -1 };
        }
      }
    }
    return null;
  }

  // Rotation a building is drawn with: single-dot buildings turn their front
  // (local -y) towards the road they use, or without one towards a footpath,
  // then `turn` more quarter turns (the player's choice, s.data.turn: side
  // or back to the road); larger ones keep their placed rotation.
  facingRotation(type, node, rotation = 0, turn = 0) {
    const nodes = this.footprintNodes(type, node, rotation);
    if (nodes.length > 1) return rotation;
    const front = this.frontFor(nodes);
    if (!front) return rotation;
    const [ox, oy] = front.dir;
    const base = ox !== 0 ? (ox > 0 ? 1 : 3) : oy > 0 ? 2 : 0;
    return (base + turn) % 4;
  }

  // The rotation structure s is drawn with (see facingRotation).
  drawnRotation(s) {
    return this.facingRotation(s.type, s.node, s.rotation, s.data?.turn ?? 0);
  }

  // Map exits: roads that end at the edge of the map continue off it.
  // Returns [{ node, dir: [dx, dy] }] with dir pointing off the map.
  roadExits() {
    const layer = this.networks.road;
    if (this._exits?.version === layer.version) return this._exits.list;
    const list = this.edgeExits(this.roads, this.grid);
    this._exits = { version: layer.version, list };
    return list;
  }

  // Railways that run off the map edge, like roadExits().
  railExits() {
    const layer = this.networks.rail;
    if (this._railExits?.version === layer.version) return this._railExits.list;
    const list = this.edgeExits(this.rails, this.fine);
    this._railExits = { version: layer.version, list };
    return list;
  }

  edgeExits(graph, grid) {
    const { width, height } = grid;
    const list = [];
    for (const n of graph.nodes()) {
      if (graph.degree(n) !== 1) continue;
      const [x, y] = grid.xy(n);
      const dir = x === 0 ? [-1, 0] : x === width - 1 ? [1, 0] : y === 0 ? [0, -1] : y === height - 1 ? [0, 1] : null;
      if (dir) list.push({ node: n, dir });
    }
    return list;
  }

  accessNode(s) {
    return this.accessInfo(s)?.road ?? -1;
  }

  isConnected(s) {
    return this.accessInfo(s) !== null;
  }

  // A footpath within 1.5 dots of the footprint.
  hasPathAccess(s) {
    for (const n of this.nodesOf(s)) {
      const [x, y] = this.grid.xy(n);
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy > 9) continue;
          const fx = 2 * x + dx, fy = 2 * y + dy;
          if (this.fine.inBounds(fx, fy) && this.paths.hasNode(this.fine.index(fx, fy))) return true;
        }
      }
    }
    return false;
  }

  // Reachable enough to work and grow: a road, or for `access: 'any'`
  // structures (homes, shops, parks…) a footpath is fine too – people walk
  // or cycle there, nobody drives.
  isServed(s) {
    if (this.isConnected(s)) return true;
    return STRUCTURE_TYPES[s.type]?.access === 'any' && this.hasPathAccess(s);
  }

  // ---------- mutations ----------

  placeStructure(type, node, { rotation = 0, level = 1, seed = newSeed(), data = {} } = {}) {
    if (!this.canPlaceStructure(type, node, rotation).ok) return null;
    const s = { id: this.nextId++, type, node, rotation, level, seed, data };
    this._insertStructure(s);
    this.nodesOf(s).forEach((n) => this.clearFeaturesAt(n));
    STRUCTURE_TYPES[type].placed?.(this, s); // e.g. a station lays its track
    this.events.emit('structure:added', s);
    return s;
  }

  removeStructure(id) {
    const s = this.structures.get(id);
    if (!s) return false;
    this._unindexStructure(s);
    this.structures.delete(id);
    this.events.emit('structure:removed', s);
    return true;
  }

  // manual = set by the player; locks automatic growth for this building.
  setStructureLevel(id, level, { manual = false } = {}) {
    const s = this.structures.get(id);
    if (!s) return false;
    const next = Math.min(Math.max(level, 1), maxLevel(STRUCTURE_TYPES[s.type]));
    if (manual) s.data.locked = true;
    if (next === s.level && !manual) return false;
    s.level = next;
    s.data.growth = 0;
    this.events.emit('structure:changed', s);
    return true;
  }

  // Surroundings override: a style id from structures/yards.js, 'none', or null for automatic.
  setYard(id, style) {
    const s = this.structures.get(id);
    if (!s) return;
    if (style) s.data.yard = style;
    else delete s.data.yard;
    this.events.emit('structure:changed', s);
  }

  // Give a building a new random look.
  restyleStructure(id) {
    const s = this.structures.get(id);
    if (!s) return;
    s.seed = newSeed();
    this.events.emit('structure:changed', s);
  }

  setGrowthLocked(id, locked) {
    const s = this.structures.get(id);
    if (!s) return;
    s.data.locked = locked;
    s.data.growth = 0;
    this.events.emit('structure:changed', s);
  }

  canConvert(id, type) {
    const s = this.structures.get(id);
    if (!s || s.type === type) return { ok: false, reason: 'Same type' };
    return this.canPlaceStructure(type, s.node, s.rotation, s.id);
  }

  convertStructure(id, type) {
    if (!this.canConvert(id, type).ok) return false;
    const s = this.structures.get(id);
    this._unindexStructure(s);
    s.type = type;
    s.level = Math.min(s.level, maxLevel(STRUCTURE_TYPES[type]));
    s.data.growth = 0;
    this._insertStructure(s);
    this.nodesOf(s).forEach((n) => this.clearFeaturesAt(n));
    this.events.emit('structure:changed', s);
    return true;
  }

  addFeature(type, node, props = {}) {
    if (!FEATURE_TYPES[type] || node < 0 || this.featureAt(node)) return null;
    const f = { id: this.nextId++, type, node, ox: 0, oy: 0, variant: 0, scale: 1, ...props };
    this._insertFeature(f);
    this.events.emit('feature:added', f);
    return f;
  }

  removeFeature(id) {
    const f = this.features.get(id);
    if (!f) return false;
    this.features.delete(id);
    this.featureAtNode.delete(f.node);
    this.events.emit('feature:removed', f);
    return true;
  }

  clearFeaturesAt(node) {
    const f = this.featureAt(node);
    if (f && FEATURE_TYPES[f.type]?.clearable !== false) this.removeFeature(f.id);
  }

  // `nodes` is an ordered list of adjacent nodes on that layer's grid.
  // Footpaths drawn on or right beside a road become that road's sidewalks
  // (see absorbSidewalks). Roads: `lane` builds single-track lanes; drawn
  // over existing road, a lane narrows it and a road widens a lane.
  buildNetwork(kind, nodes, { lane = false } = {}) {
    const layer = this.networks[kind];
    const check = validateRoute(layer, nodes);
    if (!check.ok) return check;
    for (const n of nodes) {
      // a railway clears the trees along its way, also between dots
      if (kind === 'rail') this.coarseAround(n).forEach((c) => this.clearFeaturesAt(c));
      const c = layer.coarseOf(n);
      if (c >= 0) this.clearFeaturesAt(c);
    }
    for (let i = 0; i < nodes.length - 1; i++) {
      layer.graph.addEdge(nodes[i], nodes[i + 1]);
      if (kind !== 'road') continue;
      const key = edgeKey(nodes[i], nodes[i + 1]);
      // a street narrowed to a lane keeps a sidewalk each side; a lane
      // widened with any sidewalk becomes a street
      if (lane) {
        if (this.sidewalks.delete(key)) this.laneWalks.set(key, 3);
        this.lanes.add(key);
      } else if (this.lanes.delete(key) && this.laneWalks.delete(key)) this.sidewalks.add(key);
    }
    // a footpath drawn right on a lane gives it a sidewalk on the right of
    // the way it was drawn (draw back the other way for the other side)
    if (kind === 'path') {
      for (let i = 0; i < nodes.length - 1; i++) {
        const [fx, fy] = this.fine.xy(nodes[i]), [gx, gy] = this.fine.xy(nodes[i + 1]);
        const road = this.roadOn(fx, fy, gx, gy);
        if (!road || !this.isLane(...road)) continue;
        const [lo, hi] = road[0] < road[1] ? road : [road[1], road[0]];
        const [lx, ly] = this.grid.xy(lo), [hx, hy] = this.grid.xy(hi);
        const key = edgeKey(...road);
        // (with y down, the right of the way is the + offset side of lo -> hi)
        const side = (gx - fx) * (hx - lx) + (gy - fy) * (hy - ly) > 0 ? 1 : 2;
        this.laneWalks.set(key, (this.laneWalks.get(key) ?? 0) | side);
      }
    }
    this.absorbSidewalks(kind !== 'path'); // a path build announces itself below
    layer.version++;
    this.events.emit(layer.event, { layer, nodes });
    return check;
  }

  removeNetworkAt(kind, node) {
    const layer = this.networks[kind];
    if (!layer.graph.hasNode(node)) return false;
    const nodes = [node, ...layer.graph.neighbors(node)];
    layer.graph.removeNode(node);
    nodes.push(...this.pruneBridges(layer, nodes));
    if (kind === 'road') {
      for (const set of [this.sidewalks, this.lanes, this.laneWalks]) {
        // (keys(): laneWalks is a Map, the others Sets)
        for (const k of [...set.keys()]) if (!this.roads.hasEdge(...k.split('-').map(Number))) set.delete(k);
      }
    }
    layer.version++;
    this.events.emit(layer.event, { layer, nodes });
    return true;
  }

  // ---------- streets (roads with sidewalks) ----------

  // Footpath segments that run along a road – on its dots or on the row of
  // dense dots right beside it – are really sidewalks: remove them from the
  // footpaths and make those road segments streets instead. Runs after every
  // build and on load, so it doesn't matter which was drawn first.
  // Lanes keep their narrow look: a footpath beside one becomes a sidewalk
  // on that side only (draw one each side for two), and one right on it is
  // taken in by it (drawn on it, it gave it a sidewalk, see buildNetwork;
  // a lane drawn over a footpath just upgrades it).
  absorbSidewalks(notify = true) {
    const streets = [], walked = [];
    const gone = [];
    for (const [f, g] of this.paths.edges()) {
      const road = this.roadBeside(f, g);
      if (!road) continue;
      if (this.isLane(...road)) {
        const side = this.sideOf(f, g, road);
        if (side) {
          this.laneWalks.set(edgeKey(...road), (this.laneWalks.get(edgeKey(...road)) ?? 0) | side);
          walked.push(road);
        }
      } else streets.push(road);
      gone.push(f, g);
      this.paths.removeEdge(f, g);
    }
    if (!gone.length) return false;
    for (const [a, b] of streets) this.sidewalks.add(edgeKey(a, b));
    this.networks.road.version++;
    if (notify) {
      const path = this.networks.path;
      path.version++;
      this.events.emit(path.event, { layer: path, nodes: gone });
    }
    this.events.emit('roads:changed', { layer: this.networks.road, nodes: [...streets, ...walked].flat(), sidewalks: true });
    return true;
  }

  // The road segment [a, b] that the footpath step f -> g runs along (on it,
  // or parallel right beside it), or null.
  roadBeside(f, g) {
    const [fx, fy] = this.fine.xy(f);
    const [gx, gy] = this.fine.xy(g);
    for (const [dx, dy] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      // (sideways only: a footpath carrying straight on from a road's end
      // isn't beside it)
      if ((dx || dy) && dx * (gy - fy) === dy * (gx - fx)) continue;
      const road = this.roadOn(fx + dx, fy + dy, gx + dx, gy + dy);
      if (road) return road;
    }
    return null;
  }

  // Which side of road segment [a, b] the footpath step f -> g runs on: 1
  // left of the way from the lower dot to the higher, 2 right, 0 on it
  // (the bits of laneWalks).
  sideOf(f, g, [a, b]) {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const [lx, ly] = this.grid.xy(lo), [hx, hy] = this.grid.xy(hi);
    const [fx, fy] = this.fine.xy(f), [gx, gy] = this.fine.xy(g);
    const mx = (fx + gx) / 4 - lx, my = (fy + gy) / 4 - ly; // (dense dots are half a dot apart)
    const cross = (hx - lx) * my - (hy - ly) * mx;
    return Math.abs(cross) < 1e-6 ? 0 : cross > 0 ? 1 : 2;
  }

  // The road segment covering the dense-grid step (fx, fy) -> (gx, gy), or
  // null. A road segment spans three dense dots: its two ends and its middle.
  roadOn(fx, fy, gx, gy) {
    const even = (x, y) => x % 2 === 0 && y % 2 === 0;
    const [end, mid] = even(fx, fy) ? [[fx, fy], [gx, gy]] : [[gx, gy], [fx, fy]];
    if (!even(...end) || even(...mid)) return null;
    const ax = end[0] / 2, ay = end[1] / 2;
    const bx = mid[0] - ax, by = mid[1] - ay;
    if (!this.grid.inBounds(ax, ay) || !this.grid.inBounds(bx, by)) return null;
    const a = this.grid.index(ax, ay);
    const b = this.grid.index(bx, by);
    return this.roads.hasEdge(a, b) ? [a, b] : null;
  }

  hasSidewalk(a, b) {
    return this.sidewalks.has(edgeKey(a, b));
  }

  isLane(a, b) {
    return this.lanes.has(edgeKey(a, b));
  }

  // Does side s (0 left, 1 right of the way from the lower dot, as in
  // roadEdges' keys) of road segment [a, b] have a sidewalk?
  hasKerb(a, b, s) {
    const key = edgeKey(a, b);
    return this.sidewalks.has(key) || !!((this.laneWalks.get(key) ?? 0) & (1 << s));
  }

  // Road dot where only lanes meet.
  laneOnly(node) {
    const ms = [...this.roads.neighbors(node)];
    return ms.length > 0 && ms.every((m) => this.isLane(node, m));
  }

  // Half the width of the road at a dot: its widest segment there.
  roadHalfWidth(node) {
    return this.laneOnly(node) ? CONFIG.lane.edge : CONFIG.road.edge;
  }

  // Road segments at a road dot with sidewalks (streets, lanes with one).
  sidewalksAt(node) {
    return [...this.roads.neighbors(node)].filter((m) => this.hasSidewalk(node, m) || this.laneWalks.has(edgeKey(node, m))).map((m) => [node, m]);
  }

  setSidewalks(edges, on) {
    let changed = false;
    for (const [a, b] of edges) {
      const key = edgeKey(a, b);
      if (!on && this.laneWalks.delete(key)) changed = true;
      if (on === this.sidewalks.has(key) || (on && (!this.roads.hasEdge(a, b) || this.lanes.has(key)))) continue;
      if (on) this.sidewalks.add(key);
      else this.sidewalks.delete(key);
      changed = true;
    }
    if (!changed) return false;
    const layer = this.networks.road;
    layer.version++;
    this.events.emit(layer.event, { layer, nodes: edges.flat(), sidewalks: true });
    return true;
  }

  buildRoad(nodes, options) {
    return this.buildNetwork('road', nodes, options);
  }

  removeRoadAt(node) {
    return this.removeNetworkAt('road', node);
  }

  // ---------- persistence ----------

  _insertStructure(s) {
    this.structureVersion = (this.structureVersion ?? 0) + 1;
    this.structures.set(s.id, s);
    for (const n of this.nodesOf(s)) this.structureAtNode.set(n, s.id);
  }

  _unindexStructure(s) {
    this.structureVersion = (this.structureVersion ?? 0) + 1;
    for (const n of this.nodesOf(s)) {
      if (this.structureAtNode.get(n) === s.id) this.structureAtNode.delete(n);
    }
  }

  _insertFeature(f) {
    this.features.set(f.id, f);
    this.featureAtNode.set(f.node, f.id);
  }

  rename(name) {
    name = name.trim();
    if (!name || name === this.name) return;
    this.name = name;
    this.events.emit('world:renamed', name);
  }

  toJSON() {
    return {
      version: SAVE_VERSION,
      seed: this.seed,
      name: this.name,
      hilliness: this.hilliness,
      rockiness: this.rockiness,
      width: this.grid.width,
      height: this.grid.height,
      nextId: this.nextId,
      terrain: this.terrain.toJSON(),
      networks: Object.fromEntries(Object.entries(this.networks).map(([k, l]) => [k, l.graph.toJSON()])),
      sidewalks: [...this.sidewalks],
      lanes: [...this.lanes],
      laneWalks: [...this.laneWalks],
      structures: [...this.structures.values()],
      features: [...this.features.values()],
      time: Math.round(this.time),
      story: this.story,
      chronicle: this.chronicle,
    };
  }

  static fromJSON(data) {
    if (data.version > SAVE_VERSION) throw new Error(`Save is from a newer version (${data.version})`);
    const world = new World({ ...data, rockiness: data.rockiness ?? 0 }); // (older saves: no rock, their ground stays as built on)
    world.terrain.load(data.terrain);

    const networks = data.networks ?? { road: data.roads ?? [] }; // v1 had only roads
    // before v3 railways were on the main dots: each segment spans three dense ones
    if ((data.version ?? 1) < 3 && networks.rail) networks.rail = networks.rail.flatMap((e) => world.fineSegment(...e));
    for (const [kind, edges] of Object.entries(networks)) {
      if (world.networks[kind]) {
        world.networks[kind].graph = RoadNetwork.fromJSON(edges);
        world.networks[kind].version++;
      }
    }

    for (const key of data.lanes ?? []) {
      const [a, b] = key.split('-').map(Number);
      if (world.roads.hasEdge(a, b)) world.lanes.add(key);
    }
    for (const key of data.sidewalks ?? []) {
      const [a, b] = key.split('-').map(Number);
      if (world.roads.hasEdge(a, b) && !world.lanes.has(key)) world.sidewalks.add(key);
    }
    for (const [key, sides] of data.laneWalks ?? []) if (world.lanes.has(key)) world.laneWalks.set(key, sides);
    world.absorbSidewalks(false); // footpaths drawn beside roads before streets existed

    for (const s of data.structures) {
      if (!STRUCTURE_TYPES[s.type]) continue;
      s.rotation ??= 0;
      s.level ??= 1;
      s.seed ??= Math.imul(s.id, 2654435761) >>> 0;
      s.data ??= {};
      // Stations saved facing away from their track: turn them round.
      const rule = STRUCTURE_TYPES[s.type].canPlace;
      const fits = rule?.(world, world.footprintNodes(s.type, s.node, s.rotation), s.rotation);
      if (rule && (!fits.ok || fits.lay)) {
        const at = world.placementFor(s.type, s.node, s.rotation);
        if (at.check.ok) [s.node, s.rotation] = [at.node, at.rotation];
      }
      // Footprints may have grown since the save was made; skip what no longer fits.
      if (world.fitsStructure(s.type, s.node, s.rotation).ok) world._insertStructure(s);
      else console.warn(`Dropped ${s.type} #${s.id}: no longer fits`);
    }
    for (const f of data.features) {
      if (FEATURE_TYPES[f.type] && !world.structureAt(f.node)) world._insertFeature(f);
    }
    world.nextId = data.nextId;
    world.time = data.time ?? 0;
    world.story = { seen: data.story?.seen ?? [], vars: data.story?.vars ?? {}, unlocks: data.story?.unlocks ?? [] };
    world.chronicle = { entries: data.chronicle?.entries ?? [], marks: data.chronicle?.marks ?? [] };
    return world;
  }
}
