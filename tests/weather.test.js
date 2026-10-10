import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { WeatherSystem } from '../src/sim/weather.js';
import { World } from '../src/core/world.js';
import { flatWorld } from './helpers.js';

const kinds = CONFIG.weather.kinds;

function run(world, seconds, step = 5) {
  const sys = new WeatherSystem(world, CONFIG);
  const seen = [world.weather.kind];
  for (let t = 0; t < seconds; t += step) {
    world.time = t;
    sys.update();
    if (world.weather.kind !== seen.at(-1)) seen.push(world.weather.kind);
  }
  return seen;
}

test('the weather turns only to what may follow it', () => {
  const seen = run(flatWorld(), 40000);
  assert.ok(seen.length > 5, 'it changes over time');
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] in CONFIG.weather.next[seen[i - 1]], `${seen[i - 1]} -> ${seen[i]}`);
  }
});

test('it is mostly cloudy, and rains now and then', () => {
  const time = {};
  for (let seed = 1; seed <= 10; seed++) {
    const world = flatWorld();
    world.seed = seed;
    const sys = new WeatherSystem(world, CONFIG);
    for (let t = 0; t < 100000; t += 10) {
      world.time = t;
      sys.update();
      time[world.weather.kind] = (time[world.weather.kind] ?? 0) + 1;
    }
  }
  const most = Object.entries(time).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(most, 'cloudy');
  const total = Object.values(time).reduce((a, b) => a + b);
  assert.ok((time.rain + time.storm) / total < 0.25);
});

test('the same seed gives the same weather', () => {
  assert.deepEqual(run(flatWorld(), 20000), run(flatWorld(), 20000));
});

test('a long gap catches up in one go', () => {
  const world = flatWorld();
  const sys = new WeatherSystem(world, CONFIG);
  world.time = 100000;
  sys.update();
  assert.ok(world.weather.until > world.time);
  assert.ok(kinds.includes(world.weather.kind));
});

test('the weather survives saving and loading, and old saves start fair', () => {
  const world = flatWorld();
  run(world, 5000);
  const json = JSON.parse(JSON.stringify(world.toJSON()));
  assert.deepEqual(World.fromJSON(json).weather, world.weather);
  delete json.weather;
  assert.equal(World.fromJSON(json).weather.kind, 'fair'); // (World's own default, before the system starts it)
});

test('a save from when there was overcast starts cloudy', () => {
  const world = flatWorld();
  const json = JSON.parse(JSON.stringify(world.toJSON()));
  json.weather = { kind: 'overcast', until: 0, n: 3 };
  const loaded = World.fromJSON(json);
  new WeatherSystem(loaded, CONFIG);
  assert.equal(loaded.weather.kind, 'cloudy');
  assert.ok(loaded.weather.until > loaded.time);
  assert.ok(!kinds.includes('overcast'));
});

test('set() makes the weather so, for a spell', () => {
  const world = flatWorld();
  const sys = new WeatherSystem(world, CONFIG);
  sys.set('rain');
  assert.equal(world.weather.kind, 'rain');
  assert.ok(world.weather.until > world.time);
  assert.throws(() => sys.set('snow'));
  assert.throws(() => sys.set('overcast'));
});

test('in a storm fewer people cycle, and walkers draw with umbrellas', async () => {
  const { AgentSystem } = await import('../src/sim/agents.js');
  const { walkerSVG } = await import('../src/render/people.js');
  const world = flatWorld();
  const agents = new AgentSystem(world, CONFIG);
  const fair = agents.bikeChance(3);
  world.weather.kind = 'storm';
  assert.ok(agents.bikeChance(3) < fair);
  assert.equal(agents.weather().activities.stroll, 0);
  assert.ok(walkerSVG(0, true).length > walkerSVG(0).length);
});
