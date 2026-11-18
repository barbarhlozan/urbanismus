// Ways beside buildings placed freely: kept off the walls by the drawn
// line itself (World.buildingsOnLine), not by the dots the house stands
// nearest, so a road or a footpath may run close by.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld } from './helpers.js';

const house = (w) => w.placeStructureAt('house', 6, 9, 0, { seed: 1 });
const body = (w, s) => {
  const xs = w.bodyAt(s.type, s.x, s.y, s.angle).map((p) => p[1]);
  return [Math.min(...xs), Math.max(...xs)];
};

test('a road just past the walls is laid, one over them is not', () => {
  const w = flatWorld();
  const s = house(w);
  assert.ok(s);
  const [, y1] = body(w, s);
  const y = y1 + w.wayClear('road') + 0.02;
  assert.ok(w.layWay('road', [[2, y], [11, y]]).ok, 'beside');
  const through = w.checkWay('road', [[2, s.y], [11, s.y]]);
  assert.equal(through.ok, false);
  assert.equal(through.reason, 'A building is in the way');
});

test('a footpath and a field edge close by the walls too', () => {
  for (const kind of ['path', 'field', 'fence', 'rail']) {
    const w = flatWorld();
    const s = house(w);
    const [y0] = body(w, s);
    const y = y0 - w.wayClear(kind) - 0.02;
    assert.ok(w.checkWay(kind, [[2, y], [11, y]]).ok, `${kind} beside`);
    assert.equal(w.checkWay(kind, [[2, s.y], [11, s.y]]).ok, false, `${kind} through`);
  }
});

test('undo and redo of a road beside a house', () => {
  const w = flatWorld();
  const s = house(w);
  w.history.commit();
  const [, y1] = body(w, s);
  const y = y1 + w.wayClear('road') + 0.02;
  assert.ok(w.layWay('road', [[2, y], [11, y]]).ok);
  w.history.commit();
  assert.ok(w.history.undo().ok);
  assert.ok(w.history.redo().ok);
  assert.ok([...w.ways.edges.values()].some((e) => e.kind === 'road'));
});
