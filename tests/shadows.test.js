import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUN, groundDir, sunFor, castStrips, hatchRuns, shadowPaths, wallStrokes, strokeShare, tierOf } from '../src/render/shadows.js';

// the sun casting along +x
const sun = (over = {}) => ({ ...SUN, ...over, cast: [SUN.length, 0] });

test('screen directions map onto the ground and back with the view', () => {
  // straight down the screen is +x+y on the ground (unrotated view)
  const [x, y] = groundDir(90);
  assert.ok(Math.abs(x - y) < 1e-9 && x > 0);
  // a quarter turn of the view turns the ground direction with it
  const [rx, ry] = groundDir(90, 1);
  assert.ok(Math.abs(rx * x + ry * y) < 1e-9);
  assert.equal(sunFor({ rotation: 0 }).cast.length, 2);
});

// a unit box's four walls, outward normals, 1 high
const feet = [
  { a: [0, 0], b: [1, 0], h: 1, n: [0, -1] },
  { a: [1, 0], b: [1, 1], h: 1, n: [1, 0] },
  { a: [1, 1], b: [0, 1], h: 1, n: [0, 1] },
  { a: [0, 1], b: [0, 0], h: 1, n: [-1, 0] },
];
const project = (x, y) => [x * 10, y * 10];

test('only the walls turned away from the sun cast a strip, and only tall ones', () => {
  assert.deepEqual(castStrips(feet, sun()), [[[1, 0], [1, 1], [1 + SUN.length, 1], [1 + SUN.length, 0]]]);
  assert.equal(castStrips(feet.map((f) => ({ ...f, h: SUN.low / 2 })), sun()).length, 0);
});

test('hatching joins the runs of shadows that overlap on a line', () => {
  const sq = (x0, x1) => [[x0, 0], [x1, 0], [x1, 1], [x0, 1]];
  const runs = hatchRuns([sq(0, 2), sq(1, 3), sq(5, 6)], [1, 0], [0, 1], 0.25);
  const line = runs.filter(([k]) => k === 2).map(([, a, b]) => [a, b]);
  assert.deepEqual(line, [[0, 3], [5, 6]]);
});

test('the cast shadow is hatched on the shaded side, as far out as the wall is tall', () => {
  const d = shadowPaths({ feet, project }, sun()).join('');
  const xs = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => +m[1]);
  assert.ok(xs.length > 10);
  const slack = SUN.hatch.wave * 10 + 0.01;
  assert.ok(xs.every((x) => x >= 10 - slack), 'beyond the shaded wall at x = 1');
  assert.ok(Math.max(...xs) <= 10 + SUN.length * 10 + slack, 'no further than its length');
  assert.equal(shadowPaths({ feet, project }, sun({ on: false })).join(''), '');
  assert.equal(shadowPaths({ feet, project }, sun({ hatch: null })).join(''), '');
});

test('wall strokes: more the further a wall is turned, ragged and thinning out', () => {
  const st = { ...SUN.strokes, ragged: 0.8, fade: 0.9, most: 0.9 };
  const S = SUN.strokes;
  assert.equal(strokeShare(S.from, sun()), 0);
  assert.ok(strokeShare((S.from + S.full) / 2, sun()) < strokeShare(1, sun()));
  assert.equal(strokeShare(1, sun()), S.most);
  const wall = [[0, 0], [4, 0], [4, 0.6], [0, 0.6]];
  const all = wallStrokes(wall, { ...st, ragged: 0, fade: 0 }, 1, 3);
  const loose = wallStrokes(wall, st, 1, 3);
  assert.ok(loose.length < all.length * 0.8 && loose.length > all.length * 0.2, 'thinned out');
  for (const [a, b] of loose) {
    assert.ok(a[1] < 0.06 || a[0] < 0.25 || a[0] > 3.75, 'from near the foot or a side edge');
    assert.ok(b[1] <= 0.6 + 1e-9 && b[1] > a[1], 'upwards, within the wall');
  }
  assert.ok(loose.some(([, b]) => b[1] < 0.5), 'some stop well short of the top');
  assert.ok(wallStrokes(wall, st, 0.3, 3).length < loose.length);
});

test('density tiers: every 8th, 4th, other', () => {
  assert.deepEqual([-8, -4, -3, -2, 0, 1, 2, 4, 8].map(tierOf), [0, 1, 3, 2, 0, 3, 2, 1, 0]);
});
