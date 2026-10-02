// The numbers a story's conditions can read (see story/README.md), counted
// from the town as it is now. Names go through normalName (script.js), so
// `residential_house_amount`, `Residential.House` and `residential-house`
// are all the same.
//
//   <type or tag>              how many: residential, park, church, heritage…
//   <type or tag>_<level>      how many at that level, by the level's name:
//                              residential_house, residential_panel_block,
//                              park_green, mine_deep_mine
//   residents, jobs            people living and working in town (as in the panel)
//   buildings                  everything built
//   roads, lanes, streets, footpaths, railways   how many dots long
//   bridges                    crossings over water (any network)
//   trees                      trees and other nature on the map
//   walking, cycling, driving, trains, buses     out and about right now
//   minutes                    how long the town has been running (game time)
//   photos                     photographs taken

import { STRUCTURE_TYPES, levelOf } from '../../structures/index.js';
import { normalName } from './script.js';

export function townVariables(world, { agents = null, trains = null, photos = 0 } = {}) {
  const v = new Map();
  const add = (name, n = 1) => {
    const key = normalName(name);
    v.set(key, (v.get(key) ?? 0) + n);
  };
  // every type, tag and level name is known, even at nought
  for (const def of Object.values(STRUCTURE_TYPES)) {
    for (const name of [def.id, ...(def.tags ?? [])]) {
      add(name, 0);
      for (const level of def.levels) add(`${name}_${level.name}`, 0);
    }
  }
  for (const name of ['residents', 'jobs', 'walking', 'cycling', 'driving', 'trains', 'buses']) add(name, 0);

  for (const s of world.structures.values()) {
    const def = STRUCTURE_TYPES[s.type];
    const level = levelOf(def, s);
    for (const name of [def.id, ...(def.tags ?? [])]) {
      add(name);
      add(`${name}_${level.name}`);
    }
    if (world.isServed(s)) for (const [k, n] of Object.entries(level.stats ?? {})) add(k, n);
  }
  v.set('buildings', world.structures.size);

  // networks, in dots of length
  const length = (layer, keep = () => true) => {
    let n = 0;
    for (const [a, b] of layer.graph.edges()) if (keep(a, b)) n += layer.grid.distance(a, b) * (layer.scale ?? 1);
    return Math.round(n);
  };
  const roads = world.networks.road;
  v.set('roads', length(roads, (a, b) => !world.isLane(a, b)));
  v.set('lanes', length(roads, (a, b) => world.isLane(a, b)));
  v.set('streets', length(roads, (a, b) => world.hasSidewalk(a, b)));
  v.set('footpaths', length(world.networks.path));
  v.set('railways', length(world.networks.rail));
  v.set('bridges', countBridges(world));
  v.set('trees', world.features.size);

  for (const a of agents?.visible?.() ?? []) {
    if (a.bus) add('buses');
    else if (!a.truck) add(a.trip?.mode === 'drive' ? 'driving' : a.trip?.mode === 'cycle' ? 'cycling' : 'walking');
  }
  v.set('trains', trains?.trains?.size ?? 0);
  v.set('minutes', Math.floor((world.time ?? 0) / 60));
  v.set('photos', photos);
  return v;
}

// Runs of a network over water (as render/bridges.js finds them, without
// their shape).
function countBridges(world) {
  let n = 0;
  for (const layer of Object.values(world.networks)) {
    const { graph, bridge } = layer;
    if (!bridge) continue;
    const seen = new Set();
    for (const start of graph.nodes()) {
      if (seen.has(start) || !bridge.water(start)) continue;
      n++;
      const todo = [start];
      seen.add(start);
      while (todo.length) {
        for (const m of graph.neighbors(todo.pop())) {
          if (bridge.water(m) && !seen.has(m)) { seen.add(m); todo.push(m); }
        }
      }
    }
  }
  return n;
}
