// Structure registry. To add a building: create a file next to this one
// (copy residential.js), then import it and add it to the list below.
// Toolbar buttons, the click menu, hotkeys, growth and the simulation pick it
// up automatically.
//
// Optional definition fields beyond those documented in residential.js:
//   category   toolbar group: 'zone' (default), 'transport', 'civic' or 'heritage' – see CATEGORIES
//   blurb      one line for the Build menu, e.g. 'Homes nearby grow faster'
//   size       label for the Size button when it shares a tool (default Small / Large)
//   tags       extra names growth rules and agents can match, e.g. ['park']
//   access     'road' (default) or 'any' – 'any' also counts a footpath as access
//   code       short prefix for annotations, e.g. 'R' -> "R-012" (default: first letter)
//   site       true = fills its lot up to the road and merges with neighbouring
//              sites; drawings get the area as g.site (parks, squares)
//   canPlace(world, nodes, rotation) -> { ok, reason }
//              extra placement rule on top of free ground (stations need track)
//              When it fails, the build tool also tries the footprint turned
//              half round on the same dots (World.placementFor).
//   railStop   true = trains stop here (stations, src/sim/trains.js)
//   levels[i].coverage   service radius in dots (services)
//   levels[i].yards      surroundings styles it may get (see yards.js)

import { rotateQuarter } from '../src/core/grid.js';
import { mulberry32 } from '../src/core/random.js';
import { YARDS } from './yards.js';
import residential from './residential.js';
import business from './business.js';
import industrial, { small as industrialSmall } from './industrial.js';
import * as park from './park.js';
import * as square from './square.js';
import * as services from './services.js';
import * as heritage from './heritage.js';
import * as station from './station.js';

// Toolbar groups, in toolbar order. The network tools (road, footpath,
// railway) join 'transport' too (src/main.js).
export const CATEGORIES = [
  { id: 'transport', label: 'Transport' },
  { id: 'zone', label: 'Zones' },
  { id: 'civic', label: 'Public' },
  { id: 'heritage', label: 'Landmarks' },
];

export const STRUCTURES = [
  residential, business, industrial, industrialSmall,
  park.small, park.large, square.small, square.large, services.small, services.large, station.station, station.stop,
  heritage.chapel, heritage.church, heritage.townHall, heritage.column,
];

// Build menu entries: sizes of the same thing share one tool (S switches,
// the first is the default). Every structure must be in exactly one.
export const BUILD_FAMILIES = [
  [station.station, station.stop],
  [residential], [business], [industrial, industrialSmall],
  [park.small, park.large], [square.small, square.large], [services.small, services.large],
  [heritage.chapel], [heritage.church], [heritage.townHall], [heritage.column],
];

export const STRUCTURE_TYPES = Object.fromEntries(STRUCTURES.map((s) => [s.id, s]));

export function categoryOf(def) {
  return def.category ?? 'zone';
}

// Does a structure definition answer to `name` (its id or one of its tags)?
export function matches(def, name) {
  return def.id === name || (def.tags ?? []).includes(name);
}

// Display name for a type id or tag used in rules.
export function nameOf(name) {
  return (STRUCTURE_TYPES[name]?.name ?? name).toLowerCase();
}

// Short technical code for annotations, e.g. "R-012".
export function codeOf(s) {
  const def = STRUCTURE_TYPES[s.type];
  const prefix = def?.code ?? s.type[0].toUpperCase();
  return `${prefix}-${String(s.id).padStart(3, '0')}`;
}

export function maxLevel(def) {
  return def.levels.length;
}

// The level definition ({ name, stats, agents, grow, draw }) for an instance.
export function levelOf(def, s) {
  const i = Math.min(Math.max((s.level ?? 1) - 1, 0), def.levels.length - 1);
  return def.levels[i];
}

// Every building has a random `seed` that drives its look (see Painter
// variation helpers). Each level gets its own look from the same seed.
export function newSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

export function drawSeed(s) {
  return (s.seed ^ Math.imul(s.level ?? 1, 0x9e3779b1)) >>> 0;
}

// Surroundings style for an instance: the player's choice (s.data.yard),
// or one of the level's `yards` picked by seed. null = none.
export function yardOf(def, s) {
  const chosen = s.data?.yard;
  if (chosen === 'none') return null;
  if (chosen && YARDS[chosen]) return chosen;
  const options = levelOf(def, s).yards ?? [];
  if (!options.length) return null;
  return options[Math.floor(mulberry32(drawSeed(s) ^ 0x51ed)() * options.length)];
}

// Joined buildings: neighbouring single-dot buildings facing the same road
// can share a wall and read as one street front (a terrace of tenements, a
// panel block in sections). A level opts in with
//   join: { group, chance }
// Two neighbours join when both levels are in the same group, they stand side
// by side along their road (same drawn rotation), and a roll seeded by both
// buildings is under the lower chance – so it stays put until one of them is
// restyled or changes level. The draw function gets g.join = { left, right }.
export function joinSides(world, s) {
  const none = { left: false, right: false };
  const def = STRUCTURE_TYPES[s.type];
  const join = def && levelOf(def, s).join;
  if (!join || world.nodesOf(s).length !== 1) return none;
  const rot = world.facingRotation(s.type, s.node, s.rotation);
  const [x, y] = world.grid.xy(s.node);
  const side = (dir) => {
    const [dx, dy] = rotateQuarter(dir, 0, rot);
    const n = world.grid.nodeAt(x + dx, y + dy);
    const o = n >= 0 ? world.structureAt(n) : null;
    if (!o || o.id === s.id) return false;
    const odef = STRUCTURE_TYPES[o.type];
    const ojoin = odef && levelOf(odef, o).join;
    if (!ojoin || ojoin.group !== join.group || world.nodesOf(o).length !== 1) return false;
    if (world.facingRotation(o.type, o.node, o.rotation) !== rot) return false;
    const [a, b] = s.id < o.id ? [s, o] : [o, s];
    const roll = mulberry32((drawSeed(a) ^ Math.imul(drawSeed(b), 0x85ebca6b) ^ 0x10ad) >>> 0)();
    return roll < Math.min(join.chance ?? 1, ojoin.chance ?? 1);
  };
  return { left: side(-1), right: side(1) };
}

// Footprint offsets relative to the anchor dot, after rotation.
export function footprintOffsets(def, rotation = 0) {
  return (def.footprint ?? [[0, 0]]).map(([dx, dy]) => rotateQuarter(dx, dy, rotation));
}

// Offset from the anchor dot to the middle of the footprint.
export function footprintCenter(def, rotation = 0) {
  const offs = footprintOffsets(def, rotation);
  return [
    offs.reduce((s, o) => s + o[0], 0) / offs.length,
    offs.reduce((s, o) => s + o[1], 0) / offs.length,
  ];
}
