// The pen's timing for the map's linework: roads, kerbs, driveways,
// footpaths, railways and fences (drawn with WebGL, gl/lines.js). The pen
// counterpart of draw.js for things that the renderer draws as a few long
// lines per layer rather than per object.
//
// The renderer hands over the whole layer as items, one per network segment
// (or exit, buffer, driveway), each with a stable key and its points – or
// with `runs`, several separate lines drawn in one after another (a track's
// sleepers). A key that wasn't there last time is drawn in along its line; a
// key that is gone is erased back along it. Segments built in one go are
// ranked along the way they were drawn (the order of the dots in the build
// event), so the pen runs down the new road from where the player started.
// What is on the move, and how far it has got (frac), is all this keeps:
// gl/lines.js draws each item as far as that.

import { DRAW } from './draw.js';

export const INK = {
  min: 260,     // ms for a single segment…
  step: 60,     // …plus this for each further segment in drawing order
  max: 1400,    // at most
  erase: 380,   // ms to erase
  cap: 240,     // more new segments at once than this (a new map) just appear
};

const clamp01 = (u) => (u < 0 ? 0 : u > 1 ? 1 : u);
const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));
export class InkLayer {
  // `classes`: the layer's path classes, back to front.
  constructor(classes) {
    this.classes = classes;
    this.items = new Map();  // key -> { key, cls, pts, a, b }
    this.moving = new Map(); // key -> { item, batch, rank, flip, out, cap }
    this.first = true;
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

  // Lines whose pen is done let go.
  tick(now = performance.now()) {
    for (const [k, m] of this.moving) if (now >= m.batch.t0 + m.batch.T) this.moving.delete(k);
  }
}
