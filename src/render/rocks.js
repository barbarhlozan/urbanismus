// Drawing the rock (terrain/rocks.js) on the map: the cliff faces turned
// to the viewer, as a pen draws them – a line along the lip at the top of
// each face, and strokes hanging from it down the face along the fall line,
// some reaching the foot, most stopping short. They lie on the ground and
// are projected with it, so they lean as the face does in every rotation.
// Faces turned away from the viewer fold out of sight: the brows
// (brows.js) draw their edge.
//
//   rockLines(world, camera, height, box, hidden)
//        -> { lips: [[[x, y]…]…], faces: [[[x, y]…]…] } world polylines
//   height(x, y)  the ground's drawn height in grid units (as brows.js)
//   hidden(x, y)  is the ground there behind nearer ground (brows.js)

import { contours } from '../terrain/elevation.js';
import { mulberry32 } from '../core/random.js';
import { rotateQuarter } from '../core/grid.js';

//   face    metres of rise per grid step from which the ground is a face
//   rock    the rock mask (0–1) from which faces are drawn
//   step    sampling step of the faces' outlines (grid units)
//   gap     strokes this far apart along the lip (tiles on the screen),
//           give or take `jitter` of it
//   reach   longest stroke (grid units); each is cut to a random share of
//           the face, between `short` and 1
//   min     shortest lip drawn (grid units)
//   tall    lowest face drawn: its strokes' middle length on the screen
//           (tiles), before they are cut short
// Loosened by hand:
//   pair    chance that the next stroke follows close behind (a quick
//           second stroke), so they come in uneven groups, not as a comb
//   drop    strokes start up to this far below the lip (grid units)
//   bow     how far a stroke bows to one side (share of its length)
//   fade    near the ends of a lip, strokes shorten over this length
//           (grid units)
//   pencil  the lip's pen strokes (pencil.js): broken, wandering
export const ROCK_LOOK = {
  face: 26,
  rock: 0.3,
  step: 0.1,
  gap: 0.2,
  jitter: 0.6,
  reach: 0.9,
  short: 0.2,
  min: 0.4,
  tall: 0.3,
  pair: 0.25,
  drop: 0.05,
  bow: 0.06,
  fade: 0.6,
  pencil: { len: [0.25, 0.9], gap: [-0.03, 0.14], drift: 0.035, skip: 0.15 },
};

export function rockLines(world, camera, height, box, hidden = () => false, opts = ROCK_LOOK) {
  const { face, rock, step, gap, jitter, reach, short, min, tall, pair, drop, bow, fade } = opts;
  const e = world.elevation;
  const d = 0.03;
  const grad = (x, y) => [(e(x + d, y) - e(x - d, y)) / (2 * d), (e(x, y + d) - e(x, y - d)) / (2 * d)];
  const slope = (x, y) => Math.hypot(...grad(x, y));
  // a face: steep, and rock
  const field = (x, y) => (world.rockAt(x, y) < rock ? -face : slope(x, y) - face);

  // turned to the viewer: going back (against t), the ground rises up the
  // screen (brows.js: screen y = t / 2 - h * zScale)
  const [bx, by] = rotateQuarter(-1, -1, -camera.rotation); // back, in world x/y (per unit of t: half of it each)
  const shows = (x, y) => {
    const k = 0.04;
    const dh = height(x + (bx * k) / 2, y + (by * k) / 2) - height(x - (bx * k) / 2, y - (by * k) / 2);
    return 0.5 + (camera.zScale * dh) / k > 0.05;
  };

  const lips = [], faces = [];
  const rnd = mulberry32(world.seed ^ 0x5eed);
  const level = { step, interval: 1e6, index: 1 };
  for (const { points } of contours(field, box, level)) {
    // the outline of a face: its top edge (the lip, where the face falls
    // away from it) and its foot; keep the lip, where the face shows
    let run = [];
    const flush = () => {
      if (run.length > 1 && length(run) >= min) lips.push(run);
      run = [];
    };
    for (const [x, y] of points) {
      const [gx, gy] = grad(x, y);
      const g = Math.hypot(gx, gy) || 1;
      // into the face from the lip: downhill
      const qx = x - (gx / g) * 0.08, qy = y - (gy / g) * 0.08;
      const lip = field(qx, qy) > 0 && shows(qx, qy) && !hidden(x, y);
      if (lip) run.push([x, y]);
      else flush();
    }
    flush();
  }

  // strokes hanging from the lips, a screen gap apart; a face too low on
  // the screen to read as one is left out, lip and all
  const screen = (x, y) => camera.project(x, y, height(x, y));
  const tile = camera.tile;
  const kept = [];
  for (const lip of lips) {
    const strokes = [];
    const along = [0]; // grid units along the lip
    for (let i = 1; i < lip.length; i++) along.push(along[i - 1] + Math.hypot(lip[i][0] - lip[i - 1][0], lip[i][1] - lip[i - 1][1]));
    const total = along[along.length - 1];
    let next = gap * tile * (0.5 + rnd());
    let prev = screen(...lip[0]);
    let walked = 0;
    for (let i = 1; i < lip.length; i++) {
      const p = screen(...lip[i]);
      walked += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      prev = p;
      if (walked < next) continue;
      walked = 0;
      next = gap * tile * (rnd() < pair ? 0.3 + rnd() * 0.2 : 1 + (rnd() - 0.5) * 2 * jitter);
      const stroke = fallLine(lip[i], grad, slope, face * 0.8, reach);
      if (stroke.length < 2) continue;
      const [a, b] = [screen(...stroke[0]), screen(...stroke[stroke.length - 1])];
      const end = Math.min(along[i], total - along[i]);
      strokes.push({ stroke, tall: Math.hypot(b[0] - a[0], b[1] - a[1]), ends: Math.min(1, end / fade) });
    }
    const talls = strokes.map((s) => s.tall).sort((a, b) => a - b);
    if (!talls.length || talls[talls.length >> 1] < tall * tile) continue;
    kept.push(lip);
    for (const { stroke, ends } of strokes) {
      // cut short (more so near the lip's ends), started a little below
      // the lip, bowed to one side
      const n = stroke.length;
      const keep = Math.round(n * (short + rnd() * (1 - short)) * (0.35 + 0.65 * ends));
      const from = Math.max(0, Math.min(Math.round((rnd() * drop) / 0.04), keep - 2));
      if (keep - from < 2) continue;
      const part = stroke.slice(from, keep);
      const [x0, y0] = part[0], [x1, y1] = part[part.length - 1];
      const l = Math.hypot(x1 - x0, y1 - y0) || 1;
      const k = (rnd() - 0.5) * 2 * bow * l;
      faces.push(part.map(([x, y], j) => {
        const t = j / (part.length - 1), off = k * Math.sin(Math.PI * t);
        return [x - ((y1 - y0) / l) * off, y + ((x1 - x0) / l) * off];
      }));
    }
  }
  return { lips: kept, faces };
}

// Down the steepest way from p while the ground stays steeper than `steep`
// (metres per grid step), at most `reach` grid units.
function fallLine(p, grad, slope, steep, reach) {
  const out = [p];
  let [x, y] = p;
  const ds = 0.04;
  for (let s = 0; s < reach; s += ds) {
    const [gx, gy] = grad(x, y);
    const g = Math.hypot(gx, gy);
    if (!g) break;
    x -= (gx / g) * ds;
    y -= (gy / g) * ds;
    if (s > 0.08 && slope(x, y) < steep) break;
    out.push([x, y]);
  }
  return out;
}

function length(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}
