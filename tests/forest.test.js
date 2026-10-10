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

test('a wood is outlined in a few straight sides, not a bumpy blob', () => {
  const world = flatWorld(30, 30);
  plant(world, 4, 4, 9, 9);
  const [loop] = findForests(world, cfg).loops;
  assert.ok(loop.length <= 12, `${loop.length} points`);
  // it still goes round all the trees
  const inside = ([x, y]) => loop.slice(1).reduce((n, b, i) => {
    const a = loop[i];
    return (a[1] > y) !== (b[1] > y) && x < a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]) ? !n : n;
  }, false);
  for (const [x, y] of [[4, 4], [9, 4], [4, 9], [9, 9], [6, 6]]) assert.ok(inside([x, y]), `${x},${y} in the wood`);
});

test('a road through a wood is kept clear of it', () => {
  const world = flatWorld(30, 30);
  plant(world, 4, 4, 15, 15);
  const ways = new SegmentIndex([[[0, 10], [30, 10]]]);
  const { cover } = findForests(world, cfg, ways);
  assert.ok(cover(8, 10) < 0.5, 'on the road');
  assert.ok(cover(8, 7) > 0.5, 'in the wood');
});

test('woods far apart are separate woods, each with its own trees', () => {
  const world = flatWorld(40, 30);
  plant(world, 3, 3, 8, 8);
  plant(world, 25, 15, 32, 22);
  const { trees, woods, woodOf } = findForests(world, cfg);
  assert.equal(woods.length, 2);
  assert.equal(woods[0].trees.length + woods[1].trees.length, trees.size);
  for (const w of woods) for (const id of w.trees) assert.equal(woodOf.get(id), w.id);
  assert.notEqual(woods[0].id, woods[1].id);
});
