// The single source of truth for game state. Everything that changes the
// world goes through a World method, which validates it and emits an event.
// Everything here is plain data and round-trips through toJSON/fromJSON.
//
// Two grids:
//   grid – the main dots (buildings, roads, railways)
//   fine – twice as dense (footpaths). Fine node (2x, 2y) sits on main dot (x, y).

import { EventBus } from './events.js';
import { Grid, ORTHO, DIAG } from './grid.js';
import { Terrain } from '../terrain/terrain.js';
import { RoadNetwork, edgeKey } from '../roads/network.js';
import { NetworkLayer } from '../roads/layer.js';
import { validateRoute } from '../roads/routing.js';
import { STRUCTURE_TYPES, footprintOffsets, maxLevel, newSeed } from '../../structures/index.js';
import { mulberry32 } from './random.js';
import { FEATURE_TYPES } from '../../features/index.js';

export const SAVE_VERSION = 2;

export class World {
  constructor({ width, height, seed = 1 }) {
    this.seed = seed;
    this.events = new EventBus();
    this.grid = new Grid(width, height);
    this.fine = new Grid(2 * width - 1, 2 * height - 1);
    this.terrain = new Terrain(this.grid);
    this.structures = new Map();      // id -> { id, type, node, rotation, level, seed, data }
    this.features = new Map();        // id -> { id, type, node, ox, oy, variant, scale }
    this.structureAtNode = new Map(); // node -> structure id (every footprint node)
    this.featureAtNode = new Map();   // node -> feature id
    this.nextId = 1;

    this.sidewalks = new Set(); // edgeKey of road segments that are streets (have sidewalks)

    this.networks = {
      road: new NetworkLayer({
        id: 'road',
        grid: this.grid,
        scale: 1,
        isBlocked: (n) => this.isRoadBlocked(n),
        conflicts: (a, b) => this.rails.hasEdge(a, b),
        coarseOf: (n) => n,
        event: 'roads:changed',
      }),
      // Railways cross roads on a shared dot (a level crossing) but never
      // share a segment with one.
      rail: new NetworkLayer({
        id: 'rail',
        grid: this.grid,
        scale: 1,
        isBlocked: (n) => this.isRoadBlocked(n),
        conflicts: (a, b) => this.roads.hasEdge(a, b),
        maxTurn: Math.PI / 4,
        coarseOf: (n) => n,
        event: 'rails:changed',
      }),
      path: new NetworkLayer({
        id: 'path',
        grid: this.fine,
        scale: 0.5,
        isBlocked: (f) => this.isPathBlocked(f),
        coarseOf: (f) => this.fineToCoarse(f),
        event: 'paths:changed',
      }),
    };
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

  hasRail(node) {
    return this.rails.hasNode(node);
  }

  footprintNodes(type, node, rotation = 0) {
    return footprintOffsets(STRUCTURE_TYPES[type], rotation).map(([dx, dy]) => this.grid.offset(node, dx, dy));
  }

  nodesOf(s) {
    return this.footprintNodes(s.type, s.node, s.rotation);
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

  isPathBlocked(f) {
    const around = this.coarseAround(f);
    if (around.some((c) => this.terrain.isWater(c))) return true;
    // Blocked only if every surrounding dot belongs to the same building,
    // so paths can squeeze between neighbouring buildings.
    const ids = around.map((c) => this.structureAtNode.get(c));
    return ids[0] !== undefined && ids.every((id) => id === ids[0]);
  }

  // Free ground for the footprint, plus the type's own rule (def.canPlace,
  // e.g. a station needs track alongside).
  canPlaceStructure(type, node, rotation = 0, ignoreId = null) {
    const fits = this.fitsStructure(type, node, rotation, ignoreId);
    const rule = STRUCTURE_TYPES[type]?.canPlace;
    return fits.ok && rule ? rule(this, this.footprintNodes(type, node, rotation), rotation) : fits;
  }

  // Where to put a structure the player points at: as asked, or – for types
  // with their own rule (a station must face its track) – turned half round
  // over the same dots if only that fits. { node, rotation, check }.
  placementFor(type, node, rotation = 0) {
    const check = this.canPlaceStructure(type, node, rotation);
    if (check.ok || !STRUCTURE_TYPES[type]?.canPlace || node < 0) return { node, rotation, check };
    const offs = footprintOffsets(STRUCTURE_TYPES[type], rotation);
    const [sx, sy] = [0, 1].map((k) => Math.min(...offs.map((o) => o[k])) + Math.max(...offs.map((o) => o[k])));
    const flipped = this.grid.offset(node, sx, sy);
    const turned = (rotation + 2) % 4;
    if (flipped >= 0 && this.canPlaceStructure(type, flipped, turned).ok) {
      return { node: flipped, rotation: turned, check: { ok: true } };
    }
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
      if (this.hasRail(n)) return { ok: false, reason: 'Railway' };
      const f = this.featureAt(n);
      if (f && FEATURE_TYPES[f.type]?.clearable === false) return { ok: false, reason: 'Blocked' };
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
          if (m >= 0 && this.hasRoad(m)) return { door: n, road: m };
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

  // Walkable paths through a site (park, square): exits in the middle of the
  // footprint's sides, on the footpath grid, joined at a hub in the middle.
  // Sides facing a road or touched by a footpath always get an exit; the
  // rest are picked by seed, more with level (1 + level, max 4).
  //   { hub, exits: [{ node, pos: [x, y], dir: [dx, dy], road }] }
  // node = fine-grid index; road = main-grid road node the exit leads to, or -1.
  sitePaths(s) {
    const pts = this.nodesOf(s).map((n) => this.grid.xy(n));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const fineAt = (x, y) => (this.fine.inBounds(2 * x, 2 * y) ? this.fine.index(2 * x, 2 * y) : -1);

    const sides = [
      { pos: [x0 - 0.5, cy], dir: [-1, 0] },
      { pos: [x1 + 0.5, cy], dir: [1, 0] },
      { pos: [cx, y0 - 0.5], dir: [0, -1] },
      { pos: [cx, y1 + 0.5], dir: [0, 1] },
    ].map((e) => {
      const node = fineAt(...e.pos);
      const r = this.grid.nodeAt(e.pos[0] + e.dir[0] * 0.5, e.pos[1] + e.dir[1] * 0.5);
      return { ...e, node, road: r >= 0 && this.hasRoad(r) ? r : -1 };
    }).filter((e) => e.node >= 0);

    const rng = mulberry32(s.seed ^ 0x7a11);
    const order = sides.map((e) => ({ e, k: (e.road >= 0 || this.paths.hasNode(e.node) ? -1 : 0) + rng() }));
    order.sort((a, b) => a.k - b.k);
    const forced = order.filter((o) => o.k < 0).length;
    const exits = order.slice(0, Math.max(forced, Math.min(4, 1 + (s.level ?? 1)))).map((o) => o.e);
    return { hub: fineAt(cx, cy), hubPos: [cx, cy], exits };
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
  // (local -y) towards the road they use, or without one towards a footpath;
  // larger ones keep their placed rotation.
  facingRotation(type, node, rotation = 0) {
    const nodes = this.footprintNodes(type, node, rotation);
    if (nodes.length > 1) return rotation;
    const front = this.frontFor(nodes);
    if (!front) return rotation;
    const [ox, oy] = front.dir;
    if (ox !== 0) return ox > 0 ? 1 : 3;
    return oy > 0 ? 2 : 0;
  }

  // Map exits: roads that end at the edge of the map continue off it.
  // Returns [{ node, dir: [dx, dy] }] with dir pointing off the map.
  roadExits() {
    const layer = this.networks.road;
    if (this._exits?.version === layer.version) return this._exits.list;
    const list = this.edgeExits(this.roads);
    this._exits = { version: layer.version, list };
    return list;
  }

  // Railways that run off the map edge, like roadExits().
  railExits() {
    const layer = this.networks.rail;
    if (this._railExits?.version === layer.version) return this._railExits.list;
    const list = this.edgeExits(this.rails);
    this._railExits = { version: layer.version, list };
    return list;
  }

  edgeExits(graph) {
    const { width, height } = this.grid;
    const list = [];
    for (const n of graph.nodes()) {
      if (graph.degree(n) !== 1) continue;
      const [x, y] = this.grid.xy(n);
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
  // (see absorbSidewalks).
  buildNetwork(kind, nodes) {
    const layer = this.networks[kind];
    const check = validateRoute(layer, nodes);
    if (!check.ok) return check;
    for (const n of nodes) {
      const c = layer.coarseOf(n);
      if (c >= 0) this.clearFeaturesAt(c);
    }
    for (let i = 0; i < nodes.length - 1; i++) layer.graph.addEdge(nodes[i], nodes[i + 1]);
    this.absorbSidewalks(kind !== 'path'); // a path build announces itself below
    layer.version++;
    this.events.emit(layer.event, { layer, nodes });
    return check;
  }

  removeNetworkAt(kind, node) {
    const layer = this.networks[kind];
    if (!layer.graph.hasNode(node)) return false;
    const nodes = [node, ...layer.graph.neighbors(node)];
    if (kind === 'road') for (const m of nodes) this.sidewalks.delete(edgeKey(node, m));
    layer.graph.removeNode(node);
    layer.version++;
    this.events.emit(layer.event, { layer, nodes });
    return true;
  }

  // ---------- streets (roads with sidewalks) ----------

  // Footpath segments that run along a road – on its dots or on the row of
  // dense dots right beside it – are really sidewalks: remove them from the
  // footpaths and make those road segments streets instead. Runs after every
  // build and on load, so it doesn't matter which was drawn first.
  absorbSidewalks(notify = true) {
    const streets = [];
    const gone = [];
    for (const [f, g] of this.paths.edges()) {
      const road = this.roadBeside(f, g);
      if (!road) continue;
      streets.push(road);
      gone.push(f, g);
      this.paths.removeEdge(f, g);
    }
    if (!streets.length) return false;
    for (const [a, b] of streets) this.sidewalks.add(edgeKey(a, b));
    this.networks.road.version++;
    if (notify) {
      const path = this.networks.path;
      path.version++;
      this.events.emit(path.event, { layer: path, nodes: gone });
    }
    this.events.emit('roads:changed', { layer: this.networks.road, nodes: streets.flat(), sidewalks: true });
    return true;
  }

  // The road segment [a, b] that the footpath step f -> g runs along (on it,
  // or parallel right beside it), or null.
  roadBeside(f, g) {
    const [fx, fy] = this.fine.xy(f);
    const [gx, gy] = this.fine.xy(g);
    for (const [dx, dy] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const road = this.roadOn(fx + dx, fy + dy, gx + dx, gy + dy);
      if (road) return road;
    }
    return null;
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

  // Road segments at a road dot that are streets.
  sidewalksAt(node) {
    return [...this.roads.neighbors(node)].filter((m) => this.hasSidewalk(node, m)).map((m) => [node, m]);
  }

  setSidewalks(edges, on) {
    let changed = false;
    for (const [a, b] of edges) {
      const key = edgeKey(a, b);
      if (on === this.sidewalks.has(key) || (on && !this.roads.hasEdge(a, b))) continue;
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

  buildRoad(nodes) {
    return this.buildNetwork('road', nodes);
  }

  removeRoadAt(node) {
    return this.removeNetworkAt('road', node);
  }

  // ---------- persistence ----------

  _insertStructure(s) {
    this.structures.set(s.id, s);
    for (const n of this.nodesOf(s)) this.structureAtNode.set(n, s.id);
  }

  _unindexStructure(s) {
    for (const n of this.nodesOf(s)) {
      if (this.structureAtNode.get(n) === s.id) this.structureAtNode.delete(n);
    }
  }

  _insertFeature(f) {
    this.features.set(f.id, f);
    this.featureAtNode.set(f.node, f.id);
  }

  toJSON() {
    return {
      version: SAVE_VERSION,
      seed: this.seed,
      width: this.grid.width,
      height: this.grid.height,
      nextId: this.nextId,
      terrain: this.terrain.toJSON(),
      networks: Object.fromEntries(Object.entries(this.networks).map(([k, l]) => [k, l.graph.toJSON()])),
      sidewalks: [...this.sidewalks],
      structures: [...this.structures.values()],
      features: [...this.features.values()],
    };
  }

  static fromJSON(data) {
    if (data.version > SAVE_VERSION) throw new Error(`Save is from a newer version (${data.version})`);
    const world = new World(data);
    world.terrain.load(data.terrain);

    const networks = data.networks ?? { road: data.roads ?? [] }; // v1 had only roads
    for (const [kind, edges] of Object.entries(networks)) {
      if (world.networks[kind]) {
        world.networks[kind].graph = RoadNetwork.fromJSON(edges);
        world.networks[kind].version++;
      }
    }

    for (const key of data.sidewalks ?? []) {
      const [a, b] = key.split('-').map(Number);
      if (world.roads.hasEdge(a, b)) world.sidewalks.add(key);
    }
    world.absorbSidewalks(false); // footpaths drawn beside roads before streets existed

    for (const s of data.structures) {
      if (!STRUCTURE_TYPES[s.type]) continue;
      s.rotation ??= 0;
      s.level ??= 1;
      s.seed ??= Math.imul(s.id, 2654435761) >>> 0;
      s.data ??= {};
      // Stations saved facing away from their track: turn them round.
      const rule = STRUCTURE_TYPES[s.type].canPlace;
      if (rule && !rule(world, world.footprintNodes(s.type, s.node, s.rotation), s.rotation).ok) {
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
    return world;
  }
}
