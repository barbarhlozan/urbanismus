// Ways drawn from their own curves, junctions as one shape
// (roads/wayOutline.js) – the cases that drew spikes and tangles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ways } from '../src/roads/ways.js';
import { easeBends } from '../src/roads/curves.js';
import { wayOutlines, offsetLine } from '../src/roads/wayOutline.js';

const W = 0.11;

function town(lines, props = { kind: 'road' }) {
  const ways = new Ways();
  for (const pts of lines) {
    const r = ways.insert(easeBends(pts, 1), props);
    assert.ok(r.ok, `laid ${JSON.stringify(pts)}: ${r.reason}`);
  }
  return ways;
}

// The distance from p to the nearest centre line.
function inside(ways, p) {
  let best = Infinity;
  for (const e of ways.edges.values()) {
    for (let i = 1; i < e.pts.length; i++) {
      const [a, b] = [e.pts[i - 1], e.pts[i]];
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t));
    }
  }
  return best;
}

// No outline point lies inside a roadway (a spike or a tangle would).
function clean(ways, w = W) {
  const pieces = wayOutlines(ways, { width: () => w });
  for (const { key, line } of pieces) {
    for (const p of line) assert.ok(inside(ways, p) > w * 0.85, `${key} at ${p.map((v) => v.toFixed(3))} is inside a road`);
  }
  return pieces;
}

test('a straight road: two sides and two rounded ends', () => {
  const pieces = clean(town([[[0, 0], [4, 0]]]));
  assert.equal(pieces.filter((p) => p.kind === 'edge').length, 2);
  assert.equal(pieces.filter((p) => p.kind === 'end').length, 2);
});

test('a crossroads: four corners, each side cut short of the others', () => {
  const pieces = clean(town([[[0, 2], [4, 2]], [[2, 0], [2, 4]]]));
  assert.equal(pieces.filter((p) => p.kind === 'corner').length, 4);
});

test('a T: the straight side runs on, two rounded corners', () => {
  const pieces = clean(town([[[0, 2], [4, 2]], [[2, 2], [2, 4]]]));
  assert.equal(pieces.filter((p) => p.kind === 'corner').length, 3);
});

test('a narrow Y has no notch between its arms', () => {
  clean(town([[[0, 0], [5, 0]], [[1, 0], [5, 2.6]]]));
});

test('a road crossing close by a T leaves a clean short arm', () => {
  clean(town([[[0, 0], [8, 0]], [[2, 0], [2, 3]], [[0, 1.2], [3, 0.9], [7, 1.2]]]));
});

test('a road through a tight bend: the inner side doesn\'t loop', () => {
  const line = offsetLine([[0, 0], [1, 0], [1.05, 0.02], [1.06, 0.06], [1.05, 0.1], [1, 0.12], [0, 0.12]], 0.11);
  for (let i = 1; i < line.length; i++) for (let j = i + 2; j < line.length; j++) {
    const [a, b, c, d] = [line[i - 1], line[i], line[j - 1], line[j]];
    const cr = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    assert.ok(!(cr(a, b, c) * cr(a, b, d) < 0 && cr(c, d, a) * cr(c, d, b) < 0), 'crosses itself');
  }
});

test('lanes keep their own width where they meet a road', () => {
  const ways = town([[[0, 0], [4, 0]]]);
  ways.insert(easeBends([[2, 0], [2, 3]], 1), { kind: 'road', lane: true });
  const pieces = wayOutlines(ways, { width: (e) => (e.lane ? 0.05 : W) });
  const lane = pieces.filter((p) => p.kind === 'edge' && p.line.some(([, y]) => y > 0.5));
  assert.equal(lane.length, 2);
  for (const { line } of lane) assert.ok(Math.abs(Math.abs(line.at(-1)[0] - 2) - 0.05) < 1e-6);
});

test('an end near a junction moves it there instead of leaving a stub', () => {
  const ways = town([[[0, 0], [6, 0]], [[3, 0], [3, 3]]]);
  const r = ways.insert(easeBends([[3.4, -3], [3.4, -0.25]], 1), { kind: 'road' }, { refit: 0.7 });
  assert.ok(r.ok, r.reason);
  // no new node by the junction: the stroke took it, the ways at it followed
  const near = [...ways.nodes.values()].filter((n) => Math.hypot(n.x - 3.2, n.y + 0.1) < 0.8);
  assert.equal(near.length, 1);
  assert.deepEqual([near[0].x, near[0].y].map((v) => +v.toFixed(6)), [3.4, -0.25]);
  for (const e of ways.edgesAt(near[0].id)) {
    const end = e.a === near[0].id ? e.pts[0] : e.pts.at(-1);
    assert.deepEqual(end, [3.4, -0.25]);
  }
  clean(ways);
});

test('an end meeting a way just by its end takes that end', () => {
  const ways = town([[[0, 0], [4, 0]]]);
  const r = ways.insert(easeBends([[4.3, 3], [3.7, 0.1]], 1), { kind: 'road' }, { refit: 0.7 });
  assert.ok(r.ok, r.reason);
  assert.equal(ways.nodes.size, 3);
});
