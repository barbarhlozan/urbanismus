// Canoes down the rivers and streams (sim/boats.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.js';
import { generateWorld } from '../src/terrain/generate.js';
import { CONFIG } from '../src/config.js';
import { BoatSystem } from '../src/sim/boats.js';

const riverWorld = (size = 'river', tributaries = 2) => {
  const world = new World({ ...CONFIG.grid, seed: 4242 });
  generateWorld(world, { ...CONFIG, terrain: { ...CONFIG.terrain, riverChance: 1, riverSize: size, tributaries } });
  return world;
};

test('a tributary\'s canoes carry on down the river it runs into', () => {
  const world = riverWorld();
  const boats = new BoatSystem(world, CONFIG);
  const [main, ...tribs] = boats.routes;
  assert.ok(tribs.length);
  for (const t of tribs) {
    // it ends where the river does
    assert.deepEqual(t.points.at(-1), main.points.at(-1));
    assert.ok(t.at.at(-1) > 0);
  }
});

test('canoes come in groups of one to five, stay on the water and leave at the end', () => {
  for (const size of ['river', 'stream']) {
    const world = riverWorld(size);
    const boats = new BoatSystem(world, CONFIG);
    const field = world.riverField;
    const sizes = new Set();
    for (let n = 0; n < 40; n++) {
      boats.boats.clear();
      boats.launch();
      sizes.add(boats.count);
      for (const b of boats.boats.values()) assert.ok(b.crew.length === 1 || b.crew.length === 2);
    }
    assert.ok([...sizes].every((k) => k >= 1 && k <= 5), [...sizes].join());
    // float them all the way down, checking they keep to the water
    let seen = 0;
    for (let t = 0; t < 2000 && boats.count; t++) {
      boats.time += 0.5;
      for (const b of boats.boats.values()) b.s += 0.25;
      boats.update(1e-9);
      for (const b of boats.visible()) {
        seen++;
        assert.ok(field.depth(b.x, b.y) > 0, `${size}: a canoe at ${b.x}, ${b.y} is out of the water`);
      }
    }
    assert.ok(seen > 0);
    assert.equal(boats.count, 0);
  }
});

test('no river, no canoes', () => {
  const world = riverWorld('river', 0);
  world.terrain.rivers = [];
  const boats = new BoatSystem(world, CONFIG);
  boats.update(1000);
  assert.equal(boats.count, 0);
});

test('now and then canoes put in by a house near the water', () => {
  const world = riverWorld('river', 0);
  const boats = new BoatSystem(world, CONFIG);
  assert.equal(boats.landings().length, 0);
  // a house on dry land a step or two from the river's line
  const field = world.riverField, { grid } = world;
  let node = -1;
  for (let i = 0; i < grid.size && node < 0; i++) {
    const [x, y] = grid.xy(i), d = field.at(x, y)?.d ?? Infinity;
    if (d > 1.5 && d < 2.5 && !world.terrain.isWater(i) && world.placeStructure('house', i)) node = i;
  }
  assert.ok(node >= 0, 'no spot for the house');
  assert.ok(boats.landings().length);
  // from there: one or two, appearing beside the house, not at the edge
  boats.config = { ...CONFIG.boats, fromHome: 1 };
  boats.launch();
  assert.ok(boats.count >= 1 && boats.count <= CONFIG.boats.homeGroup);
  const [first] = boats.visible();
  assert.ok(first.home);
  assert.ok(Math.hypot(first.x - grid.xy(node)[0], first.y - grid.xy(node)[1]) < CONFIG.boats.homeReach + 1.5);
});
