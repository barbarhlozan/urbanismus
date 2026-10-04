// A little landscape for the New map menu, drawn by pen like the map: the
// settings as a picture instead of words. Hills behind rise from a flat
// line to sharp mountains, hatched where they're steep; lakes lie in the
// plain in front, one by one; trees stand on the near ridge and in the
// plain, a few at first, then whole forests; the water winds out of the
// hills towards you, a thin stream or a river, and with streams joining
// it. Changes move: the hills grow or sink, trees and lakes pop up or
// shrink away, the water runs out towards you (not with reduce motion).
//
//   const p = new LandscapePreview()
//   root.appendChild(p.el); p.set({ hills: 2, lakes: 3, forest: 1, river: 2 })
//   hills, forest, river: the option's index (0–4; river 0–3: none,
//   stream, river, river and streams); lakes: how many (0–5)
//   p.focus('lakes')  shows that part, the rest faint (null: all of it)

import { sketchEllipse, seedOf } from '../render/sketch.js';
import { mulberry32 } from '../core/random.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 440, H = 150;   // the drawing's own units (it scales to fit)
const BACK = 112;         // the foot of the hills behind
const NEAR = 118;         // the near ridge's foot, where the plain starts
const STEP = 4;           // px between the points of a ridge

// per Land option (newMapMenu.js SETTINGS.hills): the hills' height, and
// how pointed their tops are (0: round, 1: peaks)
const HEIGHT = [2, 16, 36, 56, 84];
const SHARP = [0, 0, 0.15, 0.45, 0.9];
// per Forests option: how many trees (of TREES, in this order)
const TREE_COUNT = [0, 5, 12, 22, 34];

// the hills behind and the near ridge: bumps at [x, width, height] (of W)
const BACK_BUMPS = [[0.12, 0.11, 0.65], [0.36, 0.15, 1], [0.58, 0.09, 0.7], [0.8, 0.13, 0.85], [0.98, 0.08, 0.5]];
const NEAR_BUMPS = [[0.2, 0.18, 0.5], [0.52, 0.2, 0.35], [0.85, 0.16, 0.45]];

// where lakes lie, in the order they appear: [x, y, rx, ry]
const LAKES = [[0.5, 133, 30, 6.5], [0.15, 138, 22, 5], [0.82, 131, 25, 5.5], [0.33, 143, 16, 3.8], [0.68, 144, 18, 4]];

// The water, as the line down its middle ([x, y] through which it winds,
// from the foot of the hills to the front edge) and its width across at
// the back and at the front (nearer, wider). It keeps between the lakes.
// The streams joining the river end in its middle, hidden by its water.
const RIVER_LINE = [[318, 119], [301, 124], [289, 129], [281, 134], [271, 139.5], [261, 146], [255, 153]];
const STREAM_LINES = [
  [[412, 119], [394, 122.5], [372, 121], [350, 123.5], [328, 122.5], [302, 125]],
  [[176, 153], [190, 148], [214, 146.5], [240, 144], [262, 141], [276, 137]],
];
const WIDE = { river: [1.4, 9], stream: [0.6, 3] };

// a smooth line through the points (Catmull–Rom), `n` points per stretch
function smooth(pts, n = 6) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((c) => 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// the water's middle at height y (null: not that far down)
function waterAt(pts, y) {
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if ((y - y0) * (y - y1) <= 0 && y0 !== y1) return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
  }
  return null;
}

// a band of water along a middle line: { water: its area, banks: its two banks }
function waterBand(middle, [back, front], seed) {
  const pts = smooth(middle), rnd = mulberry32(seed);
  const sides = [[], []];
  pts.forEach(([x, y], i) => {
    const [ax, ay] = pts[Math.max(0, i - 1)], [bx, by] = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    const half = (back + (front - back) * Math.min(1, Math.max(0, (y - NEAR) / (H - NEAR)))) / 2;
    for (const [k, side] of [[0, 1], [1, -1]]) {
      const w = half + (rnd() - 0.5) * 0.3 * half;
      sides[k].push([x - ((by - ay) / l) * w * side, y + ((bx - ax) / l) * w * side]);
    }
  });
  return { water: `${line(sides[0])}${line(sides[1].reverse()).replace('M', 'L')}Z`, banks: line(sides[0]) + line(sides[1]) };
}

// where trees stand, in the order they come: [x, depth below the ridge
// (0: on it; more: in the plain in front), size, round?]. Two woods grow
// from their middles, then a few strays.
const TREES = (() => {
  const rnd = mulberry32(seedOf(7, 11));
  const woods = [[0.24, 0], [0.64, 0], [0.94, 1]];
  const list = [];
  for (let i = 0; i < 34; i++) {
    const [cx, wood] = woods[i % 5 === 4 ? 2 : i % 2];
    const spread = 0.03 + 0.016 * Math.floor(i / 2);
    let x = cx + (rnd() - 0.5) * 2 * spread;
    // the later ones further out, and further in front
    let depth = wood === 1 ? 0 : rnd() * (i < 8 ? 3 : i < 20 ? 8 : 13);
    // keep the lakes clear (those in front: their whole width), and the water
    for (const [lx, , rx] of LAKES) {
      const clear = depth > 6 ? rx / W + 0.035 : 0.03;
      if (Math.abs(x - lx) < clear) x = lx + (x < lx ? -clear : clear);
    }
    for (const water of [RIVER_LINE, ...STREAM_LINES]) {
      const wx = depth > 1 ? waterAt(water, NEAR + depth) : null;
      if (wx != null && Math.abs(x * W - wx) < 9) x = (wx + (x * W < wx ? -9 : 9)) / W;
    }
    list.push([Math.min(0.99, Math.max(0.01, x)), depth, 0.95 + rnd() * 0.45, rnd() < 0.22]);
  }
  return list;
})();

const r1 = (n) => Math.round(n * 10) / 10;

// a ridge's height above its foot at x (0–1): bumps rounded or pointed
function ridge(bumps, x, height, sharp) {
  let h = 0;
  for (const [c, w, k] of bumps) {
    const d = Math.abs(x - c) / w;
    const round = Math.exp(-d * d);
    const peak = Math.max(0, 1 - d * 0.75) ** 1.6;
    h = Math.max(h, k * (round * (1 - sharp) + peak * sharp));
  }
  return h * height;
}

// the points of a ridge, with a fixed small wobble (the same every frame)
function ridgePoints(bumps, foot, height, sharp, seed) {
  const rnd = mulberry32(seed);
  const pts = [];
  for (let x = -STEP; x <= W + STEP; x += STEP) {
    pts.push([x, foot - ridge(bumps, x / W, height, sharp) + (rnd() - 0.5) * 0.7]);
  }
  return pts;
}

const line = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`).join('');
const area = (pts) => `${line(pts)}L${W + STEP} ${H}L${-STEP} ${H}Z`;

// short strokes down the shady (right-hand) side wherever a ridge is steep
function hatch(pts, seed) {
  const rnd = mulberry32(seed);
  let d = '';
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const slope = (y1 - y0) / (x1 - x0); // > 0: going down to the right
    if (slope < 0.45) continue;
    const n = slope > 1.1 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const x = x0 + (x1 - x0) * (k + 0.5) / n, y = y0 + (y1 - y0) * (k + 0.5) / n + 1.5;
      const len = 4 + slope * 3 + rnd() * 3;
      d += `M${r1(x)} ${r1(y)}l${r1(-len * 0.35)} ${r1(len)}`;
    }
  }
  return d;
}

// a tree as the map draws them small: a pine of three tiers or a round crown
function treePath(size, round) {
  const s = size;
  if (round) {
    return `M0 0V${r1(-6 * s)}` + sketchEllipse(0, -10 * s, 5 * s, 5 * s, seedOf(size * 100), { turns: 1.05 });
  }
  const tier = (top, half, base) => `M0 ${r1(top)}L${r1(-half)} ${r1(base)}H${r1(half)}Z`;
  return `M0 0V${r1(-3 * s)}` + tier(-18 * s, 4.2 * s, -10 * s) + tier(-14.5 * s, 5.2 * s, -6.5 * s) + tier(-11 * s, 6.2 * s, -3 * s);
}

const el = (name, attrs = {}) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

export class LandscapePreview {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'newmap-scene';
    this.svg = el('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
    this.el.appendChild(this.svg);

    const hills = el('g', { class: 'lp-hills' });
    this.backFill = el('path', { class: 'lp-fill' });
    this.backLine = el('path', { class: 'lp-back' });
    this.backHatch = el('path', { class: 'lp-hatch' });
    this.nearFill = el('path', { class: 'lp-fill' });
    this.nearLine = el('path', { class: 'lp-near' });
    this.nearHatch = el('path', { class: 'lp-hatch' });
    hills.append(this.backFill, this.backLine, this.backHatch);

    const lakes = el('g', { class: 'lp-lakes' });
    this.lakes = LAKES.map(([x, y, rx, ry], i) => {
      const g = el('g', { class: 'lp-item', transform: `translate(${r1(x * W)} ${y})` });
      const shape = el('path', { class: 'lp-lake', d: sketchEllipse(0, 0, rx, ry, seedOf(i, 3)) });
      const ripples = el('path', { class: 'lp-ripple', d: `M${r1(-rx * 0.45)} ${r1(-ry * 0.1)}h${r1(rx * 0.35)}M${r1(rx * 0.05)} ${r1(ry * 0.35)}h${r1(rx * 0.3)}` });
      const grow = el('g', { class: 'lp-grow' });
      grow.append(shape, ripples);
      g.appendChild(grow);
      lakes.appendChild(g);
      return g;
    });

    // the near ridge in front of the hills, its trees on and in front of it
    const near = el('g', { class: 'lp-hills' });
    near.append(this.nearFill, this.nearLine, this.nearHatch);
    const trees = el('g', { class: 'lp-trees' });
    this.trees = TREES.map(([, , size, round], i) => {
      const g = el('g', { class: 'lp-item' });
      const grow = el('g', { class: 'lp-grow', style: `transition-delay: ${(i % 6) * 30}ms` });
      grow.appendChild(el('path', { class: 'lp-tree', d: treePath(size * 1.15, round) }));
      g.appendChild(grow);
      return g;
    });
    // those further in front drawn later, over the ones behind
    for (const i of TREES.map((_, i) => i).sort((a, b) => TREES[a][1] - TREES[b][1])) trees.appendChild(this.trees[i]);
    // the water: the streams first, their ends under the river's water
    const water = el('g', { class: 'lp-water' });
    const band = (lineAt, wide, seed) => {
      const g = el('g', { class: 'lp-item' });
      const grow = el('g', { class: 'lp-grow' });
      const { water: area, banks } = waterBand(lineAt, wide, seed);
      grow.append(el('path', { class: 'lp-lake lp-flow', d: area }), el('path', { class: 'lp-bank', d: banks }));
      g.appendChild(grow);
      water.appendChild(g);
      return g;
    };
    this.streams = STREAM_LINES.map((l, i) => band(l, WIDE.stream, seedOf(i, 9)));
    this.stream = band(RIVER_LINE, WIDE.stream, seedOf(5, 9));
    this.river = band(RIVER_LINE, WIDE.river, seedOf(6, 9));
    this.layers = { hills: [hills, near], lakes: [lakes], forest: [trees], river: [water] };
    this.svg.append(hills, near, water, lakes, trees);

    this.height = null; // drawn now (moves towards the target)
    this.sharp = 0;
  }

  set({ hills, lakes, forest, river = 0 }) {
    this.lakes.forEach((g, i) => g.classList.toggle('on', i < lakes));
    this.stream.classList.toggle('on', river === 1);
    this.river.classList.toggle('on', river >= 2);
    this.streams.forEach((g) => g.classList.toggle('on', river === 3));
    this.trees.forEach((g, i) => g.classList.toggle('on', i < TREE_COUNT[forest]));
    const to = [HEIGHT[hills], SHARP[hills]];
    if (this.height == null || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cancelAnimationFrame(this.frame);
      [this.height, this.sharp] = to;
      this.draw();
      return;
    }
    // the hills grow or sink to it, going a little past and back
    const from = [this.height, this.sharp];
    const start = performance.now(), ms = 520;
    const ease = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
    cancelAnimationFrame(this.frame);
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms), e = ease(t);
      this.height = from[0] + (to[0] - from[0]) * e;
      this.sharp = from[1] + (to[1] - from[1]) * Math.min(1, t * 1.4);
      this.draw();
      if (t < 1) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  // The hills at their height now, and the trees standing on the near ridge.
  draw() {
    const h = Math.max(0, this.height), s = this.sharp;
    const back = ridgePoints(BACK_BUMPS, BACK, h, s, 21);
    const near = ridgePoints(NEAR_BUMPS, NEAR, h * 0.32, s * 0.5, 22);
    this.backFill.setAttribute('d', area(back));
    this.backLine.setAttribute('d', line(back));
    // flat: no hills behind, just the one ground line
    this.backLine.style.opacity = Math.min(1, Math.max(0, (h - 2) / 10)).toFixed(2);
    this.backHatch.setAttribute('d', hatch(back, 23));
    this.nearFill.setAttribute('d', area(near));
    this.nearLine.setAttribute('d', line(near));
    this.nearHatch.setAttribute('d', hatch(near, 24));
    const groundAt = (x) => NEAR - ridge(NEAR_BUMPS, x, h * 0.32, s * 0.5);
    TREES.forEach(([x, depth], i) => {
      this.trees[i].setAttribute('transform', `translate(${r1(x * W)} ${r1(groundAt(x) + depth + 1)})`);
    });
  }

  // one part shown, the rest faint (a slider pointed at); null: all
  focus(key) {
    for (const [k, layers] of Object.entries(this.layers)) {
      for (const g of layers) g.classList.toggle('faint', !!key && k !== key);
    }
  }
}
