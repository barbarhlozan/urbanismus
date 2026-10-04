// Deer out of the forests to graze (sim/deer.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { DeerSystem } from '../src/sim/deer.js';
import { DEER_KINDS, deerSVG } from '../src/render/deer.js';
import { flatWorld, run } from './helpers.js';

// A flat map with a block of forest on its left side.
const forestWorld = () => {
  const world = flatWorld(24, 16);
  for (let y = 2; y < 14; y++) for (let x = 0; x < 7; x++) world.addFeature('tree', world.grid.index(x, y));
  return world;
};

const runFor = (deer, seconds, each = () => {}) => {
  for (let t = 0; t < seconds; t += 0.25) {
    deer.update(0.25);
    each();
  }
};

test('a herd walks out of the forest, grazes on open grass and goes back in', () => {
  const world = forestWorld();
  const deer = new DeerSystem(world, { deer: { ...CONFIG.deer, interval: [1e9, 1e9] } });
  const herd = deer.launch();
  assert.ok(herd);
  assert.ok(deer.isTree(herd.start));
  assert.ok(deer.grazing(herd.spot));
  assert.ok(herd.members.length >= 1 && herd.members.length <= 4);
  for (const m of herd.members) assert.ok(DEER_KINDS[m.kind], m.kind);
  let grazed = false;
  runFor(deer, 600, () => {
    for (const d of deer.visible()) {
      const n = world.grid.nodeAt(d.x, d.y);
      assert.ok(n >= 0, 'stays on the map');
      if (d.pose === 'graze') grazed = true;
    }
  });
  assert.ok(grazed, 'put its head down at some point');
  assert.equal(deer.count, 0, 'gone back into the forest');
});

test('no forest, no deer', () => {
  const world = flatWorld(16, 16);
  const deer = new DeerSystem(world, CONFIG);
  runFor(deer, 400);
  assert.equal(deer.count, 0);
});

test('they never graze on roads, by buildings or among trees', () => {
  const world = forestWorld();
  world.buildRoad(run(world, [9, 0], [9, 15]));
  const deer = new DeerSystem(world, CONFIG);
  for (let n = 0; n < world.grid.size; n++) {
    if (!deer.grazing(n)) continue;
    assert.ok(!world.hasRoad(n) && !world.featureAt(n) && !world.structureAt(n));
  }
  for (let k = 0; k < 30; k++) {
    const h = deer.launch();
    if (h) assert.ok(!world.hasRoad(h.spot));
  }
});

test('someone coming near sends them running back', () => {
  const world = forestWorld();
  const agents = { list: [], *visible() { yield* this.list; } };
  const deer = new DeerSystem(world, { deer: { ...CONFIG.deer, interval: [1e9, 1e9] } }, agents);
  const herd = deer.launch();
  // walk up to it once it's grazing
  for (let t = 0; t < 1200 && herd.state !== 'graze'; t++) deer.update(0.25);
  assert.equal(herd.state, 'graze');
  const m = herd.members[0];
  agents.list = [{ x: m.x + 0.5, y: m.y }];
  deer.update(0.6);
  assert.equal(herd.state, 'back');
  assert.equal(herd.speed, CONFIG.deer.run);
});

test('every kind draws in every pose', () => {
  for (const kind of Object.keys(DEER_KINDS)) {
    for (const pose of ['stand', 'step', 'graze']) assert.match(deerSVG(kind, pose, 3), /fig-body/);
  }
});
