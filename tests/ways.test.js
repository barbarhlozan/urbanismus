// The ways network off the dots (roads/ways.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ways } from '../src/roads/ways.js';
import { curveThrough } from '../src/roads/curves.js';

function line(w, a, b, props) {
  const na = w.nodes.get(a), nb = w.nodes.get(b);
  return w.addEdge(a, b, curveThrough([[na.x, na.y], [nb.x, nb.y]]), props);
}

test('edges join nodes, and keep their attributes', () => {
  const w = new Ways();
  const a = w.addNode(0, 0), b = w.addNode(4, 0);
  const e = line(w, a.id, b.id, { kind: 'road', street: 3 });
  assert.equal(e.kind, 'road');
  assert.equal(e.street, 3);
  assert.equal(w.edgesAt(a.id).length, 1);
  assert.ok(Math.abs(w.length(e) - 4) < 1e-9);
});

test('splitting an edge makes a junction, and both halves keep its attributes', () => {
  const w = new Ways();
  const a = w.addNode(0, 0), b = w.addNode(4, 0);
  const e = line(w, a.id, b.id, { kind: 'road', lane: true });
  const { node, edges } = w.split(e.id, 1.5);
  assert.deepEqual([node.x, node.y], [1.5, 0]);
  assert.equal(w.edges.has(e.id), false);
  assert.equal(edges.length, 2);
  assert.ok(edges.every((x) => x.lane === true && x.kind === 'road'));
  assert.ok(Math.abs(w.length(edges[0]) - 1.5) < 1e-9 && Math.abs(w.length(edges[1]) - 2.5) < 1e-9);
  assert.equal(w.edgesAt(node.id).length, 2);
  // at an end: nothing split
  assert.equal(w.split(edges[0].id, 0).node.id, a.id);
});

test('removing an edge takes its loose ends away, not a junction', () => {
  const w = new Ways();
  const a = w.addNode(0, 0), b = w.addNode(4, 0), c = w.addNode(4, 4);
  const e1 = line(w, a.id, b.id), e2 = line(w, b.id, c.id);
  w.removeEdge(e1.id);
  assert.equal(w.nodes.has(a.id), false);
  assert.equal(w.nodes.has(b.id), true);
  w.removeEdge(e2.id);
  assert.equal(w.nodes.size, 0);
});

test('near: the nearest node, and the nearest point on an edge', () => {
  const w = new Ways();
  const a = w.addNode(0, 0), b = w.addNode(4, 0);
  line(w, a.id, b.id);
  assert.equal(w.nodeNear(0.2, 0.1, 0.5).id, a.id);
  assert.equal(w.nodeNear(2, 0, 0.5), null);
  const hit = w.edgeNear(2.5, 0.3, 0.5);
  assert.ok(Math.abs(hit.s - 2.5) < 1e-9 && Math.abs(hit.dist - 0.3) < 1e-9);
  assert.equal(w.edgeNear(2.5, 2, 0.5), null);
});

test('routes take the cheaper way round, by length or by cost', () => {
  const w = new Ways();
  const [a, b, c, d] = [[0, 0], [4, 0], [2, 1], [2, -3]].map(([x, y]) => w.addNode(x, y).id);
  line(w, a, c); line(w, c, b); // short way
  const l1 = line(w, a, d), l2 = line(w, d, b); // long way
  const r = w.route(a, b);
  assert.deepEqual(r.nodes, [a, c, b]);
  const slowShort = w.route(a, b, { cost: (e) => (e === l1 || e === l2 ? w.length(e) : 100) });
  assert.deepEqual(slowShort.nodes, [a, d, b]);
  assert.equal(w.route(a, b, { pass: () => false }), null);
});

test('saved and loaded whole', () => {
  const w = new Ways();
  const a = w.addNode(0, 0), b = w.addNode(3, 1);
  const e = line(w, a.id, b.id, { kind: 'path' });
  w.measured(e); // (a cache that isn't saved)
  const back = Ways.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(back.edges.get(e.id).kind, 'path');
  assert.deepEqual(back.edges.get(e.id).pts, e.pts);
  assert.equal(back.edgesAt(a.id).length, 1);
  assert.equal(back.addNode(1, 1).id, w.nextId);
});

test('insert: a road across another makes a junction; ends snap to nodes and ways', async () => {
  const w = new Ways();
  const a = w.insert(curveThrough([[0, 0], [10, 0]]), { kind: 'road' });
  assert.ok(a.ok);
  const b = w.insert(curveThrough([[4, -3], [4, 3]]), { kind: 'road' });
  assert.ok(b.ok);
  const mid = b.nodes[1];
  assert.ok(Math.abs(mid.x - 4) < 1e-9 && Math.abs(mid.y) < 1e-9);
  assert.equal(w.edgesAt(mid.id).length, 4);
  // an end near a node joins it; near a way, splits it
  const c = w.insert(curveThrough([[10.2, 0.1], [10, 5]]), { kind: 'road' });
  assert.equal(c.nodes[0].x, 10);
  const d = w.insert(curveThrough([[7, 0.2], [7, 4]]), { kind: 'road' });
  assert.ok(d.ok);
  assert.ok(Math.abs(d.nodes[0].y) < 1e-9 && w.edgesAt(d.nodes[0].id).length === 3);
});

test('insert: level crossings join, fences leave a gap, railways refuse each other', () => {
  const w = new Ways();
  w.insert(curveThrough([[0, 0], [10, 0]]), { kind: 'rail' });
  const road = w.insert(curveThrough([[5, -3], [5, 3]]), { kind: 'road' });
  assert.ok(road.ok);
  const kinds = w.edgesAt(road.nodes[1].id).map((e) => e.kind).sort();
  assert.deepEqual(kinds, ['rail', 'rail', 'road', 'road']); // the level crossing
  const fence = w.insert(curveThrough([[2, -3], [2, 3]]), { kind: 'fence' });
  assert.ok(fence.ok);
  assert.equal(fence.edges.length, 1); // across the railway, not joining it
  const before = w.edges.size;
  const rail = w.insert(curveThrough([[8, -3], [8, 3]]), { kind: 'rail' });
  assert.equal(rail.ok, false);
  assert.equal(rail.reason, 'Crosses another line');
  assert.equal(w.edges.size, before); // nothing changed
});

test('insert: too shallow a crossing is refused, and changes nothing', () => {
  const w = new Ways();
  w.insert(curveThrough([[0, 0], [10, 0]]), { kind: 'road' });
  const before = JSON.stringify(w.toJSON());
  const r = w.insert(curveThrough([[0, -1], [10, 1]]), { kind: 'road' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'Too shallow a crossing');
  assert.equal(JSON.stringify(w.toJSON()), before);
});

test('insert: two crossings on the same way both split it', () => {
  const w = new Ways();
  w.insert(curveThrough([[0, 0], [10, 0]]), { kind: 'road' });
  const u = w.insert(curveThrough([[2, -2], [2, 2], [8, 2], [8, -2]], 0.1), { kind: 'road' });
  assert.ok(u.ok, u.reason);
  assert.equal(u.nodes.length, 4);
  // the first road is now three pieces
  const pieces = [...w.edges.values()].filter((e) => e.pts.every(([, y]) => Math.abs(y) < 1e-9));
  assert.equal(pieces.length, 3);
  assert.ok(Math.abs(pieces.reduce((s, e) => s + w.length(e), 0) - 10) < 1e-6);
});
