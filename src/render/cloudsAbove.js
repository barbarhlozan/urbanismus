// Clouds overhead: zoomed right out under a cloudy sky, the clouds whose
// shadows drift over the map (cloudShadows.js) are drawn too, up in the
// air above their shadows – filled with paper, so they hide the town
// under them, and outlined in the pen. Zoom back in and they part; the sky
// clears and they go.
//
// Seen from above, as the map is: each cloud has its shadow's shape (the
// same lumps strung out along the wind, flattened onto the ground the same
// way), traced as an outline drawing traces clouds – every lump a heap
// bulging unevenly, the lumps run together into one outline, its edge
// crinkled all round, finely and unevenly, like the edge of torn paper.
// Where one lump lies over the next its edge often shows as a fold inside;
// now and then a small hole shows the ground through.
//
// The same clouds as the shadows, so they drift with the same wind and
// come and go with them: each lifted `lift` up the screen from its shadow,
// as big as the shadow is (`scale`). Drawn on their own canvas
// (#clouds-above) over the map, a few times a second and moved with the
// map in between (follow.js), as the shadows.

import { THEME } from '../theme.js';
import { CONFIG } from '../config.js';
import { CLOUD_SHADOWS } from './cloudShadows.js';
import { Follow } from './follow.js';

export const CLOUDS_ABOVE = {
  zoom: 0.72,          // shown at this zoom and further out (config.camera.minZoom is 0.55)
  fade: 0.9,           // seconds to come or go
  cover: [0.45, 0.95], // the sky's cover (config.weather.cover) from which the first are up, and all of them
  lift: 2.4,           // grid units up the screen from the shadow
  scale: 1,            // a cloud's size as a share of its shadow's
  swell: 1.15,         // each lump a little fuller than the shadow's, so they run together
  lobes: [2, 4],       // smaller lobes bulging out of each lump's edge…
  lobe: [0.35, 0.55],  // …this big, a share of the lump
  bulge: [0.05, 0.11], // how unevenly a lump bulges: the share of its size its edge swells and dips by
  crinkle: [0.1, 0.04], // grid units: how far the edge wobbles, the coarse ripple and the fine
  ripple: [0.32, 0.1],  // grid units: their lengths
  fold: 0.6,           // the share of lumps lying over another whose edge shows there as a fold
  hole: 0.2,           // the share with a hole
  pen: 2,              // the outline's pen (styles.css --pen-n)
  more: 3,             // times as many clouds in the sky while they're shown (their shadows too)
  fps: 6,
};

const between = (rnd, [a, b]) => a + rnd() * (b - a);

export class CloudsAbove {
  constructor(canvas, shadows) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.shadows = shadows;
    this.k = 0;          // how far they are in (0 gone, 1 there)
    this.empty = true;
    this.follow = new Follow(canvas, CLOUDS_ABOVE.fps);
  }

  // One frame: `dt` real seconds; `cover` the sky's; `stroke` the map's --stroke.
  frame(dt, camera, cover, stroke = 1) {
    const C = CLOUDS_ABOVE;
    const want = camera.zoom <= C.zoom && cover > C.cover[0] ? 1 : 0;
    const was = this.k;
    if (want > this.k) this.k = Math.min(1, this.k + dt / C.fade);
    else if (want < this.k) this.k = Math.max(0, this.k - dt / C.fade);
    // a fuller sky while they're seen (more come in as they fade in)
    this.shadows.more = 1 + (C.more - 1) * this.k;
    // (the whole drawing faded as one, so one cloud doesn't show through another)
    if (this.k !== was) this.canvas.style.opacity = this.k;
    // which clouds are up: a share of them, the more the cloudier
    const share = Math.min(1, Math.max(0, (cover - C.cover[0]) / (C.cover[1] - C.cover[0])));
    const up = this.shadows.clouds.filter((c) => c.a > 0 && (c.pick ??= Math.random()) < share);
    if (!this.k || !up.length) return this.clear();
    if (this.k === was && !this.empty && !this.follow.due(camera)) return this.follow.place(camera);
    this.draw(camera, up, stroke);
    this.follow.drawn(camera);
  }

  draw(camera, clouds, stroke) {
    const { canvas, ctx } = this, C = CLOUDS_ABOVE;
    const dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const z = dpr * camera.zoom, tile = camera.tile;
    if (!(z > 0 && tile > 0)) return;
    const css = getComputedStyle(document.documentElement);
    const pen = (parseFloat(css.getPropertyValue(`--pen-${C.pen}`)) || 1) * stroke * (CONFIG.render.lineWeight ?? 1) * dpr / z;
    const { bg, main } = THEME.palette;
    const lift = C.lift * tile;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.lineWidth = pen;
    ctx.strokeStyle = main;
    ctx.fillStyle = bg;
    // far ones first: a nearer cloud hides the back of one behind it
    for (const c of [...clouds].sort((p, q) => p.y - q.y)) {
      if (c.above?.tile !== tile) c.above = traced(Math.random, c, this.shadows.windAngle, tile);
      const { lumps, folds, holes } = c.above;
      ctx.setTransform(z, 0, 0, z, dpr * camera.panX + z * c.x, dpr * camera.panY + z * (c.y - lift));
      ctx.globalAlpha = Math.min(1, c.a);
      // each lump's outline twice as wide under all their fills: only the
      // outer half shows, round the lumps run together
      ctx.lineWidth = 2 * pen;
      for (const p of lumps) ctx.stroke(p);
      for (const p of lumps) ctx.fill(p);
      ctx.lineWidth = pen;
      // a fold: a lump's edge where it lies over the lumps behind it
      for (const { edge, over } of folds) {
        ctx.save();
        ctx.clip(over);
        ctx.stroke(edge);
        ctx.restore();
      }
      if (holes) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fill(holes);
        ctx.globalCompositeOperation = 'source-over';
        ctx.stroke(holes);
      }
    }
    ctx.globalAlpha = 1;
    this.empty = false;
  }

  clear() {
    if (this.empty) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.empty = true;
    this.follow.set('');
  }
}

// A cloud's drawing in scene px about its middle, from its shadow's lumps
// (`c.lumps`, on the ground along and across the wind): each lump's
// outline, the folds, the holes.
function traced(rnd, c, wind, tile) {
  const C = CLOUDS_ABOVE, sq = CLOUD_SHADOWS.squash, k = C.scale;
  const cos = Math.cos(wind), sin = Math.sin(wind);
  const ground = ([u, v]) => [(u * cos - v * sin) * k, (u * sin + v * cos) * sq * k];
  const crinkle = crinkler(rnd, tile);
  // each lump fuller, with smaller lobes out of its edge
  const parts = [];
  for (const l of c.lumps) {
    const ru = l.ru * C.swell, rv = l.rv * C.swell;
    parts.push({ u: l.u, v: l.v, ru, rv, main: true });
    const n = Math.round(between(rnd, C.lobes));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, f = between(rnd, C.lobe);
      parts.push({ u: l.u + Math.cos(a) * ru * 0.78, v: l.v + Math.sin(a) * rv * 0.78, ru: ru * f, rv: rv * f, main: false });
    }
  }
  const rings = parts.map(({ u, v, ru, rv, main }) => {
    // a few swells and dips round it, of their own sizes
    const swells = [2, 3, 5].map((n) => ({ n, size: between(rnd, C.bulge) / (n / 2), phase: rnd() * Math.PI * 2 }));
    const pts = [];
    const m = Math.max(40, Math.round((Math.PI * (ru + rv)) / (tile * 0.03)));
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2;
      const r = 1 + swells.reduce((sum, w) => sum + w.size * Math.sin(w.n * a + w.phase), 0);
      pts.push(ground([u + Math.cos(a) * ru * r, v + Math.sin(a) * rv * r]));
    }
    pts.push(pts[0]);
    const path = new Path2D();
    loop(path, crinkle(pts));
    return { path, main, sy: ground([u, v])[1] };
  });
  // nearer lumps (lower on the screen) over those behind
  const order = [...rings].sort((p, q) => p.sy - q.sy);
  const lumps = order.map((r) => r.path);
  const folds = [];
  for (let i = 1; i < order.length; i++) {
    if (!order[i].main || rnd() >= C.fold) continue;
    const over = new Path2D();
    for (let j = 0; j < i; j++) over.addPath(order[j].path);
    folds.push({ edge: order[i].path, over });
  }
  let holes = null;
  if (rnd() < C.hole) {
    const { u, v, ru, rv } = c.lumps[Math.floor(rnd() * c.lumps.length)];
    const r = Math.min(ru, rv) * (0.1 + rnd() * 0.08);
    const cu = u + (rnd() - 0.5) * ru * 0.6, cv = v + (rnd() - 0.5) * rv * 0.6;
    const ring = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ring.push(ground([cu + Math.cos(a) * r * 1.6, cv + Math.sin(a) * r]));
    }
    ring.push(ring[0]);
    holes = new Path2D();
    loop(holes, crinkler(rnd, tile * 0.5)(ring));
  }
  return { tile, lumps, folds, holes };
}

// A function that crinkles a run of points: each nudged off the line it
// lies on by two ripples of random heights, a coarse one and a fine one,
// easing off towards both ends of the run (so a loop closes cleanly).
function crinkler(rnd, tile) {
  const C = CLOUDS_ABOVE;
  const waves = C.ripple.map((l, k) => {
    const len = l * tile, size = C.crinkle[k] * tile;
    const knots = [];
    return (s) => {
      const u = s / len, i = Math.floor(u), f = u - i;
      while (knots.length <= i + 1) knots.push((rnd() * 2 - 1) * size);
      return knots[i] + (knots[i + 1] - knots[i]) * f * f * (3 - 2 * f);
    };
  });
  const ease = C.ripple[0] * tile;
  return (pts) => {
    const along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = along[along.length - 1];
    return pts.map(([x, y], i) => {
      const [px, py] = pts[Math.max(0, i - 1)], [qx, qy] = pts[Math.min(pts.length - 1, i + 1)];
      const s = along[i];
      const l = Math.hypot(qx - px, qy - py) || 1;
      const d = waves.reduce((sum, wave) => sum + wave(s), 0) * Math.min(1, s / ease, (total - s) / ease);
      return [x - ((qy - py) / l) * d, y + ((qx - px) / l) * d];
    });
  };
}

function loop(path, pts) {
  pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  path.closePath();
}
