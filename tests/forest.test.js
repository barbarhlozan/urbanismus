import test from 'node:test';
import assert from 'node:assert/strict';
import { findForests } from '../src/render/forest.js';
import { CONFIG } from '../src/config.js';
import { SegmentIndex } from '../src/core/geom2d.js';
import { flatWorld } from './helpers.js';

const cfg = CONFIG.render.forest;

// A block of trees on every dot from (x0, y0) to (x1, y1).
function plant(world, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) world.addFeature('tree', world.grid.index(x, y));
}

test('a block of trees is one wood, a lone tree stays a tree', () => {
  const world = flatWorld(30, 30);
  plant(world, 4, 4, 9, 9);
  const lone = world.addFeature('tree', world.grid.index(20, 20));
  const { trees, loops } = findForests(world, cfg);
  assert.equal(trees.size, 36);
  assert.ok(!trees.has(lone.id));
  assert.equal(loops.length, 1);
});

test('a wood is outlined along the grid, a few corners rather than a round blob', () => {
  const world = flatWorld(30, 30);
  plant(world, 4, 4, 9, 9);
  const [loop] = findForests(world, cfg).loops;
  // almost all of its length along x or y (the corners are cut a little)
  const sides = loop.slice(1).map((p, i) => [p[0] - loop[i][0], p[1] - loop[i][1]]);
  const len = (list) => list.reduce((s, [dx, dy]) => s + Math.hypot(dx, dy), 0);
  const straight = sides.filter(([dx, dy]) => Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6);
  assert.ok(loop.length <= 13, `${loop.length} points`);
  assert.ok(len(straight) > 0.9 * len(sides));
});

test('a road through a wood is kept clear of it', () => {
  const world = flatWorld(30, 30);
  plant(world, 4, 4, 15, 15);
  const ways = new SegmentIndex([[[0, 10], [30, 10]]]);
  const { cover } = findForests(world, cfg, ways);
  assert.ok(cover(8, 10) < 0.5, 'on the road');
  assert.ok(cover(8, 7) > 0.5, 'in the wood');
});
