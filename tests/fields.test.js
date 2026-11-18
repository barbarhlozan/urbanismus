// Crop fields painted on the ground (world/crops.js, sim/fields.js), cut
// by what's built on them, grown by the meadow (render/meadow.js plant).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.js';
import { flatWorld, road } from './helpers.js';
import { fieldsOf } from '../src/sim/fields.js';
import { meadowGround, plant } from '../src/render/meadow.js';
import { CONFIG } from '../src/config.js';

// a rectangle sown, as brush strokes back and forth across it
const sow = (world, [x0, y0], [x1, y1], crop) => {
  for (let y = y0 + 0.25; y < y1; y += 0.5) world.paintCrops([[x0 + 0.25, y], [x1 - 0.25, y]], 0.24, crop);
};

test('ground sown is a field of its crop, rows along its long side', () => {
  const world = flatWorld();
  sow(world, [2, 2], [10, 6], 'potatoes');
  const found = fieldsOf(world);
  assert.equal(found.list.length, 1);
  assert.equal(found.list[0].crop, 'potatoes');
  assert.equal(found.list[0].along, 'x');
  assert.equal(found.list[0].area, 32);
  assert.ok(found.at(5, 4) >= 0);
  assert.equal(found.at(12, 4), -1);
});

test('sown next to a field of the same crop it grows the field; the other crop is a field of its own', () => {
  const world = flatWorld();
  sow(world, [2, 2], [6, 6], 'grain');
  sow(world, [6, 2], [9, 6], 'grain');
  assert.equal(fieldsOf(world).list.length, 1);
  sow(world, [9, 2], [12, 6], 'potatoes');
  const found = fieldsOf(world);
  assert.equal(found.list.length, 2);
  assert.deepEqual(found.list.map((f) => f.crop).sort(), ['grain', 'potatoes']);
  // painted over with the other crop: it takes its place
  sow(world, [2, 2], [12, 6], 'potatoes');
  assert.equal(fieldsOf(world).list.length, 1);
});

test('a road across a field makes two; taken away, one again', () => {
  const world = flatWorld();
  sow(world, [2, 2], [10, 8], 'grain');
  assert.ok(world.layWay('road', [[6, 0], [6, 12]]).ok);
  const found = fieldsOf(world);
  assert.equal(found.list.length, 2);
  assert.equal(found.at(6, 5), -1); // (the road)
  assert.notEqual(found.at(4, 5), found.at(8, 5));
  world.removeWay([...world.ways.edges.values()].find((e) => e.kind === 'road').id);
  assert.equal(fieldsOf(world).list.length, 1);
});

test('a footpath and a fence cut a field too; a house in its middle leaves it whole', () => {
  for (const kind of ['path', 'fence']) {
    const world = flatWorld();
    sow(world, [2, 2], [10, 8], 'grain');
    assert.ok(world.layWay(kind, [[2, 5.1], [12, 5.1]]).ok, kind);
    assert.equal(fieldsOf(world).list.length, 2, kind);
  }
  const world = flatWorld();
  sow(world, [2, 2], [12, 10], 'grain');
  const s = world.placeStructureAt('house', 7, 6, 0, { seed: 1 });
  assert.ok(s);
  const found = fieldsOf(world);
  assert.equal(found.list.length, 1);
  assert.equal(found.at(s.x, s.y), -1);
  world.removeStructure(s.id);
  assert.ok(fieldsOf(world).at(7, 6) >= 0); // (the crop was there all along)
});

test('the eraser and the brush take the crop off; undo puts it back', () => {
  const world = flatWorld();
  sow(world, [2, 2], [6, 6], 'grain');
  world.history.commit();
  world.paintCrops([[2, 4], [6, 4]], 0.6, null);
  world.history.commit();
  assert.equal(fieldsOf(world).list.length, 2);
  assert.ok(world.history.undo().ok);
  assert.equal(fieldsOf(world).list.length, 1);
  assert.equal(fieldsOf(world).list[0].area, 16);
});

test('not on water', () => {
  const world = flatWorld();
  for (let y = 0; y < world.grid.height; y++) world.terrain.water[world.grid.index(5, y)] = 2;
  sow(world, [2, 2], [9, 6], 'grain');
  assert.equal(fieldsOf(world).list.length, 2);
  assert.equal(world.crops[world.cropCellAt(5, 4)], 0);
});

test('the field grows its crop and no meadow; outside it the meadow is as before', () => {
  const world = flatWorld();
  sow(world, [2, 2], [8, 8], 'grain');
  const ground = meadowGround(world, CONFIG);
  const inside = plant(world, ground, 5, 5);
  assert.ok(inside.length > 30, `only ${inside.length} plants`);
  assert.ok(inside.every((p) => p.parts.some(([, pen]) => pen === 'grain')));
  const outside = plant(world, ground, 14, 14);
  assert.ok(outside.every((p) => !p.parts.some(([, pen]) => pen === 'grain' || pen === 'leaf')));
});

test('potatoes: ridges on the ground and leaves', () => {
  const world = flatWorld();
  sow(world, [2, 2], [6, 6], 'potatoes');
  const at = plant(world, meadowGround(world, CONFIG), 4, 4);
  assert.ok(at.some((p) => p.ground?.[0][1] === 'ridge'));
  assert.ok(at.some((p) => p.parts.some(([, pen]) => pen === 'leaf')));
});

test('fields and their crops survive a save', () => {
  const world = flatWorld();
  sow(world, [2, 2], [6, 6], 'potatoes');
  const back = World.fromJSON(JSON.parse(JSON.stringify(world.toJSON())));
  assert.equal(fieldsOf(back).list.length, 1);
  assert.equal(fieldsOf(back).list[0].crop, 'potatoes');
  assert.equal(fieldsOf(back).list[0].area, 16);
});

test('an older save: the ground its field edges closed in is sown, the edges go', () => {
  const world = flatWorld();
  const pts = [[2, 2], [6, 2], [6, 6], [2, 6], [2, 2]];
  for (let k = 1; k < pts.length; k++) assert.ok(world.layWay('field', [pts[k - 1], pts[k]], { crop: 'potatoes' }).ok);
  const data = JSON.parse(JSON.stringify(world.toJSON()));
  delete data.crops;
  const back = World.fromJSON(data);
  const found = fieldsOf(back);
  assert.equal(found.list.length, 1);
  assert.equal(found.list[0].crop, 'potatoes');
  assert.ok(found.at(4, 4) >= 0);
  assert.ok(![...back.ways.edges.values()].some((e) => e.kind === 'field'));
});
