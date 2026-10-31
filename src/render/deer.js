// Deer close up: toy pen figures after the deer sketch sheet (deer.html,
// style C), drawn freehand in the walkers' hand (people.js smooth,
// lumpyRound) – a lumpy rounded body on four thin legs, the hind ones
// bent at the hock, a rough round head floating in front of the shoulders
// (open or inked in, no neck, as the sheep's), two ears, and a bob of a tail. A stag has one antler
// beam with two tines, a roe buck a spike with one tine; fawns are smaller
// and leggier. Seen from the side, facing right; the renderer mirrors them
// to face the way they go, like the walkers (people.js).
//
// Poses: 'stand', 'step' (legs apart, every other stride while walking)
// and 'graze' (neck swung down from the withers, muzzle in the grass).
// Drawn in scene px around the deer's ground point, at the walkers' scale
// (a walker is PEOPLE.height tall). Everything is cached.

import { mulberry32 } from '../core/random.js';
import { PEOPLE, smooth, lumpyRound } from './people.js';

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
// legs drawn steadier than the body: thin strokes show every wobble
const LEG_WOBBLE = 0.3;
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

  const S = ([x, y]) => [x * s, y * s];
  const wob = () => PEOPLE.wobble * 2.5 * s * (rnd() * 2 - 1); // the hand's wobble, as the walkers'
  const sp = (pts, k = 1) => pts.map((p) => { const [x, y] = S(p); return [x + wob() * k, y + wob() * k]; });
  // a stroke through points, bowed a little through a point between each two
  const stroke = (pts) => {
    const q = sp(pts), all = [];
    q.forEach((p, i) => { if (i) all.push([(q[i - 1][0] + p[0]) / 2 + wob() * 0.6, (q[i - 1][1] + p[1]) / 2 + wob() * 0.6]); all.push(p); });
    return smooth(all, false);
  };
  const parts = [];

  // four legs: the near and far one of each pair, apart when stepping
  const spread = pose === 'step' ? 0.09 : 0;
  let legs = '';
  for (const [x, foot] of [[rear + 0.1, spread], [rear + 0.2, -spread], [chest - 0.22, -spread], [chest - 0.12, spread]]) {
    const pts = x < 0
      ? [[x, bot + 0.02], [x - 0.07 + foot / 2, bot * 0.45], [x - 0.02 + foot, 0]]  // hind: bent at the hock
      : [[x, bot + 0.02], [x + 0.01 + foot / 2, bot * 0.5], [x + foot, 0]];
    legs += smooth(sp(pts, LEG_WOBBLE), false);
  }
  parts.push(['fig-line', legs]);
  // the body round from the rump: the back dipping to the withers, the
  // chest, a belly
  parts.push(['fig-body', smooth(sp([
    [rear + 0.02, top + 0.08], [rear + 0.25, top], [chest - 0.25, top + 0.01], [chest - 0.06, top + 0.02],
    [chest + 0.01, (top + bot) / 2], [chest - 0.1, bot + 0.04], [(rear + chest) / 2, bot + 0.03], [rear + 0.06, bot + 0.01], [rear - 0.03, (top + bot) / 2],
  ]), true)]);
  // no neck: the head floats in front of the shoulders, as the sheep's,
  // brought in towards them from where a neck would hold it (less when
  // grazing, so the muzzle stays down by the grass)
  const base = [chest - 0.1, top + 0.1], pull = pose === 'graze' ? 0.75 : 0.45;
  const moved = [base[0] + (head[0] - base[0]) * pull, base[1] + (head[1] - base[1]) * pull];
  const by = ([x, y]) => [x + moved[0] - head[0], y + moved[1] - head[1]];
  const hc = S(moved);
  parts.push(['fig-line', [...ears, ...antlers].map((l) => stroke(l.map(by))).join('')]);
  parts.push([rnd() < 0.5 ? 'fig-ink' : 'fig-body', lumpyRound(rnd, hc[0], hc[1], 0.14 * s, 0.12 * s, PEOPLE.lumpy, 6)]);
  // a bob of a tail
  const [tx, ty] = S([rear - 0.03, top + 0.12]);
  parts.push(['fig-ink', lumpyRound(rnd, tx, ty, 0.055 * s, 0.065 * s, 0.2, 5)]);
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
