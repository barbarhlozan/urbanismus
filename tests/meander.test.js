// Footpaths wander a little off their dots (roads/meander.js): not too far,
// not where they meet something, the same each time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, path, road } from './helpers.js';
import { World } from '../src/core/world.js';

const offsets = (w) => [...w.paths.nodes()].map((f) => {
  const [x, y] = w.networks.path.dot(f), [px, py] = w.networks.path.pos(f);
  return [f, Math.hypot(px - x, py - y)];
});

test('a long footpath wanders, within reach of its dots', () => {
  const w = flatWorld(30, 30);
  path(w, [3, 10], [26, 10]);
  const off = offsets(w).map(([, d]) => d);
  assert.ok(Math.max(...off) > 0.05, 'it bends');
  assert.ok(Math.max(...off) <= 0.26 + 1e-9, 'not far');
});

test('its ends and where it meets a road stay on their dots', () => {
  const w = flatWorld(30, 30);
  assert.ok(road(w, [14, 4], [14, 15]).ok);
  path(w, [3, 10], [26, 10]);
  const at = new Map(offsets(w));
  for (const end of [w.fine.index(6, 20), w.fine.index(52, 20)]) assert.equal(at.get(end), 0);
  for (let fx = 27; fx <= 29; fx++) assert.equal(at.get(w.fine.index(fx, 20)), 0, `at ${fx / 2}`); // (the crossing and its kerbs)
});

test('the same path bends the same way after loading', () => {
  const w = flatWorld(30, 30);
  path(w, [3, 10], [26, 10]);
  const again = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  for (const [f] of offsets(w)) assert.deepEqual(again.networks.path.pos(f), w.networks.path.pos(f));
});
