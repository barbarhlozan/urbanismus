// Shadows drawn by pen – no lighting, just geometry. Three ground styles
// (SUN.ground), all from what the painter leaves behind as it draws:
//
//   cast      the whole shadow on the ground. Every face (and any explicit
//             caster, Painter.cast) leaves its world points (Painter.casts);
//             its shadow is the hull of them and the same points slid along
//             the sun by their height, and a building's is the union of its
//             faces', hatched on parallel screen lines (SUN.angle,
//             SUN.spacing). Overlapping hulls share strokes; the part under
//             the building is hidden by it.
//   hatch     a contact shadow, as in a quick ink sketch: flat dashes along
//             the foot of each wall turned away from the sun, in rows
//             stepping out along the sun, thinning out and getting shorter
//             as they go. Every wall standing on the ground leaves its foot
//             (Painter.feet: ends, height, outward normal).
//   scribble  the same reach as one zigzag pen line per such wall, its
//             teeth pointing away along the sun.
//
// The ground strokes lie flat (along the walls' feet, or the cast lines),
// and the walls' own shading leans another way (SUN.wallAngle), so the eye
// can tell what is on the ground and what stands up.
//
// Walls turned away from the sun are shaded inside the drawing
// (Painter._shade): a nearer building must cover them like its walls. Under
// the eaves of pitched roofs a short band of the same strokes runs along
// the lit walls too (Painter._eaveBand).
//
// Density: zoomed out the hatching gets sparser rather than turning into a
// grey smudge or vanishing. Stroke lines (and rows) come in tiers – every
// 8th (tier 0), every 4th (1), every other (2), the rest (3) – each tagged
// with its class: s1…s3 on the ground, w1…w3 on walls. The renderer shows
// the tiers that keep strokes at least SUN.gap screen px apart, for the
// ground and the walls each by their own spacing (classes sz-N and sw-N on
// the map, tierAt; styles.css). Wall shading also hides with the facade
// detail when far (d1).
//
// Shadows on the ground are kept apart from the drawing on purpose: the
// renderer keeps each object's casters and feet and redraws only its
// shadow from them (shadowSVG), so a sun that moves later on needs no
// repainting of buildings.

import { rotateQuarter } from './camera.js';

const COS30 = Math.cos(Math.PI / 6);
const r2 = (n) => Math.round(n * 100) / 100;

// The sun and the pen:
//   on       draw shadows at all
//   fall     the way shadows fall on screen, in degrees clockwise from
//            screen right (90 = straight down). Fixed to the screen, as an
//            illustrator keeps the light over one shoulder: rotating the
//            view keeps shadows falling the same way on screen
//   length   shadow length on the ground per unit of height (1 = 45° sun)
//   ground   'cast', 'hatch', 'scribble' (see above), 'tone' (one flat
//            shape, no strokes) or 'none'
//   low      faces lower than this (paving, lawns) cast nothing
//   gap      screen px the strokes keep apart at the least, as tiers drop out
//   drift    how far a stroke bows off its line, grid units of the map's
//            scale (scene px / tile)
// cast:
//   spacing  between the stroke lines, across them on screen, grid units
//   angle    the strokes' direction on screen, degrees clockwise from right
//   trim     strokes stop short of the outline by up to this share of their
//            length at each end, seeded, as a hand does
// hatch and scribble (contact shadows):
//   reach    how far they reach out, as a share of the cast shadow's length
//   rowGap   grid units between the rows of dashes (hatch) / the teeth of the
//            zigzag along the wall (scribble)
//   fade     how fast the rows thin out and shorten away from the wall
//            (0 = not at all)
// walls:
//   walls    shade walls turned away from the sun: true – hatched
//            (Painter._shade), 'tone' – just filled a shade darker
//            (styles.css .shade-1 / .shade-2, no strokes), false – not
//   wallAngle the strokes' direction on screen (a steep lean, apart from
//            the ground's)
//   wallSpacing between the stroke lines, across them on screen, grid units
//   wallFrom how far a wall must turn away before it is shaded (0 = side
//            on to the sun, 1 = straight away); it is shaded fully from
//            wallFull on, and in between only some of its strokes are drawn
//   wallFull
//   wallTrim strokes stop short of the wall's foot by up to this share
//   wallLoose how sketchy the wall shading is, 0..1: strokes stop at uneven
//            heights (ragged tops), each a little off in angle and spacing,
//            and the shading thins out across the wall from one end
//            (which end is seeded per wall) instead of filling it
//   eaveBand under the eaves of pitched roofs, a band of strokes this high
//            (grid units) along the lit walls too (0 = none)
//   photoGap in photo mode (a perspective camera: no one scale, no zoom
//            tiers) strokes are this many px apart on the picture, as a pen
//            spaces them on paper
export const SUN = {
  on: true,
  fall: 150,
  length: 0.55,
  ground: 'none',
  low: 0.03,
  gap: 2.6,
  drift: 0.002,
  spacing: 0.2,
  angle: -45,
  trim: 0.12,
  reach: 0.8,
  rowGap: 0.012,
  fade: 1,
  walls: 'tone',
  wallAngle: -68,
  wallSpacing: 0.004,
  wallFrom: 0.1,
  wallFull: 0.6,
  wallTrim: 0.08,
  wallLoose: 0.7,
  eaveBand: 0.07,
  photoGap: 3.2,
};

// The density tier of hatch line or row k (see above).
export const tierOf = (k) => (k % 8 === 0 ? 0 : k % 4 === 0 ? 1 : k % 2 === 0 ? 2 : 3);

// The spacing (grid units on screen) of the ground's strokes in the style
// drawn – rows lie flat, about half as far apart on screen as on the
// ground – and of the walls'.
export const groundSpacing = (sun = SUN) => (sun.ground === 'cast' ? sun.spacing : sun.rowGap * 0.5);
export const wallSpacing = (sun = SUN) => sun.wallSpacing;

// The densest tier to show at a zoom (scene px per grid unit = tile · zoom)
// for strokes `spacing` apart: the most that keeps them SUN.gap apart (tier
// 0, every 8th, always shows).
export function tierAt(pxPerUnit, spacing, sun = SUN) {
  for (let n = 3; n > 0; n--) if (spacing * pxPerUnit * 2 ** (3 - n) >= sun.gap) return n;
  return 0;
}

// The class of a stroke in tier n: on the ground (s) or on a wall (w).
export const tierClass = (n, kind = 's') => (n ? ` ${kind}${n}` : '');

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

// Parallel lines across the screen: along `dir`, `gap` scene px apart
// along `normal`, bowing by up to `bow` scene px.
function lines(deg, gap, bow) {
  const a = (deg * Math.PI) / 180;
  return { dir: [Math.cos(a), Math.sin(a)], normal: [-Math.sin(a), Math.cos(a)], gap, bow };
}

// The sun for a camera: `cast` is the ground shift per unit of height; the
// cast shadow's stroke lines are spread in (dir, normal, gap, bow), the
// walls' in `wall`. On the map strokes are spaced in the map's units (and
// thinned by zoom tiers); through a perspective camera (photo mode) on the
// picture itself, SUN.photoGap px apart near or far.
export function sunFor(camera, sun = SUN) {
  const [fx, fy] = groundDir(sun.fall, camera.rotation ?? 0);
  const t = camera.tile ?? 32;
  const gap = (spacing) => (camera.perspective ? sun.photoGap : spacing * t);
  return {
    ...sun,
    ...lines(sun.angle, gap(sun.spacing), sun.drift * t),
    cast: [fx * sun.length, fy * sun.length],
    wall: lines(sun.wallAngle, gap(sun.wallSpacing), sun.drift * t),
  };
}

// How far a wall with outward world normal n (unit, horizontal) is turned
// away from the sun: 1 straight away, 0 side on, below 0 lit.
export function awayFrom([nx, ny], sun) {
  const [sx, sy] = sun.cast;
  return (nx * sx + ny * sy) / (Math.hypot(sx, sy) || 1);
}

// The share of a wall's strokes drawn (0..1), from awayFrom.
export function shadeShare(away, sun) {
  if (away <= sun.wallFrom) return 0;
  return Math.min(1, (away - sun.wallFrom) / Math.max(1e-6, sun.wallFull - sun.wallFrom));
}

// Convex hull (monotone chain) of 2D points, counter-clockwise.
function hull(pts) {
  if (pts.length < 3) return pts;
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Deterministic noise in [0, 1) from two numbers.
export function hash(a, b) {
  let h = Math.imul(Math.round(a * 1000) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(b * 1000) | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// The shadow on the ground of casters (each a list of world [x, y, h], h
// the height above the object's ground): a convex hull (world [x, y]) per
// caster.
export function shadowHulls(casts, sun) {
  const { cast: [sx, sy], low } = sun;
  const out = [];
  for (const pts of casts) {
    let top = 0;
    for (const p of pts) top = Math.max(top, p[2]);
    if (top < low) continue;
    const ground = [];
    for (const [x, y, h] of pts) ground.push([x, y], [x + h * sx, y + h * sy]);
    const poly = hull(ground);
    if (poly.length >= 3) out.push(poly);
  }
  return out;
}

// Polygons on screen (scene px) hatched with parallel lines (`at`: dir,
// normal, gap): a list of [k, t0, t1] – on line k (k·gap along the normal),
// from t0 to t1 along it – where the lines cross any of them (taken as
// convex).
export function hatchLines(polys, at) {
  const { dir: [dx, dy], normal: [nx, ny], gap } = at;
  const lines = new Map(); // line index -> [[t0, t1]…]
  for (const pts of polys) {
    const poly = pts.map(([x, y]) => [x * dx + y * dy, x * nx + y * ny]); // [t along, u across]
    let u0 = Infinity, u1 = -Infinity;
    for (const [, u] of poly) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); }
    for (let k = Math.ceil(u0 / gap); k * gap <= u1; k++) {
      const u = k * gap;
      let t0 = Infinity, t1 = -Infinity;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if ((a[1] - u) * (b[1] - u) > 0 || a[1] === b[1]) continue;
        const t = a[0] + ((u - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
        t0 = Math.min(t0, t); t1 = Math.max(t1, t);
      }
      if (t1 - t0 < 1e-6) continue;
      if (!lines.has(k)) lines.set(k, []);
      lines.get(k).push([t0, t1]);
    }
  }
  // the union along each line
  const out = [];
  for (const [k, spans] of lines) {
    spans.sort((a, b) => a[0] - b[0]);
    let [s0, s1] = spans[0];
    for (let i = 1; i <= spans.length; i++) {
      const next = spans[i];
      if (next && next[0] <= s1 + gap * 0.2) { s1 = Math.max(s1, next[1]); continue; }
      out.push([k, s0, s1]);
      if (next) [s0, s1] = next;
    }
  }
  return out;
}

// One stroke on line k (of `at`) from t0 to t1 as path data: trimmed at its
// ends by a seeded share (up to `trim`) and bowed a little. Empty when too
// short.
export function stroke(k, t0, t1, at, trim, salt = 0) {
  const { dir: [dx, dy], normal: [nx, ny], gap, bow } = at;
  const len = t1 - t0;
  if (len < gap * 0.6) return '';
  const a = t0 + len * trim * hash(k + salt, t0);
  const b = t1 - len * trim * hash(t1, k - salt);
  const off = (hash(k + t1, t0 + salt) - 0.5) * 2 * Math.min(bow, len * 0.05);
  const u = k * gap;
  const pt = (t, w) => [t * dx + w * nx, t * dy + w * ny];
  const [p, m, q] = [pt(a, u), pt((a + b) / 2, u + off * 2), pt(b, u)];
  return `M${r2(p[0])} ${r2(p[1])}Q${r2(m[0])} ${r2(m[1])} ${r2(q[0])} ${r2(q[1])}`;
}

// Shading strokes over a polygon on screen (a wall), on the lines of `at`,
// drawn more loosely than the ground's (SUN.wallLoose): each stroke stops
// short of the foot by up to `trim` and of the top by a seeded, often much
// larger share; leans a few degrees off and sits a little off its line; and
// the strokes thin out across the polygon from a seeded end (`fade`: how
// much, 0 = even). `share` of the lines are drawn at all. Path data per
// density tier.
//   hang: shading hangs from the top (under the eaves) – the ragged end is
//   the foot instead.
export function wallHatch(poly, at, { share = 1, trim = 0, loose = 0, fade = loose, seed = 0, hang = false } = {}) {
  const d = ['', '', '', ''];
  const found = hatchLines([poly], at);
  if (!found.length) return d;
  const { dir: [dx, dy], normal: [nx, ny], gap, bow } = at;
  let k0 = Infinity, k1 = -Infinity;
  for (const [k] of found) { k0 = Math.min(k0, k); k1 = Math.max(k1, k); }
  const flip = hash(seed, 3.7) < 0.5;
  for (const [k, t0, t1] of found) {
    if (hash(k, 0.5 + seed) >= share) continue;
    // thinning out across the wall: 0 at the dense end, 1 at the other
    const f = k1 > k0 ? (flip ? k1 - k : k - k0) / (k1 - k0) : 0;
    if (hash(k + seed, 1.3) < fade * f ** 1.3) continue;
    const len = t1 - t0;
    if (len < gap * 0.6) continue;
    // `dir` points up the wall on screen (t grows upwards): t1 is the top
    let a = t0 + len * trim * hash(k, t0 + seed);
    const top = trim + loose * (0.15 + 0.6 * f) * hash(t1 + seed, k);
    let b = t1 - len * Math.min(0.85, top * (1 + loose * hash(k, 9.1)));
    if (hang) [a, b] = [t0 + (t1 - b), t1 - (a - t0)];
    if (b - a < gap * 0.6) continue;
    const u = k * gap + (hash(k, 2.9 + seed) - 0.5) * gap * 0.6 * loose;
    const lean = (hash(k + 0.3, seed) - 0.5) * 0.14 * loose; // radians
    const m = (a + b) / 2, h = (b - a) / 2;
    const ex = dx * Math.cos(lean) - dy * Math.sin(lean), ey = dx * Math.sin(lean) + dy * Math.cos(lean);
    const off = (hash(k + b, a) - 0.5) * 2 * Math.min(bow, h * 0.1);
    const cx = m * dx + u * nx, cy = m * dy + u * ny;
    const [px, py, qx, qy] = [cx - ex * h, cy - ey * h, cx + ex * h, cy + ey * h];
    d[tierOf(k)] += `M${r2(px)} ${r2(py)}Q${r2(cx + nx * off * 2)} ${r2(cy + ny * off * 2)} ${r2(qx)} ${r2(qy)}`;
  }
  return d;
}

const pathOf = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r2(x)} ${r2(y)}`).join('');

// The feet that cast a contact shadow: those turned away from the sun, with
// how far their shadow reaches (world units) and the sun's ground direction.
export function shadedFeet(feet, sun) {
  const [sx, sy] = sun.cast;
  const l = Math.hypot(sx, sy) || 1;
  const c = [sx / l, sy / l];
  const out = [];
  for (const f of feet) {
    const away = awayFrom(f.n, sun);
    if (away <= sun.wallFrom || f.h < sun.low) continue;
    out.push({ ...f, away, reach: f.h * l * sun.reach * Math.min(1, away * 1.5), c });
  }
  return out;
}

// hatch: rows of flat dashes along each shaded foot, stepping out along the
// sun; further rows are skipped more often, and shorter.
function hatchFeet(feet, project, sun, d) {
  const { rowGap, fade, drift } = sun;
  for (const { a, b, reach, c } of shadedFeet(feet, sun)) {
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const rows = Math.floor(reach / rowGap);
    for (let i = 0; i <= rows; i++) {
      const f = rows ? i / rows : 0; // 0 at the wall, 1 at the far edge
      if (i > 0 && hash(i + a[0] * 7, a[1] + b[0]) < f ** 1.5 * fade) continue;
      const w = (i + 0.5) * rowGap;
      // the row shortens away from the wall, from both ends by seeded amounts
      const s0 = (0.04 + 0.4 * f * fade) * hash(i, a[0] + a[1]);
      const s1 = 1 - (0.04 + 0.4 * f * fade) * hash(a[1] - a[0], i);
      // and breaks into two dashes now and then
      const cut = hash(i * 3, b[0] + b[1]) < 0.35 ? s0 + (s1 - s0) * (0.3 + 0.4 * hash(i, b[1])) : null;
      const runs = cut === null ? [[s0, s1]] : [[s0, cut - 0.04], [cut + 0.04, s1]];
      for (const [t0, t1] of runs) {
        if (t1 - t0 < 0.08) continue;
        const at = (t, dw = 0) => project(a[0] + ex * t + c[0] * (w + dw), a[1] + ey * t + c[1] * (w + dw));
        const bow = (hash(t0 + i, a[0]) - 0.5) * 2 * drift;
        const [p, m, q] = [at(t0), at((t0 + t1) / 2, bow), at(t1)];
        d[tierOf(i)] += `M${r2(p[0])} ${r2(p[1])}Q${r2(m[0])} ${r2(m[1])} ${r2(q[0])} ${r2(q[1])}`;
      }
    }
  }
}

// scribble: one zigzag per shaded foot, its teeth out along the sun, taller
// in the middle of the wall, each a seeded height.
function scribbleFeet(feet, project, sun, d) {
  for (const { a, b, reach, c } of shadedFeet(feet, sun)) {
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const teeth = Math.max(2, Math.round(Math.hypot(ex, ey) / sun.rowGap / 2));
    const pts = [];
    for (let i = 0; i <= teeth * 2; i++) {
      const t = (i / (teeth * 2)) * 0.92 + 0.04;
      const w = i % 2
        ? reach * (0.45 + 0.55 * hash(i, a[0] + b[1])) * (0.5 + 0.5 * Math.sin(Math.PI * t))
        : reach * 0.06 * hash(a[1], i);
      pts.push(project(a[0] + ex * t + c[0] * w, a[1] + ey * t + c[1] * w));
    }
    d[1] += pathOf(pts);
  }
}

// An object's ground shadow as SVG path data, one per density tier.
// shade = { casts, feet, project } (Renderer.shadeOf); `project(x, y)`: a
// ground point -> scene px, with the object's relief and warp.
export function shadowPaths({ casts = [], feet = [], project }, sun) {
  const d = ['', '', '', ''];
  if (!sun.on || sun.ground === 'none') return d;
  if (sun.ground === 'tone') {
    // one flat shape: the hulls together (as subpaths of one path, filled
    // nonzero, they read as their union), the building covering its part
    for (const h of shadowHulls(casts, sun)) d[0] += `M${h.map(([x, y]) => project(x, y).map(r2).join(' ')).join('L')}Z`;
  } else if (sun.ground === 'hatch') hatchFeet(feet, project, sun, d);
  else if (sun.ground === 'scribble') scribbleFeet(feet, project, sun, d);
  else {
    const polys = shadowHulls(casts, sun).map((h) => h.map(([x, y]) => project(x, y)));
    for (const [k, t0, t1] of hatchLines(polys, sun)) d[tierOf(k)] += stroke(k, t0, t1, sun, sun.trim);
  }
  return d;
}

// An object's ground shadow as SVG markup: a <path> per density tier.
export function shadowSVG(shade, sun) {
  return shadowPaths(shade, sun)
    .map((d, n) => (d ? `<path d="${d}" class="shadow${sun.ground === 'tone' ? ' tone' : tierClass(n)}"/>` : ''))
    .join('');
}
