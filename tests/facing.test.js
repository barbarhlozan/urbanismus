// Single-dot buildings take their facing once, as they are built
// (World.faceOnce): a road laid past one later doesn't turn it round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road } from './helpers.js';
import { World } from '../src/core/world.js';

const house = (w, x, y, rotation = 0, data = {}) => w.placeStructure('house', w.grid.index(x, y), { rotation, data });

test('built by a road: faces it', () => {
  const w = flatWorld();
  road(w, [2, 5], [10, 5]);
  assert.equal(w.drawnRotation(house(w, 5, 6, 1)), 0);
});

test('a road laid later: keeps facing as placed', () => {
  const w = flatWorld();
  const s = house(w, 5, 6, 1, { turn: 2 });
  road(w, [2, 5], [10, 5]);
  assert.equal(w.drawnRotation(s), 1);
  assert.equal(s.data.turn, undefined);
});

test('a second road later behind it: keeps facing the first', () => {
  const w = flatWorld();
  road(w, [2, 5], [10, 5]);
  const s = house(w, 5, 6, 1, { turn: 1 });
  assert.equal(w.drawnRotation(s), 1);
  road(w, [2, 7], [10, 7]);
  assert.equal(w.drawnRotation(s), 1);
  assert.equal(w.frontRotation(s), 0);
});

test('an older save: kept facing as it is drawn now', () => {
  const w = flatWorld();
  road(w, [2, 5], [10, 5]);
  const s = house(w, 5, 6, 1);
  delete s.data.face;
  const back = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(back.structures.get(s.id).data.face, 0);
});
