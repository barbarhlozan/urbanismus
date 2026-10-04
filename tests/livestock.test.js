// Cows and sheep in fenced pastures (sim/livestock.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { LivestockSystem } from '../src/sim/livestock.js';
import { livestockSVG } from '../src/render/livestock.js';
import { flatWorld, run, fineRun } from './helpers.js';

const pasture = (world, corners) => {
  const pts = [...corners, corners[0]];
  for (let k = 1; k < pts.length; k++) assert.ok(world.buildNetwork('fence', fineRun(world, pts[k - 1], pts[k])).ok);
};

test('a closed pasture gets a herd that stays inside the fence', () => {
  const world = flatWorld();
  const herd = new LivestockSystem(world, CONFIG);
  herd.update(0.1);
  assert.equal(herd.count, 0);
  pasture(world, [[2, 2], [11, 2], [11, 8], [2, 8]]); // 54 squares
  herd.update(0.1);
  assert.equal(herd.count, Math.min(CONFIG.livestock.most, Math.floor(54 / CONFIG.livestock.area.cow)));
  for (const a of herd.visible()) assert.equal(a.kind, 'cow'); // (flat: cows)
  const poses = new Set();
  for (let t = 0; t < 2000; t++) {
    herd.update(0.25);
    for (const a of herd.visible()) {
      poses.add(a.pose);
      assert.ok(a.x > 2 && a.x < 11 && a.y > 2 && a.y < 8, `${a.x}, ${a.y} is out of the pasture`);
    }
  }
  for (const p of ['graze', 'walk', 'lie']) assert.ok(poses.has(p), p);
});

test('steep pastures keep sheep', () => {
  const world = flatWorld();
  const herd = new LivestockSystem(world, { livestock: { ...CONFIG.livestock, steep: -1 } });
  pasture(world, [[2, 2], [8, 2], [8, 6], [2, 6]]);
  herd.update(0.1);
  assert.ok(herd.count > 0);
  for (const a of herd.visible()) assert.equal(a.kind, 'sheep');
});

test('a road through the pasture opens it: the herd is gone', () => {
  const world = flatWorld();
  const herd = new LivestockSystem(world, CONFIG);
  pasture(world, [[2, 2], [11, 2], [11, 8], [2, 8]]);
  herd.update(0.1);
  assert.ok(herd.count > 0);
  world.buildRoad(run(world, [6, 0], [6, 12]));
  herd.update(0.1);
  assert.equal(herd.count, 0);
});

test('cows and sheep draw in every pose', () => {
  for (const kind of ['cow', 'sheep']) {
    for (const pose of ['stand', 'step', 'graze', 'lie']) {
      for (const v of [0, 5]) assert.match(livestockSVG(kind, pose, v), /fig-/);
    }
  }
});
