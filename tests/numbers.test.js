// House numbers (World.numberStructure): every building gets the next one,
// open ground none; a number gone with its building isn't given again,
// ⌘Z takes back the one it undoes, and the save keeps them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road } from './helpers.js';
import { World } from '../src/core/world.js';

const at = (w, x, y) => w.grid.index(x, y);

function steps(w, ...clicks) {
  for (const click of clicks) {
    click();
    w.history.commit();
  }
}

test('buildings are numbered in the order they are built, open ground is not', () => {
  const w = flatWorld();
  road(w, [2, 5], [16, 5]);
  const a = w.placeStructure('house', at(w, 3, 6));
  const park = w.placeStructure('green', at(w, 6, 6));
  const b = w.placeStructure('hospoda', at(w, 9, 6));
  assert.equal(a.no, 1);
  assert.equal(park.no, undefined);
  assert.equal(b.no, 2);
  assert.equal(w.structureByNo(2), b);
  assert.equal(w.structureByNo(3), null);
});

test("a demolished building's number is not given again", () => {
  const w = flatWorld();
  road(w, [2, 5], [16, 5]);
  const a = w.placeStructure('house', at(w, 3, 6));
  w.placeStructure('house', at(w, 6, 6));
  w.removeStructure(a.id);
  assert.equal(w.placeStructure('house', at(w, 9, 6)).no, 3);
});

test('undo takes back the number of what it undoes, redo gives it again', () => {
  const w = flatWorld();
  road(w, [2, 5], [16, 5]);
  w.history.commit();
  let house;
  steps(w, () => w.placeStructure('house', at(w, 3, 6)), () => (house = w.placeStructure('house', at(w, 6, 6))));
  assert.equal(house.no, 2);
  w.history.undo();
  assert.equal(w.nextNo, 2);
  assert.equal(w.placeStructure('house', at(w, 9, 6)).no, 2); // no gap left
  w.history.commit();
  w.history.undo();
  w.history.undo();
  assert.equal(w.nextNo, 1);
  w.history.redo();
  assert.equal(w.structureByNo(1)?.node, at(w, 3, 6));
  assert.equal(w.nextNo, 2);

  // a demolition undone: the building comes back with its number
  const s = w.structureByNo(1);
  steps(w, () => w.removeStructure(s.id));
  w.history.undo();
  assert.equal(w.structureByNo(1)?.id, s.id);
  assert.equal(w.nextNo, 2);
});

test('the save keeps the numbers; an older save is numbered in build order', () => {
  const w = flatWorld();
  road(w, [2, 5], [16, 5]);
  const a = w.placeStructure('house', at(w, 3, 6));
  const b = w.placeStructure('house', at(w, 6, 6));
  w.removeStructure(a.id);
  const back = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(back.structureByNo(2)?.id, b.id);
  assert.equal(back.nextNo, 3);

  const old = JSON.parse(JSON.stringify(w.toJSON()));
  delete old.nextNo;
  for (const s of old.structures) delete s.no;
  const upgraded = World.fromJSON(old);
  assert.equal(upgraded.structureByNo(1)?.id, b.id);
  assert.equal(upgraded.nextNo, 2);
});
