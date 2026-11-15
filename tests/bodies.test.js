// A building placed freely keeps others and ways off its body – its walls
// as drawn (structures/bodies.js) – not its whole square: footpaths pass
// close, neighbours stand close, and joined houses still meet wall to wall.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road, path } from './helpers.js';
import { joinSides, courtSides } from '../structures/index.js';

test('every building has a body inside its square, smaller than it', () => {
  const w = flatWorld();
  const [x0, y0, x1, y1] = w.bodyBox('house');
  assert.ok(x0 > -0.5 && y0 > -0.5 && x1 < 0.5 && y1 < 0.5);
  assert.ok(x0 < -0.25 && x1 > 0.25 && y0 < -0.2 && y1 > 0.2); // still round its walls
  const [w2, h2] = w.outlineSize('house-wide'), b = w.bodyBox('house-wide');
  assert.ok(b[0] >= -w2 / 2 && b[2] <= w2 / 2 && b[1] >= -h2 / 2 && b[3] <= h2 / 2);
});

test('a footpath can pass close behind a house', () => {
  const w = flatWorld();
  const s = w.placeStructureAt('house', 6, 9, 0);
  assert.ok(s);
  // a quarter of a step behind its back wall: inside its old square
  assert.ok(path(w, [3, 9.5], [9, 9.5]), 'the path is laid');
  assert.ok([...w.networks.path.graph.edges()].length > 0);
  // …but not through its walls
  const w2 = flatWorld();
  w2.placeStructureAt('house', 6, 9, 0);
  path(w2, [3, 9], [9, 9]);
  assert.ok(![...w2.networks.path.graph.edges()].some(([a, b]) => {
    const pa = w2.networks.path.pos(a), pb = w2.networks.path.pos(b);
    return Math.min(pa[0], pb[0]) < 6 && Math.max(pa[0], pb[0]) > 6;
  }), 'no path across the house');
});

test('a house can stand by a footpath closer than its square', () => {
  const w = flatWorld();
  path(w, [3, 9.5], [9, 9.5]);
  assert.equal(w.fitsOutline('house', 6, 9, 0).ok, true);
  assert.equal(w.fitsOutline('house', 6, 9.3, 0).reason, 'Footpath');
});

test('two houses can stand close, but not wall in wall', () => {
  // (one with no court of its own beside it)
  let w;
  for (let seed = 1; seed < 100; seed++) {
    w = flatWorld();
    const s = w.placeStructureAt('house', 6, 9, 0, { seed });
    if (!courtSides(w, s).left && !courtSides(w, s).right) break;
  }
  const [x0, , x1] = w.bodyBox('house');
  const d = x1 - x0 + 0.01; // well under a step apart
  assert.ok(d < 0.75);
  assert.ok(w.placeStructureAt('house', 6 + d, 9, 0, { seed: 3 }));
  assert.equal(w.fitsOutline('house', 6 - d + 0.05, 9, 0).reason, 'Occupied');
  assert.equal(w.fitsOutline('house', 6, 9.4, Math.PI / 5).reason, 'Occupied');
});

test('joined houses still meet wall to wall, with no way between', () => {
  // two village houses side by side that share a wall (a seeded roll)
  let w, a, b;
  for (let seed = 1; seed < 200; seed++) {
    w = flatWorld();
    road(w, [2, 5], [14, 5]);
    const p = w.freePlacement('house', 6, 5.8, { seed });
    a = w.placeStructureAt('house', p.x, p.y, p.angle, { seed });
    const q = w.freePlacement('house', a.x + 1.1, a.y, { seed: seed + 1 });
    b = w.placeStructureAt('house', q.x, q.y, q.angle, { seed: seed + 1 });
    if (b && joinSides(w, a).right) break;
  }
  assert.ok(joinSides(w, a).right && joinSides(w, b).left, 'a joined pair');
  assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 1) < 1e-9); // flush, a step apart
  // their bodies reach the shared wall: nothing fits between, no path through
  const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
  assert.ok(w.structureIndex.at(mid[0] - 0.01, mid[1]).includes(a.id));
  assert.ok(w.structureIndex.at(mid[0] + 0.01, mid[1]).includes(b.id));
  path(w, [mid[0], a.y - 2], [mid[0], a.y + 2]);
  const layer = w.networks.path;
  assert.ok(![...layer.graph.edges()].some(([p, q]) => {
    const [pa, pb] = [layer.pos(p), layer.pos(q)];
    return Math.abs(pa[0] - mid[0]) < 0.3 && Math.min(pa[1], pb[1]) < a.y && Math.max(pa[1], pb[1]) > a.y;
  }), 'no path between them');
  // taken away, the other's body shrinks back to its walls
  w.removeStructure(b.id);
  assert.ok(!w.structureIndex.at(mid[0] - 0.01, mid[1]).includes(a.id));
});

test('an own court gives way to a neighbour standing close', () => {
  // a house whose own court is on its right, with nobody about
  let w, s, seed;
  for (seed = 1; seed < 400; seed++) {
    w = flatWorld();
    s = w.placeStructureAt('house', 6, 9, 0, { seed });
    if (courtSides(w, s).right === 'own') break;
  }
  assert.equal(courtSides(w, s).right, 'own');
  // its court is in its body: a house can't stand in it…
  assert.equal(w.fitsOutline('house', 6.75, 9, 0).reason, 'Occupied');
  // …but one built close before it leaves it no room there (a shop: no
  // court of its own)
  const v = flatWorld();
  const n = v.placeStructureAt('store', 6 + v.bodyBox('house')[2] - v.bodyBox('store')[0] + 0.01, 9, 0);
  assert.ok(n);
  const t = v.placeStructureAt('house', 6, 9, 0, { seed });
  assert.ok(t);
  assert.notEqual(courtSides(v, t).right, 'own');
});
