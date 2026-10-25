// Commands for trying things out from the browser console: window.cmd.
// cmd.help() lists them. One place for "make this happen now", so a new
// kind of animal or event is one entry in SPAWN (or a new verb below).

import { exportCity } from '../ui/saveFile.js';
import { STRUCTURE_TYPES } from '../../structures/index.js';
import { planRoute } from '../roads/routing.js';
import { eraseTarget } from '../tools/erase.js';
import { ROAD_MARK } from '../render/roadMarks.js';
import { SUN, DAY, sunAt, stepAt, holdDay, goOnDay, dayLength } from '../render/shadows.js';

const STEP = 0.5; // simulated seconds per step while jumping

export function createCommands({ world, config, clock, weather, agents, fires, trains, boats, deer, livestock, growth, story, annotations, unlocks, renderer = null, save = exportCity }) {
  // What `cmd.spawn(name)` can make; each returns something truthy if it did.
  const SPAWN = {
    deer: () => deer.launch(),
    boats: () => boats.launch(),
    train: () => trains.spawn(),
    visitor: () => agents.spawnVisitor(),
    commuter: () => agents.spawnVisitor({ commuter: true }),
    truck: () => agents.spawnVisitor({ truck: true }),
    bus: () => {
      const stops = agents.busStops();
      return stops.length && agents.spawnBus(stops);
    },
    cow: () => pasture('cow'),
    sheep: () => pasture('sheep'),
    church: () => growth.spawnChurch(),
  };

  // One more animal in a pasture that keeps that kind.
  function pasture(kind) {
    livestock.refresh();
    const list = livestock.pastures?.list ?? [];
    const options = list.map((p, i) => i).filter((i) => livestock.kindOf(list[i]) === kind);
    if (!options.length) return false;
    const at = livestock.spot(options[Math.floor(Math.random() * options.length)]);
    return at ? livestock.add(kind, at) : false;
  }

  function spawn(name, count = 1) {
    const make = SPAWN[name];
    if (!make) throw new Error(`Unknown '${name}' (${Object.keys(SPAWN).join(', ')})`);
    let made = 0;
    for (let i = 0; i < count; i++) if (make()) made++;
    if (!made) console.warn(`Nothing ${name} could be made (is there a place for it?)`);
    return made;
  }

  function time(what) {
    if (what === 'pause') clock.paused = true;
    else if (what === 'play') clock.paused = false;
    else if (Number.isInteger(what) && what >= 0 && what < clock.speeds.length) {
      clock.index = what;
      clock.paused = false;
    } else throw new Error(`time('pause' | 'play' | 0..${clock.speeds.length - 1})`);
    return { paused: clock.paused, speed: clock.speed.name ?? clock.index };
  }

  // Run the town ahead by some minutes without drawing, to see growth,
  // weather and herds come and go. (Up to an hour at a time.)
  function jump(minutes = 1) {
    const seconds = Math.min(60, Math.max(0, minutes)) * 60;
    for (let t = 0; t < seconds; t += STEP) {
      clock.elapsed += STEP;
      world.time = clock.elapsed;
      weather.update();
      agents.update(STEP);
      fires?.update(STEP);
      trains.update(STEP);
      boats.update(STEP);
      deer.update(STEP);
      livestock.update(STEP);
      growth.update(STEP);
    }
    return world.weather.kind;
  }

  function clear(what) {
    const sets = { deer: deer.herds, boats: boats.boats, cows: livestock.animals, sheep: livestock.animals };
    const set = sets[what];
    if (!set) throw new Error(`clear(${Object.keys(sets).join(' | ')})`);
    if (what === 'cows' || what === 'sheep') {
      const kind = what === 'cows' ? 'cow' : 'sheep';
      for (const [id, a] of set) if (a.kind === kind) set.delete(id);
    } else set.clear();
  }

  // ----- building (x, y are map dots, as the grid counts them; footpaths and
  // rails also take half steps) -----

  const fail = (what, reason) => {
    console.warn(`${what}: ${reason ?? 'no'}`);
    return false;
  };

  function build(type, x, y, { rotation = 0 } = {}) {
    if (!STRUCTURE_TYPES[type]) throw new Error(`Unknown structure '${type}' (cmd.types() lists them)`);
    const at = world.placementFor(type, world.grid.nodeAt(x, y), rotation);
    if (!at.check.ok) return fail(`Can't build ${type} at ${x}, ${y}`, at.check.reason);
    return world.placeStructure(type, at.node, { rotation: at.rotation });
  }

  const NETWORKS = { road: ['road', false], lane: ['road', true], path: ['path', false], rail: ['rail', false], fence: ['fence', false] };

  // A straight (or diagonal, then straight) run from one dot to another.
  function road(kind, [x0, y0], [x1, y1]) {
    const entry = NETWORKS[kind];
    if (!entry) throw new Error(`cmd.road(${Object.keys(NETWORKS).map((k) => `'${k}'`).join(' | ')}, [x, y], [x, y])`);
    const [layerKind, lane] = entry, layer = world.networks[layerKind];
    const a = layer.nodeAt(x0, y0), b = layer.nodeAt(x1, y1);
    if (a < 0 || b < 0 || a === b) return fail(`Can't lay ${kind}`, 'off the map, or both ends the same');
    const result = world.buildNetwork(layerKind, planRoute(layer.grid, a, b), { lane });
    return result.ok ? true : fail(`Can't lay ${kind}`, result.reason);
  }

  function tree(x, y) {
    const f = world.addFeature('tree', world.grid.nodeAt(x, y));
    return f ?? fail(`Can't plant a tree at ${x}, ${y}`, 'off the map or one already there');
  }

  // Whatever the eraser would take there (a building, then a footpath, road…).
  function erase(x, y) {
    const target = eraseTarget(world, [x, y]);
    if (!target) return false;
    target.run();
    return true;
  }

  // A building by its house number (č. p.): what it is, where, who lives
  // there; with no number, every one standing, in order.
  function house(no) {
    const about = (s) => {
      const def = STRUCTURE_TYPES[s.type];
      const [x, y] = world.grid.xy(s.node);
      return { no: s.no, type: s.type, name: def.name, x, y, residents: def.stats?.residents ?? 0, served: world.isServed(s), id: s.id };
    };
    if (no === undefined) return [...world.structures.values()].filter((s) => s.no != null).sort((a, b) => a.no - b.no).map(about);
    const s = world.structureByNo(no);
    if (s) return about(s);
    return fail(`No building č. p. ${no}`, no > 0 && no < world.nextNo ? 'it stood once, and is gone' : `numbers run 1 … ${world.nextNo - 1}`);
  }

  // The people of houses `from` (a number or a list of them) who are in go
  // to house `to`, stay a while and come home: how many set off.
  function send(from, to) {
    const dest = world.structureByNo(to);
    if (!dest) return house(to); // (says why)
    const homes = [];
    for (const no of [from].flat()) {
      const s = world.structureByNo(no);
      if (s) homes.push(s);
      else house(no);
    }
    const { sent, missed } = agents.send(homes, dest);
    for (const { home, why } of missed) console.warn(`č. p. ${home.no}: ${why}`);
    return sent;
  }

  // Fires, as the story's `ignite`, `put out` and `burn` (src/sim/fire.js):
  // the town's doing, not steps ⌘Z takes back (demolish a ruin to clear it).
  // House `no` catches fire; the neighbours and the brigade turn out. It
  // burns until put out or burnt down – or, given `minutes`, burns down
  // when they're up.
  function ignite(no, minutes = null) {
    const s = world.structureByNo(no);
    if (!s) return house(no); // (says why)
    if (s.ruin) return fail(`č. p. ${no}`, 'burnt down already');
    if (s.burning) return fail(`č. p. ${no}`, 'burning already');
    return world.history.aside(() => fires.ignite(s, minutes === null ? null : minutes * 60));
  }

  // The fire at house `no` is put out: the house stays.
  function putOut(no) {
    const s = world.structureByNo(no);
    if (!s) return house(no);
    if (!s.burning) return fail(`č. p. ${no}`, 'not burning');
    return world.history.aside(() => fires.putOut(s));
  }

  // House `no` burns down: the fire there ends in a ruin, or it burns
  // down at once if it wasn't burning.
  function burn(no) {
    const s = world.structureByNo(no);
    if (!s) return house(no);
    if (s.ruin) return fail(`č. p. ${no}`, 'burnt down already');
    return world.history.aside(() => fires.burnDown(s));
  }

  // What's burning, and who's there doing what (src/sim/fire.js).
  function fire() {
    return [...(fires?.fires.values() ?? [])].map((f) => {
      const s = world.structures.get(f.id);
      const doing = {};
      for (const a of f.people) {
        const k = `${a.fire.role} ${a.fire.phase}`;
        doing[k] = (doing[k] ?? 0) + 1;
      }
      return { no: s?.no, left: !s?.burning ? 'out' : s.burning.left === null ? 'until told' : Math.round(s.burning.left), chain: f.chain?.places ?? 0, engine: f.engine?.state ?? null, doing };
    });
  }

  // The view centred on house `no`, `zoom` close (to watch it, say, burn).
  function look(no, zoom = 3) {
    const s = world.structureByNo(no);
    if (!s) return house(no); // (says why)
    const cam = renderer?.camera;
    if (!cam) return fail('No view', 'no renderer');
    cam.zoom = Math.min(cam.maxZoom, Math.max(cam.minZoom, zoom));
    cam.centerOn(...world.centerOf(s), innerWidth, innerHeight);
    renderer.invalidate();
    return true;
  }

  const cmd = {
    spawn,
    house,
    look,
    fire,
    send,
    ignite,
    putOut,
    burn,
    build,
    road,
    tree,
    erase,
    undo: () => world.history.undo(), // the player's last change (each cmd that builds or erases is one too)
    redo: () => world.history.redo(),
    types:() => Object.keys(STRUCTURE_TYPES),
    weather: (kind) => {
      if (kind === undefined) return world.weather.kind;
      weather.set(kind);
      return kind;
    },
    time,
    jump,
    clear,
    unlock: (name) => unlocks.apply('unlock', name),
    lock: (name) => unlocks.apply('lock', name),
    story: {
      play: (branch) => story.play(branch), // tell a branch now
      reset: () => story.reset(),           // forget what was told, start over
      reload: () => story.reload(),         // read the file again
    },
    log: (n = 20) => annotations.lines.slice(0, n), // what the systems reported, newest first
    seed: () => world.seed,
    // the sun and the pens of the shadows (SUN in render/shadows.js): the
    // settings given are changed, e.g. { length: 1.5, hatch: { gap: 0.03,
    // pen: 3 } }, and everything is drawn again with them
    sun(over = {}) {
      for (const [k, v] of Object.entries(over)) {
        if (!(k in SUN)) throw new Error(`cmd.sun: no setting '${k}' (${Object.keys(SUN).join(', ')})`);
        SUN[k] = v && typeof v === 'object' && SUN[k] ? { ...SUN[k], ...v } : v;
      }
      if (Object.keys(over).length) renderer?.invalidate();
      return structuredClone(SUN);
    },
    // the day (DAY in render/shadows.js): an hour (0 … 24, e.g. 20.5)
    // holds the time there – the sun, the dusk, the night – nothing lets
    // the day go on from there; { day } sets how long a day lasts
    // (simulated seconds), the hour kept
    day(hour, over = {}) {
      if (hour && typeof hour === 'object') [hour, over] = [undefined, hour];
      const { day: seconds, ...rest } = over;
      Object.assign(DAY, rest);
      if (seconds) dayLength(seconds, world.time);
      if (hour == null) {
        goOnDay(world.time); // (from where it was held)
        renderer?.setSun(sunAt(world.time));
      } else {
        if (!(hour >= 0 && hour <= 24)) throw new Error('cmd.day: an hour, 0 … 24');
        holdDay(hour);
        renderer?.setSun(stepAt(hour));
      }
      return { on: DAY.on, ...DAY.steps[renderer?.dayStep ?? stepAt(hour ?? 12)], day: DAY.day };
    },
    // the hand of the road marks on buildings nothing reaches (render/roadMarks.js)
    roadMark(style) {
      if (style === undefined) return ROAD_MARK.style;
      if (!ROAD_MARK.styles.includes(style)) throw new Error(`cmd.roadMark: one of ${ROAD_MARK.styles.join(', ')}`);
      if (renderer) renderer.setRoadMark(style);
      else ROAD_MARK.style = style;
      return style;
    },
    save: () => save(world), // downloads the town as a file: a backup outside the page
    help() {
      const lines = [
        `cmd.spawn(${Object.keys(SPAWN).map((k) => `'${k}'`).join(' | ')}, count = 1)`,
        `cmd.weather(${config.weather.kinds.map((k) => `'${k}'`).join(' | ')})   now: '${world.weather.kind}'`,
        `cmd.time('pause' | 'play' | 0..${clock.speeds.length - 1})`,
        'cmd.jump(minutes)         run the town ahead, up to 60',
        "cmd.clear('deer' | 'boats' | 'cows' | 'sheep')",
        "cmd.unlock(name) / cmd.lock(name)   as in story/unlocks.txt",
        "cmd.story.play('Branch') / .reset() / .reload()",
        'cmd.log(n)               the last things the systems reported',
        "cmd.build('house', x, y, { rotation: 0..3 })   see cmd.types()",
        "cmd.road('road' | 'lane' | 'path' | 'rail' | 'fence', [x, y], [x, y])",
        'cmd.tree(x, y)',
        'cmd.house(4)              the building č. p. 4; cmd.house() every one',
        'cmd.send([1, 2, 3], 7)    the people of č. p. 1, 2, 3 go to č. p. 7, stay and come home',
        'cmd.fire()                what burns, and who is there doing what',
        'cmd.look(4, 3)            the view on č. p. 4, zoomed in 3×',
        'cmd.ignite(4)             č. p. 4 catches fire, the town turns out; cmd.ignite(4, 2): burns down in 2 minutes',
        'cmd.putOut(4)             the fire at č. p. 4 is put out, the house stays',
        'cmd.burn(4)               č. p. 4 burns down now (a ruin until demolished)',
        'cmd.erase(x, y)           what the eraser would take there',
        'cmd.undo() / cmd.redo()   the last change to the town, as ⌘Z / ⇧⌘Z',
        'cmd.sun({ length, hatch: { gap, pen }, strokes: { gap, pen } })   shadows; pens 1…5',
        'cmd.day(20.5) / cmd.day()   hold the time at 20:30 / let the day go on; cmd.day({ day: 120 }) a shorter day',
        `cmd.roadMark(${ROAD_MARK.styles.map((k) => `'${k}'`).join(' | ')})   now: '${ROAD_MARK.style}'`,
        'cmd.seed()                the map seed',
        'cmd.save()                download the town as a file',
      ];
      console.log(lines.join('\n'));
    },
  };
  return cmd;
}
