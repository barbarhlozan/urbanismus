// Shadows drawn by pen – no lighting, just two marks a hand makes on the
// side turned away from the sun (shadows.html shows them beside the other
// ways tried):
//
//   scribble  on the ground: one zigzag stroke along the foot of each wall
//             turned away, its teeth pointing out along the sun, short.
//             Every wall standing on the ground leaves its foot
//             (Painter.feet: ends, height, outward normal); the renderer
//             keeps an object's feet and redraws only this stroke from them
//             (shadowSVG), so a sun that moves later on needs no repainting
//             of buildings.
//   strokes   on the wall itself: a few loose parallel strokes, leaning,
//             with ragged tops, thinning out across the wall from a seeded
//             end (wallStrokes, drawn by Painter._shade with the painter's
//             own wobble); the further the wall is turned away, the more of
//             them.
//
// Both are drawn in the secondary pen (--detail) and fade with the weather
// (--sun in styles.css). The wall strokes go by the roof hatching's density tiers
// (rh1…rh3), so the map thins them out with the roofs, building by
// building, as it zooms out.

import { rotateQuarter } from './camera.js';

const COS30 = Math.cos(Math.PI / 6);
const r2 = (n) => Math.round(n * 100) / 100;

// The sun and the pen:
//   on       draw shadows at all
//   fall     the way shadows fall on screen, in degrees clockwise from
//            screen right (90 = straight down). Fixed to the screen, as an
//            illustrator keeps the light over one shoulder: rotating the
//            view keeps shadows falling the same way on screen
//   length   a shadow's length on the ground per unit of height (1 = 45° sun)
//   low      walls lower than this (kerbs, benches, paving) get neither mark
// scribble (null: none):
//   from     how far a wall must turn away to get one (0 = side on to the
//            sun, 1 = straight away)
//   reach    how far the teeth reach out, as a share of the cast shadow's
//            length, but no further than `most` (grid units)
//   tooth    about this far apart along the wall (grid units)
// strokes (null: none):
//   from     as for the scribble; from `full` on the wall gets `most` of its
//            strokes, in between fewer
//   gap      between the strokes, in the wall's plane (grid units)
//   lean     their angle from level, in the wall's plane (degrees)
//   ragged   how unevenly their tops stop short (0 = all full height)
//   fade     how much they thin out across the wall (0 = not at all)
export const SUN = {
  on: true,
  fall: 150,
  length: 0.55,
  low: 0.08,
  scribble: { from: 0.1, reach: 0.35, most: 0.09, tooth: 0.07 },
  strokes: { from: 0.1, full: 0.6, most: 0.9, gap: 0.05, lean: 70, ragged: 0.8, fade: 0.9 },
};

// The density tier of hatch line k: every 8th (0), every 4th (1), every
// other (2), the rest (3) – the roof hatching's, see Renderer.atDetail.
export const tierOf = (k) => (k % 8 === 0 ? 0 : k % 4 === 0 ? 1 : k % 2 === 0 ? 2 : 3);

// The class of a stroke in tier n (`kind`: 'rh' for roofs and walls).
export const tierClass = (n, kind) => (n ? ` ${kind}${n}` : '');

// A direction on screen (degrees clockwise from right) as a unit direction
// on the ground, in world axes for a camera turned `rotation` quarters.
// The iso camera draws view axes (rx, ry) at screen ((rx - ry)·cos30,
// (rx + ry)·½); this is the inverse, then turned back to the world.
export function groundDir(deg, rotation = 0) {
  const a = (deg * Math.PI) / 180;
  const cx = Math.cos(a), cy = Math.sin(a);
  const k = cx / (2 * COS30);
  const [wx, wy] = rotateQuarter(cy + k, cy - k, -rotation);
  const l = Math.hypot(wx, wy) || 1;
  return [wx / l, wy / l];
}

// The sun for a camera: `cast` is the ground shift per unit of height.
export function sunFor(camera, sun = SUN) {
  const [fx, fy] = groundDir(sun.fall, camera.rotation ?? 0);
  return { ...sun, cast: [fx * sun.length, fy * sun.length] };
}

// How far a wall with outward world normal n (unit, horizontal) is turned
// away from the sun: 1 straight away, 0 side on, below 0 lit.
export function awayFrom([nx, ny], sun) {
  const [sx, sy] = sun.cast;
  return (nx * sx + ny * sy) / (Math.hypot(sx, sy) || 1);
}

// Deterministic noise in [0, 1) from two numbers.
export function hash(a, b) {
  let h = Math.imul(Math.round(a * 1000) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(b * 1000) | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// The feet that get a scribble: those turned away from the sun and tall
// enough, with how far it reaches (world units) and the sun's ground
// direction `c`.
export function shadedFeet(feet, sun) {
  const sc = sun.scribble;
  if (!sc) return [];
  const [sx, sy] = sun.cast;
  const l = Math.hypot(sx, sy) || 1;
  const c = [sx / l, sy / l];
  const out = [];
  for (const f of feet) {
    const away = awayFrom(f.n, sun);
    if (away <= sc.from || f.h < sun.low) continue;
    out.push({ ...f, away, reach: Math.min(sc.most, f.h * l * sc.reach), c });
  }
  return out;
}

// An object's scribbles as path data, one subpath per shaded foot: a
// zigzag along it, every other point out along the sun by a seeded share
// of the reach. shade = { feet, project } (Renderer.shadeOf); `project(x,
// y)`: a ground point -> scene px, with the object's relief and warp.
export function shadowPath({ feet = [], project }, sun) {
  if (!sun.on) return '';
  let d = '';
  for (const { a, b, reach, c } of shadedFeet(feet, sun)) {
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const teeth = Math.max(2, Math.round(Math.hypot(ex, ey) / sun.scribble.tooth));
    const pts = [];
    for (let i = 0; i <= teeth * 2; i++) {
      const t = 0.03 + (i / (teeth * 2)) * 0.94 + (hash(i, a[0]) - 0.5) * 0.02;
      const w = i % 2 ? reach * (0.55 + 0.45 * hash(i, a[1] + b[0])) : reach * 0.08 * hash(b[1], i);
      pts.push(project(a[0] + ex * t + c[0] * w, a[1] + ey * t + c[1] * w));
    }
    d += `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}`;
  }
  return d;
}

// An object's ground shadow as SVG markup.
export function shadowSVG(shade, sun) {
  const d = shadowPath(shade, sun);
  return d ? `<path d="${d}" class="shadow"/>` : '';
}

// How many of a wall's strokes to draw (0..1), from how far it is turned
// away from the sun (awayFrom).
export function strokeShare(away, sun) {
  const st = sun.strokes;
  if (!st || away <= st.from) return 0;
  return st.most * Math.min(1, (away - st.from) / Math.max(1e-6, st.full - st.from));
}

// The strokes on a wall, in its own plane: `flat` is the wall as a convex
// polygon [[u, w]…] (u along it, w up). Returns [[u0, w0], [u1, w1], k] per
// stroke (k its line, for tierOf): parallel lines `lean` from level and
// `gap` apart, `share` of them drawn; each starts just above the foot and
// stops short of the top by a seeded, ragged amount, more so towards the
// far end, and they thin out (`fade`) towards that end, which is seeded
// per wall.
export function wallStrokes(flat, { gap, lean, ragged, fade }, share = 1, seed = 0) {
  const a = (lean * Math.PI) / 180, d = [Math.cos(a), Math.sin(a)], n = [-Math.sin(a), Math.cos(a)];
  const tc = flat.map(([u, w]) => [u * d[0] + w * d[1], u * n[0] + w * n[1]]);
  const cs = tc.map((p) => p[1]);
  const back = (t, c) => [t * d[0] + c * n[0], t * d[1] + c * n[1]];
  const lines = [];
  for (let k = Math.ceil(Math.min(...cs) / gap); k * gap <= Math.max(...cs); k++) {
    const c = k * gap, ts = [];
    for (let i = 0; i < tc.length; i++) {
      const p = tc[i], q = tc[(i + 1) % tc.length];
      if ((p[1] - c) * (q[1] - c) > 0 || p[1] === q[1]) continue;
      ts.push(p[0] + ((c - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
    }
    if (ts.length >= 2) lines.push([k, Math.min(...ts), Math.max(...ts)]);
  }
  if (!lines.length) return [];
  const k0 = lines[0][0], k1 = lines[lines.length - 1][0];
  const flip = hash(seed, 3.7) < 0.5;
  const out = [];
  for (const [k, t0, t1] of lines) {
    if (hash(k, 0.5 + seed) >= share) continue;
    const x = k1 > k0 ? (flip ? k1 - k : k - k0) / (k1 - k0) : 0;
    if (hash(k + seed, 1.3) < fade * x ** 1.2) continue;
    const len = t1 - t0;
    if (len < gap * 0.8) continue;
    const s = t0 + len * (0.03 + 0.06 * hash(k, t0 + seed));
    const e = t1 - len * Math.min(0.8, ragged * (0.1 + 0.9 * x) * hash(t1 + seed, k) + 0.04);
    if (e - s < gap * 0.8) continue;
    out.push([back(s, k * gap), back(e, k * gap), k]);
  }
  return out;
}
