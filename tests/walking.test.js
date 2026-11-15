// Walking and cycling on the ways (sim/walking.js over sim/wayGraph.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road, street, path } from './helpers.js';
import { CONFIG } from '../src/config.js';
import { WalkNetwork } from '../src/sim/walking.js';
import { UNLOCKS } from '../src/story/unlocks.js';

function town(build) {
  const w = flatWorld(24, 24);
  UNLOCKS.setWorld(w);
  const out = build(w);
  return { w, walk: new WalkNetwork(w, CONFIG), ride: new WalkNetwork(w, CONFIG, { allRoads: true }), ...out };
}

const house = (w, x, y) => w.placeStructure('house', w.grid.index(x, y));
const near = (p, q, d = 1e-6) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= d;

test('along a street from door to door, on its sidewalk', () => {
  const { walk, a, b } = town((w) => {
    street(w, [2, 10], [20, 10]);
    return { a: house(w, 4, 9), b: house(w, 16, 9) };
  });
  const r = walk.route(a, b);
  assert.ok(r, 'a walk');
  assert.ok(r.ways.length >= 1);
  assert.ok(r.pts.every(([, y]) => Math.abs(y - 10) < 0.01), 'along the street');
  assert.ok(Math.abs(r.pts[0][0] - 4) < 1.1 && Math.abs(r.pts[r.pts.length - 1][0] - 16) < 1.1); // (straight out, or a step aslant)
  assert.ok(near(r.fromDoor, [4, 9], 0.6) && near(r.toDoor, [16, 9], 0.6));
  // sidewalks count longer than they are
  assert.ok(r.cost > 10 * 1.4, r.cost);
});

test('a plain road is for cyclists, not walkers', () => {
  const { walk, ride, a, b } = town((w) => {
    road(w, [2, 10], [20, 10]);
    return { a: house(w, 4, 9), b: house(w, 16, 9) };
  });
  assert.equal(walk.route(a, b), null);
  assert.ok(ride.route(a, b));
});

test('a footpath is taken over a longer street', () => {
  const { walk, a, b } = town((w) => {
    street(w, [2, 14], [20, 14]);
    path(w, [4, 10], [16, 10]);
    return { a: house(w, 4, 11), b: house(w, 16, 11) };
  });
  const r = walk.route(a, b);
  assert.ok(r.pts.every(([, y]) => Math.abs(y - 10) < 0.01), 'along the footpath');
});

test('a stroll goes out and comes home, ending where it set off', () => {
  const { walk, a } = town((w) => {
    path(w, [2, 10], [20, 10]);
    path(w, [10, 10], [10, 20]);
    return { a: house(w, 4, 11) };
  });
  for (let i = 0; i < 10; i++) {
    const loop = walk.stroll(a, 3, 12);
    assert.ok(loop, 'a stroll');
    assert.ok(loop.cost >= 3 && loop.cost <= 12, loop.cost);
    assert.ok(near(loop.pts[loop.pts.length - 1], loop.backPts[0], 1e-6), 'back from where it got to');
    assert.ok(near(loop.backDoor, loop.fromDoor, 1e-6));
  }
});

test('a walk to a spot where something holds, along the way', () => {
  const { walk, a } = town((w) => {
    path(w, [2, 10], [20, 10]);
    return { a: house(w, 4, 11) };
  });
  const r = walk.toward(a, ([x]) => x > 14, 1, 20);
  assert.ok(r);
  assert.ok(r.pts[r.pts.length - 1][0] > 14);
  assert.equal(r.toDoor, null);
});
