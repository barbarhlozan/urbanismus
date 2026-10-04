// Too steep to build (CONFIG.steep): buildings keep off steep ground (parks
// don't mind), roads and railways off steep climbs; footpaths go anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { flatWorld, run, fineRun } from './helpers.js';

// a world on a ramp rising along x, `rise` metres per grid step
function ramp(rise) {
  const world = flatWorld();
  world._relief = { rivers: world.terrain.rivers, field: null, elevation: (x) => rise * x };
  return world;
}

test('buildings stay off ground steeper than the limit', () => {
  const steep = ramp(CONFIG.steep.build + 2);
  assert.equal(steep.canPlaceStructure('house', steep.grid.index(10, 10)).reason, 'Too steep');
  const gentle = ramp(CONFIG.steep.build - 2);
  assert.ok(gentle.canPlaceStructure('house', gentle.grid.index(10, 10)).ok);
});

test('parks go on any slope, squares do not', () => {
  const world = ramp(CONFIG.steep.build * 3);
  assert.ok(world.canPlaceStructure('green', world.grid.index(10, 10)).ok);
  assert.ok(world.canPlaceStructure('meadow', world.grid.index(10, 10)).ok);
  assert.equal(world.canPlaceStructure('plaza', world.grid.index(10, 10)).reason, 'Too steep');
});

test('a road may cross a steep slope but not climb it', () => {
  const world = ramp(CONFIG.steep.road + 2);
  const up = world.buildNetwork('road', run(world, [5, 5], [9, 5]));
  assert.ok(!up?.ok && up?.reason === 'Too steep', 'straight up the slope');
  const across = world.buildNetwork('road', run(world, [5, 5], [5, 9]));
  assert.ok(across === true || across?.ok !== false, 'along the slope');
});

test('railways need gentler ground than roads, footpaths none', () => {
  const world = ramp(CONFIG.steep.rail + 1);
  const rail = world.buildNetwork('rail', fineRun(world, [5, 5], [9, 5]));
  assert.ok(!rail?.ok && rail?.reason === 'Too steep');
  const path = world.buildNetwork('path', fineRun(world, [5, 7], [9, 7]));
  assert.ok(path === true || path?.ok !== false);
});
