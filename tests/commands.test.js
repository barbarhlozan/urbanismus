import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createCommands } from '../src/dev/commands.js';
import { WeatherSystem } from '../src/sim/weather.js';
import { SimClock } from '../src/sim/clock.js';
import { flatWorld } from './helpers.js';

function kit() {
  const world = flatWorld();
  const clock = new SimClock(CONFIG);
  const weather = new WeatherSystem(world, CONFIG);
  const calls = [];
  const sys = (name) => ({ update: (dt) => calls.push(name), launch: () => 'x', herds: new Map(), boats: new Map(), animals: new Map() });
  const cmd = createCommands({
    world, config: CONFIG, clock, weather,
    agents: sys('agents'), trains: sys('trains'), boats: sys('boats'), deer: sys('deer'), livestock: sys('livestock'), growth: sys('growth'),
    unlocks: { apply: () => {} }, save: () => {},
  });
  return { cmd, world, clock, calls };
}

test('cmd.weather sets and reads the weather', () => {
  const { cmd } = kit();
  cmd.weather('rain');
  assert.equal(cmd.weather(), 'rain');
  assert.throws(() => cmd.weather('snow'));
});

test('cmd.spawn knows its names and counts what it made', () => {
  const { cmd } = kit();
  assert.equal(cmd.spawn('deer', 3), 3);
  assert.throws(() => cmd.spawn('dragon'));
});

test('cmd.time pauses and plays', () => {
  const { cmd, clock } = kit();
  cmd.time('pause');
  assert.equal(clock.paused, true);
  cmd.time('play');
  assert.equal(clock.paused, false);
  assert.throws(() => cmd.time(99));
});

test('cmd.jump runs the town ahead and moves the clock', () => {
  const { cmd, world, clock } = kit();
  cmd.jump(1);
  assert.equal(clock.elapsed, 60);
  assert.equal(world.time, 60);
});

test('cmd.build, road, tree and erase change the town', () => {
  const { cmd, world } = kit();
  assert.equal(cmd.road('road', [2, 2], [8, 2]), true);
  assert.ok(world.hasRoad(world.grid.index(5, 2)));
  const house = cmd.build('house', 3, 5);
  assert.ok(house && world.structures.has(house.id));
  assert.ok(cmd.tree(10, 10));
  assert.equal(cmd.erase(10, 10), true);
  assert.equal(cmd.erase(3, 5), true);
  assert.equal(world.structures.size, 0);
  assert.equal(cmd.erase(15, 15), false);
});

test('cmd.build refuses what does not fit and unknown names', () => {
  const { cmd } = kit();
  assert.ok(cmd.build('house', 3, 5));
  const warn = console.warn;
  console.warn = () => {};
  assert.equal(cmd.build('house', 3, 5), false);
  assert.equal(cmd.road('road', [1, 1], [1, 1]), false);
  console.warn = warn;
  assert.throws(() => cmd.build('castle-in-the-air', 1, 1));
  assert.ok(cmd.types().includes('house'));
});
