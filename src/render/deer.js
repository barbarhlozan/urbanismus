// Deer close up: toy pen figures after the deer sketch sheet (deer.html,
// style C) – a rounded box of a body on four thin legs, the hind ones
// bent at the hock, a single stroke of a neck up to a round head (open or
// inked in), two ears, and a square bob of a tail. A stag has one antler
// beam with two tines, a roe buck a spike with one tine; fawns are smaller
// and leggier. Seen from the side, facing right; the renderer mirrors them
// to face the way they go, like the walkers (people.js).
//
// Poses: 'stand', 'step' (legs apart, every other stride while walking)
// and 'graze' (neck swung down from the withers, muzzle in the grass).
// Drawn in scene px around the deer's ground point, at the walkers' scale
// (a walker is PEOPLE.height tall). Everything is cached.

import { mulberry32 } from '../core/random.js';

export const DEER = {
  bodies: 8,     // small variations per kind (size, head inked or open, wobble)
  scale: 1.6,    // scene px per sketch unit (a walker is 2.5 tall): drawn larger than life, to be seen
  stride: 0.08,  // grid units walked per step (legs apart, then together)
};

// The kinds: overall size, and antlers. Red deer are the big ones, roe
// deer the small; the hinds and does carry none.
export const DEER_KINDS = {
  stag: { s: 1.2, antlers: 'stag' },
  hind: { s: 1.12 },
  buck: { s: 0.95, antlers: 'roe' },
  doe: { s: 0.92 },
  fawn: { s: 0.62, fawn: true },
};

const r2 = (n) => Math.round(n * 100) / 100;
const P = ([x, y]) => `${r2(x)} ${r2(y)}`;
const poly = (pts, close = true) => `M${pts.map(P).join('L')}${close ? 'Z' : ''}`;
const ball = ([cx, cy], r) => `M${r2(cx - r)} ${r2(cy)}a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0`;
// a closed shape with its corners rounded off by `k` (0–0.5 of each side)
function rounded(pts, k) {
  const n = pts.length, mid = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  let d = `M${P(mid(pts[0], pts[1], k))}`;
  for (let i = 1; i <= n; i++) {
    const a = pts[(i - 1) % n], b = pts[i % n], c = pts[(i + 1) % n];
    d += `L${P(mid(a, b, 1 - k))}Q${P(b)} ${P(mid(b, c, k))}`;
  }
  return `${d}Z`;
}
const turn = (o, a) => ([x, y]) => {
  const dx = x - o[0], dy = y - o[1], c = Math.cos(a), s = Math.sin(a);
  return [o[0] + dx * c - dy * s, o[1] + dx * s + dy * c];
};

// One deer as [class, d] parts. Sketch units: y up is negative, the
// ground at 0, a doe's withers about 1 up.
function deerParts(kind, pose, variant) {
  const K = DEER_KINDS[kind] ?? DEER_KINDS.doe;
  const rnd = mulberry32(variant * 2654435761 + 7);
  const s = K.s * (0.94 + rnd() * 0.12) * DEER.scale;
  const jit = () => (rnd() - 0.5) * 0.015;
  const fawn = !!K.fawn;
  const legH = fawn ? 0.66 : 0.55, depth = fawn ? 0.36 : 0.44;
  const rear = -0.6, chest = fawn ? 0.5 : 0.6;
  const bot = -legH, top = bot - depth;

  // the head and what's on it, standing; turned down together for grazing
  const pivot = [chest - 0.12, top + 0.1];
  const neckTop = [0.79, -1.48];
  let head = [0.82, -1.52];                              // the round head's centre
  let ears = [[[0.72, -1.6], [0.6, -1.8]], [[0.78, -1.62], [0.73, -1.84]]];
  let antlers = K.antlers === 'stag'
    ? [[[0.74, -1.62], [0.66, -1.95], [0.56, -2.26]], [[0.68, -1.86], [0.84, -1.94]], [[0.6, -2.12], [0.75, -2.24]]]
    : K.antlers === 'roe' ? [[[0.78, -1.62], [0.77, -1.96]], [[0.775, -1.8], [0.86, -1.86]]] : [];
  if (pose === 'graze') {
    // swing the neck down about the withers, the head held up a little
    // against it, until the muzzle is in the grass
    const nose = [1.12, -1.405], tilt = -0.85;
    const both = (a) => (p) => { const t = turn(pivot, a); return turn(t(neckTop), tilt)(t(p)); };
    let lo = 0, hi = 2.5;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (both(m)(nose)[1] < -0.03) lo = m; else hi = m; }
    const t = both(lo);
    head = t(head); ears = ears.map((l) => l.map(t)); antlers = antlers.map((l) => l.map(t));
  }

  const S = ([x, y]) => [x * s + jit(), y * s];
  const sp = (pts) => pts.map(S);
  const lines = (ls) => ls.map((l) => poly(sp(l), false)).join('');
  const parts = [];

  // four legs: the near and far one of each pair, apart when stepping
  const spread = pose === 'step' ? 0.09 : 0;
  let legs = '';
  for (const [x, foot] of [[rear + 0.1, spread], [rear + 0.2, -spread], [chest - 0.22, -spread], [chest - 0.12, spread]]) {
    const pts = x < 0
      ? [[x, bot + 0.02], [x - 0.07 + foot / 2, bot * 0.45], [x - 0.02 + foot, 0]]  // hind: bent at the hock
      : [[x, bot + 0.02], [x + 0.01 + foot / 2, bot * 0.5], [x + foot, 0]];
    legs += poly(sp(pts), false);
  }
  parts.push(['fig-line', legs]);
  parts.push(['fig-body', rounded(sp([[rear, top + 0.06], [chest - 0.1, top - 0.02], [chest, bot + 0.04], [rear + 0.04, bot]]), 0.3)]);
  const hc = S(head);
  parts.push(['fig-line', `M${P(S([chest - 0.1, top + 0.1]))}L${P(hc)}${lines([...ears, ...antlers])}`]);
  parts.push([rnd() < 0.5 ? 'fig-ink' : 'fig-head', ball(hc, 0.13 * s)]);
  // a square bob of a tail
  const [tx, ty] = S([rear - 0.02, top + 0.12]), th = 0.05 * s;
  parts.push(['fig-ink', poly([[tx - th, ty - th], [tx + th, ty - th], [tx + th, ty + th], [tx - th, ty + th]])]);
  return parts;
}

const cache = new Map();

// Inner SVG of a deer of `kind` (a DEER_KINDS key) in `pose`, body `variant`.
export function deerSVG(kind, pose, variant) {
  const key = `${kind}|${pose}|${variant % DEER.bodies}`;
  if (!cache.has(key)) {
    cache.set(key, deerParts(kind, pose, variant % DEER.bodies).map(([cls, d]) => `<path class="${cls}" d="${d}"/>`).join(''));
  }
  return cache.get(key);
}

// The plain mark for a deer further out: a low, wide rectangle (the
// walkers' is upright, render/marks.js), smaller for a fawn.
export function deerMark(kind) {
  const k = (DEER_KINDS[kind] ?? DEER_KINDS.doe).s;
  const w = 1.1 * k * DEER.scale, h = 0.55 * k * DEER.scale;
  return `M${r2(-w / 2)} ${r2(-h)}h${r2(w)}v${r2(h)}h${r2(-w)}Z`;
}
