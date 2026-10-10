// Traffic: vehicles keep behind the one in front and queue, pass cyclists
// by the edge, don't lock up at a junction; slower through the village.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road } from './helpers.js';
import { CONFIG } from '../src/config.js';
import { AgentSystem } from '../src/sim/agents.js';
import { UNLOCKS } from '../src/story/unlocks.js';
import { pointAt } from '../src/roads/geometry.js';

// A town with roads, two buildings at a time to drive between, and nobody
// out but the drivers a test sends.
function town(build) {
  const w = flatWorld(30, 30);
  UNLOCKS.setWorld(w);
  build(w);
  const agents = new AgentSystem(w, CONFIG);
  return { w, agents };
}

// Someone from `from` on the way to `to`, by `mode`, `ahead` along already.
function send(agents, from, to, mode = 'drive', ahead = 0) {
  const a = agents.agents.get(`${from.id}:0`);
  const plan = mode === 'drive' ? agents.driveRoute(from, to) : { mode: 'cycle', ...agents.ride.route(from, to, 40) };
  agents.begin(a, plan, to.id);
  a.state = 'out';
  a.s = ahead;
  return a;
}

// Nobody else about.
function only(agents, ...list) {
  agents.agents.clear();
  for (const a of list) agents.agents.set(a.id, a);
}

// Runs the agents for `seconds`, calling check() after every frame.
function run(agents, seconds, check = () => {}, dt = 1 / 30) {
  for (let t = 0; t < seconds; t += dt) {
    agents.update(dt);
    check(t);
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('a car stops behind one standing in its lane and goes on after it', () => {
  let home, home2, shop;
  const { agents } = town((w) => {
    road(w, [1, 5], [28, 5]);
    home = w.placeStructure('house', w.grid.index(2, 6));
    home2 = w.placeStructure('house', w.grid.index(4, 6));
    shop = w.placeStructure('jednota', w.grid.index(26, 6));
  });
  const lead = send(agents, home2, shop, 'drive', 3);
  const lag = send(agents, home, shop);
  only(agents, lead, lag);
  const stop = lead.s;
  let closest = Infinity;
  // the one in front stands (held where it is) for a while…
  run(agents, 25, () => {
    lead.s = stop;
    closest = Math.min(closest, dist(lead, lag));
  });
  assert.ok(lag.s > stop - 0.5, `the one behind came up (${lag.s.toFixed(2)} of ${stop.toFixed(2)})`);
  assert.ok(closest > 0.17 + CONFIG.traffic.gap.drive * 0.8, `and kept behind (${closest.toFixed(3)} apart at the closest)`);
  // …then both drive on, never into each other
  const before = lag.s;
  run(agents, 6, () => (closest = Math.min(closest, dist(lead, lag))));
  assert.ok(lag.s > before + 0.5);
  assert.ok(closest > 0.18, `${closest.toFixed(3)}`);
});

test('cars pass a cyclist by the edge', () => {
  let home, home2, shop;
  const { agents } = town((w) => {
    road(w, [1, 5], [28, 5]);
    home = w.placeStructure('house', w.grid.index(2, 6));
    home2 = w.placeStructure('house', w.grid.index(4, 4));
    shop = w.placeStructure('jednota', w.grid.index(26, 6));
  });
  const bike = send(agents, home2, shop, 'cycle', 3);
  const car = send(agents, home, shop);
  only(agents, bike, car);
  let slowest = 1;
  run(agents, 30, () => (slowest = Math.min(slowest, car.state === 'out' && car.x > 4 ? car.followK : 1)));
  assert.ok(car.x > bike.x + 1, 'the car got past');
  assert.equal(slowest, 1, 'without slowing down for it');
});

test('two cars meeting across a crossroads both get through', () => {
  let a1, a2, b1, b2;
  const { agents } = town((w) => {
    road(w, [2, 10], [18, 10]);
    road(w, [10, 2], [10, 18]);
    a1 = w.placeStructure('house', w.grid.index(3, 11));
    a2 = w.placeStructure('jednota', w.grid.index(17, 11));
    b1 = w.placeStructure('house', w.grid.index(11, 3));
    b2 = w.placeStructure('jednota', w.grid.index(11, 17));
  });
  const east = send(agents, a1, a2);
  const south = send(agents, b1, b2);
  only(agents, east, south);
  // both about as far from the middle
  east.s = east.trip.out.total / 2 - 0.6;
  south.s = south.trip.out.total / 2 - 0.6;
  let closest = Infinity;
  run(agents, 30, () => {
    if (east.state === 'out' && south.state === 'out') closest = Math.min(closest, dist(east, south));
  });
  assert.notEqual(east.state, 'out', 'east got there');
  assert.notEqual(south.state, 'out', 'south got there');
  assert.ok(closest > 0.1, `kept apart crossing (${closest.toFixed(3)})`);
});

test('slower through the village than on the open road', () => {
  let home, far;
  const { agents } = town((w) => {
    road(w, [1, 5], [28, 5]);
    home = w.placeStructure('house', w.grid.index(2, 6));
    far = w.placeStructure('jednota', w.grid.index(27, 6));
  });
  const car = send(agents, home, far);
  only(agents, car);
  const k = car.trip.out.pace;
  const at = (x) => k[car.trip.out.points.findIndex((p) => p[0] >= x)];
  assert.equal(at(14), 1);                    // out in the fields
  assert.equal(at(2.5), CONFIG.sim.village); // by the house
});

test('a car and a cyclist side by side round a bend don\'t hold each other up', () => {
  let home, home2, shop;
  const { agents } = town((w) => {
    road(w, [1, 5], [10, 5]);
    road(w, [10, 5], [10, 20]);
    home = w.placeStructure('house', w.grid.index(2, 6));
    home2 = w.placeStructure('house', w.grid.index(3, 4));
    shop = w.placeStructure('jednota', w.grid.index(11, 19));
  });
  const bike = send(agents, home2, shop, 'cycle');
  const car = send(agents, home, shop);
  only(agents, bike, car);
  // both just before the bend, level with each other
  const before = (a) => {
    const leg = a.trip.out;
    a.s = leg.cum[leg.points.findIndex((p) => p[0] > 9.75)];
  };
  before(bike);
  before(car);
  run(agents, 8);
  assert.ok(car.y > 6 && bike.y > 5.6, `both round the bend (car ${car.y.toFixed(2)}, bike ${bike.y.toFixed(2)})`);
});

test('a queue waits short of a junction, not in it', () => {
  let home, home2, shop;
  const { agents } = town((w) => {
    road(w, [1, 5], [20, 5]);
    road(w, [10, 1], [10, 9]); // a crossroads at x 10
    home = w.placeStructure('house', w.grid.index(2, 6));
    home2 = w.placeStructure('house', w.grid.index(4, 6));
    shop = w.placeStructure('jednota', w.grid.index(19, 6));
  });
  const lead = send(agents, home2, shop);
  const lag = send(agents, home, shop);
  only(agents, lead, lag);
  // the one in front stands just past the junction, too near for another car to fit
  const leg = lead.trip.out;
  let s = 0;
  while (pointAt(leg, s)[0] < 10.45) s += 0.01;
  lag.s = s - 3;
  run(agents, 20, () => (lead.s = s));
  const front = lag.x + 0.085;
  assert.ok(front <= 10 - CONFIG.traffic.box + 0.03, `stopped short of it (front at ${front.toFixed(2)})`);
  assert.ok(front > 9.4, `but came up to it (${front.toFixed(2)})`);
});
