// Contour tracing (terrain/elevation.js): asking for one level only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contours } from '../src/terrain/elevation.js';

// a field far below and above zero, like the water's depth: a round pool
// 0 at its shore, rising steeply inside and falling far outside
const pool = (x, y) => (3 - Math.hypot(x - 5, y - 5)) * 20;
const BOX = [0, 0, 10, 10];
const OPTS = { step: 0.25, interval: 1, index: 99 };

test('only: the same line as tracing every level and keeping that one', () => {
  const all = contours(pool, BOX, OPTS).filter((c) => c.level === 0);
  const one = contours(pool, BOX, { ...OPTS, only: 0 });
  assert.ok(all.length > 0);
  assert.deepEqual(one, all);
});

test('only: a level the field never reaches gives no lines', () => {
  assert.deepEqual(contours(pool, BOX, { ...OPTS, only: 1000 }), []);
});
