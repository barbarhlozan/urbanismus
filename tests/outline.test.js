// Free placement (stage B): may a building stand at a position and angle,
// by its outline (World.fitsOutline)?
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road, street } from './helpers.js';

const fits = (w, x, y, angle = 0, type = 'house') => w.fitsOutline(type, x, y, angle);

test('a house off the dots, anywhere free', () => {
  const w = flatWorld();
  assert.deepEqual(fits(w, 7.3, 8.6), { ok: true });
  assert.deepEqual(fits(w, 7.3, 8.6, 0.4), { ok: true });
});

test('not across a road, but close beside it', () => {
  const w = flatWorld();
  road(w, [2, 5], [12, 5]);
  assert.equal(fits(w, 6, 5.2).reason, 'Road');
  assert.equal(fits(w, 6, 5.6).reason, 'Road'); // its front edge on the road's edge
  assert.equal(fits(w, 6, 5.7).ok, true);
  assert.equal(fits(w, 6, 4.3).ok, true); // the other side
});

test('a street keeps houses back to its kerb', () => {
  const w = flatWorld();
  street(w, [2, 5], [12, 5]);
  assert.equal(fits(w, 6, 5.7).reason, 'Road');
  assert.equal(fits(w, 6, 5.75).ok, true);
});

test('not on another building; side by side is fine, at any angle', () => {
  const w = flatWorld();
  const s = w.placeStructure('house', w.grid.index(6, 9));
  assert.equal(fits(w, 6.5, 9).reason, 'Occupied');
  assert.equal(fits(w, 7, 9).ok, true); // wall to wall
  assert.equal(fits(w, 7.1, 9, Math.PI / 4).reason, 'Occupied');
  assert.equal(fits(w, 7.75, 9, Math.PI / 4).ok, true);
  assert.equal(w.fitsOutline('house', 6.5, 9, 0, s.id).ok, true); // itself, moved
});

test('not off the map, nor on a station-like rule', () => {
  const w = flatWorld();
  assert.equal(fits(w, -0.1, 5).reason, 'Off the map');
  assert.equal(fits(w, 0.5, 5).ok, true);
  assert.equal(w.fitsOutline('station', 10, 10).reason, 'On the grid only');
});

test('a wider building is measured by its whole outline', () => {
  const w = flatWorld();
  road(w, [2, 5], [12, 5]);
  const [across, deep] = w.outlineSize('house-wide');
  assert.ok(across >= 2 && deep >= 1);
  assert.equal(fits(w, 7, 6.2, 0, 'house-wide').ok, deep / 2 + 0.15 < 1.2);
  assert.equal(fits(w, 7, 5 + deep / 2 + 0.2, 0, 'house-wide').ok, true);
  assert.equal(fits(w, 7, 5 + deep / 2 + 0.2, Math.PI / 2, 'house-wide').ok, across / 2 + 0.15 < deep / 2 + 0.2);
});

test('placed by a road: facing it, set back, unevenly by seed', () => {
  const w = flatWorld();
  road(w, [2, 5], [12, 5]);
  const below = w.freePlacement('house', 6.3, 6.4, { seed: 1 });
  assert.ok(below.check.ok, below.check.reason);
  assert.ok(Math.abs(below.angle) < 1e-9); // below the road: front up
  assert.ok(below.y > 5.7 && below.y < 6.2);
  assert.ok(Math.abs(below.x - 6.3) < 1e-9); // along the road where pointed
  const above = w.freePlacement('house', 6.3, 4.2, { seed: 1 });
  assert.ok(Math.abs(Math.abs(above.angle) - Math.PI) < 1e-9);
  const ys = [1, 2, 3, 4, 5].map((seed) => w.freePlacement('house', 6, 6.4, { seed }).y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.03); // not all the same setback
  const s = w.placeStructureAt('house', below.x, below.y, below.angle);
  assert.ok(s?.free);
  assert.deepEqual([s.x, s.y, s.angle], [below.x, below.y, below.angle]);
  assert.equal(w.drawnRotation(s), 0);
});

test('a diagonal road turns the house to it', () => {
  const w = flatWorld();
  road(w, [2, 2], [10, 10]);
  const p = w.freePlacement('house', 7, 5, { seed: 3 });
  assert.ok(p.check.ok, p.check.reason);
  assert.ok(Math.abs(Math.abs(p.angle) - Math.PI / 4) < 1e-9 || Math.abs(Math.abs(p.angle) - 3 * Math.PI / 4) < 1e-9, String(p.angle));
});

test('a free house survives saving, and undo takes it away', async () => {
  const { World } = await import('../src/core/world.js');
  const w = flatWorld();
  road(w, [2, 5], [12, 5]);
  const p = w.freePlacement('house', 6.3, 6.4, { seed: 1 });
  const s = w.placeStructureAt('house', p.x, p.y, p.angle);
  const back = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  const t = back.structures.get(s.id);
  assert.deepEqual([t.x, t.y, t.angle, t.free], [s.x, s.y, s.angle, true]);
  assert.deepEqual(back.structureIndex.at(s.x, s.y), [s.id]);
  w.history.undo();
  assert.equal(w.structures.has(s.id), false);
});
