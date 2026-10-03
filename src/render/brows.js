// What of the ground the map's camera sees, and the brows: the lines where
// a hill turns away out of sight, drawn on the map at all times (the
// contour lines show only in the terrain view).
//
// The camera is isometric, so every screen column is one straight line of
// sight across the map, and seeing is worked out a column at a time: walk
// it from the front of the map to the back, keep the highest point drawn so
// far (the horizon), and whatever falls below it is hidden behind nearer
// ground.
//
//   visibility(camera, height, box)  -> { columns, events }
//                 columns  [{ u, hidden: [[tFront, tBack]…] }], the stretches
//                          of each column hidden behind nearer ground
//                 events   per column the brow points found on it
//   hiddenAt(vis, camera, x, y)  is the ground at world (x, y) hidden
//   browLines(vis, camera)  -> [{ points: [[x, y]…], s: [strength…] }]
//                          the brow points joined across the columns, in
//                          world units
//
// View units: t = rx + ry grows towards the viewer, u = rx - ry runs across
// the screen (rx, ry: Camera.rotated). A ground point at height h shows at
// screen y = (t / 2 - h * zScale) tiles, at screen x = u * cos30 tiles.
//
// Steepness of a back slope (falling away from the viewer): r = 1 where the
// ground runs straight along the line of sight, so beyond 1 it folds away
// and hides what is behind it. A back slope gets a brow once r passes
// BROWS.from, light at first and darker towards 1, where it sits on the
// slope's steepest line; past 1 the brow is the outline itself – the last
// point seen before the ground drops out of sight – and is drawn darkest.

import { rotateQuarter } from '../core/grid.js';

const COS30 = Math.cos(Math.PI / 6);

//   on      draw the brows
//   du      spacing of the screen columns (view units; 0.2 ≈ 0.17 tiles)
//   dt      sampling step along a column
//   from    back-slope steepness (r) where a brow begins
//   drop    a back slope must fall at least this far (grid units of height)
//   smooth  steepness averaged over this many samples either way
//   link    neighbouring columns' brow points join up when this close in
//           screen height (tiles)
//   gap     ...also across this many columns without one
//   min     shortest brow kept (tiles across the screen)
//   taper   brows fade in over this much of their ends (tiles)...
//   join    ...unless they end this near another brow (tiles on the
//           screen), which they then run into
//   tiers   strength from which a brow is drawn mid / as the outline
//           (strength: 0..1 from `from` to r = 1, 1..2 beyond)
//   pencil  the pen strokes (pencil.js)
export const BROWS = {
  on: true,
  du: 0.2,
  dt: 0.1,
  from: 0.2,
  drop: 0.12,
  smooth: 3,
  link: 0.3,
  gap: 2,
  min: 1.2,
  taper: 0.8,
  join: 0.6,
  tiers: [0.4, 1],
  pencil: { len: [0.8, 2.4], gap: [-0.05, 0.12], drift: 0.02, skip: 0 },
};

// World point of view coordinates (u, t).
function worldOf(camera, u, t) {
  const [dx, dy] = rotateQuarter((t + u) / 2, (t - u) / 2, -camera.rotation);
  return [dx + camera.cx, dy + camera.cy];
}

// `height(x, y)`: the ground's height as drawn, in grid units (the relief's
// lift plus the terrain's own). `box`: [x0, y0, x1, y1], the ground there.
export function visibility(camera, height, box, opts = BROWS) {
  const { du, dt, from, drop, smooth } = opts;
  const z = camera.zScale;
  const [x0, y0, x1, y1] = box;
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => {
    const [rx, ry] = camera.rotated(x, y);
    return [rx - ry, rx + ry];
  });
  const uMin = Math.min(...corners.map((c) => c[0])), uMax = Math.max(...corners.map((c) => c[0]));
  const tMin = Math.min(...corners.map((c) => c[1])), tMax = Math.max(...corners.map((c) => c[1]));
  const inside = ([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

  const columns = [], events = [];
  const T = [], H = [], Y = [], R = [];
  for (let u = uMin + du / 2; u < uMax; u += du) {
    // the column's samples on the map, front to back
    T.length = H.length = Y.length = 0;
    for (let t = tMax; t >= tMin; t -= dt) {
      const p = worldOf(camera, u, t);
      if (!inside(p)) {
        if (T.length) break; // (the box is convex: past it for good)
        continue;
      }
      const h = height(...p);
      T.push(t); H.push(h); Y.push(t / 2 - h * z);
    }
    const n = T.length;
    const col = { u, hidden: [] };
    const ev = [];
    columns.push(col);
    events.push(ev);
    if (n < 3) continue;

    // hidden: below the horizon of everything in front
    const hidden = new Uint8Array(n);
    let horizon = Infinity, from_ = -1;
    for (let k = 0; k < n; k++) {
      if (Y[k] > horizon + 1e-6) {
        hidden[k] = 1;
        if (from_ < 0) from_ = k;
      } else {
        horizon = Y[k];
        if (from_ >= 0) col.hidden.push([T[from_ - 1], T[k]]);
        from_ = -1;
      }
    }
    if (from_ >= 0) col.hidden.push([T[from_ - 1], T[n - 1]]);

    // steepness of the back slope between each sample and the one in front
    R.length = n;
    R[0] = 0;
    for (let k = 1; k < n; k++) R[k] = (z * (H[k - 1] - H[k])) / dt / 0.5;
    const S = R.map((_, k) => {
      let sum = 0, c = 0;
      for (let j = Math.max(1, k - smooth); j <= Math.min(n - 1, k + smooth); j++) { sum += R[j]; c++; }
      return c ? sum / c : 0;
    });

    // each back slope (a run of falling ground) that falls far enough
    for (let k = 1; k < n; k++) {
      if (S[k] <= 0) continue;
      const a = k;
      while (k < n && S[k] > 0) k++;
      const b = k - 1; // the run: samples a..b, falling from a - 1
      if (H[a - 1] - H[b] < drop) continue;
      // folding away: an outline wherever the ground stops rising on the
      // screen (its last point before dropping behind itself) – a slope
      // may fold more than once, steepening again further down
      const folds = [];
      for (let j = a; j <= b; j++) {
        if (Y[j] > Y[j - 1] && !(Y[j - 1] > Y[j - 2])) folds.push(j - 1);
      }
      for (let f = 0; f < folds.length; f++) {
        let rmax = 1;
        for (let j = folds[f] + 1; j <= (folds[f + 1] ?? b); j++) rmax = Math.max(rmax, S[j]);
        const at = folds[f];
        if (!hidden[at]) ev.push({ t: T[at], y: Y[at], s: 1 + Math.min(1, rmax - 1) });
      }
      if (folds.length) continue;
      // steep, not folding: on the slope's steepest line
      let top = a;
      for (let j = a; j <= b; j++) if (S[j] > S[top]) top = j;
      if (S[top] < from || hidden[top]) continue;
      ev.push({ t: T[top], y: Y[top], s: Math.min(0.999, (S[top] - from) / (1 - from)) });
    }
  }
  return { columns, events, du, dt, u0: uMin + du / 2 };
}

export function hiddenAt(vis, camera, x, y) {
  const [rx, ry] = camera.rotated(x, y);
  const col = vis.columns[Math.round((rx - ry - vis.u0) / vis.du)];
  const t = rx + ry;
  return !!col?.hidden.some(([front, back]) => t < front && t > back);
}

// The brow points joined into lines across the columns (screen left to
// right), smoothed, faded in at their ends, in world units.
export function browLines(vis, camera, opts = BROWS) {
  const { link, gap, min, taper, join } = opts;
  const { events, columns, du } = vis;
  const step = du * COS30; // tiles across the screen per column
  const chains = [];
  let open = []; // chains that may still go on: { pts: [{ i, t, y, s }] }
  events.forEach((ev, i) => {
    open = open.filter((c) => i - c.pts[c.pts.length - 1].i <= gap + 1);
    const pairs = [];
    ev.forEach((e, k) => open.forEach((c, m) => {
      const end = c.pts[c.pts.length - 1];
      const d = Math.abs(e.y - end.y);
      if (d <= link * (i - end.i)) pairs.push([d, k, m]);
    }));
    pairs.sort((p, q) => p[0] - q[0]);
    const usedE = new Set(), usedC = new Set();
    for (const [, k, m] of pairs) {
      if (usedE.has(k) || usedC.has(m)) continue;
      usedE.add(k); usedC.add(m);
      open[m].pts.push({ i, ...ev[k] });
    }
    ev.forEach((e, k) => {
      if (usedE.has(k)) return;
      const c = { pts: [{ i, ...e }] };
      chains.push(c);
      open.push(c);
    });
  });

  // fill the skipped columns of each long enough chain
  const kept = [];
  for (const { pts } of chains) {
    if ((pts[pts.length - 1].i - pts[0].i) * step < min) continue;
    const full = [];
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], q = pts[k + 1];
      full.push(p);
      if (q) for (let i = p.i + 1; i < q.i; i++) {
        const f = (i - p.i) / (q.i - p.i);
        full.push({ i, t: p.t + (q.t - p.t) * f, y: p.y + (q.y - p.y) * f, s: p.s + (q.s - p.s) * f });
      }
    }
    kept.push(full);
  }

  // Where a brow ends against another (a ridge passing behind a nearer
  // one), it runs on into that one instead of fading out.
  const meet = (full, end) => {
    const e = full[end ? full.length - 1 : 0];
    let best = null, dist = join;
    for (const other of kept) {
      if (other === full) continue;
      for (const p of other) {
        const d = Math.hypot((p.i - e.i) * step, p.y - e.y);
        if (d < dist) { dist = d; best = p; }
      }
    }
    return best;
  };
  const ends = kept.map((full) => [meet(full, false), meet(full, true)]);

  const out = [];
  kept.forEach((full, c) => {
    const avg = (key, r) => full.map((_, k) => {
      let sum = 0, n = 0;
      for (let j = Math.max(0, k - r); j <= Math.min(full.length - 1, k + r); j++) { sum += full[j][key]; n++; }
      return sum / n;
    });
    const t = avg('t', 2), s = avg('s', 3);
    const n = full.length;
    const [head, tail] = ends[c];
    const fade = (k) => Math.min(1, ((head ? Infinity : k) * step) / taper, ((tail ? Infinity : n - 1 - k) * step) / taper);
    const points = full.map((p, k) => worldOf(camera, columns[p.i].u, t[k]));
    const strength = s.map((v, k) => v * fade(k));
    if (head) { points.unshift(worldOf(camera, columns[head.i].u, head.t)); strength.unshift(strength[0]); }
    if (tail) { points.push(worldOf(camera, columns[tail.i].u, tail.t)); strength.push(strength[strength.length - 1]); }
    out.push({ points, s: strength });
  });
  return out;
}

// A brow cut into runs by how strongly it is drawn: tier 0 light, 1 mid,
// 2 the outline. Each run shares its end point with the next.
export function browRuns({ points, s }, tiers = BROWS.tiers) {
  const tierOf = (v) => (v >= tiers[1] ? 2 : v >= tiers[0] ? 1 : 0);
  const runs = [];
  let run = null;
  for (let k = 0; k < points.length - 1; k++) {
    const tier = tierOf((s[k] + s[k + 1]) / 2);
    if (!run || run.tier !== tier) {
      run = { tier, points: [points[k]] };
      runs.push(run);
    }
    run.points.push(points[k + 1]);
  }
  return runs;
}
