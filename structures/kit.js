// Small props shared by structure, park and surroundings drawings.
// Each prop starts its own depth-sorted solid, so props can be scattered
// freely around a building. Props skip themselves where a footpath (or road)
// is in the way (g.isFree), and small ones are drawn at detail level 2 so
// they disappear when zoomed out.

import { clipSegment, splitRuns } from '../src/core/geom2d.js';
import { drawTree, drawShrub, pickKind } from '../features/trees.js';
import { LOOK } from '../src/render/painter.js';

// A tree (features/trees.js), about half a grid step tall at size 1: any of
// the three kinds, or one given as `kind`.
export function tree(g, x, y, size = 1, kind = null) {
  if (!g.isFree(x, y, 0.07 * size)) return;
  const k = kind ?? pickKind(g);
  drawTree(g, x, y, k, (k === 'spruce' ? 0.56 : 0.5) * size);
}

// A low shrub (features/trees.js) about r * 4 tall; close-up detail only.
export function bush(g, x, y, r = 0.04) {
  if (!g.isFree(x, y, r)) return;
  g.detailed(2, () => drawShrub(g, x, y, r * 4));
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

// Street lamp, the Czechoslovak kind: a thick bullet-shaped foot, a thin
// pole, a flat disc of a shade on top. `h`: height to the shade.
export function lamp(g, x, y, h = 0.24) {
  if (!g.isFree(x, y, 0.03)) return;
  g.detailed(2, () => {
    g.lathe(x, y, 0, [[0.012, 0], [0.012, 0.04], [0.008, 0.052], [0.003, 0.056]], 8, { smooth: true });
    g.solid(x, y, h / 2);
    g.line([[x, y, 0.056], [x, y, h]]);
    g.lathe(x, y, h, [[0.03, 0], [0.03, 0.012]], 12, { smooth: true });
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

// A statue on a stone pedestal: a bronze figure drawn as a solid ink
// silhouette (see figure() below). kind: one of STATUES, or null for any
// of the single figures. Pedestals are stepped, with a plaque on the front.
export function statue(g, x, y, kind = null, size = 1) {
  if (!g.isFree(x, y, 0.07 * size)) return;
  kind ??= g.pick(['standing', 'worker', 'flag', 'mother', 'bust', 'standing']);
  const long = kind === 'equestrian' || kind === 'pair';
  const [w, d] = long ? [0.17 * size, 0.1 * size] : [0.08 * size, 0.08 * size];
  const ph = (kind === 'bust' ? 0.16 : 0.1) * size;
  g.box(x - w / 2 - 0.02, y - d / 2 - 0.02, 0, w + 0.04, d + 0.04, 0.02);
  g.box(x - w / 2, y - d / 2, 0.02, w, d, ph);
  g.detailed(2, () => g.line([[x - w * 0.3, y - d / 2, 0.02 + ph * 0.3], [x + w * 0.3, y - d / 2, 0.02 + ph * 0.3], [x + w * 0.3, y - d / 2, 0.02 + ph * 0.7], [x - w * 0.3, y - d / 2, 0.02 + ph * 0.7], [x - w * 0.3, y - d / 2, 0.02 + ph * 0.3]], { facing: [0, -1, 0] }));
  figure(g, x, y, 0.02 + ph, (kind === 'bust' ? 0.12 : kind === 'equestrian' ? 0.2 : 0.16) * size, kind);
}

export const STATUES = ['standing', 'worker', 'flag', 'soldier', 'mother', 'pair', 'bust', 'equestrian'];

// Outlines of the figures, in units of the figure's height (u right, v up
// from its feet). Drawn facing the screen, like trees and people.
const circle = (cu, cv, r, n = 12) => Array.from({ length: n }, (_, i) => [cu + Math.cos((i / n) * Math.PI * 2) * r, cv + Math.sin((i / n) * Math.PI * 2) * r]);
const FIG = {
  // a man in a long coat, legs a little apart
  man: [[-0.13, 0], [-0.03, 0], [0, 0.28], [0.03, 0], [0.13, 0], [0.15, 0.42], [0.19, 0.72], [0.16, 0.8],
    [0.07, 0.83], [0.05, 0.86], [-0.05, 0.86], [-0.07, 0.83], [-0.16, 0.8], [-0.19, 0.72], [-0.15, 0.42]],
  // a woman in a long skirt
  woman: [[-0.17, 0], [0.17, 0], [0.13, 0.48], [0.16, 0.74], [0.13, 0.8], [0.06, 0.83], [0.05, 0.86],
    [-0.05, 0.86], [-0.06, 0.83], [-0.13, 0.8], [-0.16, 0.74], [-0.13, 0.48]],
  child: [[-0.08, 0], [0.08, 0], [0.07, 0.32], [0.04, 0.36], [-0.04, 0.36], [-0.07, 0.32]],
  bust: [[-0.3, 0], [0.3, 0], [0.28, 0.22], [0.14, 0.34], [0.07, 0.36], [0.07, 0.44], [-0.07, 0.44], [-0.07, 0.36], [-0.14, 0.34], [-0.28, 0.22]],
  horse: [[-0.34, 0], [-0.3, 0], [-0.27, 0.3], [-0.16, 0.32], [-0.13, 0], [-0.09, 0], [-0.09, 0.33], [0.18, 0.33],
    [0.2, 0], [0.24, 0], [0.24, 0.33], [0.3, 0.36], [0.38, 0.1], [0.43, 0.12], [0.36, 0.42], [0.4, 0.62],
    [0.52, 0.72], [0.57, 0.68], [0.53, 0.8], [0.45, 0.86], [0.36, 0.8], [0.27, 0.6], [0.05, 0.6],
    [-0.2, 0.62], [-0.36, 0.58], [-0.45, 0.5], [-0.52, 0.3], [-0.44, 0.44], [-0.38, 0.36]],
  rider: [[-0.1, 0.56], [0.08, 0.56], [0.07, 0.8], [0.1, 0.9], [0.04, 0.95], [-0.06, 0.95], [-0.1, 0.88], [-0.08, 0.74]],
};

// A bronze figure standing at (x, y, z), h tall: ink silhouettes for the
// bodies, ink strokes for arms, tools and poles.
export function figure(g, x, y, z, h, kind = 'standing') {
  const v = h * g.camera.zScale; // screen units per figure height
  const ink = { cls: 'ink' };
  const pen = { stroke: 'main', width: Math.max(1, g.camera.tile * h * 0.05) };
  const body = (pts, du = 0, sc = 1) => g.shape(x, y, z, pts.map(([a, b]) => [(a * sc + du) * v, b * sc * v]), ink);
  const head = (du, dv, r = 0.075, sc = 1) => g.shape(x, y, z, circle(du * v, dv * sc * v, r * sc * v), ink);
  const stroke = (...lines) => g.strokes(x, y, z, lines.map((l) => l.map(([a, b]) => [a * v, b * v])), pen);
  g.solid(x, y, z + h / 2);
  switch (kind) {
    case 'worker':
      // raising a hammer
      body(FIG.man); head(0, 0.93);
      stroke([[0.15, 0.78], [0.28, 1.1]], [[0.24, 1.06], [0.34, 1.3]], [[0.27, 1.33], [0.42, 1.27]]);
      break;
    case 'flag':
      // carrying a flag on a long pole
      body(FIG.man); head(0, 0.93);
      stroke([[0.17, 0.05], [0.3, 1.5]], [[0.14, 0.76], [0.25, 0.95]]);
      g.shape(x, y, z, [[0.3, 1.5], [0.66, 1.42], [0.58, 1.3], [0.66, 1.17], [0.28, 1.25]].map(([a, b]) => [a * v, b * v]), ink);
      break;
    case 'soldier':
      // with a rifle over the shoulder
      body(FIG.man); head(0, 0.93, 0.08);
      stroke([[0.1, 0.55], [0.26, 1.15]]);
      break;
    case 'mother':
      body(FIG.woman); head(0, 0.93);
      body(FIG.child, 0.24); head(0.24, 0.43, 0.05);
      stroke([[0.12, 0.72], [0.22, 0.4]]);
      break;
    case 'pair':
      // a worker and a farm woman, arms raised together (hammer and sheaf)
      body(FIG.man, -0.17); head(-0.17, 0.93);
      body(FIG.woman, 0.17, 0.95); head(0.17, 0.93, 0.075, 0.95);
      stroke([[-0.05, 0.78], [0, 1.15]], [[0.05, 0.76], [0.02, 1.15]], [[-0.04, 1.2], [0.06, 1.2]]);
      g.shape(x, y, z, [[0.0, 1.15], [-0.08, 1.35], [0.02, 1.3], [0.1, 1.36]].map(([a, b]) => [a * v, b * v]), ink);
      break;
    case 'bust':
      body(FIG.bust); head(0, 0.6, 0.17);
      break;
    case 'equestrian':
      body(FIG.horse); body(FIG.rider); head(-0.01, 1.03, 0.065);
      stroke([[0.0, 0.6], [0.06, 0.4]], [[0.06, 0.88], [0.22, 1.2]]);
      break;
    default:
      // standing figure, one hand on the chest
      body(FIG.man); head(0, 0.93);
  }
}

// Paving: a grid of lines clipped to a polygon ([[x, y]…], e.g.
// g.site.outline), optionally with the outline. Grid lines sit on multiples
// of `step`, so neighbouring pavings line up. With LOOK.sketch the lines
// are broken into pencil strokes: about a third of the step-long pieces
// are left out, picked by their place on the map, so neighbouring pavings
// still agree.
export function paving(g, poly, step = 0.1, { dash = '1.5 2', outline = true, lod = 2 } = {}) {
  if (outline) g.groundPoly(poly);
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const keep = (x, y) => {
    const [wx, wy] = g.toWorld(x, y);
    return !LOOK.sketch || noise(wx, wy) > -0.35;
  };
  const draw = (seg) => {
    // leave the footpaths clear
    for (const run of splitRuns(seg, (p) => g.isFree(p[0], p[1], 0.02), 0.06)) {
      const [a, b] = [run[0], run[run.length - 1]];
      const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      let from = null;
      for (let i = 0; i <= n; i++) {
        const on = i < n && keep(...at((i + 0.5) / n));
        if (on && from === null) from = i;
        if (!on && from !== null) {
          g.groundLine([at(from / n), at(i / n)], { dash, lod });
          from = null;
        }
      }
    }
  };
  for (let x = Math.ceil(x0 / step) * step; x < x1; x += step) {
    for (const seg of clipSegment([x, y0 - 1], [x, y1 + 1], poly)) draw(seg);
  }
  for (let y = Math.ceil(y0 / step) * step; y < y1; y += step) {
    for (const seg of clipSegment([x0 - 1, y], [x1 + 1, y], poly)) draw(seg);
  }
}

// Noise in [-1, 1] from a map position (same place, same value).
function noise(x, y) {
  let h = Math.imul(Math.round(x * 1000) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(y * 1000) | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1;
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

// ----- works yard props -----

// A few oil drums standing together.
export function barrels(g, x, y) {
  if (!g.isFree(x, y, 0.06)) return;
  g.detailed(2, () => {
    for (const [dx, dy] of g.pick([[[0, 0], [0.045, 0.01], [0.02, 0.045]], [[0, 0], [0.045, 0]]])) {
      g.cylinder(x + dx - 0.02, y + dy - 0.02, 0, 0.02, 0.05, 6);
    }
  });
}

// Pile of logs or planks, lying along x or y.
export function timber(g, x, y, alongX = g.chance(0.5)) {
  if (!g.isFree(x, y, 0.09)) return;
  const [w, d] = alongX ? [0.18, 0.08] : [0.08, 0.18];
  g.detailed(2, () => {
    g.box(x - w / 2, y - d / 2, 0, w, d, 0.035);
    g.box(x - w / 2 + (alongX ? 0.02 : 0.01), y - d / 2 + (alongX ? 0.01 : 0.02), 0.035, w - (alongX ? 0.04 : 0.02), d - (alongX ? 0.02 : 0.04), 0.03);
    g.floors(x - w / 2, y - d / 2, w, d, 0, 0.035, 0.012, { inset: 0 });
  });
}

// Heap of coal or gravel.
export function heap(g, x, y, r = 0.08) {
  if (!g.isFree(x, y, r)) return;
  g.detailed(1, () => mound(g, x, y, r, r * 0.8));
}

// A mound drawn freehand: a smooth screen-facing outline with a few strokes
// down its flanks, r = radius on the ground, h = height. Heaps, spoil tips.
export function mound(g, x, y, r, h) {
  const w = g.camera.groundEllipse(r)[0] / g.camera.tile;
  g.solid(x, y, h / 3);
  g.shape(x, y, 0, [
    [-w, 0], [-w * 0.8, h * 0.3], [-w * 0.45, h * 0.85], [-w * 0.2, h], [w * 0.25, h * 0.97],
    [w * 0.5, h * 0.8], [w * 0.85, h * 0.25], [w, 0], [0, -w * 0.15],
  ], { smooth: true });
  g.detailed(1, () => g.strokes(x, y, 0, [
    [[-w * 0.35, h * 0.85], [-w * 0.6, h * 0.3]],
    [[w * 0.05, h * 0.9], [w * 0.1, h * 0.35]],
    [[w * 0.4, h * 0.75], [w * 0.65, h * 0.2]],
  ]));
}

// Upright tank on four legs.
export function tank(g, x, y, r = 0.06, h = 0.12) {
  if (!g.isFree(x, y, r)) return;
  g.detailed(1, () => {
    g.solid(x, y, 0.02);
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.line([[x + dx * r * 0.6, y + dy * r * 0.6, 0], [x + dx * r * 0.6, y + dy * r * 0.6, 0.05]]);
    g.lathe(x, y, 0.05, [[r * 0.3, 0], [r, r * 0.4], [r, h], [r * 0.5, h + r * 0.35], [0, h + r * 0.4]], 8);
  });
}

// Transformer: a squat box with insulators on top.
export function transformer(g, x, y) {
  if (!g.isFree(x, y, 0.06)) return;
  g.detailed(2, () => {
    g.box(x - 0.04, y - 0.03, 0, 0.08, 0.06, 0.06);
    for (const dx of [-0.025, 0, 0.025]) g.line([[x + dx, y, 0.06], [x + dx, y, 0.09]]);
  });
}

// Gantry crane: two A-frame legs and a beam from a to b (2D points).
export function gantry(g, a, b, h = 0.3) {
  const [ax, ay] = a, [bx, by] = b;
  const len = Math.hypot(bx - ax, by - ay);
  const px = (-(by - ay) / len) * 0.05, py = ((bx - ax) / len) * 0.05;
  g.detailed(1, () => {
    g.solid((ax + bx) / 2, (ay + by) / 2, h);
    for (const [x, y] of [a, b]) g.line([[x - px, y - py, 0], [x, y, h], [x + px, y + py, 0]]);
    g.line([[ax, ay, h], [bx, by, h]]);
    g.line([[ax, ay, h - 0.025], [bx, by, h - 0.025]]);
    const t = 0.4;
    const cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t;
    g.line([[cx, cy, h - 0.025], [cx, cy, h * 0.55]]);
  });
}

// Pipe bridge between two points (2D) at height h, on posts.
export function pipes(g, a, b, h = 0.14) {
  const [ax, ay] = a, [bx, by] = b;
  const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 0.25));
  g.detailed(1, () => {
    g.solid((ax + bx) / 2, (ay + by) / 2, h / 2);
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n, y = ay + ((by - ay) * i) / n;
      g.line([[x, y, 0], [x, y, h]]);
    }
    g.line([[ax, ay, h], [bx, by, h]]);
    g.line([[ax, ay, h + 0.02], [bx, by, h + 0.02]]);
  });
}

// ----- park props -----

// Swing set: an A-frame each end, a bar and two seats.
export function swings(g, x, y, alongX = g.chance(0.5)) {
  if (!g.isFree(x, y, 0.09)) return;
  const [dx, dy] = alongX ? [0.08, 0] : [0, 0.08];
  const [px, py] = alongX ? [0, 0.035] : [0.035, 0];
  const h = 0.11;
  g.detailed(2, () => {
    g.solid(x, y, h / 2);
    for (const k of [-1, 1]) g.line([[x + dx * k - px, y + dy * k - py, 0], [x + dx * k, y + dy * k, h], [x + dx * k + px, y + dy * k + py, 0]]);
    g.line([[x - dx, y - dy, h], [x + dx, y + dy, h]]);
    for (const k of [-0.4, 0.4]) g.line([[x + dx * k, y + dy * k, h], [x + dx * k, y + dy * k, 0.03]]);
  });
}

// Slide: a ladder up and a chute down.
export function slide(g, x, y, alongX = g.chance(0.5)) {
  if (!g.isFree(x, y, 0.09)) return;
  const [dx, dy] = alongX ? [0.08, 0] : [0, 0.08];
  g.detailed(2, () => {
    g.solid(x, y, 0.05);
    g.line([[x - dx, y - dy, 0], [x - dx * 0.5, y - dy * 0.5, 0.1], [x + dx, y + dy, 0.01]]);
    g.line([[x - dx * 0.5, y - dy * 0.5, 0], [x - dx * 0.5, y - dy * 0.5, 0.1]]);
  });
}

// Seesaw.
export function seesaw(g, x, y, alongX = g.chance(0.5)) {
  if (!g.isFree(x, y, 0.08)) return;
  const [dx, dy] = alongX ? [0.08, 0] : [0, 0.08];
  g.detailed(2, () => {
    g.solid(x, y, 0.02);
    g.line([[x, y, 0], [x, y, 0.03]]);
    g.line([[x - dx, y - dy, 0.005], [x + dx, y + dy, 0.05]]);
  });
}

// A playground: sandpit and one to three pieces around it.
export function playground(g, x, y, r = 0.2) {
  g.groundCircle(x, y, r, { dash: '1 2', lod: 1 });
  const pieces = [swings, slide, seesaw, climbingFrame];
  sandpit(g, x, y);
  const n = g.int(1, 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + g.range(0, 1);
    g.pick(pieces)(g, x + Math.cos(a) * r * 0.65, y + Math.sin(a) * r * 0.65);
  }
}

// Bandstand / gazebo: a round floor, posts and a domed roof.
export function bandstand(g, x, y, r = 0.1) {
  if (!g.isFree(x, y, r)) return;
  g.cylinder(x, y, 0, r, 0.02, 8);
  g.detailed(1, () => {
    g.solid(x, y, 0.06);
    for (let i = 0; i < 8; i += 2) {
      const a = (i / 8) * Math.PI * 2;
      g.line([[x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85, 0.02], [x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85, 0.11]]);
    }
  });
  g.lathe(x, y, 0.11, [[r * 1.08, 0], [r * 0.9, 0.03], [r * 0.4, 0.07], [0.012, 0.09], [0, 0.12]], 8);
}

// Round flower bed with a few blooms.
export function flowerBed(g, x, y, r = 0.08) {
  if (!g.isFree(x, y, r)) return;
  g.groundCircle(x, y, r, { lod: 1 });
  g.groundCircle(x, y, r * 0.6, { dash: '1 1.5', lod: 2 });
  bush(g, x, y, 0.025);
}

// Obelisk / war memorial on a stepped base.
export function obelisk(g, x, y, h = 0.3) {
  if (!g.isFree(x, y, 0.07)) return;
  g.box(x - 0.06, y - 0.06, 0, 0.12, 0.12, 0.03);
  g.lathe(x, y, 0.03, [[0.042, 0], [0.028, h], [0, h + 0.04]], 4, { phase: 0.5 });
}

// Abstract concrete sculpture: stacked slabs at angles.
export function sculpture(g, x, y) {
  if (!g.isFree(x, y, 0.06)) return;
  g.box(x - 0.04, y - 0.015, 0, 0.08, 0.03, 0.08);
  g.box(x - 0.015, y - 0.05, 0.08, 0.03, 0.1, 0.05);
}

// Bicycle stands: a row of hoops from x0 to x1 along y.
export function bikeRack(g, x0, x1, y) {
  if (!g.isFree((x0 + x1) / 2, y, 0.05)) return;
  g.detailed(1, () => {
    g.solid((x0 + x1) / 2, y, 0.03);
    for (let x = x0; x <= x1 + 1e-6; x += 0.05) g.line([[x, y - 0.02, 0], [x, y - 0.02, 0.05], [x, y + 0.02, 0.05], [x, y + 0.02, 0]]);
  });
}

// Ice-cream / snack kiosk.
export function kiosk(g, x, y) {
  if (!g.isFree(x, y, 0.07)) return;
  g.box(x - 0.05, y - 0.04, 0, 0.1, 0.08, 0.08);
  g.box(x - 0.065, y - 0.06, 0.08, 0.13, 0.11, 0.015);
  g.detailed(2, () => g.line([[x - 0.035, y - 0.04, 0.035], [x + 0.035, y - 0.04, 0.035], [x + 0.035, y - 0.04, 0.07], [x - 0.035, y - 0.04, 0.07], [x - 0.035, y - 0.04, 0.035]], { facing: [0, -1, 0] }));
}

// Outdoor chess / table with two stools.
export function chessTable(g, x, y) {
  if (!g.isFree(x, y, 0.06)) return;
  g.detailed(2, () => {
    g.box(x - 0.025, y - 0.025, 0, 0.05, 0.05, 0.04);
    for (const k of [-1, 1]) g.cylinder(x + k * 0.05, y, 0, 0.012, 0.025, 5);
  });
}

// Spa colonnade: a row of columns under a flat roof, from a to b along x at depth y.
export function colonnade(g, x0, x1, y, d = 0.14, h = 0.16) {
  g.box(x0, y - d / 2, h, x1 - x0, d, 0.025);
  g.detailed(1, () => {
    g.solid((x0 + x1) / 2, y, h / 2);
    const n = Math.max(2, Math.round((x1 - x0) / 0.08));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      for (const k of [-0.4, 0.4]) g.line([[x, y + d * k, 0], [x, y + d * k, h]]);
    }
  });
}

// Wooden footbridge (ground drawing) from a to b.
export function footbridge(g, a, b, w = 0.05) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const px = (-(b[1] - a[1]) / len) * w, py = ((b[0] - a[0]) / len) * w;
  g.groundPoly([[a[0] - px, a[1] - py], [b[0] - px, b[1] - py], [b[0] + px, b[1] + py], [a[0] + px, a[1] + py]], { fill: 'bg' });
  g.detailed(2, () => {
    g.solid((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.02);
    for (const k of [-1, 1]) g.line([[a[0] + px * k, a[1] + py * k, 0.03], [b[0] + px * k, b[1] + py * k, 0.03]]);
  });
}

// Line style for the main members of steel and timber frames (headframes,
// masts, floodlights): the outline pen, not the pale detail colour.
export const FRAME = { stroke: 'main', width: 1.1 };

// Five-pointed star, facing the screen.
export function star(g, x, y, z, r = 0.04) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? 0.45 : 1;
    pts.push([Math.cos(a) * r * k, Math.sin(a) * r * k]);
  }
  g.shape(x, y, z, pts);
}

// ----- street furniture of the 60s–80s (squares, precincts) -----

// Concrete planter: a low box (or a hexagon) with a shrub in it.
export function planter(g, x, y, s = 0.05) {
  if (!g.isFree(x, y, s)) return;
  if (g.chance(0.5)) g.box(x - s, y - s, 0, 2 * s, 2 * s, 0.03);
  else g.cylinder(x, y, 0, s * 1.1, 0.03, 6);
  bush(g, x, y, s * 0.6);
}

// Street clock: a post with a round double-sided face on top.
export function streetClock(g, x, y, h = 0.2) {
  if (!g.isFree(x, y, 0.03)) return;
  const r = 0.028;
  g.detailed(1, () => {
    g.solid(x, y, h / 2);
    g.line([[x, y, 0], [x, y, h - r]]);
    g.line(Array.from({ length: 13 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return [x + Math.cos(a) * r, y, h + Math.sin(a) * r];
    }));
  });
}

// Phone booth: a tall narrow glazed box with a flat cap.
export function phoneBooth(g, x, y) {
  if (!g.isFree(x, y, 0.03)) return;
  g.detailed(1, () => {
    g.box(x - 0.022, y - 0.022, 0, 0.044, 0.044, 0.11);
    g.line([[x - 0.012, y - 0.022, 0.02], [x - 0.012, y - 0.022, 0.09], [x + 0.012, y - 0.022, 0.09], [x + 0.012, y - 0.022, 0.02]], { facing: [0, -1, 0] });
  });
}

// Newspaper kiosk (PNS): a hexagonal booth under a wide hexagonal roof.
export function newsKiosk(g, x, y) {
  if (!g.isFree(x, y, 0.08)) return;
  g.cylinder(x, y, 0, 0.055, 0.1, 6);
  g.detailed(2, () => g.line([[x - 0.035, y - 0.048, 0.035], [x + 0.035, y - 0.048, 0.035], [x + 0.035, y - 0.048, 0.08], [x - 0.035, y - 0.048, 0.08], [x - 0.035, y - 0.048, 0.035]], { facing: [0, -1, 0] }));
  g.lathe(x, y, 0.1, [[0.08, 0], [0.08, 0.014], [0.025, 0.036], [0, 0.042]], 6);
}

// Noticeboard: two posts, a board and a little roof over it.
export function noticeboard(g, x, y, alongX = true) {
  if (!g.isFree(x, y, 0.05)) return;
  const [dx, dy] = alongX ? [0.045, 0] : [0, 0.045];
  g.detailed(2, () => {
    g.solid(x, y, 0.05);
    for (const k of [-1, 1]) g.line([[x + dx * k, y + dy * k, 0], [x + dx * k, y + dy * k, 0.1]]);
    g.line([[x - dx, y - dy, 0.04], [x + dx, y + dy, 0.04], [x + dx, y + dy, 0.09], [x - dx, y - dy, 0.09], [x - dx, y - dy, 0.04]]);
    g.line([[x - dx * 1.2, y - dy * 1.2, 0.1], [x + dx * 1.2, y + dy * 1.2, 0.1]]);
  });
}

// Floodlight mast: a lattice leg narrowing upwards, a bank of lamps on top
// facing `face` (2D direction the lamps look).
export function floodlight(g, x, y, h = 0.7, face = [1, 1]) {
  const b = 0.03 + h * 0.015, t = 0.018;
  const len = Math.hypot(face[0], face[1]);
  const [fx, fy] = [face[0] / len, face[1] / len];
  g.detailed(1, () => {
    g.solid(x, y, h / 2);
    const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sy] of legs) g.line([[x + sx * b, y + sy * b, 0], [x + sx * t, y + sy * t, h]], FRAME);
    g.detailed(2, () => {
      // cross bracing on two sides, zig-zag up the mast
      const n = 6;
      for (const [a, c] of [[legs[0], legs[1]], [legs[1], legs[2]]]) {
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const k = i / n, r = b + (t - b) * k, s = i % 2 ? c : a;
          pts.push([x + s[0] * r, y + s[1] * r, h * k]);
        }
        g.line(pts);
      }
    });
    // the lamp bank: a block on top, leaning out towards the pitch
    const [cx, cy] = [x + fx * 0.02, y + fy * 0.02];
    g.box(cx - 0.05, cy - 0.05, h - 0.02, 0.1, 0.1, 0.07);
  });
}

// Football pitch marked on the ground from (x0, y0) to (x1, y1), its length
// along the longer side: outline, halfway line, centre circle, penalty
// boxes, and a goal frame at each end.
export function pitch(g, x0, y0, x1, y1) {
  const alongX = x1 - x0 >= y1 - y0;
  const P = alongX ? (u, v) => [x0 + u, y0 + v] : (u, v) => [x0 + v, y0 + u];
  const L = alongX ? x1 - x0 : y1 - y0, W = alongX ? y1 - y0 : x1 - x0;
  const box = (u0, u1, v0, v1) => [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
  g.groundPoly(box(0, L, 0, W));
  g.groundLine([P(L / 2, 0), P(L / 2, W)]);
  g.groundCircle(...P(L / 2, W / 2), Math.min(W * 0.16, 0.08), { lod: 1 });
  const bd = L * 0.14, bw = W * 0.55;
  g.groundPoly(box(0, bd, (W - bw) / 2, (W + bw) / 2), { lod: 1 });
  g.groundPoly(box(L - bd, L, (W - bw) / 2, (W + bw) / 2), { lod: 1 });
  const gw = Math.min(W * 0.18, 0.08), h = 0.035;
  g.detailed(2, () => {
    for (const u of [0, L]) {
      const [a, b] = [P(u, (W - gw) / 2), P(u, (W + gw) / 2)];
      g.solid((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, h / 2);
      g.line([[...a, 0], [...a, h], [...b, h], [...b, 0]]);
    }
  });
}

// A sloping enclosed bridge (conveyor gallery) from a to b ([x, y, z],
// bottom middle of each end), w wide and h tall.
export function gallery(g, a, b, w = 0.05, h = 0.05) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const px = (-(b[1] - a[1]) / len) * (w / 2), py = ((b[0] - a[0]) / len) * (w / 2);
  const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + h / 2];
  const at = (e, k, up) => [e[0] + px * k, e[1] + py * k, e[2] + (up ? h : 0)];
  const A = [at(a, -1, 0), at(a, 1, 0), at(a, 1, 1), at(a, -1, 1)];
  const B = [at(b, -1, 0), at(b, 1, 0), at(b, 1, 1), at(b, -1, 1)];
  g.solid(...c);
  const faces = [A, B, [A[0], A[1], B[1], B[0]], [A[3], A[2], B[2], B[3]], [A[0], A[3], B[3], B[0]], [A[1], A[2], B[2], B[1]]];
  for (const f of faces) g.face(outward(f, c));
}

// Order a planar polygon counter-clockwise as seen from outside, away from
// the point `c` inside the solid.
export function outward(pts, c) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0, z0] = pts[i], [x1, y1, z1] = pts[(i + 1) % pts.length];
    nx += (y0 - y1) * (z0 + z1);
    ny += (z0 - z1) * (x0 + x1);
    nz += (x0 - x1) * (y0 + y1);
  }
  const m = pts.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => v / pts.length);
  const dot = nx * (m[0] - c[0]) + ny * (m[1] - c[1]) + nz * (m[2] - c[2]);
  return dot >= 0 ? pts : [...pts].reverse();
}

// Farm tractor, facing along x (or y), about as long as a car: a bonnet,
// a cab, big back wheels and small front ones.
export function tractor(g, x, y, alongX = g.chance(0.5)) {
  if (!g.isFree(x, y, 0.08)) return;
  const [ux, uy] = alongX ? [1, 0] : [0, 1];
  const [vx, vy] = [-uy, ux];
  // box in the tractor's own frame: u forward, v to the left
  const box = (u0, u1, v0, v1, z0, z1) => g.box(
    x + Math.min(u0 * ux + v0 * vx, u1 * ux + v1 * vx), y + Math.min(u0 * uy + v0 * vy, u1 * uy + v1 * vy), z0,
    Math.abs((u1 - u0) * ux + (v1 - v0) * vx), Math.abs((u1 - u0) * uy + (v1 - v0) * vy), z1 - z0);
  const wheel = (u, v, r) => {
    const cx = x + u * ux + v * vx, cy = y + u * uy + v * vy;
    g.line(Array.from({ length: 13 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return [cx + Math.cos(a) * r * ux, cy + Math.cos(a) * r * uy, r + Math.sin(a) * r];
    }), FRAME);
  };
  g.detailed(2, () => {
    box(-0.05, 0.065, -0.018, 0.018, 0.02, 0.035);   // chassis
    box(0.0, 0.065, -0.02, 0.02, 0.035, 0.06);       // bonnet
    box(-0.06, -0.005, -0.027, 0.027, 0.035, 0.105); // cab
    for (const v of [-0.04, 0.04]) wheel(-0.035, v, 0.035);
    for (const v of [-0.032, 0.032]) wheel(0.045, v, 0.02);
  });
}

// Haystack: a rounded stack.
export function haystack(g, x, y, r = 0.06) {
  if (!g.isFree(x, y, r)) return;
  g.detailed(1, () => mound(g, x, y, r, r * 1.6));
}

// ----- round bodies (towers, silos): details on a curved wall -----

// Small windows on a round wall of radius r round (x, y): n around, a row
// every `step` from z0 to z1, each row turned half a bay from the one
// below. Ink blocks (or outlines) like g.windows, hidden when round the back.
export function roundWindows(g, x, y, r, z0, z1, step, n, { w = 0.025, h = 0.05, phase = 0 } = {}) {
  const cls = LOOK.ink ? 'ink' : undefined;
  const da = w / 2 / r;
  let row = 0;
  for (let z = z0; z + h <= z1 + 1e-6; z += step, row++) {
    for (let k = 0; k < n; k++) {
      const a = ((k + phase + (row % 2) * 0.5) / n) * Math.PI * 2;
      const p = (t, zz) => [x + Math.cos(a + t) * r * 1.002, y + Math.sin(a + t) * r * 1.002, zz];
      g.line([p(-da, z), p(da, z), p(da, z + h), p(-da, z + h), p(-da, z)], { facing: [Math.cos(a), Math.sin(a), 0], cls });
    }
  }
}

// Hoops round a silo or a tank: the near half of a ring at each height.
export function hoops(g, x, y, r, zs) {
  g.detailed(2, () => {
    for (const z of zs) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, b = ((k + 1) / 16) * Math.PI * 2, m = (a + b) / 2;
        g.line([[x + Math.cos(a) * r, y + Math.sin(a) * r, z], [x + Math.cos(b) * r, y + Math.sin(b) * r, z]], { facing: [Math.cos(m), Math.sin(m), 0] });
      }
    }
  });
}
