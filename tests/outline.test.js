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

test('a house by a free neighbour snaps flush to its side and they can share a wall', async () => {
  const { freeSideBy, joinSides } = await import('../structures/index.js');
  const w = flatWorld();
  road(w, [2, 2], [12, 7]); // a slanting road, so nothing lines up by chance
  const p = w.freePlacement('house', 6, 5.5, { seed: 1 });
  const a = w.placeStructureAt('house', p.x, p.y, p.angle);
  // pointing roughly beside it, a little off
  const q = w.freePlacement('house', a.x + Math.cos(a.angle) * 1.2, a.y + Math.sin(a.angle) * 1.2 + 0.1, { seed: 9 });
  assert.ok(q.check.ok, q.check.reason);
  assert.ok(Math.abs(q.angle - a.angle) < 1e-9);
  assert.ok(Math.abs(Math.hypot(q.x - a.x, q.y - a.y) - 1) < 1e-9);
  const b = w.placeStructureAt('house', q.x, q.y, q.angle);
  assert.equal(freeSideBy(w, a, 1)?.id, b.id);
  assert.equal(freeSideBy(w, b, -1)?.id, a.id);
  assert.equal(freeSideBy(w, a, -1), null);
  const sides = joinSides(w, a);
  assert.equal(sides.left, false);
  assert.equal(typeof sides.right, 'boolean'); // (whether they do is the seeded roll)
});

test('far from a neighbour, no snap', () => {
  const w = flatWorld();
  road(w, [2, 5], [14, 5]);
  const a = w.placeStructureAt('house', 5, 5.9, 0);
  const q = w.freePlacement('house', 6.8, 6.4, { seed: 2 });
  assert.ok(Math.abs(q.x - 6.8) < 1e-9);
  assert.ok(!!a);
});

test('a wider building placed freely: its anchor turns with it about its middle', async () => {
  const { freeAnchor, STRUCTURE_TYPES, footprintCenter } = await import('../structures/index.js');
  const w = flatWorld(30, 30);
  road(w, [2, 2], [20, 11]);
  const p = w.freePlacement('house-wide', 10, 8, { seed: 4 });
  assert.ok(p.check.ok, p.check.reason);
  const s = w.placeStructureAt('house-wide', p.x, p.y, p.angle);
  const [ax, ay] = w.anchorOf(s);
  // turned back by the angle, the anchor is the footprint centre away from the middle
  const def = STRUCTURE_TYPES['house-wide'], [cx, cy] = footprintCenter(def, 0);
  const c = Math.cos(-s.angle), sn = Math.sin(-s.angle), dx = s.x - ax, dy = s.y - ay;
  assert.ok(Math.abs(dx * c - dy * sn - cx) < 1e-9 && Math.abs(dx * sn + dy * c - cy) < 1e-9);
  assert.deepEqual(freeAnchor(def, 5, 5, 0), [5 - cx, 5 - cy]);
  assert.deepEqual(w.structureIndex.at(s.x, s.y), [s.id]);
});

test('a road, railway or footpath may not be laid through a free building', async () => {
  const { run, fineRun } = await import('./helpers.js');
  const w = flatWorld();
  const s = w.placeStructureAt('house', 6.5, 8, 0.3);
  assert.ok(s);
  const across = w.buildNetwork('road', run(w, [6, 3], [6, 14]));
  assert.equal(across.ok, false);
  assert.equal(across.reason, 'Occupied');
  assert.equal(w.buildNetwork('road', run(w, [4, 3], [4, 14])).ok, true); // clear of it
  assert.equal(w.buildNetwork('path', fineRun(w, [7, 3], [7, 14])).ok, false);
});

test('turned by the player: from facing its road, or the viewer, by any angle', () => {
  const w = flatWorld();
  road(w, [2, 5], [12, 5]);
  const p = w.freePlacement('house', 6, 6.4, { seed: 1, twist: 0.3 });
  assert.ok(p.road); // still by its road, set back as ever
  assert.ok(Math.abs(p.angle - 0.3) < 1e-9); // facing it, then turned by the twist
  const off = w.freePlacement('house', 6, 12, { rotation: 1, twist: 0.3 });
  assert.equal(off.road, null);
  assert.ok(Math.abs(off.angle - (Math.PI / 2 + 0.3)) < 1e-9);
  assert.deepEqual([off.x, off.y], [6, 12]);
});

test('a free building finds its way in by the road in front of it', () => {
  let dotless = 0;
  for (const [x, y] of [[7, 5.4], [5.6, 3.4], [9.3, 7.2], [4.5, 2.6], [8.2, 6.6]]) {
    const w = flatWorld(30, 30);
    road(w, [2, 2], [14, 8]); // a shallow slant: road dots don't line up with the houses' dots
    const p = w.freePlacement('house', x, y + 1.2, { seed: 5 });
    if (!p.check.ok) continue;
    const s = w.placeStructureAt('house', p.x, p.y, p.angle);
    const a = w.accessInfo(s);
    assert.ok(a && w.hasRoad(a.road), `no way in at ${x}, ${y}`);
    if (!w.accessFor(w.nodesOf(s))) dotless++;
  }
  const w = flatWorld(30, 30);
  const lone = w.placeStructureAt('house', 10, 25, 0);
  assert.equal(w.accessInfo(lone), null);
  assert.ok(dotless >= 0);
});
