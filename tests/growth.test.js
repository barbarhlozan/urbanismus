// A church grows by itself by a road where enough homes stand (sim/growth.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, street } from './helpers.js';
import { GrowthSystem } from '../src/sim/growth.js';
import { CONFIG } from '../src/config.js';

test('a church appears by a road among enough homes', () => {
  const w = flatWorld(30, 20);
  street(w, [2, 5], [26, 5]);
  street(w, [2, 9], [26, 9]);
  for (let x = 4; x <= 24; x += 1) w.placeStructure('house', w.grid.index(x, 6));
  for (let x = 4; x <= 24; x += 1) w.placeStructure('house', w.grid.index(x, 8));
  const g = new GrowthSystem(w, { growth: { ...CONFIG.growth, church: { ...CONFIG.growth.church, chance: 1 } } });
  g.step();
  const churches = [...w.structures.values()].filter((s) => s.type === 'church');
  assert.ok(churches.length >= 1);
  assert.equal(typeof churches[0].x, 'number');
});
