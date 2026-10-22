import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashed, meshOf, Pieces } from '../src/render/gl/hatching.js';

test('dashes start again at each subpath and run on round a corner', () => {
  const d = dashed([{ pts: [[0, 0], [10, 0]], closed: false }, { pts: [[0, 5], [4, 5], [4, 9]], closed: false }], [3, 2]);
  assert.deepEqual(d.map((l) => l.pts), [[[0, 0], [3, 0]], [[5, 0], [8, 0]], [[0, 5], [3, 5]], [[4, 6], [4, 9]]]);
  assert.deepEqual(dashed([{ pts: [[0, 0], [2, 0], [2, 4]], closed: false }], [3, 2]).map((l) => l.pts), [[[0, 0], [2, 0], [2, 1]], [[2, 3], [2, 4]]]);
  assert.ok(d.every((l) => l.cap === 2));
});

test('a shape is filled and its edge dashed; a line is not filled', () => {
  const sq = meshOf('shape', 'M0 0L10 0L10 10L0 10Z');
  assert.equal(sq.tris.length, 12); // two triangles
  assert.ok(sq.lines.length > 3);
  const line = meshOf('line', 'M0 0L10 0');
  assert.equal(line.tris.length, 0);
  assert.deepEqual(line.lines.map((l) => l.cap), [1]);
});

test('pieces are laid where the matrix puts them, the pen scaled with it', () => {
  const p = new Pieces();
  p.shape(meshOf('line', 'M0 0L10 0'), [2, 0, 0, 2, 5, 7], 0.5, 1);
  assert.equal(p.n, 1);
  assert.deepEqual([...p.data.subarray(0, 4)], [5, 7, 25, 7]);
  assert.ok(Math.abs(p.data[9] - 2.2) < 1e-6); // half of 2.2, times 2
  assert.deepEqual([...p.data.subarray(12, 14)], [0.5, 1]);
});
