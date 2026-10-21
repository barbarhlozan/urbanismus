import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenPath, triangulate, polygonArea } from '../src/render/gl/geometry.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const samePoint = (p, q, eps = 1e-9) => close(p[0], q[0], eps) && close(p[1], q[1], eps);
const pointsOf = (d, tol) => flattenPath(d, tol).map((s) => s.pts);
const only = (d, tol) => {
  const subs = flattenPath(d, tol);
  assert.equal(subs.length, 1, `one subpath in "${d}"`);
  return subs[0];
};

// a small deterministic random source
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToPolyline(p, pts, closed = false) {
  let best = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    best = Math.min(best, distToSegment(p[0], p[1], a[0], a[1], b[0], b[1]));
  }
  return best;
}

// the farthest any of the true curve's points (sampled by t in [0, 1]) is from the polyline
const deviation = (curve, pts, samples = 800) => {
  let worst = 0;
  for (let i = 0; i <= samples; i++) worst = Math.max(worst, distToPolyline(curve(i / samples), pts));
  return worst;
};

// the area of a mesh: the sum of its triangles' areas, unsigned
function meshArea(m) {
  let sum = 0;
  const p = m.positions, ix = m.indices;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 2, b = ix[t + 1] * 2, c = ix[t + 2] * 2;
    sum += Math.abs((p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[c] - p[a]) * (p[b + 1] - p[a + 1])) / 2;
  }
  return sum;
}

// the same with the signs kept
function meshSignedAreas(m) {
  const out = [];
  const p = m.positions, ix = m.indices;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 2, b = ix[t + 1] * 2, c = ix[t + 2] * 2;
    out.push(((p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[c] - p[a]) * (p[b + 1] - p[a + 1])) / 2);
  }
  return out;
}

const validMesh = (m) => {
  assert.ok(m.positions instanceof Float32Array);
  assert.ok(m.indices instanceof Uint32Array);
  assert.equal(m.positions.length % 2, 0);
  assert.equal(m.indices.length % 3, 0);
  for (const i of m.indices) assert.ok(i < m.positions.length / 2, `index ${i} in range`);
};

const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const ring = (pts, closed = true) => ({ pts, closed });
const reversed = (pts) => [...pts].reverse();

// a polygon of n points around (cx, cy), at random radii, in order of angle: simple, star-shaped
function star(rand, n, cx = 0, cy = 0, r0 = 5, r1 = 10) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.1 + 0.8 * rand()) / n) * Math.PI * 2, r = r0 + (r1 - r0) * rand();
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

// ------------------------------------------------------------- flattenPath

test('M and L, absolute and relative', () => {
  assert.deepEqual(pointsOf('M10 20 L30 40 L50 20'), [[[10, 20], [30, 40], [50, 20]]]);
  assert.deepEqual(pointsOf('m10 20 l20 20 l20 -20'), [[[10, 20], [30, 40], [50, 20]]]);
  assert.deepEqual(pointsOf('M10 20 l20 20 L50 20'), [[[10, 20], [30, 40], [50, 20]]]);
  assert.equal(only('M10 20 L30 40').closed, false);
});

test('H and V, absolute and relative', () => {
  assert.deepEqual(pointsOf('M10 10 H30 V40 H5 V0'), [[[10, 10], [30, 10], [30, 40], [5, 40], [5, 0]]]);
  assert.deepEqual(pointsOf('M10 10 h20 v30 h-25 v-40'), [[[10, 10], [30, 10], [30, 40], [5, 40], [5, 0]]]);
});

test('several movetos make several subpaths, and a lone moveto draws nothing', () => {
  const subs = flattenPath('M0 0 L10 0 M20 20 L30 20 M99 99 M5 5 l1 1');
  assert.equal(subs.length, 3);
  assert.deepEqual(subs[1].pts, [[20, 20], [30, 20]]);
  assert.deepEqual(subs[2].pts, [[5, 5], [6, 6]]);
  assert.deepEqual(flattenPath('M5 5'), []);
});

test('a relative moveto after a closepath is from where the subpath began', () => {
  const subs = flattenPath('M10 10 h10 v10 z m5 5 l5 0');
  assert.deepEqual(subs[1].pts, [[15, 15], [20, 15]]);
});

test('C and c end where they should, and pass through the curve', () => {
  const abs = only('M0 0 C10 0 20 10 30 10');
  const rel = only('M0 0 c10 0 20 10 30 10');
  assert.deepEqual(abs.pts, rel.pts);
  assert.deepEqual(abs.pts[0], [0, 0]);
  assert.deepEqual(abs.pts[abs.pts.length - 1], [30, 10]);
  // B(½) = (P0 + 3·P1 + 3·P2 + P3) / 8
  const mid = [(0 + 30 + 60 + 30) / 8, (0 + 0 + 30 + 10) / 8];
  assert.ok(distToPolyline(mid, abs.pts) < 0.25);
  const rel2 = only('M5 5 c10 0 20 10 30 10');
  assert.ok(samePoint(rel2.pts[rel2.pts.length - 1], [35, 15]));
});

test('S reflects the control point of a cubic before it, or uses the current point', () => {
  const s = only('M0 0 C10 0 20 10 30 10 S50 20 60 10');
  const c = only('M0 0 C10 0 20 10 30 10 C40 10 50 20 60 10');
  assert.equal(s.pts.length, c.pts.length);
  s.pts.forEach((p, i) => assert.ok(samePoint(p, c.pts[i]), `point ${i}`));
  const rel = only('M0 0 C10 0 20 10 30 10 s20 10 30 0');
  assert.ok(samePoint(rel.pts[rel.pts.length - 1], [60, 10]));
  // after a line the first control point is the current point
  const fresh = only('M0 0 L30 10 S50 20 60 10');
  const expl = only('M0 0 L30 10 C30 10 50 20 60 10');
  assert.equal(fresh.pts.length, expl.pts.length);
  fresh.pts.forEach((p, i) => assert.ok(samePoint(p, expl.pts[i]), `point ${i}`));
});

test('Q and q', () => {
  const q = only('M0 0 Q20 40 40 0');
  assert.ok(samePoint(q.pts[q.pts.length - 1], [40, 0]));
  assert.ok(distToPolyline([20, 20], q.pts) < 0.25); // B(½) = (P0 + 2·P1 + P2) / 4
  assert.deepEqual(only('m5 5 q20 40 40 0').pts.map((p) => p.map((v) => Math.round(v * 1e6) / 1e6)),
    only('M5 5 Q25 45 45 5').pts.map((p) => p.map((v) => Math.round(v * 1e6) / 1e6)));
});

test('T reflects the control point of a quadratic before it, or uses the current point', () => {
  const t = only('M0 0 Q10 20 20 0 T40 0 t20 0');
  const q = only('M0 0 Q10 20 20 0 Q30 -20 40 0 Q50 20 60 0');
  assert.equal(t.pts.length, q.pts.length);
  t.pts.forEach((p, i) => assert.ok(samePoint(p, q.pts[i]), `point ${i}`));
  // after anything else its control point is the current point: a straight line, pieces and all
  const line = only('M0 0 L10 0 T20 10').pts;
  assert.deepEqual(line[1], [10, 0]);
  assert.deepEqual(line[line.length - 1], [20, 10]);
  for (const p of line.slice(1)) assert.ok(close(p[1], p[0] - 10, 1e-9), 'on the line from (10, 0) to (20, 10)');
  // a cubic's control point is not reflected by T
  const afterCubic = only('M0 0 C0 10 10 10 10 0 T20 0').pts;
  assert.ok(afterCubic.slice(-6).every((p) => close(p[1], 0, 1e-9) || p[0] <= 10), 'flat, not swung round the cubic\'s control point');
});

test('Z closes the subpath without repeating its first point', () => {
  const sq = only('M0 0 L10 0 L10 10 L0 10 Z');
  assert.equal(sq.closed, true);
  assert.deepEqual(sq.pts, [[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.deepEqual(only('M0 0 L10 0 L10 10 L0 10 L0 0 z').pts, sq.pts);
  assert.deepEqual(only('m0 0 l10 0 0 10 -10 0 -0 -10 z').pts, [[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.deepEqual(flattenPath('M5 5 Z'), [{ pts: [[5, 5]], closed: true }]);
});

test('after Z the current point is the start, and drawing on starts a new subpath there', () => {
  const subs = flattenPath('M10 10 L20 10 L20 20 Z L30 30 l5 0');
  assert.equal(subs.length, 2);
  assert.equal(subs[0].closed, true);
  assert.deepEqual(subs[1].pts, [[10, 10], [30, 30], [35, 30]]);
  assert.equal(subs[1].closed, false);
  assert.equal(flattenPath('M0 0 L5 0 L5 5 Z Z z').length, 1);
});

test('numbers after a command repeat it; after a moveto they are linetos', () => {
  assert.deepEqual(pointsOf('M0 0 10 0 10 10'), [[[0, 0], [10, 0], [10, 10]]]);
  assert.deepEqual(pointsOf('m1 1 10 0 0 10'), [[[1, 1], [11, 1], [11, 11]]]);
  assert.deepEqual(pointsOf('M0 0 L1 1 2 2 3 3'), [[[0, 0], [1, 1], [2, 2], [3, 3]]]);
  assert.deepEqual(pointsOf('M0 0 h1 2 3 v1 2'), [[[0, 0], [1, 0], [3, 0], [6, 0], [6, 1], [6, 3]]]);
  const two = only('M0 0 C1 0 2 1 3 1 4 1 5 0 6 0', 100);
  assert.deepEqual(two.pts, [[0, 0], [3, 1], [6, 0]]);
  const rel = only('M0 0 c1 0 2 1 3 1 1 0 2 -1 3 -1', 100);
  assert.deepEqual(rel.pts, [[0, 0], [3, 1], [6, 0]]);
});

test('numbers in all their forms, with any separators or none', () => {
  assert.deepEqual(pointsOf('M-.5-.5L.5.5'), [[[-0.5, -0.5], [0.5, 0.5]]]);
  assert.deepEqual(pointsOf('M.5.5.5.5'), [[[0.5, 0.5], [0.5, 0.5]]]);
  assert.deepEqual(pointsOf('M1e-3 2E+1 L1.5e1,-2.5E-1'), [[[0.001, 20], [15, -0.25]]]);
  assert.deepEqual(pointsOf('M 1,2 L 3,4'), [[[1, 2], [3, 4]]]);
  assert.deepEqual(pointsOf('M1 2,3 4'), [[[1, 2], [3, 4]]]);
  assert.deepEqual(pointsOf('M10-20L+5+6'), [[[10, -20], [5, 6]]]);
  assert.deepEqual(pointsOf('M1.,2.L3 4'), [[[1, 2], [3, 4]]]);
  assert.deepEqual(pointsOf('\n M\t1 \r\n 2\n L 3\t4 \n'), [[[1, 2], [3, 4]]]);
  assert.deepEqual(pointsOf('M0 0L10 0 20 0'), [[[0, 0], [10, 0], [20, 0]]]);
  assert.deepEqual(pointsOf('M1 1L2e0 3'), [[[1, 1], [2, 3]]]);
});

test('arc flags can be written without separators', () => {
  const spaced = only('M0 0 a5 5 0 0 1 1 1');
  const packed = only('M0 0a5 5 0 011 1');
  assert.deepEqual(packed.pts, spaced.pts);
  assert.deepEqual(packed.pts[packed.pts.length - 1], [1, 1]);
  const a = only('M0 0 a5 5 0 1010 0');
  assert.deepEqual(a.pts[a.pts.length - 1], [10, 0]);
  const b = only('M0 0a5,5,0,1,0,10,0');
  assert.deepEqual(b.pts, a.pts);
  const c = only('M0 0A5 5 0 0 1 10 0 5 5 0 0 1 20 0');
  assert.deepEqual(c.pts[c.pts.length - 1], [20, 0]);
});

test('an arc stays within the tolerance of the true circle', () => {
  const r = 50, cx = 100, cy = 100;
  for (const tol of [0.01, 0.25, 2]) {
    // from angle 0 to a quarter, a half, and three quarters of a turn
    const quarter = only(`M${cx + r} ${cy} A${r} ${r} 0 0 1 ${cx} ${cy + r}`, tol);
    const three = only(`M${cx + r} ${cy} A${r} ${r} 0 1 1 ${cx} ${cy - r}`, tol);
    const check = (sub, turns) => {
      for (const p of sub.pts) assert.ok(close(Math.hypot(p[0] - cx, p[1] - cy), r, 1e-9), 'vertices lie on the circle');
      const curve = (t) => [cx + r * Math.cos(turns * t * Math.PI * 2), cy + r * Math.sin(turns * t * Math.PI * 2)];
      assert.ok(deviation(curve, sub.pts) <= tol + 1e-9, `tolerance ${tol}`);
    };
    check(quarter, 0.25);
    check(three, 0.75);
    assert.ok(only(`M${cx + r} ${cy} A${r} ${r} 0 0 1 ${cx} ${cy + r}`, 0.01).pts.length > quarter.pts.length || tol === 0.01);
  }
});

test('an arc goes the way its sweep flag says', () => {
  // from (10, 0) to (0, 10) round the origin: sweep 1 is the short way, through (7.07, 7.07)
  const short = only('M10 0 A10 10 0 0 1 0 10', 0.01);
  assert.ok(short.pts.every((p) => p[0] >= -1e-9 && p[1] >= -1e-9));
  // sweep 1 with the large arc: round the other centre, (10, 10), three quarters of a turn
  const long = only('M10 0 A10 10 0 1 1 0 10', 0.01);
  assert.ok(long.pts.every((p) => close(Math.hypot(p[0] - 10, p[1] - 10), 10, 1e-9)));
  assert.ok(long.pts.some((p) => p[0] > 19.9) && long.pts.some((p) => p[1] > 19.9));
  // sweep 0 goes the other way round the other centre
  const back = only('M10 0 A10 10 0 0 0 0 10', 0.01);
  assert.ok(back.pts.every((p) => Math.hypot(p[0] - 10, p[1] - 10) < 10 + 1e-9));
  assert.ok(back.pts.some((p) => p[0] > 2 && p[1] > 2));
});

test('a circle of two arcs has the area of a circle', () => {
  const r = 50;
  const circle = only(`M${100 + r} 100 A${r} ${r} 0 1 1 ${100 - r} 100 A${r} ${r} 0 1 1 ${100 + r} 100 Z`, 0.01);
  assert.equal(circle.closed, true);
  const area = Math.abs(polygonArea(circle.pts));
  assert.ok(Math.abs(area - Math.PI * r * r) / (Math.PI * r * r) < 0.001, `area ${area}`);
  // a polygon inscribed in a circle is smaller
  assert.ok(area < Math.PI * r * r);
  // and its first point isn't repeated at the end
  assert.ok(!samePoint(circle.pts[0], circle.pts[circle.pts.length - 1]));
});

test('a rotated ellipse arc stays within the tolerance', () => {
  const rx = 40, ry = 15, rot = 30, phi = (rot * Math.PI) / 180;
  const at = (t) => [rx * Math.cos(t) * Math.cos(phi) - ry * Math.sin(t) * Math.sin(phi), rx * Math.cos(t) * Math.sin(phi) + ry * Math.sin(t) * Math.cos(phi)];
  const [x0, y0] = at(0), [x1, y1] = at(Math.PI);
  for (const tol of [0.05, 0.25]) {
    const sub = only(`M${x0} ${y0} A${rx} ${ry} ${rot} 1 1 ${x1} ${y1}`, tol);
    assert.ok(deviation((t) => at(t * Math.PI), sub.pts) <= tol + 1e-9);
    assert.ok(sub.pts.length > 6);
    // a half turn the other way round
    const other = only(`M${x0} ${y0} A${rx} ${ry} ${rot} 0 0 ${x1} ${y1}`, tol);
    assert.ok(deviation((t) => at(-t * Math.PI), other.pts) <= tol + 1e-9);
  }
  // the same rotation written as 390 degrees
  const a = only(`M${x0} ${y0} A${rx} ${ry} ${rot} 1 1 ${x1} ${y1}`);
  const b = only(`M${x0} ${y0} A${rx} ${ry} ${rot + 360} 1 1 ${x1} ${y1}`);
  assert.equal(a.pts.length, b.pts.length);
  a.pts.forEach((p, i) => assert.ok(samePoint(p, b.pts[i], 1e-6)));
});

test('radii too small for an arc are scaled up; zero radii make a line; equal ends make none', () => {
  const s = only('M0 0 A1 1 0 0 1 100 0', 0.01);
  for (const p of s.pts) assert.ok(close(Math.hypot(p[0] - 50, p[1]), 50, 1e-6), 'a half circle of radius 50');
  assert.ok(s.pts.some((p) => p[1] < -49.9), 'over the top, the way sweep 1 goes');
  // an ellipse keeps its proportions when scaled: 1 : 5 becomes 50 : 250
  const e = only('M0 0 A1 5 0 0 1 100 0', 0.01);
  assert.ok(e.pts.some((p) => p[1] < -249.9));
  assert.deepEqual(only('M0 0 A0 5 0 0 1 10 10').pts, [[0, 0], [10, 10]]);
  assert.deepEqual(only('M0 0 A5 0 0 0 1 10 10').pts, [[0, 0], [10, 10]]);
  assert.deepEqual(only('M0 0 L5 5 A5 5 0 0 1 5 5 L9 9').pts, [[0, 0], [5, 5], [9, 9]]);
  // negative radii are their absolute values
  assert.deepEqual(only('M0 0 A-5 -5 0 0 1 10 0').pts, only('M0 0 A5 5 0 0 1 10 0').pts);
});

test('a tiny closed circle keeps its corners', () => {
  const c = only('M0.2 0 A0.2 0.2 0 1 1 -0.2 0 A0.2 0.2 0 1 1 0.2 0 Z');
  assert.ok(c.pts.length >= 4);
  assert.ok(Math.abs(polygonArea(c.pts)) > 0);
});

test('curves stay within the tolerance of the true curve', () => {
  const rand = rng(7);
  for (let k = 0; k < 120; k++) {
    const tol = [0.05, 0.25, 1][k % 3];
    const s = 10 + rand() * 300;
    const p = Array.from({ length: 8 }, () => (rand() - 0.5) * s);
    const cub = only(`M${p[0]} ${p[1]} C${p[2]} ${p[3]} ${p[4]} ${p[5]} ${p[6]} ${p[7]}`, tol);
    const cubic = (t) => {
      const u = 1 - t;
      return [0, 1].map((j) => u * u * u * p[j] + 3 * u * u * t * p[2 + j] + 3 * u * t * t * p[4 + j] + t * t * t * p[6 + j]);
    };
    assert.ok(deviation(cubic, cub.pts, 400) <= tol + 1e-9, `cubic ${k}`);
    const qd = only(`M${p[0]} ${p[1]} Q${p[2]} ${p[3]} ${p[4]} ${p[5]}`, tol);
    const quad = (t) => {
      const u = 1 - t;
      return [0, 1].map((j) => u * u * p[j] + 2 * u * t * p[2 + j] + t * t * p[4 + j]);
    };
    assert.ok(deviation(quad, qd.pts, 400) <= tol + 1e-9, `quad ${k}`);
  }
});

test('circles drawn with four cubics stay within the tolerance', () => {
  const r = 100, k = 0.5522847498 * r;
  const d = `M${r} 0 C${r} ${k} ${k} ${r} 0 ${r} C${-k} ${r} ${-r} ${k} ${-r} 0 C${-r} ${-k} ${-k} ${-r} 0 ${-r} C${k} ${-r} ${r} ${-k} ${r} 0 Z`;
  const c = only(d, 0.1);
  const circle = (t) => [r * Math.cos(t * Math.PI * 2), r * Math.sin(t * Math.PI * 2)];
  let worst = 0;
  for (let i = 0; i < 2000; i++) worst = Math.max(worst, distToPolyline(circle(i / 2000), c.pts, true));
  // (the four-cubic circle is itself off by r · 2.7e-4)
  assert.ok(worst <= 0.1 + 0.03, `deviation ${worst}`);
});

test('the pieces follow the curve\'s size, and are capped', () => {
  const count = (d) => only(d).pts.length;
  assert.equal(count('M0 0 C10 0 20 0 30 0'), 2); // a straight cubic is one piece
  assert.equal(count('M0 0 Q5 0 10 0'), 2);
  assert.ok(count('M0 0 C0 5 5 10 10 10') < count('M0 0 C0 50 50 100 100 100'));
  assert.ok(count('M0 0 C0 50 50 100 100 100') < count('M0 0 C0 500 500 1000 1000 1000'));
  assert.ok(count('M0 0 A5 5 0 0 1 10 0') < count('M0 0 A500 500 0 0 1 1000 0'));
  assert.ok(count('M0 0 C1e9 0 0 1e9 1e9 1e9') <= 501);
  assert.ok(count('M0 0 A1e9 1e9 0 0 1 2e9 0') <= 501);
  assert.ok(count('M0 0 Q1e12 0 0 1e12') <= 501);
  // a tighter tolerance makes more of them
  assert.ok(only('M0 0 C0 50 50 100 100 100', 0.01).pts.length > only('M0 0 C0 50 50 100 100 100', 1).pts.length);
});

test('bad tolerances fall back to the default', () => {
  const d = 'M0 0 C0 50 50 100 100 100';
  for (const bad of [0, -1, NaN, Infinity, undefined]) assert.deepEqual(flattenPath(d, bad), flattenPath(d, 0.25));
});

test('bad path data gives what was read before it, without throwing', () => {
  assert.deepEqual(flattenPath(''), []);
  assert.deepEqual(flattenPath('   '), []);
  assert.deepEqual(flattenPath('hello'), []);
  assert.deepEqual(flattenPath(undefined), []);
  assert.deepEqual(flattenPath(null), []);
  assert.deepEqual(flattenPath('L10 10'), []); // no moveto first
  assert.deepEqual(flattenPath('10 10 L20 20'), []);
  assert.deepEqual(pointsOf('M0 0 L10 0 L20'), [[[0, 0], [10, 0]]]);
  assert.deepEqual(pointsOf('M0 0 L10 0 L foo'), [[[0, 0], [10, 0]]]);
  assert.deepEqual(pointsOf('M0 0 L10 0 X 5 5 L9 9'), [[[0, 0], [10, 0]]]);
  assert.deepEqual(pointsOf('M0 0 L10 0 C1 2 3 4 5'), [[[0, 0], [10, 0]]]);
  assert.deepEqual(pointsOf('M0 0 L10 0 A5 5 0 2 1 9 9'), [[[0, 0], [10, 0]]]);
  assert.deepEqual(pointsOf('M0 0 L10 0 L1e999 0'), [[[0, 0], [10, 0]]]);
  assert.deepEqual(pointsOf('M0 0 L10 0 Z 5 5'), [[[0, 0], [10, 0]]]);
  assert.deepEqual(pointsOf('M0 0 L10 0 L5,,5'), [[[0, 0], [10, 0]]]);
  assert.deepEqual(flattenPath('M 1 2 3'), []);
  assert.doesNotThrow(() => flattenPath('M0 0 C'));
  assert.doesNotThrow(() => flattenPath('\u0000M￿0'));
  assert.doesNotThrow(() => flattenPath('M1e'));
  assert.doesNotThrow(() => flattenPath('M-'));
  assert.doesNotThrow(() => flattenPath('M.'));
  assert.doesNotThrow(() => flattenPath(',,,'));
  assert.doesNotThrow(() => flattenPath(12345));
});

test('flattening a thousand drawn paths is quick', (t) => {
  const rand = rng(11);
  const paths = Array.from({ length: 1000 }, () => {
    const x = rand() * 500, y = rand() * 500;
    return `M${x} ${y} c5 0 10 5 10 10 s-5 10 -10 10 q-5 0 -10 5 t0 10 a6 6 0 0 1 12 0 a6 6 0 1 0 -12 0 l3 4 h5 v-3 z`;
  });
  const t0 = performance.now();
  let n = 0;
  for (const d of paths) n += flattenPath(d)[0].pts.length;
  const ms = performance.now() - t0;
  t.diagnostic(`1000 paths with curves and arcs flattened in ${ms.toFixed(1)} ms (${n} points)`);
  assert.ok(ms < 500, `${ms} ms`);
});

// ------------------------------------------------------------- polygonArea

test('polygonArea is the signed shoelace area', () => {
  const sq = square(0, 0, 10);
  assert.equal(polygonArea(sq), 100);
  assert.equal(polygonArea(reversed(sq)), -100);
  assert.equal(polygonArea([[0, 0], [4, 0], [0, 3]]), 6);
  assert.equal(polygonArea([[0, 0], [4, 0]]), 0);
  assert.equal(polygonArea([]), 0);
  assert.equal(polygonArea([[0, 0], [1, 1], [2, 2], [3, 3]]), 0);
  // far from the origin there is no loss
  assert.equal(polygonArea(square(1e7, 1e7, 2)), 4);
});

// ------------------------------------------------------------ triangulate

test('a square is two triangles, all wound the same way', () => {
  for (const pts of [square(0, 0, 10), reversed(square(0, 0, 10))]) {
    const m = triangulate([ring(pts)]);
    validMesh(m);
    assert.equal(m.indices.length, 6);
    assert.equal(m.positions.length, 8);
    assert.equal(meshArea(m), 100);
    for (const a of meshSignedAreas(m)) assert.ok(a > 0, 'counterclockwise with y up');
  }
});

test('a simple polygon of n distinct points makes n - 2 triangles, with the polygon\'s area', () => {
  const rand = rng(3);
  for (const n of [3, 4, 5, 7, 10, 25, 50, 79, 80, 81, 100, 250, 1000]) {
    for (let k = 0; k < 4; k++) {
      const pts = star(rand, n, 100 * k, -50 * k);
      for (const p of [pts, reversed(pts)]) {
        const m = triangulate([ring(p)]);
        validMesh(m);
        assert.equal(m.indices.length / 3, n - 2, `n = ${n}`);
        assert.ok(Math.abs(meshArea(m) - Math.abs(polygonArea(p))) < 1e-3 * (1 + n / 100), `area for n = ${n}`);
        for (const a of meshSignedAreas(m)) assert.ok(a > -1e-4, 'wound the same way');
      }
    }
  }
});

test('every triangle of a simple polygon lies inside it', () => {
  // the sum of the triangles' areas equals the polygon's, and none is wound the other way:
  // together that means they tile it
  const rand = rng(21);
  const pts = star(rand, 60);
  const m = triangulate([ring(pts)]);
  assert.equal(m.indices.length / 3, 58);
  const areas = meshSignedAreas(m);
  assert.ok(areas.every((a) => a > 0));
  assert.ok(Math.abs(areas.reduce((s, a) => s + a, 0) - Math.abs(polygonArea(pts))) < 1e-3);
});

test('a concave L-shape', () => {
  const l = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 30], [0, 30]];
  const m = triangulate([ring(l)]);
  validMesh(m);
  assert.equal(m.indices.length / 3, 4);
  assert.equal(meshArea(m), 20 * 10 + 10 * 20);
  assert.equal(meshArea(triangulate([ring(reversed(l))])), 400);
});

// teeth 2 wide and 10 high on a spine 5 high, a gap of 2 between them
function comb(teeth) {
  const outline = [[0, 0], [4 * teeth - 2, 0]];
  for (let i = teeth - 1; i >= 0; i--) {
    const x = i * 4;
    if (i < teeth - 1) outline.push([x + 2, 5]);
    outline.push([x + 2, 15], [x, 15]);
    if (i > 0) outline.push([x, 5]);
  }
  return outline;
}

test('a comb', () => {
  const teeth = 6, outline = comb(teeth);
  const expected = (4 * teeth - 2) * 5 + teeth * 2 * 10;
  assert.ok(close(Math.abs(polygonArea(outline)), expected), 'the outline is what the test thinks');
  for (const p of [outline, reversed(outline)]) {
    const m = triangulate([ring(p)]);
    validMesh(m);
    assert.ok(Math.abs(meshArea(m) - expected) < 1e-4, `area ${meshArea(m)}`);
    assert.equal(m.indices.length / 3, p.length - 2);
  }
});

test('a comb with extra points along all its straight runs', () => {
  const base = comb(5), outline = [];
  for (let i = 0; i < base.length; i++) {
    const a = base[i], b = base[(i + 1) % base.length];
    outline.push(a, [(a[0] * 2 + b[0]) / 3, (a[1] * 2 + b[1]) / 3], [(a[0] + b[0] * 2) / 3, (a[1] + b[1] * 2) / 3]);
  }
  const expected = 18 * 5 + 5 * 2 * 10;
  const m = triangulate([ring(outline)]);
  validMesh(m);
  assert.ok(Math.abs(meshArea(m) - expected) < 1e-4, `area ${meshArea(m)} against ${expected}`);
});

test('collinear and repeated points are harmless', () => {
  // a square with points along every side
  const side = [];
  for (let i = 0; i < 5; i++) side.push([i * 2, 0]);
  for (let i = 0; i < 5; i++) side.push([10, i * 2]);
  for (let i = 0; i < 5; i++) side.push([10 - i * 2, 10]);
  for (let i = 0; i < 5; i++) side.push([0, 10 - i * 2]);
  const m = triangulate([ring(side)]);
  validMesh(m);
  assert.equal(meshArea(m), 100);
  assert.ok(m.indices.length / 3 <= side.length - 2, 'no more triangles than the points allow');

  // each point twice in a row, and the first again at the end
  const dup = [];
  for (const p of square(0, 0, 10)) dup.push(p, [p[0], p[1]]);
  dup.push([0, 0]);
  const d = triangulate([ring(dup)]);
  validMesh(d);
  assert.equal(d.indices.length / 3, 2);
  assert.equal(meshArea(d), 100);
  assert.equal(d.positions.length, 8, 'the repeats are not kept');

  // a fully collinear run along a corner of an L
  const l = [[0, 0], [10, 0], [20, 0], [20, 10], [10, 10], [10, 20], [10, 30], [0, 30], [0, 15]];
  assert.equal(meshArea(triangulate([ring(l)])), 20 * 10 + 10 * 20);
});

test('rings with nothing to fill give an empty mesh', () => {
  for (const subs of [
    [],
    [ring([[0, 0], [1, 1]])],
    [ring([[0, 0], [1, 1], [2, 2]])],
    [ring([[0, 0], [5, 0], [10, 0], [3, 0]])],
    [ring([[1, 1], [1, 1], [1, 1], [1, 1]])],
    [ring([[0, 0], [NaN, 1], [5, Infinity]])],
    [ring([[5, 5]])],
  ]) {
    const m = triangulate(subs);
    validMesh(m);
    assert.equal(m.indices.length, 0);
  }
  assert.doesNotThrow(() => triangulate(undefined));
  assert.doesNotThrow(() => triangulate([null, {}, { pts: null }]));
  // a stray point or two does not spoil a good ring
  const m = triangulate([ring([[0, 0], [10, 0], [10, 10], [NaN, NaN], [0, 10]])]);
  assert.equal(meshArea(m), 100);
});

test('an unclosed subpath is filled as if it were closed', () => {
  const open = triangulate([{ pts: square(0, 0, 10), closed: false }]);
  assert.equal(meshArea(open), 100);
  assert.equal(meshArea(triangulate(flattenPath('M0 0 H10 V10 H0'))), 100);
});

test('a path\'s fill, from its data', () => {
  const m = triangulate(flattenPath('M0 0 L20 0 L20 10 L10 10 L10 30 L0 30 Z'));
  assert.equal(meshArea(m), 400);
  // a circle of two arcs
  const r = 40;
  const c = triangulate(flattenPath(`M${r} 0 A${r} ${r} 0 1 1 ${-r} 0 A${r} ${r} 0 1 1 ${r} 0 Z`, 0.01));
  assert.ok(Math.abs(meshArea(c) - Math.PI * r * r) / (Math.PI * r * r) < 0.001);
});

// ------------------------------------------------------------------ holes

const outer = square(0, 0, 10), hole = square(3, 3, 4);

test('a square with a square hole, evenodd, whichever way the hole is wound', () => {
  for (const h of [hole, reversed(hole)]) {
    for (const o of [outer, reversed(outer)]) {
      const m = triangulate([ring(o), ring(h)], 'evenodd');
      validMesh(m);
      assert.ok(Math.abs(meshArea(m) - 84) < 1e-4, `area ${meshArea(m)}`);
    }
  }
});

test('a square with a square hole, nonzero: a hole is a ring wound against its outline', () => {
  for (const o of [outer, reversed(outer)]) {
    const against = triangulate([ring(o), ring(polygonArea(o) > 0 ? reversed(hole) : hole)], 'nonzero');
    validMesh(against);
    assert.ok(Math.abs(meshArea(against) - 84) < 1e-4, `against: ${meshArea(against)}`);
    // wound the same way it adds to the outline and fills
    const along = triangulate([ring(o), ring(polygonArea(o) > 0 ? hole : reversed(hole))], 'nonzero');
    validMesh(along);
    assert.ok(Math.abs(meshArea(along) - 100) < 1e-4, `along: ${meshArea(along)}`);
  }
  // nonzero is the default
  assert.ok(Math.abs(meshArea(triangulate([ring(outer), ring(reversed(hole))])) - 84) < 1e-4);
  assert.ok(Math.abs(meshArea(triangulate([ring(outer), ring(hole)])) - 100) < 1e-4);
});

test('holes of all shapes: triangles, many points, touching the bounds', () => {
  const rand = rng(5);
  const big = star(rand, 40, 0, 0, 50, 60);
  const small = star(rand, 30, 5, -4, 5, 20);
  const m = triangulate([ring(big), ring(small)], 'evenodd');
  validMesh(m);
  const expected = Math.abs(polygonArea(big)) - Math.abs(polygonArea(small));
  assert.ok(Math.abs(meshArea(m) - expected) < 1e-2, `${meshArea(m)} against ${expected}`);
  // a hole as wide as the outline's bounds: touching the bounds, not the outline
  const diamond = [[0, 50], [50, 0], [100, 50], [50, 100]];
  const inner = [[50, 10], [90, 50], [50, 90], [10, 50]];
  const d = triangulate([ring(diamond), ring(inner)], 'evenodd');
  assert.ok(Math.abs(meshArea(d) - (5000 - 3200)) < 1e-4, `${meshArea(d)}`);
  // a many-pointed ring (hashed) with holes
  const wide = star(rand, 300, 0, 0, 90, 100);
  const holes = [star(rand, 20, -40, 0, 3, 10), star(rand, 20, 40, 0, 3, 10), star(rand, 20, 0, -45, 3, 10)];
  const w = triangulate([ring(wide), ...holes.map(ring)], 'evenodd');
  validMesh(w);
  const want = Math.abs(polygonArea(wide)) - holes.reduce((s, h) => s + Math.abs(polygonArea(h)), 0);
  assert.ok(Math.abs(meshArea(w) - want) < 1e-2, `${meshArea(w)} against ${want}`);
});

test('two holes, one above the other with the same left edge', () => {
  const a = square(2, 1, 3), b = square(2, 6, 3);
  for (const rule of ['evenodd', 'nonzero']) {
    const m = triangulate([ring(outer), ring(rule === 'nonzero' ? reversed(a) : a), ring(rule === 'nonzero' ? reversed(b) : b)], rule);
    validMesh(m);
    assert.ok(Math.abs(meshArea(m) - (100 - 9 - 9)) < 1e-4, `${rule}: ${meshArea(m)}`);
  }
});

test('an island in a hole: evenodd counts rings, nonzero adds windings', () => {
  const o = square(0, 0, 20), h = square(4, 4, 12), island = square(8, 8, 4);
  const evenodd = triangulate([ring(o), ring(h), ring(island)], 'evenodd');
  validMesh(evenodd);
  assert.ok(Math.abs(meshArea(evenodd) - (400 - 144 + 16)) < 1e-4, `${meshArea(evenodd)}`);
  // winding alternately: filled, empty, filled
  const alternate = triangulate([ring(o), ring(reversed(h)), ring(island)], 'nonzero');
  assert.ok(Math.abs(meshArea(alternate) - 272) < 1e-4, `${meshArea(alternate)}`);
  // all wound alike: everything is filled
  const alike = triangulate([ring(o), ring(h), ring(island)], 'nonzero');
  assert.ok(Math.abs(meshArea(alike) - 400) < 1e-4, `${meshArea(alike)}`);
  // evenodd ignores the windings
  const mixed = triangulate([ring(o), ring(reversed(h)), ring(reversed(island))], 'evenodd');
  assert.ok(Math.abs(meshArea(mixed) - 272) < 1e-4);
  // the order the rings come in does not matter
  const shuffled = triangulate([ring(island), ring(h), ring(o)], 'evenodd');
  assert.ok(Math.abs(meshArea(shuffled) - 272) < 1e-4);
  // nonzero: a ring against the outline, and a second one against the first (so with it): it is a hole in the hole's way
  const twice = triangulate([ring(o), ring(reversed(h)), ring(reversed(island))], 'nonzero');
  assert.ok(Math.abs(meshArea(twice) - (400 - 144 + 16)) < 1e-4 || Math.abs(meshArea(twice) - 256) < 1e-4, `${meshArea(twice)}`);
});

test('separate rings are separate polygons', () => {
  const rings = [ring(square(0, 0, 10)), ring(square(20, 0, 5)), ring(reversed(square(0, 20, 3)))];
  for (const rule of ['evenodd', 'nonzero']) {
    const m = triangulate(rings, rule);
    validMesh(m);
    assert.equal(meshArea(m), 100 + 25 + 9);
    assert.equal(m.indices.length / 3, 6);
  }
  // two rings drawn over each other, wound alike, are filled once by nonzero
  const near = triangulate([ring(square(0, 0, 10)), ring(square(2, 2, 2))], 'nonzero');
  assert.equal(meshArea(near), 100);
});

test('holes in two outlines go to the right ones', () => {
  const rings = [
    ring(square(0, 0, 10)), ring(square(3, 3, 4)),
    ring(square(20, 0, 10)), ring(square(23, 3, 4)), ring(square(26, 6, 1)),
  ];
  const m = triangulate(rings, 'evenodd');
  validMesh(m);
  assert.ok(Math.abs(meshArea(m) - (84 + 100 - 16 + 1)) < 1e-4, `${meshArea(m)}`);
});

test('a hole joined to the outline by a slit (one ring) is a hole', () => {
  // out along the slit to the hole, round it the other way, and back
  const o = square(0, 0, 100), h = reversed(square(40, 40, 20));
  const keyhole = [...o, o[0], ...h, h[0]];
  for (const rule of ['evenodd', 'nonzero']) {
    for (const ring_ of [keyhole, reversed(keyhole)]) {
      const m = triangulate([ring(ring_)], rule);
      validMesh(m);
      assert.ok(Math.abs(meshArea(m) - (10000 - 400)) < 1e-4, `${rule}: ${meshArea(m)}`);
    }
  }
});

test('a hole touching the outline at one point, drawn as one ring through it twice', () => {
  const pinched = [[0, 5], [0, 0], [10, 0], [10, 10], [0, 10], [0, 5], [3, 7], [6, 5], [3, 3]];
  for (const rule of ['evenodd', 'nonzero']) {
    for (const p of [pinched, reversed(pinched)]) {
      const m = triangulate([ring(p)], rule);
      validMesh(m);
      assert.ok(Math.abs(meshArea(m) - 88) < 1e-4, `${rule}: ${meshArea(m)}`);
    }
  }
});

test('a hole whose every point is also a point of the outline', () => {
  // a square with a diamond hole that touches the middle of each side
  const o = [[0, 0], [2, 0], [4, 0], [4, 2], [4, 4], [2, 4], [0, 4], [0, 2]];
  const h = [[2, 0], [4, 2], [2, 4], [0, 2]];
  for (const a of [h, reversed(h)]) {
    const wound = polygonArea(a) * polygonArea(o) < 0;
    const evenodd = triangulate([ring(o), ring(a)], 'evenodd');
    validMesh(evenodd);
    assert.ok(Math.abs(meshArea(evenodd) - 8) < 1e-4, `evenodd: ${meshArea(evenodd)}`);
    const nonzero = triangulate([ring(o), ring(a)], 'nonzero');
    assert.ok(Math.abs(meshArea(nonzero) - (wound ? 8 : 16)) < 1e-4, `nonzero: ${meshArea(nonzero)}`);
  }
});

test('many loops through one point, and rings after a ring that was cut', () => {
  // 600 thin triangles fanned round a point, in one ring that goes back to the point after each
  const fan = [[0, 0]];
  for (let i = 0; i < 600; i++) {
    const a = (i / 600) * Math.PI * 2, b = ((i + 0.5) / 600) * Math.PI * 2;
    fan.push([Math.cos(a) * 100, Math.sin(a) * 100], [Math.cos(b) * 100, Math.sin(b) * 100], [0, 0]);
  }
  fan.pop();
  let want = 0;
  for (let i = 0; i < 600; i++) want += Math.abs(polygonArea([[0, 0], fan[1 + 3 * i], fan[2 + 3 * i]]));
  for (const rule of ['evenodd', 'nonzero']) {
    const m = triangulate([ring(fan), ring(square(500, 500, 10))], rule);
    validMesh(m);
    assert.equal(m.indices.length / 3, 600 + 2);
    assert.ok(Math.abs(meshArea(m) - want - 100) < 1e-2, `${rule}: ${meshArea(m)} against ${want + 100}`);
  }
  // pinched rings one after another: later ones are not lost
  const pinched = [[0, 5], [0, 0], [10, 0], [10, 10], [0, 10], [0, 5], [3, 7], [6, 5], [3, 3]];
  const many = Array.from({ length: 800 }, (_, i) => ring(pinched.map(([x, y]) => [x + (i % 40) * 20, y + Math.floor(i / 40) * 20])));
  const m = triangulate(many, 'evenodd');
  validMesh(m);
  assert.ok(Math.abs(meshArea(m) - 800 * 88) < 1e-1, `${meshArea(m)}`);
});

test('holes made by flattening a path', () => {
  // a ring (a square with a round hole), with the hole wound against the outline
  const d = 'M0 0 H100 V100 H0 Z M50 20 A30 30 0 1 0 50 80 A30 30 0 1 0 50 20 Z';
  const subs = flattenPath(d, 0.05);
  const hole = Math.abs(polygonArea(subs[1].pts));
  const evenodd = triangulate(subs, 'evenodd');
  assert.ok(Math.abs(meshArea(evenodd) - (10000 - hole)) < 1e-2);
  const nonzero = triangulate(subs, 'nonzero');
  assert.ok(Math.abs(meshArea(nonzero) - (polygonArea(subs[0].pts) * polygonArea(subs[1].pts) < 0 ? 10000 - hole : 10000)) < 1e-2);
  assert.ok(Math.abs(hole - Math.PI * 900) / (Math.PI * 900) < 0.005);
});

// ------------------------------------------------- awkward outlines

test('outlines that touch themselves, or cross, do not throw or hang', () => {
  const touching = [[0, 0], [5, 0], [5, 5], [10, 5], [10, 10], [5, 10], [5, 5], [0, 5]]; // two squares meeting at (5, 5)
  const bowtie = [[0, 0], [10, 10], [10, 0], [0, 10]];
  const pinched = [[0, 0], [10, 0], [10, 10], [5, 10], [5, 0.0001], [4.9999, 10], [0, 10]];
  const spike = [[0, 0], [10, 0], [10, 10], [5, 10], [5, 20], [5, 10], [0, 10]]; // a spike that doubles back on itself
  const loop = [[0, 0], [10, 0], [10, 10], [6, 10], [4, 14], [4, 6], [6, 14], [4, 10], [0, 10]];
  for (const [name, pts] of Object.entries({ touching, bowtie, pinched, spike, loop })) {
    for (const p of [pts, reversed(pts)]) {
      const m = triangulate([ring(p)]);
      validMesh(m);
      assert.ok(m.indices.length / 3 <= p.length - 2, name);
    }
  }
  // the two squares meeting at a point are filled whole
  assert.ok(Math.abs(meshArea(triangulate([ring(touching)])) - 50) < 1e-6);
  // a ring with a shared edge and with a point on another edge
  const m = triangulate([ring([[0, 0], [10, 0], [10, 10], [0, 10]]), ring([[0, 5], [5, 5], [5, 8]])], 'evenodd');
  validMesh(m);
});

test('random scribbles of any kind finish and give valid meshes', () => {
  const rand = rng(99);
  for (let k = 0; k < 300; k++) {
    const n = 3 + Math.floor(rand() * 40);
    const rings = [];
    for (let r = 0; r < 1 + (k % 3); r++) {
      const grid = k % 2 === 0; // on a coarse grid, so that points repeat and line up
      rings.push(ring(Array.from({ length: n }, () => (grid ? [Math.floor(rand() * 6), Math.floor(rand() * 6)] : [rand() * 10, rand() * 10]))));
    }
    for (const rule of ['evenodd', 'nonzero']) validMesh(triangulate(rings, rule));
  }
});

test('the mesh does not alias scratch memory between calls', () => {
  const a = triangulate([ring(square(0, 0, 10))]);
  const copy = { positions: Float32Array.from(a.positions), indices: Uint32Array.from(a.indices) };
  triangulate([ring(square(100, 100, 50)), ring(reversed(square(110, 110, 5)))]);
  assert.deepEqual(a.positions, copy.positions);
  assert.deepEqual(a.indices, copy.indices);
});

// ------------------------------------------------------------------ speed

test('2000 shapes of 50 points triangulate in well under a second', (t) => {
  const rand = rng(1);
  const shapes = Array.from({ length: 2000 }, (_, i) => star(rand, 50, (i % 50) * 30, Math.floor(i / 50) * 30));
  const t0 = performance.now();
  let tris = 0;
  for (const p of shapes) tris += triangulate([ring(p)]).indices.length / 3;
  const ms = performance.now() - t0;
  t.diagnostic(`2000 stars of 50 points triangulated in ${ms.toFixed(1)} ms (${tris} triangles)`);
  assert.equal(tris, 2000 * 48);
  assert.ok(ms < 1000, `${ms} ms`);
});

test('small shapes with holes, by the thousand', (t) => {
  const rand = rng(2);
  const shapes = Array.from({ length: 2000 }, (_, i) => {
    const cx = (i % 50) * 40, cy = Math.floor(i / 50) * 40;
    return [ring(star(rand, 20, cx, cy, 14, 18)), ring(star(rand, 8, cx, cy, 3, 6))];
  });
  const t0 = performance.now();
  let tris = 0;
  for (const s of shapes) tris += triangulate(s, 'evenodd').indices.length / 3;
  const ms = performance.now() - t0;
  t.diagnostic(`2000 shapes with a hole triangulated in ${ms.toFixed(1)} ms (${tris} triangles)`);
  assert.equal(tris, 2000 * (20 + 8));
  assert.ok(ms < 1000, `${ms} ms`);
});

test('big rings are not quadratic', (t) => {
  const rand = rng(4);
  const pts = star(rand, 20000, 0, 0, 900, 1000);
  const t0 = performance.now();
  const m = triangulate([ring(pts)]);
  const ms = performance.now() - t0;
  t.diagnostic(`one ring of 20000 points triangulated in ${ms.toFixed(1)} ms`);
  assert.equal(m.indices.length / 3, 19998);
  assert.ok(ms < 1500, `${ms} ms`);
});
