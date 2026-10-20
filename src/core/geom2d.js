// Small 2D geometry helpers (points are [x, y]).

const cross = (ax, ay, bx, by) => ax * by - ay * bx;

export function segmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

// Split a polyline into the runs where keep(point) holds, sampling every `step`.
export function splitRuns(pts, keep, step = 0.03) {
  const runs = [];
  let run = [];
  const flush = () => {
    if (run.length > 1) runs.push(run);
    run = [];
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const p = [ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n];
      if (keep(p)) run.push(p);
      else flush();
    }
  }
  flush();
  return runs;
}

// Even-odd point in polygon test.
export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Parts of segment a–b that lie inside `poly`, as a list of [p, q] segments.
export function clipSegment(a, b, poly) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const ts = [0, 1];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const ex = q[0] - p[0], ey = q[1] - p[1];
    const den = cross(dx, dy, ex, ey);
    if (Math.abs(den) < 1e-12) continue;
    const px = p[0] - a[0], py = p[1] - a[1];
    const t = cross(px, py, ex, ey) / den;
    const u = cross(px, py, dx, dy) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((m, n) => m - n);
  const at = (t) => [a[0] + dx * t, a[1] + dy * t];
  const out = [];
  for (let i = 0; i < ts.length - 1; i++) {
    if (ts[i + 1] - ts[i] < 1e-6) continue;
    if (pointInPolygon(at((ts[i] + ts[i + 1]) / 2), poly)) out.push([at(ts[i]), at(ts[i + 1])]);
  }
  return out;
}

// Distance along a ray (origin o, unit direction d) to the nearest of the
// given segments, within maxDist; null if none.
export function castRay(o, d, segments, maxDist) {
  let best = null;
  for (const [a, b] of segments) {
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = cross(d[0], d[1], ex, ey);
    if (Math.abs(den) < 1e-12) continue;
    const ax = a[0] - o[0], ay = a[1] - o[1];
    const t = cross(ax, ay, ex, ey) / den;
    const u = cross(ax, ay, d[0], d[1]) / den;
    if (t >= 0 && t <= maxDist && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}

// A line through points that bends as little as it can while staying close
// to them (a Whittaker smoother): the p minimising Σ weight[i]·|p[i] − pts[i]|²
// + stiff · Σ|p[i−1] − 2p[i] + p[i+1]|² (weight 1 where not given), with
// fixed[i] points kept where they are. Straight runs stay straight; the bigger `stiff`, the smoother. A
// banded (five-wide) linear solve, both coordinates at once.
export function smoothLine(pts, fixed, stiff, weight = null) {
  const n = pts.length;
  const a = new Float64Array(n * 5); // A[i][j] at a[i * 5 + j - i + 2]
  const at = (i, j) => i * 5 + j - i + 2;
  const w = (i) => weight?.[i] ?? 1;
  for (let i = 0; i < n; i++) a[at(i, i)] += w(i);
  const r = [1, -2, 1];
  for (let k = 1; k < n - 1; k++) {
    for (let u = 0; u < 3; u++) for (let v = 0; v < 3; v++) a[at(k - 1 + u, k - 1 + v)] += stiff * r[u] * r[v];
  }
  const bx = pts.map((q, i) => w(i) * q[0]), by = pts.map((q, i) => w(i) * q[1]);
  // fixed points: their rows say p = pt, their columns move to the right side
  for (let i = 0; i < n; i++) {
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
      if (fixed[i]) a[at(i, j)] = i === j ? 1 : 0;
      else if (fixed[j] && j !== i) {
        bx[i] -= a[at(i, j)] * pts[j][0];
        by[i] -= a[at(i, j)] * pts[j][1];
        a[at(i, j)] = 0;
      }
    }
  }
  // elimination (symmetric positive definite: no pivoting), then back
  for (let i = 0; i < n; i++) {
    for (let k = i + 1; k <= Math.min(n - 1, i + 2); k++) {
      const f = a[at(k, i)] / a[at(i, i)];
      if (!f) continue;
      for (let j = i; j <= Math.min(n - 1, i + 2); j++) a[at(k, j)] -= f * a[at(i, j)];
      bx[k] -= f * bx[i];
      by[k] -= f * by[i];
    }
  }
  const out = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let x = bx[i], y = by[i];
    for (let j = i + 1; j <= Math.min(n - 1, i + 2); j++) {
      x -= a[at(i, j)] * out[j][0];
      y -= a[at(i, j)] * out[j][1];
    }
    out[i] = [x / a[at(i, i)], y / a[at(i, i)]];
  }
  return out;
}

const cellKey = (cx, cy) => (cx + 2048) * 8192 + (cy + 2048);

// Buckets line segments by grid cell for quick "what's near here" queries.
export class SegmentIndex {
  constructor(polylines) {
    this.cells = new Map();
    for (const pts of polylines) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const seg = [a, b];
        for (let cx = Math.floor(Math.min(a[0], b[0])); cx <= Math.floor(Math.max(a[0], b[0])); cx++) {
          for (let cy = Math.floor(Math.min(a[1], b[1])); cy <= Math.floor(Math.max(a[1], b[1])); cy++) {
            const k = cellKey(cx, cy);
            if (!this.cells.has(k)) this.cells.set(k, []);
            this.cells.get(k).push(seg);
          }
        }
      }
    }
  }

  near(x0, y0, x1, y1) {
    const out = new Set();
    for (let cx = Math.floor(Math.min(x0, x1)); cx <= Math.floor(Math.max(x0, x1)); cx++) {
      for (let cy = Math.floor(Math.min(y0, y1)); cy <= Math.floor(Math.max(y0, y1)); cy++) {
        for (const s of this.cells.get(cellKey(cx, cy)) ?? []) out.add(s);
      }
    }
    return [...out];
  }

  // Distance from p to the nearest segment, looking at most `max` away
  // (returns Infinity if nothing is that close).
  distance(p, max) {
    let best = Infinity;
    for (let cx = Math.floor(p[0] - max); cx <= Math.floor(p[0] + max); cx++) {
      for (let cy = Math.floor(p[1] - max); cy <= Math.floor(p[1] + max); cy++) {
        const segs = this.cells.get(cellKey(cx, cy));
        if (!segs) continue;
        for (const [a, b] of segs) best = Math.min(best, segmentDistance(p, a, b));
      }
    }
    return best <= max ? best : Infinity;
  }

  // castRay against nearby segments only.
  cast(o, d, maxDist) {
    const ex = o[0] + d[0] * maxDist, ey = o[1] + d[1] * maxDist;
    return castRay(o, d, this.near(o[0], o[1], ex, ey), maxDist);
  }
}
