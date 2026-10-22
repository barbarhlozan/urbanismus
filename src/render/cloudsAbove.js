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
// as big as the shadow is (`scale`). Only a few of them (`most`): those
// overhead in the view, one joining when another drifts off. Each is drawn
// once on a little canvas of its own (in #clouds-above, over the map) and
// slid along with the map and the wind every frame, so they drift
// smoothly; drawn again only when the zoom has changed a good deal.

import { THEME } from '../theme.js';
import { CONFIG } from '../config.js';
import { CLOUD_SHADOWS } from './cloudShadows.js';

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
  most: 4,             // clouds overhead at most, under a cloudy sky (fewer under a thinner one)
};

const between = (rnd, [a, b]) => a + rnd() * (b - a);

export class CloudsAbove {
  constructor(el, shadows) {
    this.el = el;         // the clouds' box: a little <canvas> each
    this.shadows = shadows;
    this.k = 0;           // how far they are in, zoomed out (0 gone, 1 there)
    this.up = new Map();  // shadow cloud -> { canvas, b (how far it's in), drawn }
  }

  // One frame: `dt` real seconds; `cover` the sky's; `stroke` the map's --stroke.
  frame(dt, camera, cover, stroke = 1) {
    const C = CLOUDS_ABOVE;
    const want = camera.zoom <= C.zoom && cover > C.cover[0] ? 1 : 0;
    if (want > this.k) this.k = Math.min(1, this.k + dt / C.fade);
    else if (want < this.k) this.k = Math.max(0, this.k - dt / C.fade);
    const tile = camera.tile, lift = C.lift * tile;
    const W = innerWidth, H = innerHeight;
    // a cloud whose middle is overhead in the view (or, with `reach`, any of it)
    const seen = (c, reach = 0) => {
      const x = camera.panX + camera.zoom * c.x, y = camera.panY + camera.zoom * (c.y - lift), m = camera.zoom * c.w * reach;
      return x > -m && x < W + m && y > -m && y < H + m;
    };
    // a few of the sky's clouds, the more the cloudier: those up stay
    // while their shadows last, until they drift out of view; one more
    // joins, in view, when there's room
    const most = Math.round(C.most * Math.min(1, Math.max(0, (cover - C.cover[0]) / (C.cover[1] - C.cover[0]))));
    const alive = new Set(this.shadows.clouds);
    let staying = 0;
    for (const [c, u] of this.up) {
      u.leaving ||= !alive.has(c) || c.leaving || !seen(c, 0.8) || !this.k;
      if (!u.leaving) staying++;
    }
    if (this.k && staying < most) {
      const next = this.shadows.clouds.find((c) => !this.up.has(c) && !c.leaving && seen(c));
      if (next) this.up.set(next, { canvas: null, b: 0, leaving: false, drawn: null });
    }
    // each fades in or out by itself, slid along with the map every frame
    const z = camera.zoom, dpr = devicePixelRatio || 1;
    for (const [c, u] of this.up) {
      u.b = u.leaving ? u.b - dt / C.fade : Math.min(1, u.b + dt / C.fade);
      if (u.b <= 0) {
        u.canvas?.remove();
        this.up.delete(c);
        continue;
      }
      // drawn again only when the zoom has gone far from the one it was drawn at
      if (!u.drawn || Math.abs(z / u.drawn.zoom - 1) > 0.15 || u.drawn.stroke !== stroke || u.drawn.palette !== THEME.palette.main + THEME.palette.bg) {
        this.draw(c, u, tile, z * dpr, stroke);
        u.drawn = { zoom: z, stroke, palette: THEME.palette.main + THEME.palette.bg };
      }
      const k = z / u.drawn.zoom, [x0, y0] = u.at;
      const x = camera.panX + z * (c.x + x0), y = camera.panY + z * (c.y - lift + y0);
      u.canvas.style.transform = `translate(${x}px, ${y}px) scale(${k / dpr})`;
      u.canvas.style.opacity = u.b * this.k;
      u.canvas.style.zIndex = Math.round(c.y); // (nearer ones over those behind)
    }
  }

  // A cloud's own little canvas, drawn at `scale` device px per scene px.
  draw(c, u, tile, scale, stroke) {
    const C = CLOUDS_ABOVE;
    c.above ??= traced(Math.random, c, this.shadows.windAngle, tile);
    const { lumps, folds, holes, box } = c.above;
    const pad = 4;
    const canvas = u.canvas ?? this.el.appendChild(Object.assign(document.createElement('canvas'), { className: 'cloud-above' }));
    u.canvas = canvas;
    canvas.width = Math.ceil((box[2] - box[0]) * scale) + 2 * pad;
    canvas.height = Math.ceil((box[3] - box[1]) * scale) + 2 * pad;
    u.at = [box[0] - pad / scale, box[1] - pad / scale];
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, pad - box[0] * scale, pad - box[1] * scale);
    const css = getComputedStyle(document.documentElement);
    const pen = ((parseFloat(css.getPropertyValue(`--pen-${C.pen}`)) || 1) * stroke * (CONFIG.render.lineWeight ?? 1) * (devicePixelRatio || 1)) / scale;
    const { bg, main } = THEME.palette;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = main;
    ctx.fillStyle = bg;
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
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const rings = parts.map(({ u, v, ru, rv, main }) => {
    // a few swells and dips round it, of their own sizes
    const swells = [2, 3, 5].map((n) => ({ n, size: between(rnd, C.bulge) / (n / 2), phase: rnd() * Math.PI * 2 }));
    const pts = [];
    const m = Math.max(40, Math.round((Math.PI * (ru + rv)) / (tile * 0.03)));
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2;
      const r = 1 + swells.reduce((sum, w) => sum + w.size * Math.sin(w.n * a + w.phase), 0);
      const p = ground([u + Math.cos(a) * ru * r, v + Math.sin(a) * rv * r]);
      pts.push(p);
      box[0] = Math.min(box[0], p[0]); box[1] = Math.min(box[1], p[1]);
      box[2] = Math.max(box[2], p[0]); box[3] = Math.max(box[3], p[1]);
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
  // (room for the crinkle)
  const m = (C.crinkle[0] + C.crinkle[1]) * tile;
  return { tile, lumps, folds, holes, box: [box[0] - m, box[1] - m, box[2] + m, box[3] + m] };
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
