import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUN, DAY, groundDir, sunFor, sunAt, stepAt, hourAt, screenLight, castStrips, castShapes, hatchRuns, shadowPaths, wallStrokes, strokeShare, tierOf } from '../src/render/shadows.js';

// the sun casting along +x
const sun = (over = {}) => ({ ...SUN, ...over, cast: [SUN.length, 0] });

test('screen directions map onto the ground and back with the view', () => {
  // straight down the screen is +x+y on the ground (unrotated view)
  const [x, y] = groundDir(90);
  assert.ok(Math.abs(x - y) < 1e-9 && x > 0);
  // a quarter turn of the view turns the ground direction with it
  const [rx, ry] = groundDir(90, Math.PI / 2);
  assert.ok(Math.abs(rx * x + ry * y) < 1e-9);
  assert.equal(sunFor({ angle: 0 }).cast.length, 2);
});

test('the sun stands over the world, not the screen', () => {
  // the same shadows on the ground whichever way the view is turned
  const a = sunFor({ angle: 0 }), b = sunFor({ angle: 1.1 });
  assert.deepEqual(a.cast, b.cast);
  const [x, y] = sunFor({ angle: 0 }, { ...SUN, azimuth: 0, length: 2 }).cast;
  assert.ok(Math.abs(x - 2) < 1e-9 && Math.abs(y) < 1e-9);
  // and so on screen they turn with the view: half round, the light
  // comes from the other side
  const turn = (t) => ({ angle: t, toView: (px, py) => [px * Math.cos(t) - py * Math.sin(t), px * Math.sin(t) + py * Math.cos(t)] });
  const [u0, v0] = screenLight(turn(0)), [u1, v1] = screenLight(turn(Math.PI));
  assert.ok(Math.abs(u0 + u1) < 1e-9 && Math.abs(v0 + v1) < 1e-9);
});

test('the day goes round 24 hours: sun by day, night between', () => {
  const step = (hour) => DAY.steps[stepAt(hour)];
  // midday is SUN's own, with no night over it and no grey
  assert.deepEqual(DAY.positions[step(12).sun], [SUN.azimuth, SUN.length]);
  assert.ok(!step(12).night && !step(12).length);
  // the dead of night: the night, no sun
  assert.ok(step(2).night && step(2).sun == null);
  // every position of the sun is used, morning to evening, in order
  const suns = DAY.steps.filter((s) => !s.night).map((s) => s.sun);
  assert.deepEqual([...new Set(suns)], DAY.positions.map((_, i) => i));
  // at dusk the evening's shadows spread, longer and longer, until the
  // night; at dawn the morning's shrink back from it
  const dusk = DAY.steps.filter((s) => s.sun === DAY.positions.length - 1 && s.length).map((s) => s.length);
  const dawn = DAY.steps.filter((s) => s.sun === 0 && s.length).map((s) => s.length);
  assert.ok(dusk.length >= 2 && dawn.length >= 2);
  for (let i = 1; i < dusk.length; i++) assert.ok(dusk[i] > dusk[i - 1]);
  for (let i = 1; i < dawn.length; i++) assert.ok(dawn[i] < dawn[i - 1]);
  assert.ok(Math.min(...dusk) > Math.max(...DAY.positions.map(([, l]) => l)));
  // the night deepens in the small hours – more lines, the main ink all
  // the way over to the secondary – and lifts again; no grey over it
  const deep = (hour) => step(hour).depth ?? 0, ink = (hour) => step(hour).ink ?? 0;
  assert.equal(deep(1.5), 3);
  assert.equal(ink(1.5), 1);
  assert.ok(deep(22) < deep(1.5) && deep(3.5) < deep(1.5) && ink(22) < ink(0) && ink(3.5) < ink(1.5));
  assert.ok(!ink(12) && !deep(12));
  for (const s of DAY.steps) if (s.night) assert.ok(!s.gloom, `no grey at ${s.at}`);
  assert.equal(step(DAY.dawn).sun, 0);
  assert.ok(step(DAY.dawn - 0.1).night);
  // the hours from world time: a whole day round, starting at DAY.start
  assert.equal(hourAt(0), DAY.start);
  assert.ok(Math.abs(hourAt(DAY.day) - DAY.start) < 1e-9);
  assert.ok(Math.abs(hourAt(DAY.day / 4) - ((DAY.start + 6) % 24)) < 1e-9);
  assert.equal(sunAt(0), stepAt(DAY.start));
  assert.equal(sunAt(5, { ...DAY, on: false }), null);
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

test('a tree casts its crown along the sun, and its trunk as a line', () => {
  const s = sun();
  const { polys, lines } = castShapes([
    { kind: 'crown', at: [0, 0], z: 1, r: 0.2, rz: 0.3 },
    { kind: 'cone', at: [5, 0], z0: 0.2, z1: 1.2, r: 0.15 },
    { kind: 'stem', at: [0, 0], z: 0.7 },
  ], s);
  assert.equal(polys.length, 2);
  const xs = (p) => p.map(([x]) => x);
  // the crown's shadow lies round its middle shifted by its height along the sun
  assert.ok(Math.abs((Math.max(...xs(polys[0])) + Math.min(...xs(polys[0]))) / 2 - SUN.length) < 1e-9);
  // the spruce's reaches to its point's shadow
  assert.ok(Math.abs(Math.max(...xs(polys[1])) - (5 + 1.2 * SUN.length)) < 1e-9);
  assert.deepEqual(lines, [[[0, 0], [0.7 * SUN.length, 0]]]);
  const d = shadowPaths({ casts: [{ kind: 'crown', at: [0, 0], z: 1, r: 0.2, rz: 0.3 }], project }, s).join('');
  assert.ok(d.length > 0);
});

test('a roof casts its own outline, and a gable end wall its point', () => {
  const s = sun();
  // a roof plane from the eave at 1 up to the ridge at 1.5, across x = 0..1
  const { polys } = castShapes([{ kind: 'face', pts: [[0, 0, 1], [0, 1, 1], [0.5, 1, 1.5], [0.5, 0, 1.5]] }], s);
  const xs = polys[0].map(([x]) => x);
  assert.ok(Math.abs(Math.min(...xs) - SUN.length) < 1e-9 && Math.abs(Math.max(...xs) - (0.5 + 1.5 * SUN.length)) < 1e-9);
  // a wall level at 1 casts its strip that far, whatever its point reaches
  const [strip] = castStrips([{ a: [1, 0], b: [1, 1], h: 1.5, level: 1, n: [1, 0] }], s);
  assert.equal(Math.max(...strip.map(([x]) => x)), 1 + SUN.length);
});
