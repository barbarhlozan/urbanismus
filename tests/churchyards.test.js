// Churchyards closed in by walls (sim/churchyards.js), and the churches
// standing on their own inside them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { churchyards } from '../src/sim/churchyards.js';
import { findPastures } from '../src/sim/pastures.js';
import { World } from '../src/core/world.js';
import { flatWorld, fineRun } from './helpers.js';

const wall = (world, corners) => {
  const pts = [...corners, corners[0]];
  for (let k = 1; k < pts.length; k++) {
    const check = world.buildNetwork('wall', fineRun(world, pts[k - 1], pts[k]));
    assert.ok(check.ok, check.reason);
  }
};

test('a closed wall makes a churchyard full of graves; a pasture it is not', () => {
  const world = flatWorld();
  assert.equal(churchyards(world).graves.length, 0);
  wall(world, [[2, 2], [6, 2], [6, 5], [2, 5]]);
  const yards = churchyards(world);
  assert.equal(yards.list.length, 1);
  assert.ok(yards.graves.length > 60, `${yards.graves.length} graves`);
  assert.ok(yards.graves.every((g) => g.x > 2 && g.x < 6 && g.y > 2 && g.y < 5));
  assert.equal(findPastures(world).list.length, 0);
});

test('the graves keep off a footpath through the gateway, and stay where they are', () => {
  const world = flatWorld();
  wall(world, [[2, 2], [6, 2], [6, 5], [2, 5]]);
  const before = churchyards(world).graves.length;
  assert.ok(world.buildNetwork('path', fineRun(world, [4, 1], [4, 4])).ok);
  const after = churchyards(world).graves;
  assert.equal(churchyards(world).list.length, 1); // (a path doesn't open it)
  assert.ok(after.length < before);
  assert.ok(!after.some((g) => Math.abs(g.x + 0.0225 - 4) < 0.1 && g.y < 4));
});

test('a road through the wall opens it: no graves', () => {
  const world = flatWorld();
  wall(world, [[2, 2], [6, 2], [6, 5], [2, 5]]);
  assert.ok(world.buildNetwork('road', fineRun(world, [4, 0], [4, 7]).filter((_, i) => i % 2 === 0).map((f) => world.fineToCoarse(f))).ok);
  assert.equal(churchyards(world).graves.length, 0);
});

test('a wall survives a save', () => {
  const world = flatWorld();
  wall(world, [[2, 2], [6, 2], [6, 5], [2, 5]]);
  const back = World.fromJSON(JSON.parse(JSON.stringify(world.toJSON())));
  assert.equal(churchyards(back).graves.length, churchyards(world).graves.length);
});
