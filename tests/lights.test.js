import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIGHTS, lampPool } from '../src/render/lights.js';
import { DAY } from '../src/render/shadows.js';

const px = 32;
const project = (x, y, z = 0) => [x * px, y * px - z * px]; // (flat will do)
const points = (d) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);

test('a lamp lights a ragged pool round its foot, and its head', () => {
  const [pool, head] = lampPool(3, 4, project, px);
  const xs = points(pool).filter((_, i) => i % 2 === 0).map((x) => x / px);
  const ys = points(pool).filter((_, i) => i % 2 === 1).map((y) => y / px);
  const r = xs.map((x, i) => Math.hypot(x - 3, ys[i] - 4));
  assert.ok(Math.min(...r) >= LIGHTS.pool * (1 - LIGHTS.ragged) - 1e-6 && Math.max(...r) <= LIGHTS.pool * (1 + LIGHTS.ragged) + 1e-6);
  assert.ok(Math.max(...r) - Math.min(...r) > LIGHTS.pool * 0.05, 'not a perfect circle');
  // the same lamp, the same pool
  assert.equal(lampPool(3, 4, project, px)[0], pool);
  // its head, up the post
  const [hx, hy] = points(head);
  assert.ok(Math.abs(hy / px - (4 - LIGHTS.high)) < 1e-6 && hx / px < 3);
});

test("the pools of a street's lamps, a step apart, leave night between", () => {
  // (lamps stand one a grid step, sides alternating: the same side two apart)
  assert.ok(LIGHTS.pool * (1 + LIGHTS.ragged) < 1);
});

test('the lamps are lit all night and from the deepest dusk to the deepest dawn', () => {
  for (const s of DAY.steps) if (s.night) assert.ok(s.lamps, `at ${s.at}`);
  assert.ok(DAY.steps.some((s) => s.lamps && !s.night && s.at > 12), 'at dusk');
  assert.ok(DAY.steps.some((s) => s.lamps && !s.night && s.at < 12), 'at dawn');
  assert.ok(!DAY.steps.some((s) => s.lamps && !s.night && !s.length), 'not by day');
});
