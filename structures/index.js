// Structure registry. To add a building: create a file next to this one
// (copy residential.js), then import it and add it to the list below.
// Toolbar buttons, the click menu, hotkeys, growth and the simulation pick it
// up automatically.
//
// Optional definition fields beyond those documented in residential.js:
//   category   toolbar tab: 'zone' (default) or 'civic' – see CATEGORIES
//   tags       extra names growth rules and agents can match, e.g. ['park']
//   access     'road' (default) or 'any' – 'any' also counts a footpath as access
//   code       short prefix for annotations, e.g. 'R' -> "R-012" (default: first letter)
//   site       true = fills its lot up to the road and merges with neighbouring
//              sites; drawings get the area as g.site (parks, squares)
//   levels[i].coverage   service radius in dots (services)
//   levels[i].yards      surroundings styles it may get (see yards.js)

import { rotateQuarter } from '../src/core/grid.js';
import { mulberry32 } from '../src/core/random.js';
import { YARDS } from './yards.js';
import residential from './residential.js';
import business from './business.js';
import industrial from './industrial.js';
import * as park from './park.js';
import * as square from './square.js';
import * as services from './services.js';

export const CATEGORIES = [
  { id: 'zone', label: 'Zones' },
  { id: 'civic', label: 'Civic' },
];

export const STRUCTURES = [
  residential, business, industrial,
  park.small, park.large, square.small, square.large, services.small, services.large,
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
