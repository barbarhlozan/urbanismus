// Small props shared by structure, park and surroundings drawings.
// Each prop starts its own depth-sorted solid, so props can be scattered
// freely around a building. Props skip themselves where a footpath (or road)
// is in the way (g.isFree), and small ones are drawn at detail level 2 so
// they disappear when zoomed out.

import { clipSegment, splitRuns } from '../src/core/geom2d.js';
import { drawTree, pickKind } from '../features/trees.js';

// A tree (features/trees.js), about half a grid step tall at size 1: any of
// the three kinds, or one given as `kind`.
export function tree(g, x, y, size = 1, kind = null) {
  if (!g.isFree(x, y, 0.07 * size)) return;
  const k = kind ?? pickKind(g);
  drawTree(g, x, y, k, (k === 'spruce' ? 0.56 : 0.5) * size);
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

// Street lamp: a tall concrete post with its head on a bent arm.
export function lamp(g, x, y) {
  if (!g.isFree(x, y, 0.03)) return;
  g.detailed(2, () => {
    g.solid(x, y, 0.1);
    g.line([[x, y, 0], [x, y, 0.2], [x + 0.02, y, 0.225], [x + 0.06, y, 0.23]]);
    g.line([[x + 0.045, y, 0.225], [x + 0.08, y, 0.225]], { width: 2.2 });
  });
}

// Row of lock-up garages from x0 to x1, backs at y1, doors facing -y.
export function garages(g, x0, x1, y1, d = 0.17, h = 0.08) {
  const n = Math.max(1, Math.floor((x1 - x0) / 0.12));
  const w = (x1 - x0) / n;
  g.box(x0, y1 - d, 0, x1 - x0, d, h);
  g.detailed(2, () => {
    for (let i = 0; i < n; i++) {
      const a = x0 + i * w + 0.015, b = x0 + (i + 1) * w - 0.015;
      g.line([[a, y1 - d, 0], [a, y1 - d, h * 0.75], [b, y1 - d, h * 0.75], [b, y1 - d, 0]], { facing: [0, -1, 0] });
    }
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

// ----- joined buildings (g.join, see structures/index.js) -----

// x extent of a front `w` wide, reaching the lot edge on joined sides.
export function frontage(g, w) {
  return [g.join.left ? -0.5 : -w / 2, g.join.right ? 0.5 : w / 2];
}

// Walls shared with a neighbour, for opts.skip of floors / windows / mullions.
export function shared(g) {
  return [g.join.left && 'left', g.join.right && 'right'].filter(Boolean);
}

// Hip insets for a roof with its ridge along x: gable (party wall) ends where joined.
export function hips(g, inset) {
  return [g.join.left ? 0 : inset, g.join.right ? 0 : inset];
}

// ----- roof bits -----

// TV aerials along the ridge or roof: n masts between x0 and x1 at depth y.
export function aerials(g, x0, x1, y, z, n = 3) {
  g.detailed(2, () => {
    for (let i = 0; i < n; i++) {
      const x = x0 + ((i + 0.5) / n) * (x1 - x0) + g.range(-0.03, 0.03);
      const h = g.range(0.08, 0.13);
      g.solid(x, y, z + h);
      g.line([[x, y, z], [x, y, z + h]]);
      for (const k of [0.6, 0.85]) g.line([[x - 0.035 * k, y, z + h * k], [x + 0.035 * k, y, z + h * k]]);
    }
  });
}

// Brick chimney standing on the roof (starts at z, pokes out above the ridge).
export function chimney(g, x, y, z, h, s = 0.045) {
  g.box(x - s / 2, y - s / 2, z, s, s, h);
}

// Tapered industrial chimney.
export function stack(g, x, y, h, r = 0.08) {
  g.lathe(x, y, 0, [[r, 0], [r * 0.55, h], [r * 0.62, h + 0.02], [r * 0.62, h + 0.04]], 10);
}

// Flag pole with a small pennant.
export function flagpole(g, x, y, h) {
  g.solid(x, y, h / 2);
  g.line([[x, y, 0], [x, y, h]]);
  g.shape(x, y, h - 0.06, [[0, 0], [0.09, 0.03], [0, 0.06]]);
}

// Door outline on the front (-y) wall.
export function door(g, x, y, w = 0.07, h = 0.12) {
  g.line([[x - w / 2, y, 0], [x - w / 2, y, h], [x + w / 2, y, h], [x + w / 2, y, 0]], { facing: [0, -1, 0] });
}

// Rectangle on the front (-y) wall.
export function panel(g, x0, x1, y, z0, z1) {
  g.line([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [x0, y, z0]], { facing: [0, -1, 0] });
}

// ----- housing estate props -----

// Carpet-beating rack: two posts and a bar.
export function carpetRack(g, x, y, alongX = g.chance(0.5)) {
  if (!g.isFree(x, y, 0.07)) return;
  const [dx, dy] = alongX ? [0.07, 0] : [0, 0.07];
  g.detailed(2, () => {
    g.solid(x, y, 0.05);
    g.line([[x - dx, y - dy, 0], [x - dx, y - dy, 0.09], [x + dx, y + dy, 0.09], [x + dx, y + dy, 0]]);
  });
}

// Clothes-drying frame: two T posts with lines between them.
export function dryingFrame(g, x, y, alongX = g.chance(0.5)) {
  if (!g.isFree(x, y, 0.1)) return;
  const [dx, dy] = alongX ? [0.1, 0] : [0, 0.1];
  const [px, py] = alongX ? [0, 0.03] : [0.03, 0];
  g.detailed(2, () => {
    g.solid(x, y, 0.04);
    for (const k of [-1, 1]) {
      const ex = x + dx * k, ey = y + dy * k;
      g.line([[ex, ey, 0], [ex, ey, 0.08]]);
      g.line([[ex - px, ey - py, 0.08], [ex + px, ey + py, 0.08]]);
    }
    for (const k of [-1, 0, 1]) g.line([[x - dx + px * k, y - dy + py * k, 0.08], [x + dx + px * k, y + dy + py * k, 0.08]]);
  });
}

// Sandpit with a low wooden edge.
export function sandpit(g, x, y) {
  if (!g.isFree(x, y, 0.09)) return;
  g.detailed(2, () => g.box(x - 0.07, y - 0.07, 0, 0.14, 0.14, 0.015));
}

// Climbing frame: the playground "rocket" / dome of bars.
export function climbingFrame(g, x, y) {
  if (!g.isFree(x, y, 0.07)) return;
  g.detailed(2, () => {
    g.solid(x, y, 0.06);
    const r = 0.06;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      const [cx, cy] = [Math.cos(a) * r, Math.sin(a) * r];
      g.line([[x - cx, y - cy, 0], [x - cx * 0.7, y - cy * 0.7, 0.07], [x, y, 0.1], [x + cx * 0.7, y + cy * 0.7, 0.07], [x + cx, y + cy, 0]]);
    }
  });
}
