// Commands for trying things out from the browser console: window.cmd.
// cmd.help() lists them. One place for "make this happen now", so a new
// kind of animal or event is one entry in SPAWN (or a new verb below).

import { exportCity } from '../ui/saveFile.js';
import { STRUCTURE_TYPES } from '../../structures/index.js';
import { planRoute } from '../roads/routing.js';
import { eraseTarget } from '../tools/erase.js';

const STEP = 0.5; // simulated seconds per step while jumping

export function createCommands({ world, config, clock, weather, agents, trains, boats, deer, livestock, growth, story, annotations, unlocks, save = exportCity }) {
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

  const cmd = {
    spawn,
    build,
    road,
    tree,
    erase,
    types: () => Object.keys(STRUCTURE_TYPES),
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
        'cmd.erase(x, y)           what the eraser would take there',
        'cmd.seed()                the map seed',
        'cmd.save()                download the town as a file',
      ];
      console.log(lines.join('\n'));
    },
  };
  return cmd;
}
