import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUN, sunFor, shadowPaths } from '../src/render/shadows.js';
import { TILE, hatchFrame, hatchStrokes, hatchPoints, hatchTile, tierOf } from '../src/render/hatch.js';

const h = SUN.hatch, px = 32, f = hatchFrame(h);
const near = (p, q, eps = 0.02) => Math.hypot(p[0] - q[0], p[1] - q[1]) < eps;
// the points of path data, as numbers in pairs
const points = (d) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(Number).reduce((o, x, i) => (i % 2 ? o[o.length - 1].push(x) : o.push([x]), o), []);

test('the lines fit the repeat a whole number of times, in eights', () => {
  assert.equal(f.n % 8, 0);
  assert.ok(Math.abs(f.gap * f.n - TILE) < 1e-9);
  assert.ok(Math.abs(f.gap - h.gap) / h.gap < 0.05);
});

test('the strokes repeat with the tile, along the lines and across them', () => {
  for (const k of [0, 3, 17, 250]) {
    for (const t of [5, 40.5, 133, 310]) {
      const ps = hatchPoints(k, t, h, px), qs = hatchPoints(k, t + TILE * px, h, px), rs = hatchPoints(k + f.n, t, h, px);
      assert.equal(ps.length, qs.length);
      assert.equal(ps.length, rs.length);
      ps.forEach((p, i) => {
        assert.ok(near([p[0] + f.u[0] * TILE * px, p[1] + f.u[1] * TILE * px], qs[i]), `along, line ${k} at ${t}`);
        assert.ok(near([p[0] + f.v[0] * TILE * px, p[1] + f.v[1] * TILE * px], rs[i]), `across, line ${k} at ${t}`);
      });
    }
  }
});

test('a piece of a line lies on the same strokes as the whole line', () => {
  for (const k of [1, 8, 99]) {
    const d = hatchStrokes(k, 37, 290, h, px, f);
    const ends = points(d).filter((_, i) => i % 3 !== 1); // (M and the Q's end; not its control point)
    assert.ok(ends.length >= 4);
    for (const p of ends) {
      const t = p[0] * f.u[0] + p[1] * f.u[1];
      assert.ok(hatchPoints(k, t, h, px).some((q) => near(p, q, 0.05)), `line ${k} at ${t}`);
      assert.ok(t > 37 - 0.01 && t < 290 + 0.01);
    }
  }
});

test('mostly strokes, and now and then a little paper between them', () => {
  let on = 0, all = 0;
  for (let k = 0; k < 40; k++) for (let t = 0; t < TILE * px; t += 3) { all++; if (hatchPoints(k, t, h, px).length) on++; }
  assert.ok(on / all > 0.95 && on / all < 1, `${on} of ${all}`);
});

test('the night tile has as many lines as its tier asks for', () => {
  const count = (tier) => (hatchTile('n', tier, h, px).match(/M/g) ?? []).length;
  const [c0, c1, c2, c3] = [0, 1, 2, 3].map(count);
  for (const [lo, hi] of [[c0, c1], [c1, c2], [c2, c3]]) assert.ok(hi > lo * 1.7 && hi < lo * 2.3, `${lo} → ${hi}`);
  assert.equal(tierOf(f.n), 0);
});

test('a shadow on the map is the paper\'s strokes, within the shadow', () => {
  const camera = { angle: 0, tile: px };
  const sun = sunFor(camera, { ...SUN, azimuth: 0, length: 1 });
  const project = (x, y) => [x * px, y * px]; // (a flat projection will do)
  const feet = [{ a: [0, 0], b: [0, 1], h: 1, n: [1, 0] }]; // a wall facing +x, 1 high: a 1 × 1 shadow
  const d = shadowPaths({ feet, project }, sun).join('');
  const pts = points(d).filter((_, i) => i % 3 !== 1);
  assert.ok(pts.length > 20);
  for (const [x, y] of pts) assert.ok(x > -2 && x < px + 2 && y > -2 && y < px + 2, `${x} ${y}`);
  // every end on the night's stroke there
  for (const p of pts.slice(0, 40)) {
    const t = p[0] * f.u[0] + p[1] * f.u[1], c = p[0] * f.v[0] + p[1] * f.v[1];
    assert.ok(hatchPoints(Math.round(c / (f.gap * px)), t, h, px).some((q) => near(p, q, 0.05)), `${p}`);
  }
});
