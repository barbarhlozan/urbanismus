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
//             shadow. The renderer keeps an object's feet and redraws only
//             the hatching from them (shadowSVG), so a sun that moves later
//             on needs no repainting of buildings. Trees cast theirs from
//             the shapes they leave (Painter.casts, castShapes): a crown's
//             round shadow, a spruce's pointed one, and a line from the
//             trunk. The lines lie on one grid over the whole ground, each
//             with the same wave wherever it is drawn, so where two shadows
//             meet they read as one.
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
// hatch, on the ground (null: none):
//   angle    the lines' direction on screen, in degrees clockwise from
//            screen right, so they lie the same way in every view
//   gap      between the lines (grid units)
//   wave     how far a line strays to either side as it runs (grid units)
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
  fall: 150,
  length: 1,
  low: 0.08,
  hatch: { angle: 120, gap: 0.04, wave: 0.008, ragged: 0.02, pen: 2 },
  strokes: { from: 0.05, full: 0.45, most: 1, gap: 0.045, lean: 70, ragged: 0.12, fade: 0, pen: 2 },
};

// The class of a pen (1…5) in styles.css.
export const penClass = (pen) => ` p${Math.min(5, Math.max(1, Math.round(pen ?? 2)))}`;

// The density tier of hatch line k: every 8th (0), every 4th (1), every
// other (2), the rest (3) – the roof hatching's, see Renderer.atDetail.
export const tierOf = (k) => (k % 8 === 0 ? 0 : k % 4 === 0 ? 1 : k % 2 === 0 ? 2 : 3);

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

// The sun for a camera: `cast` is the ground shift per unit of height.
export function sunFor(camera, sun = SUN) {
  const angle = camera.angle ?? 0;
  const [fx, fy] = groundDir(sun.fall, angle);
  return { ...sun, angle, cast: [fx * sun.length, fy * sun.length] };
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
// the same line that overlap are joined.
export function hatchRuns(polys, u, v, gap) {
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
      if (a <= t1) t1 = Math.max(t1, b);
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
// the object's relief and warp. Each line is drawn through points a step
// apart, so it follows the ground, and strays to the sides by a wave that
// depends only on where it is, so two shadows' lines meet as one.
export function shadowPaths({ feet = [], casts = [], project }, sun, angle = 0) {
  const d = ['', '', '', ''];
  const h = sun.hatch;
  if (!sun.on || !h) return d;
  const u = groundDir(h.angle, angle), v = [-u[1], u[0]];
  const step = 0.12;
  const { polys, lines } = castShapes(casts, sun);
  for (const [a, b] of lines) {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    const pts = Array.from({ length: n + 1 }, (_, i) => project(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n));
    d[0] += `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}`;
  }
  for (const [k, a, b] of hatchRuns([...castStrips(feet, sun), ...polys], u, v, h.gap)) {
    const t0 = a + h.ragged * hash(k, a), t1 = b - h.ragged * hash(b, k);
    if (t1 - t0 < h.gap) continue;
    const n = Math.max(1, Math.ceil((t1 - t0) / step));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      const c = k * h.gap + h.wave * (0.6 * Math.sin(t * 2.3 + k * 1.7) + 0.4 * Math.sin(t * 6.1 - k * 0.9));
      pts.push(project(u[0] * t + v[0] * c, u[1] * t + v[1] * c));
    }
    d[tierOf(k)] += `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}`;
  }
  return d;
}

// An object's cast shadow as SVG markup (Renderer.atDetail thins it out by
// the tier classes).
export function shadowSVG(shade, sun) {
  const pen = penClass(sun.hatch?.pen);
  return shadowPaths(shade, sun, sun.angle).map((d, t) => (d ? `<path d="${d}" class="shadow${pen}${tierClass(t, 'rh')}"/>` : '')).join('');
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
