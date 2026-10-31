// Commuters from outside: most come by bus / train when a stop is in
// walking range of work (config.commute.transit), the rest by car.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, street } from './helpers.js';
import { CONFIG } from '../src/config.js';
import { AgentSystem } from '../src/sim/agents.js';
import { UNLOCKS } from '../src/story/unlocks.js';

// A works by a street off the map, a bus stop a little way along (or none).
function town(stop = true) {
  const w = flatWorld(30, 30);
  UNLOCKS.setWorld(w);
  UNLOCKS.setBase([]);
  street(w, [0, 5], [29, 5]);
  const works = w.placeStructure('pila', w.grid.index(12, 6));
  const bus = stop ? w.placeStructure('bus-stop', w.grid.index(17, 6)) : null;
  assert.ok(works && (bus || !stop));
  return { w, works, bus, agents: new AgentSystem(w, CONFIG) };
}

function run(agents, seconds, until = () => false, dt = 1 / 30) {
  for (let t = 0; t < seconds; t += dt) {
    agents.update(dt);
    if (until()) return true;
  }
  return false;
}

test('a commuter gets off the bus, walks to work, walks back and rides off', () => {
  const { agents, works, bus } = town();
  agents.agents.clear();
  assert.ok(agents.spawnRider());
  const [a] = agents.agents.values();
  assert.equal(a.state, 'abroad');
  assert.equal(a.trip.dest, bus.id);
  assert.equal(a.trip.transit.work, works.id);
  assert.equal([...agents.visible()].length, 0); // still on the bus

  agents.transitCall(bus.id); // gets off
  assert.equal(a.state, 'back');
  assert.equal(a.trip.mode, 'walk');
  assert.ok(run(agents, 60, () => a.state === 'away'), 'walked to work');

  a.timer = 0; // the shift is over
  assert.ok(run(agents, 60, () => a.state === 'wait'), 'walked back to the stop');
  agents.transitCall(bus.id); // gets on
  assert.equal(agents.agents.has(a.id), false);
});

test('most commuters come by bus; without a stop they drive', () => {
  const count = (stop) => {
    const { agents } = town(stop);
    let rides = 0, cars = 0;
    for (let i = 0; i < 200; i++) {
      agents.agents.clear();
      agents.commuteTimer = 0;
      agents.updateCommuters(0);
      for (const a of agents.agents.values()) {
        if (a.trip.mode === 'drive') cars++;
        else if (a.trip.transit?.inbound) rides++;
      }
    }
    return { rides, cars };
  };
  const { rides, cars } = count(true);
  assert.ok(rides > cars * 2 && cars > 0, `${rides} by bus, ${cars} by car`);
  assert.deepEqual(count(false).rides, 0);
  assert.ok(count(false).cars > 150);
});
