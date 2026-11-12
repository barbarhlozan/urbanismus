// The single source of truth for game state. Everything that changes the
// world goes through a World method, which validates it and emits an event.
// Everything here is plain data and round-trips through toJSON/fromJSON.
//
// Two grids:
//   grid – the main dots (buildings, roads)
//   fine – twice as dense (footpaths, railways – so their curves can be
//          gentler). Fine node (2x, 2y) sits on main dot (x, y).
//
// This file keeps the set-up, the grid and the lookups, saving and loading;
// the rest of World's methods are in ./world/, by topic: networks.js
// (roads, paths, rails, fences, bridges, sidewalks), placement.js (what may
// be built where), access.js (sites, exits, facing, access) and
// structures.js (placing, fire, removing, converting; features). Each is a
// class whose methods are copied onto World.prototype (at the end), so all
// share `this`.

import { EventBus } from './events.js';
import { CONFIG } from '../config.js';
import { townName } from './townName.js';
import { Grid } from './grid.js';
import { Terrain } from '../terrain/terrain.js';
import { findHills } from '../terrain/hills.js';
import { RoadNetwork } from '../roads/network.js';
import { NetworkLayer } from '../roads/layer.js';
import { STRUCTURE_TYPES, footprintOffsets } from '../../structures/index.js';
import { upgrade, upgradeMarks, unretire, regroup, rehouse, refarm, repub, repark, reshop } from './legacy.js';
import { FEATURE_TYPES } from '../../features/index.js';
import { History } from './history.js';
import { WorldNetworks } from './world/networks.js';
import { WorldPlacement } from './world/placement.js';
import { WorldAccess } from './world/access.js';
import { WorldStructures } from './world/structures.js';

const SAVE_VERSION = 10; // 3: railways on the fine grid; 4: no building levels (legacy.js); 5: parks regrouped; 6: houses regrouped; 7: farmstead layouts; 8: pub kinds; 9: parks and squares cut; 10: shop kinds

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
    this.structures = new Map();      // id -> { id, type, node, rotation, seed, data }
    this.features = new Map();        // id -> { id, type, node, ox, oy, variant, scale }
    this.structureAtNode = new Map(); // node -> structure id (every footprint node)
    this.featureAtNode = new Map();   // node -> feature id
    this.nextId = 1;
    this.nextNo = 1; // the next house number (numberStructure); a number gone with its building isn't given again
    this.time = 0; // simulated seconds the town has been running (the clock, kept in the save)
    this.weather = { kind: 'fair', from: 'fair', since: 0, until: 0, n: 0 }; // the weather now, the one before, since and until when (world.time), and how many changes so far (src/sim/weather.js)
    this.story = { seen: [], vars: {}, unlocks: [], places: {} }; // what the story has told, set, unlocked and picked (src/story/)
    this.chronicle = { entries: [], marks: [] }; // the town's chronicle (src/sim/chronicle.js)
    this.history = new History(this); // undo and redo of the player's changes; every change below calls history.touch() first

    this.sidewalks = new Set(); // edgeKey of road segments that are streets (have sidewalks)
    this.lanes = new Set();     // edgeKey of road segments that are single-track lanes (never streets)
    this.laneWalks = new Map(); // edgeKey of lanes -> sides with a sidewalk: bit 1 left of the way from
                                // the lower dot to the higher (offsetPolyline +), bit 2 right

    this.networks = {
      road: new NetworkLayer({
        id: 'road',
        grid: this.grid,
        scale: 1,
        isBlocked: (n) => this.isRoadBlocked(n),
        conflicts: (a, b) => this.railAlong(a, b),
        steep: (a, b, { lane = false } = {}) => this.grade(this.networks.road, a, b) > (lane ? CONFIG.steep.lane : CONFIG.steep.road),
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
        // (not along a road: sidewalks come with streets, the Street tool)
        conflicts: (f, g) => !!this.roadOn(...this.fine.xy(f), ...this.fine.xy(g)) || this.rails.hasEdge(f, g),
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
      // Fences round pastures (sim/livestock.js), on the dense dots like
      // footpaths and up any slope. Not along a road or railway (crossing
      // one is allowed, but leaves a gap there), not over water.
      fence: new NetworkLayer({
        id: 'fence',
        grid: this.fine,
        scale: 0.5,
        isBlocked: (f) => this.isPathBlocked(f),
        conflicts: (f, g) => !!this.roadOn(...this.fine.xy(f), ...this.fine.xy(g)) || this.rails.hasEdge(f, g),
        coarseOf: (f) => this.fineToCoarse(f),
        event: 'fences:changed',
      }),
    };
    this.networks.rail.pos = (f) => this.railPos(f);
    this.networks.path.pos = (f) => this.pathPos(f);
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

  get fences() {
    return this.networks.fence.graph;
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
      nextNo: this.nextNo,
      terrain: this.terrain.toJSON(),
      networks: Object.fromEntries(Object.entries(this.networks).map(([k, l]) => [k, l.graph.toJSON()])),
      sidewalks: [...this.sidewalks],
      lanes: [...this.lanes],
      laneWalks: [...this.laneWalks],
      structures: [...this.structures.values()],
      features: [...this.features.values()],
      time: Math.round(this.time),
      weather: this.weather,
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

    for (const s of data.structures) {
      s.rotation ??= 0;
      s.seed ??= Math.imul(s.id, 2654435761) >>> 0;
      s.data ??= {};
      if ((data.version ?? 1) < 4) upgrade(s); // buildings with levels: the structure each level is now
      if ((data.version ?? 1) < 5) regroup(s); // parks: each look to the tool it belongs to now
      if ((data.version ?? 1) < 6) rehouse(s); // houses: village houses and family houses apart
      if ((data.version ?? 1) < 7) refarm(s); // farmsteads: the layout they had
      if ((data.version ?? 1) < 8) repub(s); // pubs: the kind they had, the town pub a village one
      if ((data.version ?? 1) < 9) repark(s); // parks and squares: the kinds cut, the squares one náměstí
      if ((data.version ?? 1) < 10) reshop(s); // Jednota: the kind it had, pavilions and townhouses cut
      unretire(s); // buildings taken out of the game: what replaced them
      if (!STRUCTURE_TYPES[s.type]) continue;
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
    // towns saved before buildings kept their facing: as they stand now
    for (const s of world.structures.values()) if (s.data.face == null) world.faceOnce(s);
    for (const f of data.features) {
      if (FEATURE_TYPES[f.type] && !world.structureAt(f.node)) world._insertFeature(f);
    }
    world.nextId = data.nextId;
    // house numbers: a town saved before them numbers its buildings once,
    // in the order they were built (and any that became buildings since
    // get the next ones)
    world.nextNo = Math.max(data.nextNo ?? 1, ...[...world.structures.values()].map((s) => (s.no ?? 0) + 1));
    for (const s of [...world.structures.values()].sort((a, b) => a.id - b.id)) world.numberStructure(s);
    world.time = data.time ?? 0;
    if (data.weather) world.weather = { kind: data.weather.kind, from: data.weather.from, since: data.weather.since, until: data.weather.until, n: data.weather.n ?? 0 }; // (older saves start fair; without `from` or `since`, WeatherSystem works them out)
    world.story = { seen: data.story?.seen ?? [], vars: data.story?.vars ?? {}, unlocks: data.story?.unlocks ?? [], places: data.story?.places ?? {} };
    const marks = data.chronicle?.marks ?? [];
    world.chronicle = { entries: data.chronicle?.entries ?? [], marks: (data.version ?? 1) < 4 ? upgradeMarks(marks) : marks };
    // how many of the entries have been read, and the book's tab last open
    // (older saves: everything read, the book at its chronicle)
    world.chronicle.seen = data.chronicle?.seen ?? world.chronicle.entries.length;
    if (data.chronicle?.tab) world.chronicle.tab = data.chronicle.tab;
    return world;
  }
}

// World's methods are kept by topic in ./world/ – each file a class
// whose methods are copied onto World.prototype here (all share `this`).
for (const part of [WorldNetworks, WorldPlacement, WorldAccess, WorldStructures]) {
  for (const key of Object.getOwnPropertyNames(part.prototype)) {
    if (key !== 'constructor') Object.defineProperty(World.prototype, key, Object.getOwnPropertyDescriptor(part.prototype, key));
  }
}
