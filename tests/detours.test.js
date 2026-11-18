// A building put down across a way: the way bends round it
// (World.detoursFor, roads/detour.js), in the same step as the building.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld } from './helpers.js';

const lineOf = (w, kind) => [...w.ways.edges.values()].filter((e) => e.kind === kind);

for (const kind of ['path', 'road']) {
  test(`a house on a ${kind}: the ${kind} goes round it, and comes back on undo`, () => {
    const w = flatWorld();
    assert.ok(w.layWay(kind, [[2, 6], [12, 6]]).ok);
    w.history.commit();
    const before = JSON.stringify(lineOf(w, kind).map((e) => e.pts));
    assert.equal(w.fitsOutline('house', 7, 6, 0).ok, false);
    const p = w.detoursFor('house', 7, 6, 0);
    assert.ok(p.ok, p.reason);
    assert.equal(p.detours.length, 1);
    const s = w.placeStructureAt('house', 7, 6, 0, { seed: 1 });
    assert.ok(s, 'placed');
    w.history.commit();
    // the way is whole, still from end to end, and clear of the walls
    const edges = lineOf(w, kind);
    assert.equal(edges.length, 1);
    assert.deepEqual(edges[0].pts[0], [2, 6]);
    assert.deepEqual(edges[0].pts.at(-1), [12, 6]);
    assert.equal(w.buildingsOnLine(kind, edges[0].pts, edges[0]).length, 0);
    // one step: the house and the bend both go
    assert.ok(w.history.undo().ok);
    assert.equal(w.structures.size, 0);
    assert.equal(JSON.stringify(lineOf(w, kind).map((e) => e.pts)), before);
  });
}

test('the build preview says it fits, with the bend to come', () => {
  const w = flatWorld();
  assert.ok(w.layWay('path', [[2, 6], [12, 6]]).ok);
  const p = w.freePlacement('house', 7, 6, { seed: 1 });
  assert.ok(p.check.ok);
  assert.equal(p.check.detours.length, 1);
});

test('no going round where a junction is under it', () => {
  const w = flatWorld();
  assert.ok(w.layWay('path', [[2, 6], [12, 6]]).ok);
  assert.ok(w.layWay('path', [[7, 6], [7, 12]]).ok);
  assert.equal(w.detoursFor('house', 7, 6, 0).ok, false);
  assert.equal(w.placeStructureAt('house', 7, 6, 0), null);
});
