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
  // its head, up the post: a round about it
  const hp = points(head), hx = hp.filter((_, i) => i % 2 === 0), hy = hp.filter((_, i) => i % 2 === 1);
  const mx = hx.reduce((a, b) => a + b) / hx.length / px, my = hy.reduce((a, b) => a + b) / hy.length / px;
  assert.ok(Math.abs(mx - 3) < 0.01 && Math.abs(my - (4 - LIGHTS.high)) < 0.01);
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

test('headlights throw a beam ahead, widening, a train\'s further', async () => {
  const { headBeam } = await import('../src/render/lights.js');
  const car = headBeam(0, 0, 1, 0, false, 3), train = headBeam(0, 0, 1, 0, true, 3);
  const xs = (p) => p.map(([x]) => x), ys = (p) => p.map(([, y]) => y);
  // ahead (+x), none behind
  assert.ok(Math.min(...xs(car)) >= -1e-9 && Math.max(...xs(car)) > LIGHTS.beam.reach * 0.9);
  // narrow at the lamps, wide at the far end
  const near = car.filter(([x]) => x < 0.01), far = car.filter(([x]) => x > LIGHTS.beam.reach * 0.6);
  const span = (p) => Math.max(...ys(p)) - Math.min(...ys(p));
  assert.ok(span(far) > span(near) * 3);
  assert.ok(Math.max(...xs(train)) > Math.max(...xs(car)) * 1.3);
  // the same vehicle, the same beam
  assert.deepEqual(headBeam(0, 0, 1, 0, false, 3), car);
});
