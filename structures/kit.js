// Small props shared by structure, park and surroundings drawings.
// Each prop starts its own depth-sorted solid, so props can be scattered
// freely around a building. Props skip themselves where a footpath (or road)
// is in the way (g.isFree), and small ones are drawn at detail level 2 so
// they disappear when zoomed out.

import { clipSegment, splitRuns } from '../src/core/geom2d.js';

export function tree(g, x, y, size = 1) {
  if (!g.isFree(x, y, 0.07 * size)) return;
  const h = 0.2 * size;
  g.solid(x, y, h);
  if (g.chance(0.35)) {
    g.line([[x, y, 0], [x, y, h * 0.3]]);
    g.shape(x, y, h * 0.2, [[-0.08 * size, 0], [0.08 * size, 0], [0, 0.28 * size]]);
  } else {
    g.line([[x, y, 0], [x, y, h * 0.7]]);
    g.disc(x, y, h, 0.075 * size);
  }
}

export function bush(g, x, y, r = 0.04) {
  if (!g.isFree(x, y, r)) return;
  g.detailed(2, () => {
    g.solid(x, y, r);
    g.disc(x, y, r, r);
  });
}

// Low hedge block from x0 to x1 at depth y (along x).
export function hedge(g, x0, x1, y, h = 0.05) {
  hedgeAlong(g, [[x0, y], [x1, y]], h);
}

// Hedge along any polyline: a low band (top and bottom edge, closed ends);
// gaps where paths cross.
export function hedgeAlong(g, pts, h = 0.045) {
  for (const run of splitRuns(pts, (p) => g.isFree(p[0], p[1], 0.04))) {
    if (run.length < 3) continue;
    const mid = run[Math.floor(run.length / 2)];
    const [a, b] = [run[0], run[run.length - 1]];
    g.detailed(2, () => {
      g.solid(mid[0], mid[1], h / 2);
      g.line([[a[0], a[1], 0], ...run.map(([x, y]) => [x, y, h]), [b[0], b[1], 0]]);
      g.line(run.map(([x, y]) => [x, y, 0]));
    });
  }
}

// Picket fence from a to b (2D points), posts every ~0.1.
export function fence(g, a, b, h = 0.06) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  g.solid((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, h / 2);
  g.line([[a[0], a[1], h], [b[0], b[1], h]]);
  const n = Math.max(1, Math.round(len / 0.1));
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    g.line([[x, y, 0], [x, y, h]]);
  }
}

// Car parked along y (nose towards -y) or along x.
export function car(g, x, y, alongX = false) {
  if (!g.isFree(x, y, 0.08)) return;
  g.detailed(2, () => carBody(g, x, y, alongX));
}

function carBody(g, x, y, alongX) {
  const w = alongX ? 0.15 : 0.085, d = alongX ? 0.085 : 0.15;
  g.box(x - w / 2, y - d / 2, 0, w, d, 0.04);
  g.box(x - w * 0.35, y - d * 0.3, 0.04, w * 0.7, d * 0.55, 0.03);
}

// Bench with a backrest. alongX: the seat runs along x; back: which side the
// backrest is on (+1 / -1 along the other axis), so it can face a path.
export function bench(g, x, y, alongX = true, back = 1) {
  if (!g.isFree(x, y, 0.07)) return;
  const len = 0.14, depth = 0.045, t = 0.012;
  g.detailed(2, () => {
    if (alongX) {
      g.box(x - len / 2, y - depth / 2, 0, len, depth, 0.03);
      g.box(x - len / 2, back > 0 ? y + depth / 2 : y - depth / 2 - t, 0, len, t, 0.07);
    } else {
      g.box(x - depth / 2, y - len / 2, 0, depth, len, 0.03);
      g.box(back > 0 ? x + depth / 2 : x - depth / 2 - t, y - len / 2, 0, t, len, 0.07);
    }
  });
}

// Entrance posts either side of a path end at (x, y) heading along dir.
export function gate(g, x, y, [dx, dy]) {
  const px = -dy * 0.07, py = dx * 0.07;
  g.detailed(2, () => {
    for (const k of [-1, 1]) g.box(x + px * k - 0.015, y + py * k - 0.015, 0, 0.03, 0.03, 0.09);
  });
}

// A few tiny grass tufts in a rectangle (detail only), avoiding skip(x, y).
export function tufts(g, n, x0, y0, x1, y1, skip = () => false) {
  g.detailed(2, () => {
    for (let i = 0, tries = 0; i < n && tries < n * 4; tries++) {
      const x = g.range(x0, x1), y = g.range(y0, y1);
      if (skip(x, y) || !g.isFree(x, y, 0.02)) continue;
      g.solid(x, y, 0.01);
      g.line([[x - 0.014, y, 0.022], [x, y, 0], [x + 0.014, y, 0.022]]);
      i++;
    }
  });
}

export function crates(g, x, y) {
  const stacked = g.chance(0.6);
  if (!g.isFree(x, y, 0.07)) return;
  g.detailed(2, () => {
    g.box(x - 0.05, y - 0.05, 0, 0.1, 0.1, 0.06);
    if (stacked) g.box(x - 0.035, y - 0.035, 0.06, 0.07, 0.07, 0.05);
  });
}

export function container(g, x, y, alongX = true) {
  const w = alongX ? 0.3 : 0.11, d = alongX ? 0.11 : 0.3;
  if (![[x - w / 2, y], [x, y], [x + w / 2, y], [x, y - d / 2], [x, y + d / 2]].every(([px, py]) => g.isFree(px, py, 0.03))) return;
  g.detailed(2, () => {
    g.box(x - w / 2, y - d / 2, 0, w, d, 0.1);
    g.mullions(x - w / 2, y - d / 2, w, d, 0, 0.1, 0.05, 0.01);
  });
}

// Small shed with a pitched roof (back gardens).
export function shed(g, x, y) {
  if (!g.isFree(x, y, 0.09)) return;
  g.detailed(2, () => g.gable(x - 0.07, y - 0.05, 0, 0.14, 0.1, 0.07, 0.05));
}

// A pair of bins.
export function bins(g, x, y) {
  if (!g.isFree(x, y, 0.05)) return;
  g.detailed(2, () => {
    g.box(x - 0.045, y - 0.02, 0, 0.04, 0.04, 0.045);
    g.box(x + 0.005, y - 0.02, 0, 0.04, 0.04, 0.045);
  });
}

// Stack of flat pallets.
export function pallets(g, x, y) {
  if (!g.isFree(x, y, 0.07)) return;
  g.detailed(2, () => g.box(x - 0.06, y - 0.05, 0, 0.12, 0.1, 0.04));
}

export function lamp(g, x, y) {
  if (!g.isFree(x, y, 0.03)) return;
  g.detailed(2, () => {
    g.solid(x, y, 0.1);
    g.line([[x, y, 0], [x, y, 0.16], [x + 0.03, y, 0.17]]);
  });
}

export function fountain(g, x, y, r = 0.1) {
  if (!g.isFree(x, y, r)) return;
  g.groundCircle(x, y, r * 1.6, { dash: '2 2' });
  g.cylinder(x, y, 0, r, 0.04, 12);
  g.cylinder(x, y, 0.04, r * 0.25, 0.08, 8);
}

export function statue(g, x, y) {
  if (!g.isFree(x, y, 0.06)) return;
  g.box(x - 0.05, y - 0.05, 0, 0.1, 0.1, 0.06);
  g.box(x - 0.018, y - 0.018, 0.06, 0.036, 0.036, 0.12);
}

// Paving: a grid of lines clipped to a polygon ([[x, y]…], e.g.
// g.site.outline), optionally with the outline. Grid lines sit on multiples
// of `step`, so neighbouring pavings line up.
export function paving(g, poly, step = 0.1, { dash = '1.5 2', outline = true, lod = 2 } = {}) {
  if (outline) g.groundPoly(poly);
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const draw = (seg) => {
    // leave the footpaths clear
    for (const run of splitRuns(seg, (p) => g.isFree(p[0], p[1], 0.02), 0.06)) {
      g.groundLine([run[0], run[run.length - 1]], { dash, lod });
    }
  };
  for (let x = Math.ceil(x0 / step) * step; x < x1; x += step) {
    for (const seg of clipSegment([x, y0 - 1], [x, y1 + 1], poly)) draw(seg);
  }
  for (let y = Math.ceil(y0 / step) * step; y < y1; y += step) {
    for (const seg of clipSegment([x0 - 1, y], [x1 + 1, y], poly)) draw(seg);
  }
}

// Picket fence along any polyline.
export function fenceAlong(g, pts, h = 0.06, spacing = 0.1) {
  if (pts.length < 2) return;
  for (const run of splitRuns(pts, (p) => g.isFree(p[0], p[1], 0.04))) {
    if (run.length > 2) g.detailed(2, () => fenceRun(g, run, h, spacing));
  }
}

function fenceRun(g, pts, h, spacing) {
  const mid = pts[Math.floor(pts.length / 2)];
  g.solid(mid[0], mid[1], h / 2);
  g.line(pts.map(([x, y]) => [x, y, h]));
  let run = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    for (; run <= len; run += spacing) {
      const t = run / len;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      g.line([[x, y, 0], [x, y, h]]);
    }
    run -= len;
  }
}
