// Getting about on the ways (sim/wayGraph.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ways } from '../src/roads/ways.js';
import { WayGraph } from '../src/sim/wayGraph.js';

function road(w, pts, props = { kind: 'road' }) {
  const a = w.nodeNear(...pts[0], 0.01) ?? w.addNode(...pts[0]);
  const b = w.nodeNear(...pts[pts.length - 1], 0.01) ?? w.addNode(...pts[pts.length - 1]);
  return w.addEdge(a.id, b.id, pts, props);
}

// a square of roads 0..4, and a lane cutting across it
function town() {
  const w = new Ways();
  road(w, [[0, 0], [2, 0], [4, 0]]);
  road(w, [[4, 0], [4, 4]]);
  road(w, [[4, 4], [0, 4]]);
  road(w, [[0, 4], [0, 0]]);
  road(w, [[0, 0], [4, 4]], { kind: 'road', lane: true });
  road(w, [[4, 4], [6, 6]], { kind: 'path' });
  return w;
}

test('routes follow the ways, from one attached place to another', () => {
  const w = town();
  const g = new WayGraph(w, { pass: (e) => e.kind === 'road', factor: (e) => (e.lane ? 2 : 1) });
  const from = g.attach(1, -0.2, 0.5), to = g.attach(4.2, 3, 0.5);
  assert.ok(from && to);
  assert.deepEqual(from.point, [1, 0]);
  const r = g.route(from, to);
  // along the bottom and up the right side: 3 + 3
  assert.ok(Math.abs(r.cost - 6) < 1e-9, r.cost);
  assert.deepEqual(r.pts[0], [1, 0]);
  assert.deepEqual(r.pts[r.pts.length - 1], [4, 3]);
  assert.ok(r.pts.some(([x, y]) => x === 4 && y === 0)); // round the corner
  assert.equal(r.ways.length, 2);
});

test('a slow lane is taken only when it saves enough', () => {
  const w = town();
  const cheap = new WayGraph(w, { pass: (e) => e.kind === 'road', factor: (e) => (e.lane ? 1.1 : 1) });
  const dear = new WayGraph(w, { pass: (e) => e.kind === 'road', factor: (e) => (e.lane ? 2 : 1) });
  const [a, b] = [[...w.nodes.values()].find((n) => n.x === 0 && n.y === 0).id, [...w.nodes.values()].find((n) => n.x === 4 && n.y === 4).id];
  assert.ok(Math.abs(cheap.route(a, b).cost - Math.SQRT2 * 4 * 1.1) < 1e-9);
  assert.equal(dear.route(a, b).cost, 8);
});

test('two places on one piece go straight along it, either way', () => {
  const w = town();
  const g = new WayGraph(w, { pass: (e) => e.kind === 'road' && !e.lane });
  const r = g.route(g.attach(3, 0.1), g.attach(1, 0.1));
  assert.ok(Math.abs(r.cost - 2) < 1e-9);
  assert.deepEqual(r.pts, [[3, 0], [2, 0], [1, 0]]);
});

test('cuts split a piece where something is linked in', () => {
  const w = town();
  const g = new WayGraph(w, { pass: (e) => e.kind === 'road' && !e.lane, cuts: [{ key: 'x', x: 2, y: 4.3 }] });
  const tap = g.tapOf('x');
  assert.ok(tap);
  assert.deepEqual(g.nodes.get(tap), [2, 4]);
  g.link('hub', tap, 1, [[2, 6], [2, 4]]);
  const r = g.route('hub', g.attach(0, 3));
  assert.ok(Math.abs(r.cost - 4) < 1e-9, r.cost); // 1 in, 2 along, 1 down
});

test('no route between pieces that never meet, and none past maxCost', () => {
  const w = town();
  road(w, [[10, 10], [12, 10]]);
  const g = new WayGraph(w, { pass: (e) => e.kind === 'road' });
  assert.equal(g.route(g.attach(1, 0), g.attach(11, 10)), null);
  assert.equal(g.route(g.attach(1, 0), g.attach(4, 3), { maxCost: 2 }), null);
});
