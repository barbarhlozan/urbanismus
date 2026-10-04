// Cows and sheep close up, drawn like the deer (deer.js) after the sketch
// sheet (livestock.html, style A of each):
//   a cow – a long rounded body with two or three inked patches, four thin
//     legs, a single stroke of a neck to a long face with two horns, a tail
//     with a square tuft; now and then a dark one, inked all over
//   a sheep – a fleece of round bumps on short thin legs, an inked head
//     tucked in at the front, an ear up and back; now and then a black one
// Poses: 'stand', 'step' (legs apart), 'graze' (head down in the grass)
// and 'lie' (folded down on the grass). Seen from the side, facing right;
// the renderer mirrors them like the deer. Scene px round the ground
// point, at the walkers' scale. Everything is cached.

import { mulberry32 } from '../core/random.js';

export const LIVESTOCK = {
  bodies: 12,    // variations per kind; body 0 is the dark cow / the black sheep
  scale: 1.6,    // scene px per sketch unit (a walker is 2.5 tall): drawn larger than life, as the deer
  stride: 0.07,  // grid units walked per step
};

const r2 = (n) => Math.round(n * 100) / 100;
const P = ([x, y]) => `${r2(x)} ${r2(y)}`;
const poly = (pts, close = true) => `M${pts.map(P).join('L')}${close ? 'Z' : ''}`;
const ball = ([cx, cy], r, ry = r) => `M${r2(cx - r)} ${r2(cy)}a${r2(r)} ${r2(ry)} 0 1 0 ${r2(2 * r)} 0a${r2(r)} ${r2(ry)} 0 1 0 ${r2(-2 * r)} 0`;
const square = ([x, y], h) => poly([[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]]);
const mid = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// a closed shape with its corners rounded off by `k` (0–0.5 of each side)
function rounded(pts, k) {
  const n = pts.length;
  let d = `M${P(mid(pts[0], pts[1], k))}`;
  for (let i = 1; i <= n; i++) {
    const a = pts[(i - 1) % n], b = pts[i % n], c = pts[(i + 1) % n];
    d += `L${P(mid(a, b, 1 - k))}Q${P(b)} ${P(mid(b, c, k))}`;
  }
  return `${d}Z`;
}

// a fleece: round bumps all along a box (corners clockwise from top left)
function cloud(pts, bumps, rnd) {
  const segs = pts.map((p, i) => [p, pts[(i + 1) % pts.length]]);
  const lens = segs.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1])), total = lens.reduce((a, b) => a + b);
  const at = (u) => {
    let d = u * total, i = 0;
    while (d > lens[i] && i < lens.length - 1) d -= lens[i++];
    return mid(...segs[i], d / lens[i]);
  };
  const ring = Array.from({ length: bumps }, (_, i) => at((i + 0.3) / bumps));
  let d = `M${P(ring[0])}`;
  for (let i = 1; i <= bumps; i++) {
    const r = (total / bumps) * (0.55 + rnd() * 0.15);
    d += `A${r2(r)} ${r2(r)} 0 0 1 ${P(ring[i % bumps])}`;
  }
  return `${d}Z`;
}

// four legs (x positions, back to front), apart when stepping; hind ones
// bent at the hock (`bend`)
function legs(xs, bot, spread, bend) {
  return xs.map((x, i) => {
    const f = spread * (i === 0 || i === 3 ? 1 : -1);
    return poly(x < 0 && bend
      ? [[x, bot + 0.02], [x - 0.05 + f / 2, bot * 0.45], [x - 0.01 + f, 0]]
      : [[x, bot + 0.02], [x + 0.01 + f / 2, bot * 0.5], [x + f, 0]], false);
  }).join('');
}

function cow(pose, variant) {
  const rnd = mulberry32(variant * 2654435761 + 3);
  const s = (0.95 + rnd() * 0.1) * LIVESTOCK.scale;
  const dark = variant === 0;
  const lying = pose === 'lie';
  const legH = lying ? 0.06 : 0.52, depth = 0.62, rear = -0.85, chest = 0.78;
  const bot = -legH, top = bot - depth;
  const S = ([x, y]) => [x * s, y * s];
  const sp = (pts) => pts.map(S);
  const parts = [];
  if (lying) parts.push(['fig-line', poly(sp([[chest - 0.3, -0.02], [chest + 0.02, -0.02]]), false)]); // legs folded under
  else parts.push(['fig-line', legs([rear + 0.12, rear + 0.24, chest - 0.26, chest - 0.14].map((x) => x * s), bot * s, pose === 'step' ? 0.09 : 0, true)]);
  // the body: a long rounded box, a hint of a hip at the back
  parts.push([dark ? 'fig-ink' : 'fig-body', rounded(sp([[rear, top + 0.02], [rear + 0.25, top - 0.03], [chest - 0.05, top + 0.02], [chest + 0.02, bot + 0.08], [rear + 0.02, bot + 0.02]]), 0.25)]);
  if (!dark) {
    let d = '';
    for (let k = 2 + Math.floor(rnd() * 2); k > 0; k--) {
      const cx = rear + 0.2 + rnd() * (chest - rear - 0.45), cy = top + 0.15 + rnd() * (depth - 0.3);
      const w = 0.08 + rnd() * 0.09, h = 0.07 + rnd() * 0.07;
      d += rounded(sp([[cx - w, cy - h], [cx + w * 0.8, cy - h * 1.2], [cx + w, cy + h * 0.7], [cx - w * 0.6, cy + h]]), 0.35);
    }
    parts.push(['fig-ink', d]);
  }
  // a tail down the back, a tuft at its end
  const tail = lying ? [[rear, top + 0.1], [rear - 0.14, top + 0.3], [rear - 0.2, -0.04]] : [[rear + 0.01, top + 0.08], [rear - 0.11, top + 0.3], [rear - 0.13, bot + 0.04]];
  parts.push(['fig-line', poly(sp(tail), false)]);
  parts.push(['fig-ink', square(S(tail.at(-1)), 0.05 * s)]);
  // a stroke of a neck out to a long face with two horns and an ear
  const [cx, cy] = pose === 'graze' ? [chest + 0.38, -0.26] : lying ? [chest + 0.3, top - 0.04] : [chest + 0.4, top - 0.04];
  parts.push(['fig-line', poly(sp([[chest - 0.1, top + 0.1], [cx - 0.04, cy - 0.04]]), false)]);
  parts.push([dark || rnd() < 0.3 ? 'fig-ink' : 'fig-body', rounded(sp([[cx - 0.12, cy - 0.16], [cx + 0.11, cy - 0.15], [cx + 0.2, cy + 0.19], [cx, cy + 0.21]]), 0.3)]);
  parts.push(['fig-line', poly(sp([[cx - 0.08, cy - 0.15], [cx - 0.14, cy - 0.3]]), false) + poly(sp([[cx + 0.05, cy - 0.15], [cx + 0.1, cy - 0.3]]), false)
    + poly(sp([[cx - 0.11, cy - 0.08], [cx - 0.28, cy - 0.04]]), false)]);
  return parts;
}

function sheep(pose, variant) {
  const rnd = mulberry32(variant * 2654435761 + 5);
  const s = (0.92 + rnd() * 0.16) * LIVESTOCK.scale;
  const black = variant === 0;
  const lying = pose === 'lie';
  const legH = lying ? 0.03 : 0.3, depth = 0.5, rear = -0.5, front = 0.42;
  const bot = -legH, top = bot - depth;
  const S = ([x, y]) => [x * s, y * s];
  const sp = (pts) => pts.map(S);
  const parts = [];
  if (!lying) parts.push(['fig-line', legs([rear + 0.14, rear + 0.24, front - 0.24, front - 0.14].map((x) => x * s), bot * s, pose === 'step' ? 0.06 : 0, false)]);
  parts.push([black ? 'fig-ink' : 'fig-body', cloud(sp([[rear, top], [front, top], [front, bot], [rear, bot]]), 11 + Math.floor(rnd() * 3), rnd)]);
  // the head, tucked in against the front of the fleece, an ear up and back
  const hc = pose === 'graze' ? [front + 0.1, -0.15] : lying ? [front + 0.06, top + 0.1] : [front + 0.1, top + 0.08];
  parts.push(['fig-line', poly(sp([[hc[0] - 0.04, hc[1] - 0.08], [hc[0] - 0.16, hc[1] - 0.2]]), false)]);
  const hr = 0.13 * s;
  parts.push(['fig-ink', ball(S(hc), hr * 1.05, hr * 0.85)]);
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
