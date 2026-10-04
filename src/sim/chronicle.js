// The town's chronicle: a few lines on what mattered, written as it happens
// and kept with the town (world.chronicle): the houses – each of the first
// ten, with where it stood, then round numbers of them – the firsts (the
// first road, the first panel block, the railway arriving), every
// landmark, the residents passing round numbers, a new name, and whatever
// the story writes in it (`chronicle:` lines, src/story/). Opened as a
// book from the HUD (src/ui/chronicleBook.js).
//
// Each entry is { day, text, kind }: `day` counts the chronicle's days
// (config.chronicle.day game seconds each) from the town's start; `kind` is
// 'town' or 'story'. world.chronicle.marks lists what has had its line
// already ('first:park', 'residents:100'…), so nothing is written twice.

import { STRUCTURE_TYPES, matches } from '../../structures/index.js';

// How a first is written, by structure id (sizes of one thing share a
// line: the first of either is written). The rest get "The first <name>
// was built."
const FIRSTS = {
  apartments: 'The first apartments went up.',
  block: 'The first panel block went up.',
  jednota: 'Jednota opened its first shop.',
  hospoda: 'The first pub poured its first beer.',
  store: 'The department store opened.',
  tuzex: 'A Tuzex shop opened.',
  office: 'The národní výbor moved into its offices.',
  'post-office': 'The post office opened.',
  hotel: 'The first hotel took in guests.',
  workshop: 'The first workshop opened.',
  factory: 'The first factory opened.',
  pit: 'Coal was found, and the first pit was sunk.',
  colliery: 'The first colliery opened.',
  'deep-mine': 'A deep mine was sunk.',
  farmstead: 'A farmstead was settled.',
  jzd: 'The farmers joined into a JZD.',
  'state-farm': 'A state farm was founded.',
  green: 'The first park was planted.',
  meadow: 'A large park was laid out.',
  plaza: 'The first square was paved.',
  'fire-house': 'The fire brigade got its fire house.',
  'health-centre': 'A health centre opened its doors.',
  clinic: 'A polyclinic opened its doors.',
  hospital: 'The hospital opened.',
  school: 'The first school rang its bell.',
  station: 'The railway station opened.',
  'station-main': 'The main station opened.',
  stop: 'A railway stop opened.',
  'bus-stop': 'The first bus stop was put up.',
  cemetery: 'The cemetery was laid out.',
};

// Landmarks are written every time.
const LANDMARK = (name) => `${/^[aeiou]/i.test(name) ? 'An' : 'A'} ${name.toLowerCase()} was built.`;

// The structure whose first stands for this type: sizes of one thing share
// it (a wide house counts as a house), by sharing its name in the Build menu.
function firstOf(type) {
  const def = STRUCTURE_TYPES[type];
  return Object.values(STRUCTURE_TYPES).find((d) => d.name === def.name && d.category === def.category)?.id ?? type;
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const WORDS = { 15: 'fifteen', 20: 'twenty', 30: 'thirty', 50: 'fifty', 75: 'seventy-five', 100: 'a hundred' };

// Where a house stands, for its line: by what's nearest of these (within
// PLACE_REACH dots), first come first.
const PLACE_REACH = 2;
const PLACES = [
  ['church', 'by the church'], ['chapel', 'by the chapel'], ['town-hall', 'by the town hall'],
  ['castle', 'below the castle'], ['pool', 'by the swimming pool'], ['station', 'near the station'],
  ['station-main', 'near the station'], ['stop', 'by the railway stop'], ['hospoda', 'by the pub'],
  ['hospoda-wide', 'by the pub'], ['square', 'on the square'], ['park', 'by the park'],
  ['cemetery', 'by the cemetery'], ['farm', 'by the farm'], ['mine', 'by the pit'], ['industrial', 'by the works'],
];

const NETWORKS = {
  road: 'The first road was laid.',
  lane: 'The first lane was cut through the fields.',
  street: 'The first street got its pavements.',
  path: 'The first footpath was trodden.',
  rail: 'The railway reached {town}.',
  bridge: 'The first bridge crossed the river.',
};

export class Chronicle {
  constructor(world, config) {
    this.world = world;
    this.config = config.chronicle;
    this.timer = 0;
    this.residents = null;
    this.types = new Map([...world.structures.values()].map((s) => [s.id, s.type]));
    // (marks of a size, as old saves have them – 'first:apartments-wide' – are
    // marks of the thing)
    this.data.marks = [...new Set(this.data.marks.map((m) => m.replace(/^first:(.+)$/, (k, t) => (STRUCTURE_TYPES[t] ? `first:${firstOf(t)}` : k))))];
    this.unread = false;

    // a town without a chronicle yet (new, or saved before there were
    // chronicles): what's already there counts as written
    if (!this.data.entries.length) {
      for (const s of world.structures.values()) this.mark(`first:${firstOf(s.type)}`);
      const houses = this.countHouses();
      for (let n = 1; n <= houses; n++) this.mark(`houses:${n}`);
      for (const kind of Object.keys(NETWORKS)) if (this.hasNetwork(kind)) this.mark(`first:${kind}`);
      const r = this.countResidents();
      for (const n of this.config.residents) if (r >= n) this.mark(`residents:${n}`);
      this.write(world.structures.size
        ? `The chronicle of ${world.name} was begun.`
        : `The chronicle of ${world.name} was begun, on an empty map.`, 'town', false);
    }

    world.events.on('structure:added', (s) => this.built(s));
    world.events.on('structure:changed', (s) => this.changed(s));
    world.events.on('structure:removed', (s) => this.removed(s));
    world.events.on('world:renamed', (name) => this.write(`The town took the name ${name}.`));
    for (const type of ['roads:changed', 'paths:changed', 'rails:changed']) {
      world.events.on(type, () => {
        for (const kind of Object.keys(NETWORKS)) {
          if (!this.marked(`first:${kind}`) && this.hasNetwork(kind)) this.first(kind, NETWORKS[kind].replace('{town}', this.world.name));
        }
      });
    }
  }

  get data() {
    return this.world.chronicle;
  }

  get entries() {
    return this.data.entries;
  }

  day() {
    return Math.floor((this.world.time ?? 0) / this.config.day) + 1;
  }

  // A line in the chronicle (`notify`: tell the book there's something new).
  write(text, kind = 'town', notify = true) {
    this.entries.push({ day: this.day(), text, kind });
    if (notify) this.unread = true;
    this.world.events.emit('chronicle:added', this.entries[this.entries.length - 1]);
  }

  marked(key) {
    return this.data.marks.includes(key);
  }

  mark(key) {
    if (!this.marked(key)) this.data.marks.push(key);
  }

  first(key, text) {
    if (this.marked(`first:${key}`)) return;
    this.mark(`first:${key}`);
    this.write(text);
  }

  // dt: real seconds. The residents are counted now and then.
  update(dt) {
    this.timer += dt;
    if (this.timer < this.config.check) return;
    this.timer = 0;
    const r = this.countResidents();
    for (const n of this.config.residents) {
      if (r >= n && !this.marked(`residents:${n}`)) {
        this.mark(`residents:${n}`);
        this.write(`${this.world.name} now has ${n} residents.`);
      }
    }
  }

  // ---------- inside ----------

  built(s) {
    this.types.set(s.id, s.type);
    const def = STRUCTURE_TYPES[s.type];
    if (matches(def, 'heritage')) return this.write(LANDMARK(def.name));
    if (s.type === 'house' || s.type === 'house-wide') this.house(s);
    else this.firstOf(s);
  }

  // The first of its kind (any size) gets its line.
  firstOf(s) {
    const key = firstOf(s.type);
    this.first(key, FIRSTS[key] ?? `The first ${STRUCTURE_TYPES[s.type].name.toLowerCase()} was built.`);
  }

  // A new home: the first ten each get a line, with where they stand; after
  // that, the round numbers (config.chronicle.houses). Counted as they come,
  // so one pulled down and built again isn't written twice.
  house(s) {
    this.mark(`first:${firstOf(s.type)}`);
    const n = this.countHouses();
    if (this.marked(`houses:${n}`)) return;
    this.mark(`houses:${n}`);
    if (n <= ORDINALS.length) {
      const place = this.placeOf(s);
      this.write(`The ${ORDINALS[n - 1]} house was built${place ? ` ${place}` : ''}.`);
    } else if (this.config.houses.includes(n)) {
      this.write(`${this.world.name} has ${WORDS[n] ?? n} houses now.`);
    }
  }

  countHouses() {
    let n = 0;
    for (const o of this.world.structures.values()) if (o.type === 'house' || o.type === 'house-wide') n++;
    return n;
  }

  // Where s stands, in a few words ('by the church', 'by the river'…), or
  // '' when there's nothing to say.
  placeOf(s) {
    const w = this.world;
    const [cx, cy] = w.centerOf(s);
    const near = (o) => {
      const [ox, oy] = w.centerOf(o);
      return Math.max(Math.abs(ox - cx), Math.abs(oy - cy)) <= PLACE_REACH + 0.5; // (centres: a dot more for big buildings)
    };
    const around = [...w.structures.values()].filter((o) => o !== s && near(o));
    for (const [type, words] of PLACES) {
      if (around.some((o) => o.type === type || matches(STRUCTURE_TYPES[o.type], type))) return words;
    }
    let river = false, lake = false, trees = 0;
    for (let dy = -PLACE_REACH; dy <= PLACE_REACH; dy++) {
      for (let dx = -PLACE_REACH; dx <= PLACE_REACH; dx++) {
        const x = Math.round(cx + dx), y = Math.round(cy + dy);
        if (x < 0 || y < 0 || x >= w.grid.width || y >= w.grid.height) continue;
        const n = w.grid.index(x, y);
        if (w.terrain.isRiver(n)) river = true;
        else if (w.terrain.isWater(n)) lake = true;
        if (w.featureAt(n)) trees++;
      }
    }
    if (river) return 'by the river';
    if (lake) return 'by the water';
    if (trees >= 6) return 'at the edge of the woods';
    if (!around.some((o) => matches(STRUCTURE_TYPES[o.type], 'residential'))) return 'on its own, out in the fields';
    return '';
  }

  // Turned into something else (World.convertStructure): a first, if it's
  // the first of its kind; a restyle or new surroundings say nothing.
  changed(s) {
    const was = this.types.get(s.id);
    this.types.set(s.id, s.type);
    if (was == null || was === s.type) return;
    if (matches(STRUCTURE_TYPES[s.type], 'heritage')) this.write(`The ${STRUCTURE_TYPES[was].name.toLowerCase()} was rebuilt as ${STRUCTURE_TYPES[s.type].name.toLowerCase()}.`);
    else this.firstOf(s);
  }

  removed(s) {
    this.types.delete(s.id);
    const def = STRUCTURE_TYPES[s.type];
    if (matches(def, 'heritage')) this.write(`The ${def.name.toLowerCase()} was pulled down.`);
  }

  hasNetwork(kind) {
    const w = this.world;
    if (kind === 'road' || kind === 'lane') {
      for (const [a, b] of w.networks.road.graph.edges()) if (w.isLane(a, b) === (kind === 'lane')) return true;
      return false;
    }
    if (kind === 'street') return w.sidewalks.size > 0;
    if (kind === 'bridge') {
      return Object.values(w.networks).some(({ graph, bridge }) => bridge && [...graph.nodes()].some((n) => bridge.water(n)));
    }
    return w.networks[kind].graph.edgeCount > 0;
  }

  countResidents() {
    let n = 0;
    for (const s of this.world.structures.values()) {
      if (this.world.isServed(s)) n += STRUCTURE_TYPES[s.type].stats?.residents ?? 0;
    }
    return n;
  }
}
