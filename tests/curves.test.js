// Drawn ways' centre lines (roads/curves.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curveThrough, tightestBend, easeBends, resample } from '../src/roads/curves.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('the curve passes through every point, ends exact', () => {
  const pts = [[0, 0], [3, 1], [5, 4], [9, 4]];
  const line = curveThrough(pts, 0.1);
  assert.deepEqual(line[0], [0, 0]);
  assert.deepEqual(line.at(-1), [9, 4]);
  for (const p of pts) assert.ok(line.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.06), `misses ${p}`);
});

test('two points: a straight line, evenly sampled', () => {
  const line = curveThrough([[0, 0], [2, 0]], 0.25);
  assert.equal(line.length, 9);
  assert.ok(line.every(([, y]) => y === 0));
  assert.equal(tightestBend(line), Infinity);
});

test('no loops between close points (centripetal)', () => {
  const line = curveThrough([[0, 0], [4, 0], [4.2, 0.1], [8, 0]], 0.05);
  // never runs back on itself in x
  for (let i = 1; i < line.length; i++) assert.ok(line[i][0] > line[i - 1][0] - 0.05);
});

test('tightest bend measures a circle', () => {
  const r = 3;
  const arc = Array.from({ length: 40 }, (_, k) => [r * Math.cos(k / 20), r * Math.sin(k / 20)]);
  assert.ok(near(tightestBend(arc), r, 1e-6));
});

test('easing a sharp corner with an arc until it holds the radius, or giving up', () => {
  const sharp = [[0, 0], [3, 0], [3, 3]];
  assert.ok(tightestBend(curveThrough(sharp)) < 2);
  for (const r of [0.5, 1, 1.2, 1.5]) {
    const line = easeBends(sharp, r);
    assert.ok(line, `eases to ${r}`);
    assert.ok(tightestBend(line) >= r * 0.97, `${r}: ${tightestBend(line)}`); // (as sampled)
    assert.deepEqual(line[0], [0, 0]);
    assert.deepEqual(line.at(-1), [3, 3]);
  }
  assert.equal(easeBends(sharp, 2), null); // a railway's curve won't fit in there
  const gentle = [[0, 0], [5, 0.2], [10, 0]];
  assert.deepEqual(easeBends(gentle, 1), curveThrough(gentle)); // gentle already: the curve itself
});

test('resample keeps the ends', () => {
  const line = resample([[0, 0], [1, 0], [1, 1]], 0.3);
  assert.deepEqual(line[0], [0, 0]);
  assert.deepEqual(line.at(-1), [1, 1]);
});

test('crossings: where, how far along each, at what angle', async () => {
  const { crossingsOf } = await import('../src/roads/curves.js');
  const h = curveThrough([[0, 0], [10, 0]], 0.5), v = curveThrough([[4, -3], [4, 3]], 0.5);
  const [c] = crossingsOf(h, v);
  assert.ok(Math.abs(c.point[0] - 4) < 1e-9 && Math.abs(c.point[1]) < 1e-9);
  assert.ok(Math.abs(c.sa - 4) < 1e-9 && Math.abs(c.sb - 3) < 1e-9);
  assert.ok(Math.abs(c.angle - Math.PI / 2) < 1e-9);
  const slant = curveThrough([[0, -1], [10, 1]], 0.5);
  assert.ok(crossingsOf(h, slant)[0].angle < 0.25);
  assert.equal(crossingsOf(h, curveThrough([[0, 2], [10, 2]])).length, 0);
  const wave = curveThrough([[0, -1], [3, 1], [6, -1], [9, 1]], 0.1);
  assert.equal(crossingsOf(h, wave).length, 3);
});
