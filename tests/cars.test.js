// Cars are things of their own (src/sim/cars.js): the one that drives in
// to a place parks in a stall there and is the one driven off again; they
// are kept with the town.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road } from './helpers.js';
import { CONFIG } from '../src/config.js';
import { World } from '../src/core/world.js';
import { AgentSystem } from '../src/sim/agents.js';
import { UNLOCKS, parseUnlocks } from '../src/story/unlocks.js';

function town() {
  const w = flatWorld(30, 30);
  UNLOCKS.setWorld(w);
  UNLOCKS.setBase([]);
  road(w, [0, 5], [29, 5]); // (off the map both ends)
  const home = w.placeStructure('house', w.grid.index(2, 6));
  const shop = w.placeStructure('jednota', w.grid.index(26, 6));
  assert.ok(home && shop);
  const agents = new AgentSystem(w, CONFIG);
  agents.agents.clear(); // (only the one driver below, nobody coming in)
  agents.visitorTimer = agents.commuteTimer = agents.deliveryTimer = agents.busTimer = Infinity;
  // the shop's lot: two stalls, as its yard's drawing would mark them
  agents.cars.setSpots(shop, [[25.6, 6.3, Math.PI / 2], [26.4, 6.3, Math.PI / 2]]);
  const a = agents.spawn({ id: `${home.id}:0`, home: home.id });
  return { w, home, shop, agents, a };
}

function run(agents, until, seconds = 120, dt = 1 / 30) {
  for (let t = 0; t < seconds; t += dt) {
    agents.update(dt);
    if (until()) return true;
  }
  return false;
}

test('the car that drives in parks in a stall and is driven home again', () => {
  const { w, home, shop, agents, a } = town();
  const plan = agents.driveRoute(home, shop);
  assert.ok(plan);
  agents.begin(a, plan, shop.id);
  a.state = 'out';
  const car = agents.cars.get(a.car);
  assert.ok(car, 'took a car');
  assert.equal(car.state, 'driving');
  assert.equal(car.home, home.id);
  assert.equal(w.cars.size, 1);

  assert.ok(run(agents, () => a.state === 'away'), 'got to the shop');
  assert.equal(car.state, 'parked');
  assert.equal(car.at, shop.id);
  assert.equal(car.stall, 0);
  assert.deepEqual([car.x, car.y], [25.6, 6.3]);
  assert.equal(a.car, car.id, 'kept to drive home in');
  assert.deepEqual([...agents.cars.parked()].map((c) => c.id), [car.id]);

  a.timer = 0;
  assert.ok(run(agents, () => a.state === 'home'), 'drove home');
  assert.equal(w.cars.size, 1, 'the same car, no other');
  assert.equal(car.at, home.id);
  assert.equal(car.state, 'parked');
  assert.equal(car.driver, null);
  assert.equal(a.car, null);

  // out again: the same car from home
  agents.begin(a, agents.driveRoute(home, shop), shop.id);
  assert.equal(a.car, car.id);
});

test('a second car takes the next stall; a full lot sends it into the yard', () => {
  const { home, shop, agents } = town();
  const cars = [];
  for (let k = 0; k < 3; k++) {
    const b = agents.spawn({ id: `${home.id}:${k + 1}`, home: home.id });
    agents.begin(b, agents.driveRoute(home, shop), shop.id);
    cars.push(agents.cars.get(b.car));
  }
  assert.deepEqual(cars.map((c) => c.stall), [0, 1, -1]);
  assert.equal(new Set(cars.map((c) => c.id)).size, 3);
});

test('cars are saved with the town, parked where they stand', () => {
  const { w, home, shop, agents, a } = town();
  agents.begin(a, agents.driveRoute(home, shop), shop.id);
  a.state = 'out';
  assert.ok(run(agents, () => a.state === 'away'));
  const other = agents.spawn({ id: `${home.id}:1`, home: home.id });
  agents.begin(other, agents.driveRoute(home, shop), shop.id); // out driving when saved
  const saved = JSON.parse(JSON.stringify(w.toJSON()));
  assert.equal(saved.cars.length, 2);
  const back = World.fromJSON(saved);
  const parked = back.cars.get(agents.cars.get(a.car).id);
  assert.equal(parked.at, shop.id);
  assert.equal(parked.stall, 0);
  assert.equal(parked.state, 'parked');
  const driving = back.cars.get(other.car);
  assert.equal(driving.at, home.id, 'one out driving is saved at home');
  assert.ok(back.nextCar > Math.max(...back.cars.keys()));
});

test('a visitor brings a car in and takes it off the map again', () => {
  const { w, agents } = town();
  assert.ok(agents.spawnVisitor());
  const v = [...agents.agents.values()].find((b) => b.visitor);
  const car = agents.cars.get(v.car);
  assert.equal(car.home, null);
  assert.ok(run(agents, () => v.state === 'away'));
  assert.equal(car.state, 'parked');
  v.timer = 0;
  assert.ok(run(agents, () => !agents.agents.has(v.id), 240), 'left the map');
  agents.cars.tidy();
  assert.equal(w.cars.has(car.id), false);
  assert.ok(w.toJSON().cars.every((c) => c.home != null), 'a visitor\'s is never saved');
});

test('while cars are locked none stands parked; they are back with them', () => {
  const { home, shop, agents, a } = town();
  agents.begin(a, agents.driveRoute(home, shop), shop.id);
  a.state = 'out';
  assert.ok(run(agents, () => a.state === 'away'));
  UNLOCKS.setBase(parseUnlocks('lock cars').rules);
  assert.equal([...agents.cars.parked()].length, 0);
  UNLOCKS.setBase([]);
  assert.equal([...agents.cars.parked()].length, 1);
});
