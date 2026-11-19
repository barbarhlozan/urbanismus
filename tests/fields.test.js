// Crop fields painted on the ground (world/crops.js, sim/fields.js), cut
// by what's built on them, grown by the meadow (render/meadow.js plant).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.js';
import { flatWorld, road } from './helpers.js';
import { fieldsOf } from '../src/sim/fields.js';
import { meadowGround, plant } from '../src/render/meadow.js';
import { CONFIG } from '../src/config.js';
import { createCropBrush } from '../src/tools/cropBrush.js';
import { eraseTarget } from '../src/tools/erase.js';
import { cropValue } from '../src/core/world/crops.js';

// a rectangle sown, its rows along its longer side
const sow = (world, [x0, y0], [x1, y1], crop) => {
  const v = cropValue(crop, x1 - x0 >= y1 - y0 ? 'x' : 'y'), changes = [];
  for (let c = 0; c < world.crops.length; c++) {
    const [x, y] = world.cropCellCenter(c);
    if (x > x0 && x < x1 && y > y0 && y < y1 && world.cropGround(c)) changes.push([c, v]);
  }
  world.setCrops(changes);
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
  world.paintCrops([[1, 4], [7, 4]], 0.6, null);
  world.history.commit();
  assert.equal(fieldsOf(world).list.length, 2);
  assert.ok(world.history.undo().ok);
  assert.equal(fieldsOf(world).list.length, 1);
  assert.equal(fieldsOf(world).list[0].area, 16);
});

// the brush paints as it's drawn: pressed, moved, let go
const stroke = (brush, pts) => {
  brush.sketch.down(...pts[0]);
  for (const p of pts.slice(1)) brush.sketch.move(...p);
};
const tick = () => new Promise((r) => setTimeout(r));

test('the brush paints while held, and the stroke is one undo step', async () => {
  const world = flatWorld();
  world.history.commit();
  const brush = createCropBrush({ world }, { crop: 'grain', group: 'farming' });
  const steps = world.history.done.length;
  stroke(brush, [[2, 4]]);
  assert.ok(fieldsOf(world).at(2, 4) >= 0); // (there as soon as it's pressed)
  await tick();
  for (let x = 2.2; x <= 8; x += 0.2) brush.sketch.move(x, 4);
  await tick();
  assert.ok(fieldsOf(world).at(7, 4) >= 0);
  assert.equal(world.history.done.length, steps); // (still held)
  brush.sketch.end();
  assert.equal(world.history.done.length, steps + 1);
  assert.ok(world.history.undo().ok);
  assert.equal(fieldsOf(world).list.length, 0);
});

test('the eraser takes the whole field it is pressed on, and the crop under a road along it', () => {
  const world = flatWorld();
  sow(world, [2, 2], [10, 6], 'grain');
  sow(world, [2, 8], [10, 10], 'potatoes');
  assert.ok(world.layWay('road', [[6, 0], [6, 7]]).ok);
  world.history.commit();
  assert.equal(fieldsOf(world).list.length, 3);
  const target = eraseTarget(world, [4, 4]);
  assert.ok(target.field.length > 0);
  target.run();
  world.history.commit();
  assert.equal(fieldsOf(world).list.length, 2); // (the grain east of the road and the potatoes stay)
  assert.ok(fieldsOf(world).at(8, 4) >= 0);
  assert.equal(world.crops[world.cropCellAt(5.95, 4)], 0); // (under the road: gone with it)
  assert.ok(world.history.undo().ok);
  assert.equal(fieldsOf(world).list.length, 3);
});

test('a new field\'s rows run the way the stroke went; sown on, a field keeps its rows', () => {
  const world = flatWorld();
  const brush = createCropBrush({ world }, { crop: 'grain', group: 'farming' });
  stroke(brush, [[5, 2], ...Array.from({ length: 30 }, (_, k) => [5, 2 + (k + 1) * 0.2])]);
  brush.sketch.end();
  assert.equal(fieldsOf(world).list[0].along, 'y');
  // across it, sideways: its rows stay as they were
  stroke(brush, [[5, 4], ...Array.from({ length: 20 }, (_, k) => [5 + (k + 1) * 0.2, 4])]);
  brush.sketch.end();
  const found = fieldsOf(world);
  assert.equal(found.list.length, 1);
  assert.equal(found.list[0].along, 'y');
  assert.equal(world.crops[world.cropCellAt(8, 4)], cropValue('grain', 'y'));
});

test('a field\'s edge is uneven, as the brush leaves it, and the same each time', () => {
  const a = flatWorld(), b = flatWorld();
  a.paintCrops([[4, 4], [10, 4]], 0.9, 'grain');
  b.paintCrops([[4, 4], [7, 4]], 0.9, 'grain');
  b.paintCrops([[7, 4], [10, 4]], 0.9, 'grain');
  assert.deepEqual([...a.crops], [...b.crops]);
  // how far the field reaches across the stroke, along it: not all alike
  const reach = [];
  for (let x = 5; x <= 9; x += 0.25) {
    let y = 4;
    while (a.crops[a.cropCellAt(x, y + 0.01)]) y += 1 / 8;
    reach.push(y);
  }
  assert.ok(new Set(reach).size > 2, `${reach}`);
});

test('a plant stays as it was when the field beside it grows or shrinks', () => {
  const world = flatWorld();
  sow(world, [2, 2], [8, 8], 'grain');
  const ground = () => meadowGround(world, CONFIG);
  const before = JSON.stringify(plant(world, ground(), 3, 5));
  sow(world, [8, 2], [14, 12], 'grain'); // (the field longer the other way now)
  world.paintCrops([[7, 7], [7.5, 7.5]], 0.6, null);
  assert.equal(JSON.stringify(plant(world, ground(), 3, 5)), before);
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

test('a save from before the little squares: each half-step square spread over the ones it covered', () => {
  const world = flatWorld();
  const data = JSON.parse(JSON.stringify(world.toJSON()));
  const ow = world.fine.width - 1, oh = world.fine.height - 1, old = new Array(ow * oh).fill(0);
  for (let j = 4; j < 8; j++) for (let i = 4; i < 12; i++) old[j * ow + i] = 2; // (potatoes, x 2–6, y 2–4)
  const runs = [];
  for (let k = 0; k < old.length; ) { let n = 1; while (old[k + n] === old[k]) n++; runs.push(`${old[k]}x${n}`); k += n; }
  data.crops = runs.join(',');
  const back = World.fromJSON(data);
  const found = fieldsOf(back);
  assert.equal(found.list.length, 1);
  assert.equal(found.list[0].crop, 'potatoes');
  assert.equal(found.list[0].area, 8);
  assert.ok(found.at(3, 3) >= 0 && found.at(7, 3) < 0);
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

test('a meadow is sown as a field is, and grows grass and flowers', async () => {
  const world = flatWorld();
  world.paintCrops([[4, 4], [8, 5]], 1.1, 'meadow');
  const found = fieldsOf(world);
  assert.equal(found.list.length, 1);
  assert.equal(found.list[0].crop, 'meadow');
  const plants = plant(world, meadowGround(world, CONFIG), 6, 4);
  assert.ok(plants.length > 20, `only ${plants.length}`);
  assert.ok(plants.some((p) => p.parts.some(([, pen]) => /^head /.test(pen))), 'no flowers');
  assert.ok(plants.every((p) => !p.parts.some(([, pen]) => pen === 'grain' || pen === 'leaf')));
});

test('new maps have a meadow now and then, away from the middle', async () => {
  const { generateWorld } = await import('../src/terrain/generate.js');
  let some = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const world = new World({ width: 30, height: 30, seed });
    generateWorld(world, CONFIG);
    const found = fieldsOf(world);
    if (found.list.some((f) => f.crop === 'meadow')) some++;
    assert.equal(found.at(14.5, 14.5), -1);
    assert.ok(!world.history.canUndo); // (the map as it comes)
  }
  assert.ok(some >= 3 && some <= 11, `${some} of 12`);
});
