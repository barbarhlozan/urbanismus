import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUN, groundDir, sunFor, shadedFeet, shadowPath, wallStrokes, strokeShare, tierOf } from '../src/render/shadows.js';

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

test('only the walls turned away from the sun get a scribble, and only tall ones', () => {
  assert.deepEqual(shadedFeet(feet, sun()).map((f) => f.n), [[1, 0]]);
  assert.equal(shadedFeet(feet.map((f) => ({ ...f, h: SUN.low / 2 })), sun()).length, 0);
});

test('the scribble is one short zigzag on the shaded side', () => {
  const d = shadowPath({ feet, project }, sun());
  assert.equal(d.match(/M/g).length, 1);
  const xs = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => +m[1]);
  assert.ok(xs.every((x) => x >= 10 - 1e-6), 'beyond the shaded wall at x = 1');
  assert.ok(Math.max(...xs) <= 10 + SUN.scribble.most * 10 + 1e-6, 'no further than `most`');
  assert.equal(shadowPath({ feet, project }, sun({ on: false })), '');
  assert.equal(shadowPath({ feet, project }, sun({ scribble: null })), '');
});

test('wall strokes: more the further a wall is turned, ragged and thinning out', () => {
  const st = SUN.strokes;
  assert.equal(strokeShare(st.from, sun()), 0);
  assert.ok(strokeShare((st.from + st.full) / 2, sun()) < strokeShare(1, sun()));
  assert.equal(strokeShare(1, sun()), st.most);
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
