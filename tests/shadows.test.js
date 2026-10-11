import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUN, groundDir, sunFor, shadedFeet, shadowPath, cornerStrokes, tierOf } from '../src/render/shadows.js';

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

test('wall strokes stay by the lit edge, rise from the foot and shorten evenly', () => {
  const wall = [[0, 0], [1, 0], [1, 0.6], [0, 0.6]];
  const st = SUN.strokes;
  const strokes = cornerStrokes(wall, 1, st);
  assert.ok(strokes.length >= 2);
  for (const [a, b] of strokes) {
    assert.ok(a[0] >= 1 - st.band - 1e-9, 'within the band from the edge');
    assert.ok(a[1] < 0.05, 'from the foot');
    assert.ok(b[1] <= 0.6 * st.reach * 1.06 + 1e-9, 'kept low');
  }
  // nearest the edge first, and (where the wall's edge doesn't cut them)
  // no taller than the one before by more than the jitter
  const tops = strokes.filter(([, b]) => b[0] < 1 - 1e-6).map(([, b]) => b[1]);
  for (let i = 1; i < tops.length; i++) assert.ok(tops[i] <= tops[i - 1] * 1.12);
  // the other edge mirrors it
  assert.ok(cornerStrokes(wall, 0, st).every(([a]) => a[0] <= st.band + 1e-9));
  assert.deepEqual(strokes.map(([, , k]) => k), strokes.map((_, i) => i));
});

test('density tiers: every 8th, 4th, other', () => {
  assert.deepEqual([-8, -4, -3, -2, 0, 1, 2, 4, 8].map(tierOf), [0, 1, 3, 2, 0, 3, 2, 1, 0]);
});
