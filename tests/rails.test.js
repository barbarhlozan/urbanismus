// Railways smoothed into even curves (World.railPos): no kinks or wiggles
// where the dots make a staircase, never far off the dots, straight track
// left straight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld } from './helpers.js';
import { planRoute } from '../src/roads/routing.js';
import { smoothLine } from '../src/core/geom2d.js';

// a level world with a railway through dense dots [x, y] (each leg drawn
// as the tool does: diagonal first, then straight)
function railway(waypoints, world = level()) {
  const nodes = [world.fine.index(...waypoints[0])];
  for (let i = 1; i < waypoints.length; i++) {
    nodes.push(...planRoute(world.fine, world.fine.index(...waypoints[i - 1]), world.fine.index(...waypoints[i])).slice(1));
  }
  const built = world.buildNetwork('rail', nodes);
  assert.ok(built.ok, built.reason);
  return { world, nodes, pts: nodes.map((n) => world.networks.rail.pos(n)) };
}

function level() {
  const world = flatWorld(26, 26);
  world._relief = { rivers: world.terrain.rivers, field: null, elevation: () => 0 };
  return world;
}

// signed turn at each inner point (radians)
const turns = (pts) => pts.slice(1, -1).map((p, i) => {
  const a = pts[i], b = pts[i + 2];
  const h1 = Math.atan2(p[1] - a[1], p[0] - a[0]), h2 = Math.atan2(b[1] - p[1], b[0] - p[0]);
  return Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1));
});

const shift = ({ world, nodes }) => Math.max(...nodes.map((n) => {
  const [x, y] = world.networks.rail.pos(n), [dx, dy] = world.networks.rail.dot(n);
  return Math.hypot(x - dx, y - dy);
}));

test('smoothLine keeps fixed points and straight lines', () => {
  const pts = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
  assert.deepEqual(smoothLine(pts, [true, false, false, false, true], 10).map(([x, y]) => [+x.toFixed(9), +y.toFixed(9)]), pts);
  const bent = smoothLine([[0, 0], [1, 0], [2, 1], [3, 1]], [true, false, false, true], 10);
  assert.deepEqual(bent[0], [0, 0]);
  assert.deepEqual(bent[3], [3, 1]);
});

test('a straight railway stays on its dots', () => {
  const r = railway([[4, 10], [30, 10]]);
  assert.ok(shift(r) < 1e-9);
});

test('a 90° turn made of two 45° bends is one even curve', () => {
  const r = railway([[4, 10], [20, 10], [28, 18], [28, 34]]);
  const t = turns(r.pts);
  assert.ok(t.every((a) => a > -0.01), 'never bends the other way');
  assert.ok(Math.max(...t) < 0.3, `no sharp corner left (${Math.max(...t).toFixed(3)} rad at one dot)`);
  assert.ok(shift(r) <= 0.25 + 1e-9);
});

test('a staircase at a shallow angle smooths out without wiggling', () => {
  const r = railway([[4, 10], [10, 11], [16, 12], [22, 13], [28, 14], [34, 15], [40, 16]]);
  const t = turns(r.pts).slice(4, -4); // away from the ends
  assert.ok(Math.max(...t.map(Math.abs)) < 0.06, `nearly straight (${Math.max(...t.map(Math.abs)).toFixed(3)})`);
  assert.ok(shift(r) <= 0.25 + 1e-9);
});

test('the through line stays straight where a branch leaves it', () => {
  const r = railway([[4, 10], [34, 10]]);
  const branch = railway([[16, 10], [22, 16], [22, 30]], r.world);
  const main = r.nodes.map((n) => r.world.networks.rail.pos(n));
  assert.ok(main.every(([, y]) => Math.abs(y - main[0][1]) < 1e-9));
  assert.ok(turns(branch.nodes.map((n) => r.world.networks.rail.pos(n))).every((a) => a > -0.01));
});

test('a closed loop is smoothed all the way round', () => {
  const world = level();
  const r = railway([[10, 4], [20, 4], [26, 10], [26, 20], [20, 26], [10, 26], [4, 20], [4, 10], [10, 4]], world);
  const pts = [...r.nodes.slice(-2, -1), ...r.nodes, r.nodes[1]].map((n) => world.networks.rail.pos(n));
  assert.ok(turns(pts).every((a) => a > -0.02 && a < 0.25));
});
