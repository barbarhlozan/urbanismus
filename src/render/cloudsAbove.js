// Clouds overhead: zoomed right out under a cloudy sky, the clouds whose
// shadows drift over the map (cloudShadows.js) are drawn too, up in the
// air above their shadows – filled with paper, so they hide the town
// under them, and outlined in the pen. Zoom back in and they part; the sky
// clears and they go.
//
// Each is drawn as clouds are traced in an outline drawing: one long, low
// shape lying level, three or four times as wide as it is tall – a few
// broad humps of uneven size along the top, the underside nearly flat, the
// ends drawn out, one often into a thin tail – its edge crinkled all
// round, finely and unevenly, like the edge of torn paper. Some have a
// fold: a line curling in from the underside where one lobe lies in front
// of the next; now and then a small hole shows the sky through.
//
// The same clouds as the shadows, so they drift with the same wind and
// come and go with them: each lifted `lift` up the screen from its shadow,
// as wide as the shadow is (`scale`). Drawn on their own canvas
// (#clouds-above) over the map, a few times a second and moved with the
// map in between (follow.js), as the shadows.

import { THEME } from '../theme.js';
import { CONFIG } from '../config.js';
import { Follow } from './follow.js';

export const CLOUDS_ABOVE = {
  zoom: 0.72,          // shown at this zoom and further out (config.camera.minZoom is 0.55)
  fade: 0.9,           // seconds to come or go
  cover: [0.45, 0.95], // the sky's cover (config.weather.cover) from which the first are up, and all of them
  lift: 2.4,           // grid units up the screen from the shadow
  scale: 0.95,         // a cloud's width as a share of its shadow's
  tall: [0.22, 0.34],  // its height as a share of its width
  humps: [2, 4],       // broad humps along the top
  crinkle: [0.1, 0.04], // grid units: how far the edge wobbles, the coarse ripple and the fine
  ripple: [0.32, 0.1],  // grid units: their lengths
  fold: 0.55,          // the share with a fold line
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
    this.k = want > this.k ? Math.min(1, this.k + dt / C.fade) : Math.max(0, this.k - dt / C.fade);
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
      if (c.above?.tile !== tile) c.above = traced(Math.random, c.w * C.scale, tile);
      ctx.setTransform(z, 0, 0, z, dpr * camera.panX + z * c.x, dpr * camera.panY + z * (c.y - lift));
      ctx.globalAlpha = Math.min(1, c.a);
      ctx.fill(c.above.shape, 'evenodd');
      ctx.stroke(c.above.shape);
      if (c.above.fold) ctx.stroke(c.above.fold);
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

// A cloud `w` wide (scene px), about its middle: its outline (with a hole,
// maybe, as a second loop) and its fold line, if it has one.
function traced(rnd, w, tile) {
  const C = CLOUDS_ABOVE;
  const h = w * between(rnd, C.tall);
  // the top: a few humps side by side, the tallest somewhere off the middle
  const n = Math.round(between(rnd, C.humps));
  const humps = Array.from({ length: n }, (_, i) => ({
    at: (i + 0.5 + (rnd() - 0.5) * 0.6) / n - 0.5,
    wide: (0.6 + rnd() * 0.7) / n,
    high: 0.45 + rnd() * 0.55,
  }));
  // one end drawn out into a tail, low and thin
  const tail = rnd() < 0.6 ? (rnd() < 0.5 ? -1 : 1) : 0;
  // each hump a rounded lobe on a low body
  const top = (u) => { // u from -0.5 to 0.5 along it; how high the top is, share of h
    let t = 0.32;
    for (const p of humps) {
      const d = (u - p.at) / p.wide;
      if (Math.abs(d) < 1) t = Math.max(t, p.high * Math.sqrt(1 - d * d));
    }
    const e = 2 * Math.abs(u), drawn = tail && Math.sign(u) === tail;
    const end = drawn ? 1 - e ** 1.6 : Math.sqrt(Math.max(0, 1 - e ** 4));
    return t * Math.max(0, end) * (drawn ? 1 - 0.55 * e : 1);
  };
  // the underside: nearly flat, a slow swell or two, a touch lower in the middle
  const sag = rnd() * 0.06, swell = rnd() * Math.PI * 2;
  const under = (u) => ((1 - (2 * u) ** 2) * sag + Math.sin(u * 9 + swell) * 0.025) * (1 - (2 * u) ** 6);
  // round it: the top left to right, then the underside back
  const step = tile * 0.03;
  const m = Math.ceil(w / step);
  const rough = crinkler(rnd, tile);
  const pts = [];
  for (let i = 0; i <= m; i++) {
    const u = i / m - 0.5;
    pts.push([u * w, -top(u) * h]);
  }
  for (let i = m - 1; i > 0; i--) {
    const u = i / m - 0.5;
    pts.push([u * w, under(u) * h]);
  }
  const shape = new Path2D();
  loop(shape, rough(pts));
  const out = { tile, shape, fold: null };
  // a hole: a small crinkled loop in the thick of it
  if (rnd() < C.hole) {
    const p = humps[Math.floor(rnd() * n)];
    const cx = p.at * w, cy = -top(p.at) * h * 0.45, r = Math.min(w * 0.04, h * 0.12);
    const ring = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ring.push([cx + Math.cos(a) * r * 1.8, cy + Math.sin(a) * r]);
    }
    loop(shape, crinkler(rnd, tile * 0.5)(ring));
  }
  // a fold: from the underside up into it, curling over the way it leans
  if (rnd() < C.fold) {
    const u0 = (rnd() - 0.5) * 0.6, way = rnd() < 0.5 ? -1 : 1;
    const x0 = u0 * w, y0 = under(u0) * h;
    const reach = w * (0.12 + rnd() * 0.12), rise = Math.min(top(u0), top(u0 + (way * reach) / w)) * h * (0.35 + rnd() * 0.25);
    const line = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, a = t * Math.PI * 0.9;
      line.push([x0 + way * reach * (1 - Math.cos(a)) * 0.55, y0 - rise * Math.sin(a) * (0.6 + 0.4 * t)]);
    }
    const fold = new Path2D();
    rough(line).forEach(([x, y], i) => (i ? fold.lineTo(x, y) : fold.moveTo(x, y)));
    out.fold = fold;
  }
  return out;
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
