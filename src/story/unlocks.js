// What may be built: story/unlocks.txt says what's locked at the start, and
// the story unlocks (or locks) more as it goes – `unlock station` in a
// branch. What the story changed is kept with the town (world.story.unlocks),
// on top of the file. See story/README.md.
//
// The file and the story both use two commands, read top to bottom, the
// last one that matches deciding:
//
//   lock all
//   unlock road
//   unlock residential
//   lock residential_panel_block
//
// Names (as in story conditions: case, '-', '.' and spaces don't matter):
//   all
//   transport, zones, public, landmarks       a whole Build menu group
//   residential, park_large, station_main…    a type, or one size of it
//   residential, heritage, park…              a tag (every type that has it)
//   residential_panel_block, park_green…      one level of a type (by its name)
//   road, lane, footpath, railway             the network tools
//   chronicle, photo, terrain, colors, assets, debug, export, import,
//   new_map, fullscreen                        the buttons at the top (not in
//                                              `all`; `controls`: all of them)
//   cars, trucks, buses                        traffic (not in `all`;
//                                              `vehicles`: all three)
//
// And one more line, in the file or the story: `scheme Night` – the colour
// scheme (by name, by number from 1, `custom`, or three colours: bg, main,
// detail, e.g. `scheme #ebe7dd #3e12b6 #9b9486`). The file's is put on when
// it changes, or every time while `colors` is locked; the player's own pick
// stays otherwise.
//
// Everything is open unless locked. A locked type or size isn't in the
// Build menu or among what a building can be turned into; a locked level
// isn't grown into, nor offered as an upgrade. What already stands stays.
//
//   UNLOCKS.allows(type, level = 1)   may this type stand at this level?
//   UNLOCKS.allowsTool(tool)          may this tool be picked up?
//   UNLOCKS.allowsNetwork(kind)       'road' | 'lane' | 'path' | 'rail'
//   UNLOCKS.allowsControl(id)         a button at the top, by its data-act ('debug'…)
//   UNLOCKS.allowsVehicle(kind)       'cars' | 'trucks' | 'buses'
//   UNLOCKS.scheme                    the file's `scheme` line: { value, line } or null
//   UNLOCKS.onChange(fn)

import { STRUCTURE_TYPES, CATEGORIES, categoryOf } from '../../structures/index.js';
import { normalName } from './script.js';
import { SCHEMES, COLOR_NAMES, normalizeHex, applyTheme, setCustomColor } from '../theme.js';

// Names of the network tools (tool id -> names that mean it).
const NETWORKS = {
  road: ['road', 'roads'],
  lane: ['lane', 'lanes'],
  path: ['footpath', 'footpaths', 'path', 'paths'],
  rail: ['railway', 'railways', 'rail', 'rails'],
};
// The buttons at the top (data-act -> names that mean it). `all` leaves
// them be; `controls` is all of them.
const CONTROLS = {
  chronicle: ['chronicle', 'book'],
  photo: ['photo', 'photos', 'camera'],
  terrain: ['terrain', 'contours'],
  colors: ['colors', 'colours', 'color_schemes', 'colour_schemes', 'schemes'],
  assets: ['assets'],
  debug: ['debug'],
  export: ['export'],
  import: ['import'],
  newMap: ['new_map', 'newmap'],
  fullscreen: ['fullscreen', 'full_screen'],
};
// Traffic (src/sim/agents.js): `all` leaves it be; `vehicles` is all of it.
const VEHICLES = {
  cars: ['cars', 'car'],
  trucks: ['trucks', 'truck', 'lorries'],
  buses: ['buses', 'bus'],
};
const GROUP_NAMES = { zone: ['zones'], civic: ['public'], heritage: ['landmarks'], transport: ['transport'] };

// The names that mean a type: all of it (`any`) or one level of it (`levels[i]`).
function namesOf(def) {
  const own = [def.id, ...(def.tags ?? [])].map(normalName);
  const group = categoryOf(def);
  const any = new Set(['all', normalName(group), ...(GROUP_NAMES[group] ?? []), ...own]);
  const levels = def.levels.map((level, i) => new Set(own.flatMap((n) => [`${n}_${normalName(level.name)}`, `${n}_level${i + 1}`, `${n}_level_${i + 1}`])));
  return { any, levels };
}

// A line of the file or a story command: { unlock, name, line }; and the
// last `scheme` line, { value, line }.
export function parseUnlocks(text) {
  const rules = [], errors = [];
  let scheme = null;
  String(text).split(/\r?\n/).forEach((raw, k) => {
    const t = raw.trim();
    if (!t || t.startsWith('#') || t.startsWith('//')) return;
    const sm = /^(?:scheme|colou?rs?)\s+(.+)$/i.exec(t);
    if (sm) {
      if (!resolveScheme(sm[1])) return errors.push({ line: k + 1, msg: `"${sm[1].trim()}" is no colour scheme – ${SCHEMES.map((s) => s.name).join(', ')}, custom, or three colours` });
      scheme = { value: sm[1].trim(), line: k + 1 };
      return;
    }
    const m = /^(unlock|lock)\s+(.+)$/i.exec(t);
    if (!m) return errors.push({ line: k + 1, msg: `"${t}" – lines here are "lock name", "unlock name" or "scheme name"` });
    rules.push({ unlock: m[1].toLowerCase() === 'unlock', name: normalName(m[2]), given: m[2].trim(), line: k + 1 });
  });
  return { rules, errors, scheme };
}

// A `scheme` value as applyTheme takes it (an index into SCHEMES, or
// 'custom'), or three colours { bg, main, detail }; null if it's none.
export function resolveScheme(value) {
  const v = String(value).trim();
  const hexes = v.split(/[\s,]+/).map(normalizeHex);
  if (hexes.length === 3 && hexes.every(Boolean)) return Object.fromEntries(COLOR_NAMES.map((n, i) => [n, hexes[i]]));
  if (normalName(v) === 'custom') return { choice: 'custom' };
  const n = Number(v);
  if (Number.isInteger(n) && n >= 1 && n <= SCHEMES.length) return { choice: n - 1 };
  const i = SCHEMES.findIndex((s) => normalName(s.name) === normalName(v));
  return i >= 0 ? { choice: i } : null;
}

// Put a scheme on (in the browser).
export function applyScheme(value) {
  const s = resolveScheme(value);
  if (!s) return;
  if ('choice' in s) applyTheme(s.choice);
  else for (const n of COLOR_NAMES) setCustomColor(n, s[n]);
}

class Unlocks {
  constructor() {
    this.base = [];      // from the file
    this.world = null;   // world.story.unlocks: [{ unlock, name }] from the story
    this.listeners = new Set();
    this.names = null;   // type id -> namesOf(def), built when first needed
    this.scheme = null;  // the file's `scheme` line
  }

  get rules() {
    return [...this.base, ...(this.world?.story.unlocks ?? [])];
  }

  setWorld(world) {
    this.world = world;
    this.changed();
  }

  setBase(rules) {
    this.base = rules;
    this.changed();
  }

  // Unlock or lock by the story (kept with the town).
  apply(unlock, name) {
    this.world.story.unlocks.push({ unlock, name: normalName(name) });
    this.changed();
    this.world.events.emit('story:changed');
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  changed() {
    this.listeners.forEach((fn) => fn());
  }

  // Is `name` anything a rule can lock?
  known(name) {
    const n = normalName(name);
    if (['all', 'controls', 'vehicles'].includes(n) || [...Object.values(NETWORKS), ...Object.values(CONTROLS), ...Object.values(VEHICLES)].some((ns) => ns.includes(n))) return true;
    return Object.values(this.namesFor()).some(({ any, levels }) => any.has(n) || levels.some((l) => l.has(n)));
  }

  namesFor() {
    this.names ??= Object.fromEntries(Object.values(STRUCTURE_TYPES).map((def) => [def.id, namesOf(def)]));
    return this.names;
  }

  allows(type, level = 1) {
    const names = this.namesFor()[type];
    if (!names) return true;
    let open = true;
    for (const r of this.rules) {
      if (names.any.has(r.name) || names.levels[level - 1]?.has(r.name)) open = r.unlock;
    }
    return open;
  }

  allowsNetwork(kind) {
    let open = true;
    for (const r of this.rules) {
      if (r.name === 'all' || r.name === 'transport' || NETWORKS[kind]?.includes(r.name)) open = r.unlock;
    }
    return open;
  }

  allowsControl(id) {
    let open = true;
    for (const r of this.rules) {
      if (r.name === 'controls' || CONTROLS[id]?.includes(r.name)) open = r.unlock;
    }
    return open;
  }

  allowsVehicle(kind) {
    let open = true;
    for (const r of this.rules) {
      if (r.name === 'vehicles' || VEHICLES[kind]?.includes(r.name)) open = r.unlock;
    }
    return open;
  }

  // A build tool needs one size it may build; a network tool its network;
  // photo mode its button.
  allowsTool(tool) {
    if (tool.defs) return tool.defs.some((d) => this.allows(d.id));
    if (tool.id in NETWORKS) return this.allowsNetwork(tool.id);
    if (tool.id === 'photo') return this.allowsControl('photo');
    return true; // select, erase
  }

  // The highest level a building of `type` may grow to from `level`: up to
  // the first locked one above it.
  ceiling(type, level) {
    const def = STRUCTURE_TYPES[type];
    let top = level;
    while (top < def.levels.length && this.allows(type, top + 1)) top++;
    return top;
  }
}

export const UNLOCKS = new Unlocks();

// Read story/unlocks.txt (none: everything open). Returns its mistakes,
// as { line, msg }.
export async function loadUnlocks(file) {
  let text = '';
  try {
    const res = await fetch(file, { cache: 'no-store' });
    if (res.ok) text = await res.text();
  } catch {
    // no file: everything open
  }
  const { rules, errors, scheme } = parseUnlocks(text);
  for (const r of rules) if (!UNLOCKS.known(r.name)) errors.push({ line: r.line, msg: `"${r.given}" is nothing that can be locked` });
  UNLOCKS.scheme = scheme;
  UNLOCKS.setBase(rules);
  return errors;
}
