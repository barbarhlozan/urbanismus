// Ways into parks and squares (World.sitePaths) and the walkways drawn
// from them (roads/siteWalks.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road, street, path, run } from './helpers.js';
import { siteEdges } from '../src/render/lots.js';
import { CONFIG } from '../src/config.js';
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

// A way in from a street or lane runs on to the road as drawn (siteEdges):
// to a lane's edge or a street's kerb, never across the road – also where
// the road bends in towards the park.
test('walkways meet the road at its edge, not past it', () => {
  const lane = (w, a, b) => w.buildNetwork('road', run(w, a, b), { lane: true });
  const cases = [
    [(w) => lane(w, [2, 5], [10, 5]), 'green', [5, 6], 5 + CONFIG.lane.edge],
    [(w) => street(w, [2, 5], [10, 5]), 'green', [5, 6], 5 + CONFIG.road.kerb],
    [(w) => lane(w, [2, 5], [10, 5]), 'meadow', [5, 6], 5 + CONFIG.lane.edge],
    [(w) => lane(w, [5, 5], [5, 1]), 'green', [5, 6], 5 + CONFIG.lane.edge], // runs straight off
  ];
  for (const [lay, type, [x, y], want] of cases) {
    const w = flatWorld();
    lay(w);
    const exits = siteEdges(w, CONFIG, w.sitePaths(w.placeStructure(type, w.grid.index(x, y)))).exits;
    assert.equal(exits.length, 1);
    assert.ok(Math.abs(exits[0].edge[1] - want) < 0.02, `${type}: ${exits[0].edge} (want y ${want})`);
  }
  // a lane bending in on the inside of a curve: stopped short of it
  const w = flatWorld();
  lane(w, [4, 3], [4, 6]);
  lane(w, [4, 6], [6, 8]);
  for (const e of siteEdges(w, CONFIG, w.sitePaths(w.placeStructure('green', w.grid.index(5, 6)))).exits) {
    assert.ok(e.edge, 'reaches the lane');
    // still on the park's side of the lane's centre
    const [ex, ey] = e.edge;
    assert.ok(e.dir[0] < 0 ? ex > 4.1 : ey < 7, `${e.dir}: ${e.edge}`);
  }
});

// Parks don't turn to a slanting road like houses do: their ground is laid
// out on the map, and a turned drawing would swing the walkways off it.
test('a park beside a diagonal lane is not turned', async () => {
  const { STRUCTURE_TYPES, tiltOf } = await import('../structures/index.js');
  const w = flatWorld();
  w.buildNetwork('road', run(w, [2, 3], [8, 9]), { lane: true });
  const s = w.placeStructure('green', w.grid.index(6, 5));
  assert.ok(s);
  assert.equal(tiltOf(STRUCTURE_TYPES.green, s, undefined, w), 0);
  const h = w.placeStructure('house', w.grid.index(4, 7));
  assert.ok(h && Math.abs(tiltOf(STRUCTURE_TYPES.house, h, undefined, w)) > 0.1, 'a house still turns to it');
});
