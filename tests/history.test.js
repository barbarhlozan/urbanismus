// Undo and redo of the player's changes (core/history.js): one step per
// click, the town's own changes left alone, steps that can't come back,
// the chronicle's lines and the save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road, path, run } from './helpers.js';
import { World } from '../src/core/world.js';
import { Chronicle } from '../src/sim/chronicle.js';
import { CONFIG } from '../src/config.js';

const at = (w, x, y) => w.grid.index(x, y);
// the save, but for the clock, the chronicle and the next id (ids aren't reused)
const save = (w) => JSON.stringify({ ...w.toJSON(), time: 0, chronicle: null, nextId: 0 });

// each call a click of its own
function steps(w, ...clicks) {
  for (const click of clicks) {
    click();
    w.history.commit();
  }
}

test('a building, a road and a demolition each undo and redo', () => {
  const w = flatWorld();
  const empty = save(w);
  let house;
  steps(w,
    () => road(w, [2, 5], [10, 5]),
    () => (house = w.placeStructure('house', at(w, 4, 6))),
  );
  const built = save(w);
  steps(w, () => w.removeStructure(house.id));
  assert.equal(w.structures.size, 0);

  assert.ok(w.history.undo().ok); // the demolition
  assert.equal(w.structureAt(at(w, 4, 6))?.id, house.id);
  assert.equal(save(w), built);
  assert.ok(w.history.undo().ok); // the house
  assert.ok(w.history.undo().ok); // the road
  assert.equal(save(w), empty);
  assert.equal(w.history.undo().ok, false);

  assert.ok(w.history.redo().ok);
  assert.ok(w.history.redo().ok);
  assert.equal(save(w), built);
  // a new step: nothing left to redo
  steps(w, () => w.placeStructure('house', at(w, 6, 6)));
  assert.equal(w.history.canRedo, false);
});

test('changes made in one go are one step; nothing changed is no step', () => {
  const w = flatWorld();
  road(w, [2, 5], [10, 5]);
  w.placeStructure('house', at(w, 4, 6));
  w.placeStructure('house', at(w, 4, 6)); // (taken: changes nothing)
  w.history.commit();
  steps(w, () => w.removeStructure(999));
  assert.equal(w.history.done.length, 1);
  w.history.undo();
  assert.equal(w.structures.size, 0);
  assert.equal(w.roads.edgeCount, 0);
});

test('the step closes by itself once the click is handled', async () => {
  const w = flatWorld();
  road(w, [2, 5], [10, 5]);
  await Promise.resolve();
  road(w, [2, 7], [10, 7]);
  await Promise.resolve();
  assert.equal(w.history.done.length, 2);
});

test('a look, a yard and turning into something else come back', () => {
  const w = flatWorld();
  road(w, [2, 5], [10, 5]);
  const s = w.placeStructure('house', at(w, 4, 6));
  w.history.commit();
  const was = JSON.stringify(s);
  steps(w,
    () => w.restyleStructure(s.id),
    () => w.setYard(s.id, 'none'),
    () => w.convertStructure(s.id, 'apartments'),
  );
  assert.equal(s.type, 'apartments');
  s.data.parked = 3; // (cars come and go by themselves: not undone)
  w.history.undo();
  w.history.undo();
  w.history.undo();
  assert.equal(w.structures.get(s.id), s, 'changed in place');
  assert.equal(s.data.parked, 3);
  delete s.data.parked;
  assert.equal(JSON.stringify(s), was);
});

test('trees cleared by a road come back with its undo', () => {
  const w = flatWorld();
  const tree = w.addFeature('tree', at(w, 5, 5));
  w.history.commit();
  steps(w, () => road(w, [2, 5], [10, 5]));
  assert.equal(w.featureAt(at(w, 5, 5)), null);
  w.history.undo();
  assert.equal(w.featureAt(at(w, 5, 5)), tree);
});

test('a footpath turned into sidewalks: the road is a road again', () => {
  const w = flatWorld();
  steps(w, () => road(w, [2, 5], [10, 5]));
  const before = save(w);
  steps(w, () => path(w, [2, 5.5], [10, 5.5]));
  assert.ok(w.sidewalks.size > 0);
  assert.equal(w.paths.edgeCount, 0);
  w.history.undo();
  assert.equal(save(w), before);
  w.history.redo();
  assert.ok(w.sidewalks.size > 0);
  // erasing the sidewalks, and back
  steps(w, () => w.setSidewalks(w.sidewalksAt(at(w, 5, 5)), false));
  const n = w.sidewalks.size;
  w.history.undo();
  assert.equal(w.sidewalks.size, n + 2);
});

test("the town's own church isn't undone, and keeps its ground", () => {
  const w = flatWorld();
  let house;
  steps(w,
    () => road(w, [2, 5], [12, 5]),
    () => (house = w.placeStructure('house', at(w, 4, 6))),
    () => w.removeStructure(house.id),
  );
  // a church grows where the house stood
  const spot = [...Array(w.grid.size).keys()].find((n) => w.footprintNodes('church', n).includes(at(w, 4, 6)) && w.canPlaceStructure('church', n).ok);
  const church = w.history.aside(() => w.placeStructure('church', spot));
  assert.ok(church);
  assert.equal(w.history.done.length, 3);

  // the house can't come back: the step goes, nothing changes
  const result = w.history.undo();
  assert.deepEqual(result, { ok: false, reason: 'Occupied' });
  assert.equal(w.structureAt(at(w, 4, 6)), church);
  assert.equal(w.history.done.length, 2);
  // the steps before it still undo; the church stays, without its road
  w.history.undo();
  w.history.undo();
  assert.equal(w.roads.edgeCount, 0);
  assert.equal(w.structures.get(church.id), church);
});

test('a road that would come back under a building stays gone', () => {
  const w = flatWorld();
  steps(w, () => road(w, [2, 5], [10, 5]), () => w.removeRoadAt(at(w, 6, 5)));
  w.history.aside(() => w.placeStructure('house', at(w, 6, 5)));
  assert.equal(w.history.undo().ok, false);
  assert.equal(w.hasRoad(at(w, 6, 5)), false);
});

test('a station comes and goes with the track it laid', () => {
  const w = flatWorld(30, 20);
  const before = save(w);
  steps(w, () => {
    const p = w.placementFor('station', at(w, 10, 10), 0);
    assert.ok(p.check.ok, p.check.reason);
    w.placeStructure('station', p.node, { rotation: p.rotation });
  });
  assert.ok(w.rails.edgeCount > 0);
  w.history.undo();
  assert.equal(save(w), before);
  w.history.redo();
  assert.ok(w.rails.edgeCount > 0);
});

test("the chronicle loses the step's lines on undo and gets them back on redo", () => {
  const w = flatWorld();
  const c = new Chronicle(w, CONFIG);
  steps(w, () => road(w, [2, 5], [10, 5]), () => w.placeStructure('church', at(w, 5, 3)));
  const lines = c.entries.map((e) => e.text);
  assert.deepEqual(lines.slice(1), ['The first road was laid.', 'A church was built.']);
  w.history.undo();
  w.history.undo();
  assert.equal(c.entries.length, 1);
  assert.ok(!w.chronicle.marks.includes('first:road'));
  w.history.redo();
  w.history.redo();
  assert.deepEqual(c.entries.map((e) => e.text), lines);
  // pulling a landmark down and undoing it writes nothing
  const church = w.structureAt(at(w, 5, 3));
  steps(w, () => w.removeStructure(church.id));
  w.history.undo();
  assert.deepEqual(c.entries.map((e) => e.text), lines);
});

test('undo is told everywhere and the save loads as the town stands', () => {
  const w = flatWorld();
  const seen = [];
  w.events.on('*', (type) => seen.push(type));
  steps(w, () => road(w, [2, 5], [10, 5]), () => w.placeStructure('house', at(w, 4, 6)));
  seen.length = 0;
  w.history.undo();
  assert.deepEqual(seen, ['structure:removed']);
  w.history.undo();
  assert.deepEqual(seen, ['structure:removed', 'roads:changed']);
  w.history.redo();
  const loaded = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(save(loaded), save(w));
  assert.equal(loaded.history.canUndo, false);
});

test('only the last hundred steps are kept', () => {
  const w = flatWorld(30, 30);
  for (let y = 0; y < 30; y += 2) for (let x = 0; x < 30; x += 4) steps(w, () => w.buildNetwork('road', run(w, [x, y], [x + 1, y])));
  assert.equal(w.history.done.length, 100);
});
