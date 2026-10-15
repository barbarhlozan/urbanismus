// What a photo is of, for its caption (ui/prints.js subjectOf): the one
// building that stands out in it, or none when several do or none does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road } from './helpers.js';
import { subjectOf } from '../src/ui/prints.js';

// looking along +x from the road's west end
const shot = { x: 1, y: 6, yaw: 0, fov: 65 };

test('the one building that stands out names the photo', () => {
  const w = flatWorld(30, 30);
  road(w, [1, 5], [28, 5]);
  w.placeStructure('church', w.grid.index(6, 6));
  for (const x of [4, 9, 11]) w.placeStructure('house', w.grid.index(x, 6)); // (homes never do)
  assert.equal(subjectOf(w, shot)?.id, 'church');
});

test('two that stand out, or none: no name', () => {
  const w = flatWorld(30, 30);
  road(w, [1, 5], [28, 5]);
  assert.equal(subjectOf(w, shot), null);
  w.placeStructure('church', w.grid.index(6, 6));
  assert.ok(w.placeStructure('school', w.grid.index(10, 3)));
  assert.equal(subjectOf(w, shot), null);
});

test('what stands behind the photographer is not in it', () => {
  const w = flatWorld(30, 30);
  road(w, [1, 5], [28, 5]);
  w.placeStructure('church', w.grid.index(6, 6));
  assert.equal(subjectOf(w, { ...shot, x: 20, yaw: 0 }), null);
});
