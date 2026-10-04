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

test('the weather changes only to a neighbouring kind', () => {
  const seen = run(flatWorld(), 40000);
  assert.ok(seen.length > 5, 'it changes over time');
  for (let i = 1; i < seen.length; i++) {
    assert.equal(Math.abs(kinds.indexOf(seen[i]) - kinds.indexOf(seen[i - 1])), 1);
  }
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
  assert.equal(World.fromJSON(json).weather.kind, 'fair');
});

test('set() makes the weather so, for a spell', () => {
  const world = flatWorld();
  const sys = new WeatherSystem(world, CONFIG);
  sys.set('rain');
  assert.equal(world.weather.kind, 'rain');
  assert.ok(world.weather.until > world.time);
  assert.throws(() => sys.set('snow'));
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
