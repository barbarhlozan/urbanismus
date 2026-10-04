// Ways into parks and squares (World.sitePaths) and the walkways drawn
// from them (roads/siteWalks.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road, street, path } from './helpers.js';
import { siteWalks, sampleSitePaths } from '../src/roads/siteWalks.js';

const park = (world, x, y) => world.placeStructure('green', world.grid.index(x, y));
const dirs = (paths) => paths.exits.map((e) => e.dir.join(',')).sort();

test('a plain road along a park is no way in', () => {
  const w = flatWorld();
  road(w, [2, 5], [10, 5]);
  assert.equal(w.sitePaths(park(w, 5, 6)).exits.length, 0);
});

test('a street along one side: one way in, a loop round the middle', () => {
  const w = flatWorld();
  street(w, [2, 5], [10, 5]);
  const paths = w.sitePaths(park(w, 5, 6));
  assert.deepEqual(dirs(paths), ['0,-1']);
  assert.deepEqual(paths.exits[0].pos, [5, 5.5]);
  const walks = siteWalks(paths);
  assert.ok(walks.loop > 0);
  assert.equal(walks.plaza, 0);
});

test('two ways in on neighbouring sides curve into each other', () => {
  const w = flatWorld();
  street(w, [2, 5], [10, 5]);
  const p = park(w, 5, 6);
  path(w, [8, 6], [5.5, 6]);
  const paths = w.sitePaths(p);
  assert.deepEqual(dirs(paths), ['0,-1', '1,0']);
  const walks = siteWalks(paths);
  assert.equal(walks.lines.length, 1);
  assert.equal(walks.plaza, 0);
  // the middle is left free on the inside of the curve
  assert.notDeepEqual(walks.centre, paths.hubPos);
});

test('three ways in meet at a plaza', () => {
  const w = flatWorld();
  street(w, [2, 5], [10, 5]);
  const p = park(w, 5, 6);
  path(w, [8, 6], [5.5, 6]);
  path(w, [5, 9], [5, 6.5]);
  const walks = siteWalks(w.sitePaths(p));
  assert.equal(walks.lines.length, 3);
  assert.ok(walks.plaza > 0);
});

test('a footpath only running along a side gives one way in, in the middle', () => {
  const w = flatWorld();
  const p = park(w, 5, 6);
  path(w, [3, 6.5], [8, 6.5]);
  assert.deepEqual(w.sitePaths(p).exits.map((e) => e.pos), [[5, 6.5]]);
});

test('neighbouring parks join up only when the group has a way in', () => {
  const w = flatWorld();
  const a = park(w, 5, 6), b = park(w, 6, 6);
  assert.equal(w.sitePaths(a).exits.length, 0);
  assert.equal(w.sitePaths(b).exits.length, 0);
  path(w, [5, 9], [5, 6.5]);
  assert.ok(w.sitePaths(a).exits.some((e) => e.site === b.id));
  assert.ok(w.sitePaths(b).exits.some((e) => e.site === a.id));
});

test('sample ways in for parks drawn on their own', () => {
  for (let n = 0; n <= 4; n++) assert.equal(sampleSitePaths([0, 0, 1, 1], n).exits.length, n);
  const straight = siteWalks(sampleSitePaths([0, 0, 1, 1], 2));
  const bent = siteWalks(sampleSitePaths([0, 0, 1, 1], 2, { bend: true }));
  assert.ok(straight.plaza > 0);
  assert.equal(bent.plaza, 0);
});
