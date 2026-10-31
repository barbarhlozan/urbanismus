// Cows and sheep close up, drawn like the deer (deer.js) after the sketch
// sheet (livestock.html, style A of each), freehand in the walkers' hand
// (people.js smooth, lumpyRound):
//   a cow – a long rounded body with two or three inked patches, four thin
//     legs, a long face with two horns floating in front (no neck, as the
//     sheep's head), a tail with a tuft; now and then a dark one, inked all over
//   a sheep – a fleece of round bumps on short thin legs, an inked head
//     tucked in at the front, an ear up and back (none while grazing); now and then a black one
// Poses: 'stand', 'step' (legs apart), 'graze' (head down in the grass)
// and 'lie' (folded down on the grass). Seen from the side, facing right;
// the renderer mirrors them like the deer. Scene px round the ground
// point, at the walkers' scale. Everything is cached.

import { mulberry32 } from '../core/random.js';
import { PEOPLE, smooth, lumpyRound } from './people.js';

export const LIVESTOCK = {
  bodies: 12,    // variations per kind; body 0 is the dark cow / the black sheep
  scale: 1.6,    // scene px per sketch unit (a walker is 2.5 tall): drawn larger than life, as the deer
  stride: 0.07,  // grid units walked per step
};

const r2 = (n) => Math.round(n * 100) / 100;
const mid = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// The hand for one animal: points scaled by `s` and each a little off
// (as the walkers'), strokes bowed through a point between each two.
function hand(rnd, s) {
  const wob = () => PEOPLE.wobble * 2.5 * s * (rnd() * 2 - 1);
  const S = ([x, y]) => [x * s, y * s];
  const sp = (pts, k = 1) => pts.map((p) => { const [x, y] = S(p); return [x + wob() * k, y + wob() * k]; });
  const stroke = (pts) => {
    const q = sp(pts), all = [];
    q.forEach((p, i) => { if (i) all.push([(q[i - 1][0] + p[0]) / 2 + wob() * 0.6, (q[i - 1][1] + p[1]) / 2 + wob() * 0.6]); all.push(p); });
    return smooth(all, false);
  };
  const shape = (pts) => smooth(sp(pts), true);
  const blob = ([x, y], rx, ry, lump = 0.2, n = 5) => lumpyRound(rnd, x * s, y * s, rx * s, ry * s, lump, n);
  // legs steadier than the rest: thin strokes show every wobble
  const leg = (pts) => smooth(sp(pts, 0.3), false);
  return { S, sp, stroke, shape, blob, leg };
}

// a fleece: round bumps of their own sizes all along a box (corners
// clockwise from top left), the box's edge itself not ruled
function cloud(pts, bumps, rnd, s) {
  const segs = pts.map((p, i) => [p, pts[(i + 1) % pts.length]]);
  const lens = segs.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1])), total = lens.reduce((a, b) => a + b);
  const at = (u) => {
    let d = u * total, i = 0;
    while (d > lens[i] && i < lens.length - 1) d -= lens[i++];
    return mid(...segs[i], d / lens[i]);
  };
  const off = () => PEOPLE.wobble * 2.5 * s * (rnd() * 2 - 1);
  const ring = Array.from({ length: bumps }, (_, i) => at((i + 0.3 + (rnd() - 0.5) * 0.35) / bumps)).map(([x, y]) => [x + off(), y + off()]);
  let d = `M${r2(ring[0][0])} ${r2(ring[0][1])}`;
  for (let i = 1; i <= bumps; i++) {
    const r = (total / bumps) * (0.5 + rnd() * 0.3);
    const [x, y] = ring[i % bumps];
    d += `A${r2(r)} ${r2(r * (0.85 + rnd() * 0.3))} 0 0 1 ${r2(x)} ${r2(y)}`;
  }
  return `${d}Z`;
}

// four legs (x positions, back to front), apart when stepping; hind ones
// bent at the hock (`bend`)
function legs(h, xs, bot, spread, bend) {
  return xs.map((x, i) => {
    const f = spread * (i === 0 || i === 3 ? 1 : -1);
    return h.leg(x < 0 && bend
      ? [[x, bot + 0.02], [x - 0.05 + f / 2, bot * 0.45], [x - 0.01 + f, 0]]
      : [[x, bot + 0.02], [x + 0.01 + f / 2, bot * 0.5], [x + f, 0]]);
  }).join('');
}

function cow(pose, variant) {
  const rnd = mulberry32(variant * 2654435761 + 3);
  const s = (0.95 + rnd() * 0.1) * LIVESTOCK.scale;
  const h = hand(rnd, s);
  const dark = variant === 0;
  const lying = pose === 'lie';
  const legH = lying ? 0.06 : 0.52, depth = 0.62, rear = -0.85, chest = 0.78;
  const bot = -legH, top = bot - depth;
  const parts = [];
  if (lying) parts.push(['fig-line', h.leg([[chest - 0.3, -0.02], [chest + 0.02, -0.02]])]); // legs folded under
  else parts.push(['fig-line', legs(h, [rear + 0.12, rear + 0.24, chest - 0.26, chest - 0.14], bot, pose === 'step' ? 0.09 : 0, true)]);
  // the body: long, the hip-bones up at the back, the back sagging a
  // little, a deep belly
  parts.push([dark ? 'fig-ink' : 'fig-body', h.shape([
    [rear - 0.02, top + 0.1], [rear + 0.12, top - 0.02], [rear + 0.3, top - 0.03], [(rear + chest) / 2, top + 0.03], [chest - 0.12, top + 0.01],
    [chest + 0.02, (top + bot) / 2 - 0.05], [chest - 0.06, bot + 0.06], [(rear + chest) / 2, bot + 0.01], [rear + 0.08, bot + 0.02], [rear - 0.01, (top + bot) / 2 + 0.05],
  ])]);
  if (!dark) {
    let d = '';
    for (let k = 2 + Math.floor(rnd() * 2); k > 0; k--) {
      const cx = rear + 0.2 + rnd() * (chest - rear - 0.45), cy = top + 0.15 + rnd() * (depth - 0.3);
      d += h.blob([cx, cy], 0.08 + rnd() * 0.09, 0.07 + rnd() * 0.07, 0.3, 6);
    }
    parts.push(['fig-ink', d]);
  }
  // a tail down the back, a tuft at its end
  const tail = lying ? [[rear, top + 0.1], [rear - 0.14, top + 0.3], [rear - 0.2, -0.04]] : [[rear + 0.01, top + 0.08], [rear - 0.11, top + 0.3], [rear - 0.13, bot + 0.04]];
  parts.push(['fig-line', h.stroke(tail)]);
  parts.push(['fig-ink', h.blob(tail.at(-1), 0.05, 0.065)]);
  // a long face with two horns and an ear, floating just in front of the
  // shoulders (no neck, as the sheep's)
  const [cx, cy] = pose === 'graze' ? [chest + 0.24, -0.24] : lying ? [chest + 0.17, top + 0.02] : [chest + 0.2, top + 0.02];
  parts.push([dark || rnd() < 0.3 ? 'fig-ink' : 'fig-body', h.shape([[cx - 0.11, cy - 0.15], [cx + 0.1, cy - 0.15], [cx + 0.17, cy + 0.08], [cx + 0.12, cy + 0.21], [cx - 0.01, cy + 0.2], [cx - 0.08, cy + 0.03]])]);
  parts.push(['fig-line', h.stroke([[cx - 0.08, cy - 0.15], [cx - 0.14, cy - 0.3]]) + h.stroke([[cx + 0.05, cy - 0.15], [cx + 0.1, cy - 0.3]]) + h.stroke([[cx - 0.11, cy - 0.08], [cx - 0.2, cy - 0.06]])]);
  return parts;
}

function sheep(pose, variant) {
  const rnd = mulberry32(variant * 2654435761 + 5);
  const s = (0.92 + rnd() * 0.16) * LIVESTOCK.scale;
  const h = hand(rnd, s);
  const black = variant === 0;
  const lying = pose === 'lie';
  const legH = lying ? 0.03 : 0.3, depth = 0.5, rear = -0.5, front = 0.42;
  const bot = -legH, top = bot - depth;
  const parts = [];
  if (!lying) parts.push(['fig-line', legs(h, [rear + 0.14, rear + 0.24, front - 0.24, front - 0.14], bot, pose === 'step' ? 0.06 : 0, false)]);
  parts.push([black ? 'fig-ink' : 'fig-body', cloud(h.sp([[rear, top], [front, top], [front, bot], [rear, bot]]), 11 + Math.floor(rnd() * 3), rnd, s)]);
  // the head, tucked in against the front of the fleece, an ear up and back
  const hc = pose === 'graze' ? [front + 0.1, -0.15] : lying ? [front + 0.06, top + 0.1] : [front + 0.1, top + 0.08];
  if (pose !== 'graze') parts.push(['fig-line', h.stroke([[hc[0] - 0.04, hc[1] - 0.08], [hc[0] - 0.16, hc[1] - 0.2]])]); // (head down: no ear to see)
  parts.push(['fig-ink', h.blob(hc, 0.14, 0.11, PEOPLE.lumpy, 6)]);
  return parts;
}

const cache = new Map();

// Inner SVG of a 'cow' or 'sheep' in `pose`, body `variant`.
export function livestockSVG(kind, pose, variant) {
  const v = variant % LIVESTOCK.bodies, key = `${kind}|${pose}|${v}`;
  if (!cache.has(key)) {
    const parts = kind === 'sheep' ? sheep(pose, v) : cow(pose, v);
    cache.set(key, parts.map(([cls, d]) => `<path class="${cls}" d="${d}"/>`).join(''));
  }
  return cache.get(key);
}

// The plain mark further out: a low, wide rectangle, as the deer's.
export function livestockMark(kind) {
  const [w, h] = (kind === 'sheep' ? [0.9, 0.7] : [1.6, 0.9]).map((v) => v * LIVESTOCK.scale);
  return `M${r2(-w / 2)} ${r2(-h)}h${r2(w)}v${r2(h)}h${r2(-w)}Z`;
}
