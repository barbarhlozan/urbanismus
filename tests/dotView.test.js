// The ways seen as dots (roads/dotView.js), for the dot readers in between.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ways } from '../src/roads/ways.js';
import { curveThrough } from '../src/roads/curves.js';
import { traceLine, traceWays } from '../src/roads/dotView.js';
import { Grid } from '../src/core/grid.js';
import { edgeKey } from '../src/roads/network.js';

const grid = new Grid(20, 20);
const at = (x, y) => grid.index(x, y);

test('a straight way passes its dots, each next to the last', () => {
  const dots = traceLine([[1, 2], [6, 2]], grid).map((d) => d.n);
  assert.deepEqual(dots, [1, 2, 3, 4, 5, 6].map((x) => at(x, 2)));
});

test('a slant runs as diagonals, not a staircase', () => {
  const dots = traceLine([[1, 1], [5, 5]], grid).map((d) => d.n);
  assert.deepEqual(dots, [1, 2, 3, 4, 5].map((k) => at(k, k)));
});

test('every step of a curve is between neighbouring dots', () => {
  const pts = curveThrough([[2, 2], [8, 3], [10, 9], [4, 12]]);
  const dots = traceLine(pts, grid).map((d) => grid.xy(d.n));
  for (let i = 1; i < dots.length; i++) {
    const [ax, ay] = dots[i - 1], [bx, by] = dots[i];
    assert.ok(Math.max(Math.abs(ax - bx), Math.abs(ay - by)) === 1, `step ${i}`);
  }
});

test('dots sit back on the curve, within half a dot', () => {
  const w = new Ways();
  w.insert(curveThrough([[2, 2.3], [8, 3.1], [12, 6]]), { kind: 'road' });
  const { pos } = traceWays(w, 'road', grid);
  for (const [n, [x, y]] of pos) {
    const [gx, gy] = grid.xy(n);
    assert.ok(Math.hypot(gx - x, gy - y) <= Math.SQRT1_2 + 1e-9);
  }
});

test('attributes become the street, lane and kerb sets', () => {
  const w = new Ways();
  w.insert([[1, 1], [4, 1]], { kind: 'road', street: 3 });
  w.insert([[1, 5], [4, 5]], { kind: 'lane', lane: true, walks: 1 });
  w.insert([[4, 8], [1, 8]], { kind: 'lane', lane: true, walks: 1 });
  w.insert([[1, 12], [4, 12]], { kind: 'path' });
  const v = traceWays(w, ['road', 'lane'], grid);
  assert.ok(v.sidewalks.has(edgeKey(at(1, 1), at(2, 1))));
  assert.ok(v.lanes.has(edgeKey(at(2, 5), at(3, 5))));
  assert.equal(v.sidewalks.has(edgeKey(at(2, 5), at(3, 5))), false);
  // the same side of a lane drawn either way round, seen from lower to higher dot
  assert.equal(v.laneWalks.get(edgeKey(at(2, 5), at(3, 5))), 1);
  assert.equal(v.laneWalks.get(edgeKey(at(2, 8), at(3, 8))), 2);
  assert.equal(v.graph.hasNode(at(2, 12)), false); // a footpath isn't a road
});

test('two ways meeting share their junction dot', () => {
  const w = new Ways();
  w.insert([[1, 5], [9, 5]], { kind: 'road' });
  w.insert([[5, 1], [5, 9]], { kind: 'road' });
  const { graph } = traceWays(w, 'road', grid);
  assert.equal(graph.degree(at(5, 5)), 4);
});
