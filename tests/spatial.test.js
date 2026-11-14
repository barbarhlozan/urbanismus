// The spatial index (core/spatial.js): what's at a point, near it, and
// what an outline would collide with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpatialIndex, rectOutline, polygonsOverlap, containsPoint } from '../src/core/spatial.js';

const square = (x, y, size = 1, angle = 0) => rectOutline(x, y, size, size, angle);

test('at finds what holds the point, in any cell it spans', () => {
  const ix = new SpatialIndex();
  ix.insert(1, rectOutline(5, 5, 3, 1)); // 3.5–6.5 across
  ix.insert(2, square(9, 9));
  assert.deepEqual(ix.at(6.2, 5.1), [1]);
  assert.deepEqual(ix.at(3.6, 4.6), [1]);
  assert.deepEqual(ix.at(9, 9), [2]);
  assert.deepEqual(ix.at(7, 7), []);
});

test('a turned outline holds only what is inside it', () => {
  const ix = new SpatialIndex();
  ix.insert(1, square(5, 5, 1, Math.PI / 4)); // a diamond reaching 0.707 out
  assert.deepEqual(ix.at(5, 5.65), [1]);
  assert.deepEqual(ix.at(5.45, 5.45), []); // the square's corner, cut off by the turn
});

test('near is nearest first and keeps to the radius', () => {
  const ix = new SpatialIndex();
  ix.insert('a', square(2, 2));
  ix.insert('b', square(5, 2));
  ix.insert('c', square(20, 20));
  assert.deepEqual(ix.near(4, 2, 2), ['b', 'a']);
  assert.deepEqual(ix.near(4, 2, 0.4), []);
  assert.deepEqual(ix.near(5, 2, 0), ['b']);
});

test('overlapping: touching sides do not count, overlap does', () => {
  const ix = new SpatialIndex();
  ix.insert(1, square(5, 5));
  assert.deepEqual(ix.overlapping(square(6, 5)), []); // side by side
  assert.deepEqual(ix.overlapping(square(5.9, 5)), [1]);
  assert.deepEqual(ix.overlapping(square(6.2, 5, 1, Math.PI / 4)), [1]); // a corner poking in
  assert.deepEqual(ix.overlapping(square(6.3, 5, 1, Math.PI / 4)), []);
});

test('remove and insert again move an item', () => {
  const ix = new SpatialIndex();
  ix.insert(1, square(5, 5));
  ix.insert(1, square(15, 5));
  assert.deepEqual(ix.at(5, 5), []);
  assert.deepEqual(ix.at(15, 5), [1]);
  assert.equal(ix.remove(1), true);
  assert.equal(ix.size, 0);
  assert.equal(ix.cells.size, 0);
});

test('polygon helpers', () => {
  assert.equal(containsPoint(square(0, 0), 0.5, 0.5), true); // on the corner
  assert.equal(containsPoint(square(0, 0), 0.51, 0), false);
  assert.equal(polygonsOverlap(square(0, 0, 4), square(0, 0, 1)), true); // one inside the other
});

test('World: buildings and trees have a position, angle and outline, and leave the index', async () => {
  const { flatWorld, road } = await import('./helpers.js');
  const w = flatWorld();
  road(w, [2, 5], [10, 5]);
  const s = w.placeStructure('house', w.grid.index(5, 6)); // below the road: faces up (rotation 0)
  assert.deepEqual([s.x, s.y, s.angle], [5, 6, 0]);
  assert.deepEqual(w.structureIndex.at(5.4, 6.4), [s.id]);
  const t = w.placeStructure('house', w.grid.index(5, 4)); // above it: faces down
  assert.equal(t.angle, Math.PI);
  const f = w.addFeature('tree', w.grid.index(12, 12), { ox: 0.2, oy: -0.1 });
  assert.deepEqual([f.x, f.y], [12.2, 11.9]);
  assert.deepEqual(w.featureIndex.near(12, 12, 0.5), [f.id]);
  w.removeStructure(s.id);
  w.removeFeature(f.id);
  assert.deepEqual(w.structureIndex.at(5, 6), []);
  assert.equal(w.featureIndex.size, 0);
});

test('World: a save from before positions is refused as old', async () => {
  const { flatWorld } = await import('./helpers.js');
  const { World } = await import('../src/core/world.js');
  const json = JSON.parse(JSON.stringify(flatWorld().toJSON()));
  assert.equal(json.version, 11);
  json.version = 10;
  assert.throws(() => World.fromJSON(json), (err) => err.code === 'old-save');
});
