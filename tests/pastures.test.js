// Pastures closed in by fences (sim/pastures.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPastures, fenceGates } from '../src/sim/pastures.js';
import { flatWorld, run, fineRun } from './helpers.js';

// A fence through the corners given (main-dot units), back to the first if `close`.
const fence = (world, corners, close = true) => {
  const pts = close ? [...corners, corners[0]] : corners;
  for (let k = 1; k < pts.length; k++) {
    const check = world.buildNetwork('fence', fineRun(world, pts[k - 1], pts[k]));
    assert.ok(check.ok, check.reason);
  }
};

test('a square of fence closes a pasture; open, it does not', () => {
  const world = flatWorld();
  fence(world, [[2, 2], [8, 2], [8, 6]], false);
  assert.equal(findPastures(world).list.length, 0);
  fence(world, [[8, 6], [2, 6], [2, 2]], false);
  const { list, at } = findPastures(world);
  assert.equal(list.length, 1);
  assert.equal(list[0].area, 24);
  assert.equal(at(5, 4), 0);
  assert.equal(at(1, 4), -1);
  assert.equal(at(9.5, 4), -1);
  assert.equal(list[0].nodes.length, 5 * 3); // the dots inside, not on the fence
});

test('diagonal fences close it too', () => {
  const world = flatWorld();
  fence(world, [[6, 2], [10, 6], [6, 10], [2, 6]]);
  const { list, at } = findPastures(world);
  assert.equal(list.length, 1);
  assert.equal(list[0].area, 32);
  assert.equal(at(6, 6), 0);
  assert.equal(at(3, 3), -1);
});

test('two pastures sharing a fence are two', () => {
  const world = flatWorld();
  fence(world, [[2, 2], [10, 2], [10, 6], [2, 6]]);
  fence(world, [[6, 2], [6, 6]], false);
  const { list, at } = findPastures(world);
  assert.equal(list.length, 2);
  assert.notEqual(at(4, 4), at(8, 4));
});

test('a road through the fence opens the pasture', () => {
  const world = flatWorld();
  fence(world, [[2, 2], [10, 2], [10, 8], [2, 8]]);
  assert.equal(findPastures(world).list.length, 1);
  world.buildRoad(run(world, [6, 0], [6, 12]));
  assert.equal(findPastures(world).list.length, 0);
});

test('a random spot in a pasture is in it', () => {
  const world = flatWorld();
  fence(world, [[3, 3], [9, 3], [9, 7], [5, 7], [3, 5]]);
  const p = findPastures(world);
  for (let k = 0; k < 200; k++) {
    const [x, y] = p.pick(0);
    assert.equal(p.at(x, y), 0, `${x}, ${y}`);
  }
});

test('a footpath through the fence makes a gate; the pasture stays closed', () => {
  const world = flatWorld();
  fence(world, [[2, 2], [10, 2], [10, 8], [2, 8]]);
  assert.ok(world.buildNetwork('path', fineRun(world, [6, 0], [6, 5])).ok);
  const { at, across } = fenceGates(world);
  assert.deepEqual([...at], [world.fine.index(12, 4)]);
  assert.equal(across.size, 0);
  assert.equal(findPastures(world).list.length, 1);
  // a path along the fence is no gate
  assert.ok(world.buildNetwork('path', fineRun(world, [3, 8], [5, 8])).ok);
  assert.equal(fenceGates(world).at.size, 1);
});

test('a diagonal path across a diagonal fence makes a gate in the middle', () => {
  const world = flatWorld();
  fence(world, [[6, 2], [10, 6], [6, 10], [2, 6]]);
  // fence (8,4)-(8.5,4.5); the path crosses it from (8.5,4) to (8,4.5)
  assert.ok(world.buildNetwork('path', [world.fine.index(17, 8), world.fine.index(16, 9)]).ok);
  const { across } = fenceGates(world);
  assert.equal(across.size, 1);
  assert.equal(findPastures(world).list.length, 1);
});
