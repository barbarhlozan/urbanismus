import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Land } from '../src/core/land.js';
import { World } from '../src/core/world.js';

test('round land is the same for a seed and stays inside the grid', () => {
  const a = new Land(30, 30, 7, 'round'), b = new Land(30, 30, 7, 'round');
  assert.deepEqual(a.outline(), b.outline());
  for (const [x, y] of a.outline()) assert.ok(x > -0.5 && y > -0.5 && x < 29.5 && y < 29.5);
  assert.ok(a.inside(14.5, 14.5, 10));
  assert.ok(!a.inside(0, 0));
});

test('a road ending at the land edge is a map exit', () => {
  const world = new World({ width: 30, height: 30, seed: 7, land: 'round' });
  const r = world.land.radiusAt(Math.PI);
  const x = 14.5 - r;
  const laid = world.layWay('road', [[x + 6, 14.5], [x + 3, 14.5], [x, 14.5]]);
  assert.ok(laid.ok, laid.reason);
  const exits = world.roadExits();
  assert.equal(exits.length, 1);
  assert.ok(exits[0].dir[0] < -0.9);
  assert.equal(world.layWay('road', [[x + 6, 20], [x - 2, 20]]).ok, false);
});
