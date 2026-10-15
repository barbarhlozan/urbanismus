// Road marks (render/roadMarks.js): which buildings get one, where it goes,
// and that each is its own stroke.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../src/render/camera.js';
import { ROAD_MARK, unserved, markPlace, roadMarkPath } from '../src/render/roadMarks.js';
import { flatWorld, road, path } from './helpers.js';

const ids = (world) => unserved(world).map((s) => s.id).sort((a, b) => a - b);
const place = (world, type, x, y, rotation = 0) => world.placeStructure(type, world.grid.index(x, y), { rotation, seed: 7 });

test('a building with no road gets a mark, which goes when a road reaches it', () => {
  const world = flatWorld();
  const house = place(world, 'house', 5, 5);
  assert.deepEqual(ids(world), [house.id]);
  road(world, [3, 6], [8, 6]);
  assert.deepEqual(ids(world), []);
});

test('a footpath will do for a house, not for a smithy', () => {
  const world = flatWorld();
  const house = place(world, 'house', 5, 5);
  const works = place(world, 'kovarna', 12, 5);
  assert.ok(works, 'the smithy stands');
  path(world, [3, 6], [15, 6]);
  assert.deepEqual(ids(world), [works.id]);
  assert.ok(house);
});

test('the mark stands just off the footprint, on a side facing the viewer', () => {
  const world = flatWorld();
  const camera = new Camera(world.grid);
  for (let rotation = 0; rotation < 4; rotation++) {
    camera.rotation = rotation;
    const s = place(world, 'house', 5 + rotation * 3, 5);
    const { at: [x, y], dir } = markPlace(world, camera, s);
    const [hx, hy] = world.grid.xy(s.node);
    assert.ok(Math.abs(Math.hypot(x - hx, y - hy) - ROAD_MARK.out) < 1e-9);
    assert.ok(camera.project(hx + dir[0], hy + dir[1], 0)[1] > camera.project(hx, hy, 0)[1], `rotation ${rotation}`);
  }
});

test('every hand draws, and no two buildings draw the same stroke', () => {
  const project = (x, y) => [x * 32, y * 16];
  const spot = { at: [5, 5.5], dir: [0, 1] };
  for (const style of ROAD_MARK.styles) {
    const a = roadMarkPath(style, spot, 1, project), b = roadMarkPath(style, spot, 2, project);
    assert.match(a, /^M/, style);
    assert.notEqual(a, b, style);
    assert.equal(a, roadMarkPath(style, spot, 1, project), `${style}: the same seed draws the same`);
  }
});
