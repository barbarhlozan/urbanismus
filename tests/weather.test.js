import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { WeatherSystem, mistRisen } from '../src/sim/weather.js';
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

test('it is mostly dry, and rains now and then', () => {
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
  const total = Object.values(time).reduce((a, b) => a + b);
  const wet = (time.rain + time.storm) / total;
  assert.ok(wet > 0.1 && wet < 0.3, `wet ${wet}`);
  assert.ok(time.storm < time.rain);
});

// Every spell over two hours of a few towns: { kind: [seconds, …] }.
function spells() {
  const out = {};
  for (let seed = 1; seed <= 20; seed++) {
    const world = flatWorld();
    world.seed = seed;
    const sys = new WeatherSystem(world, CONFIG);
    let kind = world.weather.kind, start = 0;
    for (let t = 0; t < 7200; t++) {
      world.time = t;
      sys.update();
      if (world.weather.kind !== kind) {
        if (start) (out[kind] ??= []).push(t - start); // (not the first, cut short)
        kind = world.weather.kind;
        start = t;
      }
    }
  }
  return out;
}

test('it changes every few minutes, not every few tens', () => {
  const all = Object.values(spells()).flat();
  const mean = all.reduce((a, b) => a + b) / all.length;
  assert.ok(mean > 90 && mean < 240, `a spell lasts ${mean} s on average`);
  assert.ok(Math.max(...all) <= 600);
});

test('fair weather is mostly short, but now and then it lasts', () => {
  const fair = spells().fair.sort((a, b) => a - b);
  assert.ok(fair[Math.floor(fair.length / 2)] < 240, 'half are under four minutes');
  assert.ok(fair.some((s) => s > 420), 'some go on over seven');
});

test('a storm can build out of clouds, and clears to fair', () => {
  const seen = [];
  for (let seed = 1; seed <= 10; seed++) {
    const world = flatWorld();
    world.seed = seed;
    seen.push(...run(world, 20000, 1).map((k, i, a) => `${a[i - 1]}>${k}`));
  }
  assert.ok(seen.includes('cloudy>storm'));
  assert.ok(seen.includes('storm>fair'));
  assert.ok(seen.includes('rain>cloudy'), 'a shower passes');
  assert.ok(!seen.includes('fair>rain') && !seen.includes('fair>storm'), 'never without clouds first');
});

test('each blend fits in the shortest spell', () => {
  const shortest = Math.min(...Object.values(CONFIG.weather.lasts).map(([a]) => a));
  for (const [q, [before, after]] of Object.entries(CONFIG.weather.blend)) {
    assert.ok(before + after <= shortest, q);
    assert.ok(q in CONFIG.weather, `config.weather.${q}`);
  }
});

test('the look of it goes over gradually, the wind first', () => {
  const world = flatWorld();
  const sys = new WeatherSystem(world, CONFIG);
  const w = world.weather;
  Object.assign(w, { kind: 'cloudy', from: 'cloudy', since: 0, until: 200 });
  sys.following = () => 'storm';
  const [lead] = CONFIG.weather.blend.wind;
  assert.equal(sys.sky(100).wind, CONFIG.weather.wind.cloudy);
  assert.ok(sys.sky(200 - lead / 2).wind > CONFIG.weather.wind.cloudy, 'the wind picks up before the storm');
  assert.equal(sys.sky(200 - lead / 2).rain, 0, 'before it rains');
  const before = sys.sky(199.99);
  // the storm comes: no jump across the change, and the rain thickens
  world.time = 200;
  sys.update();
  assert.equal(w.kind, 'storm');
  assert.equal(w.from, 'cloudy');
  const after = sys.sky(200);
  for (const q of Object.keys(before)) assert.ok(Math.abs(after[q] - before[q]) < 0.02, q);
  let last = -1;
  for (let t = 200; t <= 240; t += 5) {
    const { rain } = sys.sky(t);
    assert.ok(rain >= last);
    last = rain;
  }
  assert.equal(last, CONFIG.weather.rain.storm);
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

test('mist comes only after fair weather', () => {
  for (const [from, to] of Object.entries(CONFIG.weather.next)) if (from !== 'fair') assert.ok(!('mist' in to), `${from} -> mist`);
  let seen = false;
  for (let seed = 1; seed <= 10 && !seen; seed++) {
    const world = flatWorld();
    world.seed = seed;
    seen = run(world, 60000).includes('mist');
  }
  assert.ok(seen, 'it does come now and then');
});

test('a save from before `from` loads with no blend in', () => {
  const world = flatWorld();
  run(world, 8000);
  const json = JSON.parse(JSON.stringify(world.toJSON()));
  delete json.weather.from;
  const loaded = World.fromJSON(json);
  new WeatherSystem(loaded, CONFIG);
  assert.equal(loaded.weather.from, loaded.weather.kind);
});

test('each spell knows when it began, old saves included', () => {
  const world = flatWorld();
  run(world, 8000);
  const w = world.weather;
  assert.ok(w.since < w.until && w.since <= world.time);
  const json = JSON.parse(JSON.stringify(world.toJSON()));
  delete json.weather.since;
  const loaded = World.fromJSON(json);
  new WeatherSystem(loaded, CONFIG);
  assert.equal(loaded.weather.since, w.since);
});

test('the mist rises in steps, and sinks again before it goes', () => {
  const opts = { rise: 40, steps: 5 };
  const w = { kind: 'mist', since: 100, until: 500 };
  assert.equal(mistRisen({ ...w, kind: 'fair' }, 300, opts), 0);
  assert.equal(mistRisen(w, 100, opts), 0);
  assert.equal(mistRisen(w, 101, opts), 0.2);
  assert.equal(mistRisen(w, 120, opts), 0.6);
  assert.equal(mistRisen(w, 300, opts), 1);
  assert.equal(mistRisen(w, 490, opts), 0.4);
  assert.equal(mistRisen(w, 500, opts), 0);
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
