import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUN, groundDir, sunFor, shadowHulls, hatchLines, shadedFeet, shadowPaths, wallHatch, tierOf, tierAt } from '../src/render/shadows.js';

// screen = world × 10, strokes straight down the screen, 1 px apart
const sun = (over = {}) => {
  const s = { ...SUN, ...over };
  return { ...s, cast: [s.length, 0], dir: [0, 1], normal: [-1, 0], gap: 1, bow: 0 };
};
const strokesOf = (casts, s) => hatchLines(shadowHulls(casts, s).map((h) => h.map(([x, y]) => [x * 10, y * 10])), s);

test('screen directions map onto the ground and back with the view', () => {
  // straight down the screen is +x+y on the ground (unrotated view)
  const [x, y] = groundDir(90);
  assert.ok(Math.abs(x - y) < 1e-9 && x > 0);
  // a quarter turn of the view turns the ground direction with it
  const [rx, ry] = groundDir(90, 1);
  assert.ok(Math.abs(rx * x + ry * y) < 1e-9);
});

test('a box casts a shadow as long as its height along the sun', () => {
  const box = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]].flatMap(([x, y]) => [[x, y, 0], [x, y, 2]]);
  // the shadow spans x 0..2 (1 + 2·0.5): screen x 0..20, lines k = -x
  const ks = strokesOf([box], sun({ length: 0.5 })).map(([k]) => 0 - k + 0);
  assert.equal(Math.min(...ks), 0);
  assert.equal(Math.max(...ks), 20);
});

test('overlapping casters share their strokes', () => {
  const wall = (x0) => [[x0, 0, 0], [x0 + 1, 0, 0], [x0 + 1, 0, 1], [x0, 0, 1], [x0, 0.1, 0], [x0, 0.1, 1]];
  const one = strokesOf([wall(0)], sun());
  const two = strokesOf([wall(0), wall(0)], sun());
  assert.equal(two.length, one.length);
});

test('ground and walls are hatched on the same screen lines', () => {
  // two shapes anywhere on screen: their strokes sit on whole lines k·gap
  const s = sunFor({ rotation: 0, tile: 32 });
  const a = hatchLines([[[0, 0], [40, 0], [40, 30], [0, 30]]], s);
  const b = hatchLines([[[13.7, 5.1], [50, 9], [31, 44]]], s);
  for (const [k, t0] of [...a, ...b]) {
    const [x, y] = [t0 * s.dir[0] + k * s.gap * s.normal[0], t0 * s.dir[1] + k * s.gap * s.normal[1]];
    assert.ok(Math.abs(x * s.normal[0] + y * s.normal[1] - k * s.gap) < 1e-9);
  }
  assert.ok(a.length && b.length);
});

test('flat ground drawing casts nothing', () => {
  const plate = [[0, 0, 0], [1, 0, 0], [1, 1, 0.01]];
  assert.equal(shadowHulls([plate], sun()).length, 0);
});

test('zoomed out, shadow hatching thins out instead of vanishing', () => {
  const tiers = [-8, -4, -3, -2, 0, 1, 2, 4, 8].map(tierOf);
  assert.deepEqual(tiers, [0, 1, 3, 2, 0, 3, 2, 1, 0]);
  // closer in, more tiers show; strokes never closer than SUN.gap on screen
  // (but every 8th line always shows)
  const spacing = 0.02;
  const px = [10, 40, 80, 160, 320].map((p) => tierAt(p, spacing));
  assert.deepEqual(px, [...px].sort((a, b) => a - b));
  assert.equal(tierAt(1e4, spacing), 3);
  for (const p of [40, 80, 160, 320]) {
    const n = tierAt(p, spacing);
    if (n > 0) assert.ok(spacing * p * 2 ** (3 - n) >= SUN.gap);
  }
});

// a unit box's four walls, outward normals, 1 high (the sun casts along +x)
const feet = [
  { a: [0, 0], b: [1, 0], h: 1, n: [0, -1] },
  { a: [1, 0], b: [1, 1], h: 1, n: [1, 0] },
  { a: [1, 1], b: [0, 1], h: 1, n: [0, 1] },
  { a: [0, 1], b: [0, 0], h: 1, n: [-1, 0] },
];

test('contact shadows come from the walls turned away from the sun', () => {
  const shaded = shadedFeet(feet, sun());
  assert.deepEqual(shaded.map((f) => f.n), [[1, 0]]);
  // they reach out along the sun, no further than the cast shadow
  assert.ok(shaded[0].reach > 0 && shaded[0].reach <= SUN.length + 1e-9);
});

test('hatched contact shadows lie on the shaded side, the scribble is one line', () => {
  const project = (x, y) => [x * 10, y * 10];
  const hatch = shadowPaths({ feet, project }, sun({ ground: 'hatch' })).join('');
  const xs = [...hatch.matchAll(/[MQ ](-?[\d.]+) (-?[\d.]+)/g)].map((m) => +m[1]);
  assert.ok(xs.length && xs.every((x) => x >= 10 - 1e-6), 'all beyond the shaded wall at x = 1');
  const scribble = shadowPaths({ feet, project }, sun({ ground: 'scribble' })).join('');
  assert.equal(scribble.match(/M/g).length, 1);
});

test('loose wall shading thins out across the wall and leaves ragged tops', () => {
  const at = { dir: [0, -1], normal: [1, 0], gap: 2, bow: 0 }; // strokes straight up the screen
  const wall = [[0, 0], [200, 0], [200, 100], [0, 100]];
  const count = (d) => d.join('').split('M').length - 1;
  const even = count(wallHatch(wall, at, { loose: 0 }));
  const loose = count(wallHatch(wall, at, { loose: 1, seed: 3 }));
  assert.equal(even, 101);
  assert.ok(loose < even * 0.8 && loose > even * 0.2);
  // no stroke runs the full height when loose
  const tops = [...wallHatch(wall, at, { loose: 1, seed: 3 }).join('').matchAll(/Q[^ ]+ [^ ]+ [^ ]+ (-?[\d.]+)/g)].map((m) => +m[1]);
  assert.ok(tops.every((y) => y > 0.5));
});
