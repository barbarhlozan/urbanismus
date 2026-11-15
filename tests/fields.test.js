// Crop fields closed in by field edges (sim/fields.js), grown by the
// meadow (render/meadow.js plant).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.js';
import { flatWorld, road, run } from './helpers.js';
import { fieldsOf } from '../src/sim/fields.js';
import { meadowGround, plant } from '../src/render/meadow.js';
import { CONFIG } from '../src/config.js';

// a loop of field edges through the corners, laid as the tool lays them
const field = (world, corners, crop) => {
  const pts = [...corners, corners[0]];
  for (let k = 1; k < pts.length; k++) assert.ok(world.layWay('field', [pts[k - 1], pts[k]], { crop }).ok, `edge ${k}`);
};

test('a closed loop of field edges is a field of its crop, rows along its long side', () => {
  const world = flatWorld();
  field(world, [[2, 2], [10, 2], [10, 6], [2, 6]], 'potatoes');
  const found = fieldsOf(world);
  assert.equal(found.list.length, 1);
  assert.equal(found.list[0].crop, 'potatoes');
  assert.equal(found.list[0].along, 'x');
  assert.ok(found.at(5, 4) >= 0);
  assert.equal(found.at(12, 4), -1);
});

test('an open loop is no field; a road through an edge opens it', () => {
  const world = flatWorld();
  const pts = [[2, 2], [8, 2], [8, 8], [2, 8]];
  for (let k = 1; k < pts.length; k++) world.layWay('field', [pts[k - 1], pts[k]], { crop: 'grain' });
  assert.equal(fieldsOf(world).list.length, 0);
  world.layWay('field', [[2, 8], [2, 2]], { crop: 'grain' });
  assert.equal(fieldsOf(world).list.length, 1);
  assert.ok(road(world, [5, 0], [5, 12]).ok);
  assert.equal(fieldsOf(world).list.length, 0);
});

test('the field grows its crop and no meadow; outside it the meadow is as before', () => {
  const world = flatWorld();
  field(world, [[2, 2], [8, 2], [8, 8], [2, 8]], 'grain');
  const ground = meadowGround(world, CONFIG);
  const inside = plant(world, ground, 5, 5);
  assert.ok(inside.length > 30, `only ${inside.length} plants`);
  assert.ok(inside.every((p) => p.parts.some(([, pen]) => pen === 'grain')));
  const outside = plant(world, ground, 14, 14);
  assert.ok(outside.every((p) => !p.parts.some(([, pen]) => pen === 'grain' || pen === 'leaf')));
});

test('potatoes: ridges on the ground and leaves; redrawing an edge with grain switches the crop', () => {
  const world = flatWorld();
  field(world, [[2, 2], [6, 2], [6, 6], [2, 6]], 'potatoes');
  const ground = meadowGround(world, CONFIG);
  const at = plant(world, ground, 4, 4);
  assert.ok(at.some((p) => p.ground?.[0][1] === 'ridge'));
  assert.ok(at.some((p) => p.parts.some(([, pen]) => pen === 'leaf')));
  for (const [a, b] of [[[2, 2], [6, 2]], [[6, 2], [6, 6]], [[6, 6], [2, 6]]]) assert.ok(world.layWay('field', [a, b], { crop: 'grain' }).ok);
  assert.equal(fieldsOf(world).list[0].crop, 'grain');
});

test('fields and their crops survive a save', () => {
  const world = flatWorld();
  field(world, [[2, 2], [6, 2], [6, 6], [2, 6]], 'potatoes');
  const back = World.fromJSON(JSON.parse(JSON.stringify(world.toJSON())));
  assert.equal(fieldsOf(back).list[0]?.crop, 'potatoes');
});
