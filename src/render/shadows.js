// Shadows drawn by pen – no lighting, just two marks a hand makes on the
// side turned away from the sun (shadows.html shows them beside the other
// ways tried):
//
//   hatching  on the ground: the shadow a building casts, as far out along
//             the sun as its walls are tall, filled with parallel pen lines.
//             Every wall standing on the ground leaves its foot
//             (Painter.feet: ends, height, outward normal); each foot turned
//             away from the sun casts the strip between it and its own foot
//             shifted along the sun, and the strips together make the
//             shadow. The renderer keeps an object's feet, so its shadow
//             is cast from them on the GPU for the sun as it goes
//             (gl/shadows.js castPieces; a photo's: shadowSVG). Trees cast theirs from
//             the shapes they leave (Painter.casts, castShapes): a crown's
//             round shadow, a spruce's pointed one, and a line from the
//             trunk. The lines are the paper's hatching (hatch.js): straight
//             across the screen, laid as strokes, the same wherever they are
//             drawn – so where two shadows meet they read as one, and the
//             night (the same strokes everywhere) fills in between them.
//             (Photos, through a perspective camera, hatch the ground
//             itself instead: lines on the ground, waving as they run.)
//   strokes   on the wall itself: parallel strokes, leaning, evenly spaced
//             up to just below the top (wallStrokes, drawn by Painter._shade
//             with the painter's own wobble); the further the wall is
//             turned away, the more of them.
//
// Both are drawn in the secondary ink (--detail), each with one of the
// map's five pens (`pen`, styles.css), and fade with the weather (--sun in
// styles.css). To try other settings on the map: cmd.sun({ … }) in the
// console. Both go by the roof hatching's density tiers
// (rh1…rh3), so the map thins them out with the roofs, building by
// building, as it zooms out.

import { tierOf, hash, hatchFrame, hatchStrokes } from './hatch.js';

export { tierOf, hash };

const COS30 = Math.cos(Math.PI / 6);
const r2 = (n) => Math.round(n * 100) / 100;

// The sun and the pen:
//   on       draw shadows at all
//   azimuth  the way shadows fall on the ground, in degrees from the
//            world's x axis towards its y axis (90: along y, which at the
//            first view is down the screen and to the left). Fixed to the
//            world, so turning the view turns the shadows with the town;
//            the day moves it (DAY, sunAt)
//   length   a shadow's length on the ground per unit of height (1 = 45° sun)
//   low      walls lower than this (kerbs, benches, paving) get neither mark
// hatch, on the ground (null: none):
//   angle    the lines' direction on screen, in degrees clockwise from
//            screen right, so they lie the same way in every view
//   gap      between the lines (grid units)
//   stroke, join, bow, drift   how the lines are laid as strokes (hatch.js)
//   wave     in photos, how far a line strays to either side (grid units)
//   ragged   how unevenly the lines stop at the shadow's edge (grid units)
//   pen      which of the map's pens (1 finest … 5 thickest, styles.css)
// strokes, on the wall (null: none):
//   from     how far a wall must turn away to get any (0 = side on to the
//            sun, 1 = straight away); from `full` on it gets `most` of its
//            strokes, in between fewer
//   gap      between the strokes, in the wall's plane (grid units)
//   lean     their angle from level, in the wall's plane (degrees)
//   ragged   how unevenly their tops stop short (0 = all full height)
//   fade     how much they thin out across the wall (0 = not at all)
//   pen      as for the hatch
export const SUN = {
  on: true,
  azimuth: 90,
  length: 1,
  low: 0.08,
  hatch: { angle: 120, gap: 0.04, stroke: [0.9, 1.8], join: [-0.08, 0.06], bow: 0.01, drift: 0.016, wave: 0.008, ragged: 0.02, pen: 2 },
  strokes: { from: 0.05, full: 0.45, most: 1, gap: 0.045, lean: 70, ragged: 0.12, fade: 0, pen: 2 },
};

// The class of a pen (1…5) in styles.css.
export const penClass = (pen) => ` p${Math.min(5, Math.max(1, Math.round(pen ?? 2)))}`;

// The class of a stroke in tier n (`kind`: 'rh' for roofs and walls).
export const tierClass = (n, kind) => (n ? ` ${kind}${n}` : '');

// A direction on screen (degrees clockwise from right) as a unit direction
// on the ground, in world axes for a camera turned `angle` radians.
// The iso camera draws view axes (rx, ry) at screen ((rx - ry)·cos30,
// (rx + ry)·½); this is the inverse, then turned back to the world.
export function groundDir(deg, angle = 0) {
  const a = (deg * Math.PI) / 180;
  const cx = Math.cos(a), cy = Math.sin(a);
  const k = cx / (2 * COS30);
  const [rx, ry] = [cy + k, cy - k];
  const c = Math.cos(angle), s = Math.sin(angle);
  const [wx, wy] = [rx * c + ry * s, -rx * s + ry * c];
  const l = Math.hypot(wx, wy) || 1;
  return [wx / l, wy / l];
}

// The sun for a camera: `cast` is the ground shift per unit of height, in
// world axes (the same in every view); `angle` the camera's turn; `screen`
// whether the hatching is the paper's (hatch.js, not through a perspective
// camera), with `px` scene pixels to a grid unit.
export function sunFor(camera, sun = SUN) {
  const a = (sun.azimuth * Math.PI) / 180;
  return { ...sun, angle: camera.angle ?? 0, cast: [Math.cos(a) * sun.length, Math.sin(a) * sun.length], screen: !camera.perspective, px: camera.tile ?? 32 };
}

// Where the light comes from on screen, for a camera: a unit direction
// [right, up] towards the sun, opposite to the way the shadows fall there
// (the trees' glyphs are shaded by it, features/trees.js). The iso camera
// draws view axes (rx, ry) at screen ((rx - ry)·cos30, (rx + ry)·½).
export function screenLight(camera, sun = SUN) {
  const a = (sun.azimuth * Math.PI) / 180;
  const [rx, ry] = camera.toView ? camera.toView(Math.cos(a), Math.sin(a)) : [Math.cos(a), Math.sin(a)];
  const sx = (rx - ry) * COS30, sy = (rx + ry) / 2, l = Math.hypot(sx, sy) || 1;
  return [-sx / l, sy / l];
}

// The day, all 24 hours of it: its steps, each from an hour on (`at`):
//   sun     where the sun stands, an index into `positions` ([azimuth,
//           length] as SUN's, from morning to evening)
//   length  the shadows' length, if longer than the position's own: at
//           dusk the sun sinks and the shadows spread – longer, the hills'
//           as dense as the buildings' (`hills`: every so many of the
//           paper's lines, HILL_SHADOWS.every by day) – until they meet as
//           the night; at dawn they shrink back the same way
//   night   the night: the paper's strokes over everything, every one of
//           them (Renderer.renderNight), and no sun
//   lamps   the street lamps lit, their light left out of the night and
//           the shadows (lights.js)
//   windows the share of the windows lit at night (0 … 1): most in the
//           evening, a few in the small hours, some again before dawn
//   depth   how deep the night is, in the paper's strokes (Renderer,
//           gl/night.js): 1 its lines, 2 as many again between them,
//           3 and a set across them
//   ink     how far the main ink has gone over to the secondary (0 … 1):
//           in the dead of night the whole drawing is in the one ink, the
//           night's lines' – so the dark is the lines alone, and where a
//           light shines there are none
//   day     simulated seconds to 24 hours
//   start   the hour at world time 0 (a new town starts in the morning)
//   dawn    the hour the sun rises (the Debug panel's day starts there)
// Each step that moves the sun or stretches the shadows draws the map
// anew.
export const DAY = {
  on: true,
  day: 1800,
  start: 8,
  dawn: 4.25,
  positions: [[170, 2.2], [150, 1.7], [130, 1.35], [110, 1.1], [90, 1], [70, 1.1], [50, 1.35], [30, 1.7], [10, 2.2]],
  steps: [
    { at: 0, night: true, lamps: true, windows: 0.2, depth: 2, ink: 0.97 },
    { at: 1, night: true, lamps: true, windows: 0.1, depth: 3, ink: 1 },
    { at: 2.5, night: true, lamps: true, windows: 0.1, depth: 2, ink: 0.97 },
    { at: 3.25, night: true, lamps: true, windows: 0.2, depth: 1, ink: 0.85 },
    { at: 4.25, sun: 0, length: 12, hills: 1, lamps: true, windows: 0.3, ink: 0.55 },
    { at: 4.75, sun: 0, length: 6, hills: 1, ink: 0.25 },
    { at: 5.5, sun: 0, length: 3.5, hills: 1 },
    { at: 6.25, sun: 0 },
    { at: 7.5, sun: 1 }, { at: 9, sun: 2 }, { at: 10.5, sun: 3 }, { at: 12, sun: 4 },
    { at: 13.5, sun: 5 }, { at: 15, sun: 6 }, { at: 16.5, sun: 7 }, { at: 18, sun: 8 },
    { at: 19.25, sun: 8, length: 3.5, hills: 1 },
    { at: 20, sun: 8, length: 6, hills: 1, ink: 0.15 },
    { at: 20.75, sun: 8, length: 12, hills: 1, lamps: true, windows: 0.6, ink: 0.4 },
    { at: 21.5, night: true, lamps: true, windows: 0.7, depth: 1, ink: 0.6 },
    { at: 22.5, night: true, lamps: true, windows: 0.5, depth: 1, ink: 0.8 },
    { at: 23.25, night: true, lamps: true, windows: 0.3, depth: 2, ink: 0.92 },
  ],
};

// The hour of the day (0 … 24) at world time t (`shift`: hours the day
// was moved on by, holdDay / goOnDay; not kept with the town).
export function hourAt(t, day = DAY) {
  return ((((t / day.day) * 24 + day.start + (day.shift ?? 0)) % 24) + 24) % 24;
}

// Hold the day at an hour (the Debug panel's slider, cmd.day): the sun,
// the dusk, the night stay as they are then.
export function holdDay(hour, day = DAY) {
  day.on = false;
  day.held = ((hour % 24) + 24) % 24;
}

// Let the day go on from where it was held (or from the clock, if it
// wasn't), at world time t.
export function goOnDay(t, day = DAY) {
  if (day.held != null) day.shift = (day.shift ?? 0) + day.held - hourAt(t, day);
  day.held = null;
  day.on = true;
}

// A day `seconds` long (simulated), the hour at world time t kept.
export function dayLength(seconds, t, day = DAY) {
  const hour = hourAt(t, day);
  day.day = seconds;
  day.shift = (day.shift ?? 0) + hour - hourAt(t, day);
}

// The step of the day (an index into DAY.steps) at an hour.
export function stepAt(hour, day = DAY) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i + 1 < day.steps.length && day.steps[i + 1].at <= h) i++;
  return i;
}

// The step of the day at world time t; null with the day held (cmd.day,
// the Debug panel).
export function sunAt(t, day = DAY) {
  return day.on && day.steps.length ? stepAt(hourAt(t, day), day) : null;
}

// Where the sun stands at an hour, between the steps: [azimuth, length],
// or null by night. The positions (DAY.positions) are the sun at the
// steps that bring them (the morning's at the last of its steps, the rest
// at the first: so noon is the middle), and it goes on evenly from one to
// the next; the shadows' length is the position's, or the longer one the
// dawn and the dusk stretch them to, each eased into the next.
export function sunOfHour(hour, day = DAY) {
  const h = ((hour % 24) + 24) % 24;
  const step = day.steps[stepAt(h, day)];
  if (step.sun == null) return null;
  const keys = (day.sunKeys ??= sunKeys(day));
  const at = (list) => {
    if (h <= list[0][0]) return list[0][1];
    for (let i = 1; i < list.length; i++) {
      const [h1, v1] = list[i];
      if (h <= h1) {
        const [h0, v0] = list[i - 1];
        return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
      }
    }
    return list[list.length - 1][1];
  };
  return [at(keys.azimuth), Math.max(at(keys.length), at(keys.stretch))];
}

function sunKeys(day) {
  const steps = day.steps.filter((s) => s.sun != null), mid = (day.positions.length - 1) / 2;
  const azimuth = [], length = [];
  day.positions.forEach(([az, len], i) => {
    const mine = steps.filter((s) => s.sun === i);
    if (!mine.length) return;
    const h = (i < mid ? mine[mine.length - 1] : mine[0]).at;
    azimuth.push([h, az]);
    length.push([h, len]);
  });
  return { azimuth, length, stretch: steps.map((s) => [s.at, s.length ?? 0]) };
}

// How far a wall with outward world normal n (unit, horizontal) is turned
// away from the sun: 1 straight away, 0 side on, below 0 lit.
export function awayFrom([nx, ny], sun) {
  const [sx, sy] = sun.cast;
  return (nx * sx + ny * sy) / (Math.hypot(sx, sy) || 1);
}

// The strips the feet cast on the ground, each a parallelogram in world
// points: a foot turned away from the sun and tall enough, and the same
// foot shifted along the sun by the height its wall's top is level to (a
// gable end casts the rest as a face, castShapes).
export function castStrips(feet, sun) {
  const [sx, sy] = sun.cast;
  const out = [];
  for (const f of feet) {
    if (awayFrom(f.n, sun) <= 0 || f.h < sun.low) continue;
    const z = f.level ?? f.h;
    const [dx, dy] = [sx * z, sy * z];
    out.push([f.a, f.b, [f.b[0] + dx, f.b[1] + dy], [f.a[0] + dx, f.a[1] + dy]]);
  }
  return out;
}

// The shadows the shapes a drawing leaves cast on the ground
// (Painter.cast; world points, heights in grid units):
//   crown  { at, z, r, rz }    a round crown: r across, rz up, its middle
//                              z above the ground at `at`
//   cone   { at, z0, z1, r }   a spruce's: r across at z0, a point at z1
//   stem   { at, z }           a trunk up to z
//   face   { pts }             a flat face off the ground: a roof plane, a
//                              gable, a chimney's wall ([x, y, z] each)
// as { polys (convex, for hatchRuns), lines (each a pen line) }.
export function castShapes(casts = [], sun) {
  const [sx, sy] = sun.cast;
  const L = Math.hypot(sx, sy) || 1, c = [sx / L, sy / L], q = [-c[1], c[0]];
  const along = ([x, y], z) => [x + sx * z, y + sy * z];
  const polys = [], lines = [];
  for (const s of casts) {
    if (s.kind === 'crown') {
      const [mx, my] = along(s.at, s.z), a = Math.hypot(s.r, L * s.rz), n = 12;
      polys.push(Array.from({ length: n }, (_, i) => {
        const t = (i / n) * 2 * Math.PI, u = Math.cos(t) * a, v = Math.sin(t) * s.r;
        return [mx + c[0] * u + q[0] * v, my + c[1] * u + q[1] * v];
      }));
    } else if (s.kind === 'cone') {
      const [mx, my] = along(s.at, s.z0), tip = along(s.at, s.z1), n = 10;
      const ring = Array.from({ length: n }, (_, i) => [mx + Math.cos((i / n) * 2 * Math.PI) * s.r, my + Math.sin((i / n) * 2 * Math.PI) * s.r]);
      polys.push(hull([...ring, tip]));
    } else if (s.kind === 'face') {
      polys.push(hull(s.pts.map(([x, y, z]) => along([x, y], z))));
    } else if (s.kind === 'stem' && s.z > 0) {
      lines.push([s.at, along(s.at, s.z)]);
    }
  }
  return { polys, lines };
}

// The convex hull of points, anticlockwise (monotone chain).
function hull(pts) {
  pts = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

// Where line c of the hatching (the points p with p·v = c) crosses a
// convex polygon, as [t0, t1] along u; null if it misses.
function across(poly, u, v, c) {
  const ts = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const cp = p[0] * v[0] + p[1] * v[1] - c, cq = q[0] * v[0] + q[1] * v[1] - c;
    if (cp * cq > 0 || cp === cq) continue;
    const k = cp / (cp - cq);
    ts.push((p[0] + (q[0] - p[0]) * k) * u[0] + (p[1] + (q[1] - p[1]) * k) * u[1]);
  }
  return ts.length >= 2 ? [Math.min(...ts), Math.max(...ts)] : null;
}

// The hatching over a set of convex polygons (world points) as runs
// [k, t0, t1]: line k of the ground's hatching (tierOf) from t0 to t1
// along it. u: the lines' direction on the ground, v across them. Runs on
// the same line that overlap (or come within `join` of each other) are
// joined.
export function hatchRuns(polys, u, v, gap, join = 0) {
  const lines = new Map();
  for (const poly of polys) {
    const cs = poly.map(([x, y]) => x * v[0] + y * v[1]);
    for (let k = Math.ceil(Math.min(...cs) / gap); k * gap <= Math.max(...cs); k++) {
      const r = across(poly, u, v, k * gap);
      if (!r) continue;
      if (!lines.has(k)) lines.set(k, []);
      lines.get(k).push(r);
    }
  }
  const out = [];
  for (const [k, rs] of lines) {
    rs.sort((a, b) => a[0] - b[0]);
    let [t0, t1] = rs[0];
    for (const [a, b] of rs.slice(1)) {
      if (a <= t1 + join) t1 = Math.max(t1, b);
      else { out.push([k, t0, t1]); [t0, t1] = [a, b]; }
    }
    out.push([k, t0, t1]);
  }
  return out;
}

// An object's cast shadow as path data, one per density tier (tierOf):
// the hatching over the strips its feet cast and the shadows of what else
// it drew (castShapes), with its trunks' lines in the first tier, so they
// stay as far out as anything. shade = { feet, casts, project }
// (Renderer.shadeOf); `project(x, y)`: a ground point -> scene px, with
// the object's relief and warp. On the map the shadow is projected and
// hatched with the paper's strokes (hatch.js), which lie the same in
// every shadow and in the night; in a photo (sun.screen false) the ground
// itself is hatched, each line through points a step apart, so it follows
// the ground, and straying to the sides by a wave that depends only on
// where it is, so two shadows' lines meet as one.
export function shadowPaths({ feet = [], casts = [], project }, sun, angle = 0) {
  const d = ['', '', '', ''];
  const h = sun.hatch;
  if (!sun.on || !h) return d;
  const step = 0.12;
  const { polys, lines } = castShapes(casts, sun);
  for (const [a, b] of lines) {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    const pts = Array.from({ length: n + 1 }, (_, i) => project(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n));
    d[0] += `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}`;
  }
  const shapes = [...castStrips(feet, sun), ...polys];
  if (sun.screen) {
    const px = sun.px, f = hatchFrame(h), gap = f.gap * px, rag = h.ragged * px;
    const onScreen = shapes.map((poly) => poly.map(([x, y]) => project(x, y)));
    for (const [k, a, b] of hatchRuns(onScreen, f.u, f.v, gap, 0.5)) {
      const t0 = a + rag * hash(k, a / px), t1 = b - rag * hash(b / px, k);
      if (t1 - t0 < gap) continue;
      d[tierOf(k)] += hatchStrokes(k, t0, t1, h, px, f);
    }
    return d;
  }
  const u = groundDir(h.angle, angle), v = [-u[1], u[0]];
  for (const [k, a, b] of hatchRuns(shapes, u, v, h.gap)) {
    const t0 = a + h.ragged * hash(k, a), t1 = b - h.ragged * hash(b, k);
    if (t1 - t0 < h.gap) continue;
    const pts = hatchLine(k, t0, t1, u, v, h, step).map(([x, y]) => project(x, y));
    d[tierOf(k)] += `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}`;
  }
  return d;
}

// Line k of the ground's hatching (u along the lines, v across, h =
// SUN.hatch) from t0 to t1 along it, as world points `step` apart, straying
// to the sides by a wave that depends only on where it is – so wherever it
// is drawn, by a building's shadow or a hill's, it is the same line.
export function hatchLine(k, t0, t1, u, v, h, step = 0.12) {
  const n = Math.max(1, Math.ceil((t1 - t0) / step));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    const c = k * h.gap + h.wave * (0.6 * Math.sin(t * 2.3 + k * 1.7) + 0.4 * Math.sin(t * 6.1 - k * 0.9));
    pts.push([u[0] * t + v[0] * c, u[1] * t + v[1] * c]);
  }
  return pts;
}

// An object's cast shadow as SVG markup, its lines up to density tier
// `most` (3: all of them).
export function shadowSVG(shade, sun, most = 3) {
  const pen = penClass(sun.hatch?.pen);
  const d = shadowPaths(shade, sun, sun.angle).slice(0, most + 1).join('');
  return d ? `<path d="${d}" class="shadow${pen}"/>` : '';
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
