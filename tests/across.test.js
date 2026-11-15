// Walking between neighbours with no footpath: straight across the ground
// (WalkNetwork.acrossTo), unless a path or pavement gets there as well.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld } from './helpers.js';
import { WalkNetwork } from '../src/sim/walking.js';
import { CONFIG } from '../src/config.js';

const placeNear = (w, type, x, y) => {
  for (const [dx, dy] of [[0, 0], [0.5, 0], [0, 0.5], [-0.5, 0], [0, -0.5], [1, 1], [-1, 1]]) {
    const s = w.placeStructureAt(type, x + dx, y + dy, 0);
    if (s) return s;
  }
  return null;
};

test('a neighbour walks to the pub over the grass', () => {
  const w = flatWorld(30, 30);
  const home = placeNear(w, 'house', 8, 8), pub = placeNear(w, 'hospoda', 11, 9);
  assert.ok(home && pub);
  const r = new WalkNetwork(w, CONFIG).route(home, pub, CONFIG.walk.maxDistance);
  assert.ok(r?.across, 'no walk across');
  assert.deepEqual(r.pts[0], [home.x, home.y]);
  assert.deepEqual(r.pts.at(-1), [pub.x, pub.y]);
  assert.ok(Math.abs(r.cost - Math.hypot(pub.x - home.x, pub.y - home.y) * 1.35) < 1e-9);
});

test('not too far, and not through another building', () => {
  const w = flatWorld(30, 30);
  const home = placeNear(w, 'house', 4, 10), pub = placeNear(w, 'hospoda', 14, 10);
  assert.ok(home && pub);
  assert.equal(new WalkNetwork(w, CONFIG).acrossTo(home, pub), null); // 10 apart: too far
  const a = placeNear(w, 'house', 6, 15), b = placeNear(w, 'house', 10, 15), between = placeNear(w, 'house', 8, 15);
  assert.ok(a && b && between);
  assert.equal(new WalkNetwork(w, CONFIG).acrossTo(a, b), null);
});

test('cyclists keep to the ways', () => {
  const w = flatWorld(30, 30);
  const home = placeNear(w, 'house', 8, 8), pub = placeNear(w, 'hospoda', 11, 9);
  assert.equal(new WalkNetwork(w, CONFIG, { allRoads: true }).route(home, pub, 20), null);
});
