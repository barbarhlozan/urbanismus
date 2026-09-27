// Linework layers that draw themselves: roads, kerbs, driveways, footpaths
// and railways. The pen counterpart of draw.js for things that the renderer
// draws as a few long paths per layer rather than per object.
//
// The renderer hands over the whole layer as items, one per network segment
// (or exit, buffer, driveway), each with a stable key and its points on
// screen. A key that wasn't there last time is drawn in along its line; a
// key that is gone is erased back along it. Segments built in one go are
// ranked along the way they were drawn (the order of the dots in the build
// event), so the pen runs down the new road from where the player started.
//
// DOM per layer: for each class, one path of settled lines, then one of the
// lines on the move. Settled lines that continue each other are joined into
// one subpath, so dash patterns (footpaths, rail dashes) run on unbroken.
// Moving lines are redrawn every frame as the part of their points the pen
// has reached – this works for dashed lines too, where a dash reveal can't.

import { DRAW } from './draw.js';

export const INK = {
  min: 260,     // ms for a single segment…
  step: 60,     // …plus this for each further segment in drawing order
  max: 1400,    // at most
  erase: 380,   // ms to erase
  cap: 240,     // more new segments at once than this (a new map) just appear
};

const SVGNS = 'http://www.w3.org/2000/svg';
const r2 = (n) => Math.round(n * 100) / 100;
const clamp01 = (u) => (u < 0 ? 0 : u > 1 ? 1 : u);
const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));
const near = (p, q) => p && q && Math.abs(p[0] - q[0]) < 0.05 && Math.abs(p[1] - q[1]) < 0.05;

// The first f (0..1) of a polyline, by length; from its end when `flip`.
function partial(pts, f, flip) {
  if (flip) pts = pts.slice().reverse();
  if (f >= 1) return pts;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let left = total * f;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const l = Math.hypot(bx - ax, by - ay);
    if (l >= left) {
      const t = l ? left / l : 0;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      break;
    }
    out.push(pts[i]);
    left -= l;
  }
  return out;
}

const pathD = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r2(x)} ${r2(y)}`).join('');

export class InkLayer {
  // `classes`: the layer's path classes, back to front.
  constructor(el, classes) {
    this.items = new Map();  // key -> { key, cls, pts, a, b }
    this.moving = new Map(); // key -> { item, batch, rank, flip, out, cap }
    this.first = true;
    this.settledDirty = true;
    this.paths = {};
    el.innerHTML = '';
    for (const cls of classes) {
      const settled = el.appendChild(document.createElementNS(SVGNS, 'path'));
      const moving = el.appendChild(document.createElementNS(SVGNS, 'path'));
      settled.setAttribute('class', cls);
      moving.setAttribute('class', cls);
      this.paths[cls] = { settled, moving };
    }
  }

  get busy() {
    return this.moving.size > 0;
  }

  // Replace the layer's items. rankOf(item) -> { rank, flip } places a new
  // item in the drawing order (null: all at once).
  update(items, { now = performance.now(), animate = true, rankOf = () => null } = {}) {
    const next = new Map(items.map((it) => [it.key, it]));
    const born = [], gone = [];
    if (!this.first) {
      for (const it of items) if (!this.items.has(it.key)) born.push(it);
      for (const [k, it] of this.items) if (!next.has(k)) gone.push(it);
    }
    this.first = false;
    animate = animate && DRAW.on && !matchMedia('(prefers-reduced-motion: reduce)').matches;

    // segments still being drawn in get their new shape, or are erased from
    // as far as they got
    const caps = new Map();
    for (const [k, m] of this.moving) {
      if (m.out) continue;
      if (next.has(k)) m.item = next.get(k);
      else {
        caps.set(k, this.frac(m, now));
        this.moving.delete(k);
      }
    }

    if (animate && born.length && born.length <= INK.cap) {
      const ranked = born.map((item) => ({ item, ...(rankOf(item) ?? { rank: 0, flip: false }) }));
      // dense ranks: steps of the pen, however the dots were numbered
      const steps = [...new Set(ranked.map((r) => r.rank))].sort((x, y) => x - y);
      const index = new Map(steps.map((r, i) => [r, i]));
      const n = steps.length;
      const batch = { t0: now, n, T: Math.min(INK.max, INK.min + (n - 1) * INK.step) * DRAW.speed };
      for (const r of ranked) this.moving.set(r.item.key, { item: r.item, batch, rank: index.get(r.rank), flip: r.flip, out: false });
    }
    if (animate && gone.length && gone.length <= INK.cap) {
      const batch = { t0: now, n: 1, T: INK.erase * DRAW.speed };
      for (const item of gone) {
        const m = { item, batch, rank: 0, flip: false, out: true, cap: caps.get(item.key) ?? 1 };
        if (m.cap > 0) this.moving.set(`${item.key}~${now}`, m);
      }
    }

    this.items = next;
    this.settledDirty = true;
    this.tick(now);
  }

  // Drop lines being erased (drawn for a view that's gone).
  clearErasing() {
    for (const [k, m] of this.moving) if (m.out) this.moving.delete(k);
  }

  // How much of a moving line is drawn (0..1).
  frac(m, now) {
    const { t0, T, n } = m.batch;
    const e = ease(clamp01((now - t0) / T)) * n;
    return m.out ? Math.min(m.cap, 1 - clamp01(e)) : clamp01(e - m.rank);
  }

  tick(now = performance.now()) {
    const moving = {};
    for (const [k, m] of this.moving) {
      if (now >= m.batch.t0 + m.batch.T) {
        this.moving.delete(k);
        if (!m.out) this.settledDirty = true;
        continue;
      }
      const f = this.frac(m, now);
      if (f <= 0) continue;
      const { cls, pts } = m.item;
      moving[cls] = (moving[cls] ?? '') + pathD(partial(pts, f, m.flip));
    }
    for (const [cls, { settled, moving: el }] of Object.entries(this.paths)) {
      const d = moving[cls] ?? '';
      if (el.getAttribute('d') !== d) el.setAttribute('d', d);
      if (!this.settledDirty) continue;
      // lines that continue each other become one subpath
      let out = '', end = null;
      for (const it of this.items.values()) {
        if (it.cls !== cls || this.moving.has(it.key)) continue;
        const [first, ...rest] = it.pts;
        out += near(end, first) ? rest.map(([x, y]) => `L${r2(x)} ${r2(y)}`).join('') : pathD(it.pts);
        end = it.pts[it.pts.length - 1];
      }
      if (settled.getAttribute('d') !== out) settled.setAttribute('d', out); // an unchanged write still re-lays it out
    }
    this.settledDirty = false;
  }
}
