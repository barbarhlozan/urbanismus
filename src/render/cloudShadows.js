// Shadows of clouds drifting over the map, as watercolour washes in the
// detail colour, sliding slowly with the wind. Drawn on their own <canvas>
// (#cloud-shadows) – they cover roofs
// as much as the ground, and moving SVG would repaint the map.
//
// Each cloud is painted once into a little canvas of its own (wash()) and
// then only placed each frame. The wash is the generative-watercolour
// recipe: a rough outline for each of a few lumps, its edges split again
// and again with random nudges, and many faint layers of such outlines
// laid over each other – so the middle builds up, the edge stays ragged and
// soft, and where lumps overlap it pools darker, as wet paint does. A few
// faint strokes along the outline darken the rim the way a drying wash does.
// With `look: 'pen'` the same outline is hatched with thin pen lines
// instead (hatch()), like the strokes down a rock face: side by side
// across it, all one way, broken now and then where the pen was lifted, so
// the cloud's edge is where the lines happen to stop. The lines are kept
// as a path in scene units and stroked every frame at one width on the
// screen, so they stay sharp at any zoom.
// With `look: 'hatch'` a cloud's shadow is drawn as every other shadow is:
// the paper's own strokes (hatch.js, the shadows' and the night's) where
// it lies – the strokes stay put on the map and the cloud, drifting over,
// picks out the ones under it; its edge broken, so they stop unevenly
// there, as the shadows' masks have it.
//
// The clouds live in scene units (the map's own px at zoom 1), so they stay
// put on the map as it is panned or zoomed; each is squashed onto the
// ground (the view is isometric). Only those
// near the view are kept: they come in from beyond its edge, and while the
// sky is clouding over (the cover growing) more fade in where they are
// seen, as they fade out when it clears. Rain and storm have none – it is
// all shade then, and the walls lose their shading instead
// (config.weather.sun, cover).

import { THEME } from '../theme.js';
import { CONFIG } from '../config.js';
import { hatchFrame, hatchTileLines } from './hatch.js';
import { Follow } from './follow.js';

export const CLOUD_SHADOWS = {
  // grid units² of map per cloud under a cloudy sky (cover 1; config
  // .weather.cover); a cloud's width, grid units, from a thin sky's to a
  // cloudy one's
  spread: 520,
  size: { thin: [3, 7], cloudy: [5, 20] },
  lumps: [2, 4],      // blobs of wash in one cloud
  squash: 0.58,       // on the ground: height per width (isometric)
  wind: 0.22,         // grid units per simulated second
  look: 'hatch',      // 'hatch' (the paper's strokes), 'wash' (watercolour) or 'pen' (hatched lines)
  fps: 6,             // drawn this many times a second, moved with the map between (follow.js)
  tone: 0.001,          // how strong the wash is put down
  // the wash: layers laid over each other, each this opaque; how many
  // times the outline's edges are split, and how far a split may wander
  // (share of the edge's length); how sharp a cloud's canvas is (px per
  // scene px); faint strokes darkening the rim
  layers: 32,
  layer: 0.03,
  splits: 4,
  wander: 0.7,
  res: 0.6,
  rim: { strokes: 3, alpha: 0.05, width: 2.2 },
  // the lines (look 'pen'): how far apart (grid units), how wide on the
  // screen (device px, times config.render.lineWeight), how strong; their
  // slant on screen (radians, up to the right) and how much it varies from
  // cloud to cloud; how much a line bows and how far its ends may fall
  // short or run over (share of the gap); how long one goes before the
  // pen is lifted (grid units), and the share of lines left out
  pen: {
    gap: 0.1, width: 0.6, tone: 0.55, slant: -0.62, tilt: 0.08,
    bow: 0.03, ends: 1.2, long: [0.5, 1.3], skip: 0.1,
  },
  // the paper's strokes (look 'hatch'): every line up to this density tier
  // (hatch.js tierOf: 2 every other one), fewer where they would lie closer
  // than `least` window px; drawn with this pen (styles.css --pen-n), this
  // strong
  hatch: { tier: 2, least: 3, pen: 1, tone: 1 },
  fade: 6,            // seconds to fade in or out
  most: 80,           // clouds kept at most (far zoomed out)
};

const between = (rnd, [a, b]) => a + rnd() * (b - a);
// a number about 0 – roughly bell-shaped, so most nudges are small
const nudge = (rnd) => (rnd() + rnd() + rnd() - 1.5) / 1.5;

// The ragged edge of a shadow, as the shadows' masks have it (styles.css
// .shade-mask .shade): a dashed line round it (scene px).
const EDGE = { width: 2.5, dash: [3, 2, 1.5, 3.5, 2.5, 1, 4, 2.5, 1, 3] };

// Split every edge of a closed outline at its middle, nudged sideways by up
// to `wander` of its length – `times` over, each time a little less.
function rough(rnd, pts, times, wander) {
  for (let k = 0; k < times; k++) {
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2 + nudge(rnd) * 0.6;
      const d = nudge(rnd) * len * wander * 0.5;
      next.push(a, [(a[0] + b[0]) / 2 + Math.cos(ang) * d, (a[1] + b[1]) / 2 + Math.sin(ang) * d]);
    }
    pts = next;
    wander *= 0.75;
  }
  return pts;
}

export class CloudShadows {
  constructor(canvas, seed = 1) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.clouds = [];
    this.view = null;
    this.empty = true;
    this.more = 1; // times as many clouds (cloudsAbove.js: zoomed far out, a fuller sky)
    this.follow = new Follow(canvas, CLOUD_SHADOWS.fps);
    // the wind's way across the map, the same for a town every time
    const a = ((seed * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
    this.windAngle = a;
    this.wind = [Math.cos(a), Math.sin(a) * CLOUD_SHADOWS.squash];
  }

  // One frame: `dt` simulated seconds, `cover` how cloudy (config.weather
  // .cover: 1 cloudy, 0 none); `paper`: the map's hatching and --stroke
  // ({ hatch: SUN.hatch, stroke }), for look 'hatch'.
  frame(dt, camera, cover, paper = {}) {
    this.paper = paper;
    const C = CLOUD_SHADOWS;
    const tile = camera.tile, zoom = camera.zoom;
    const W = innerWidth, H = innerHeight;
    // the view in scene units, and around it as far as a cloud reaches
    const v = { x0: -camera.panX / zoom, y0: -camera.panY / zoom, x1: (W - camera.panX) / zoom, y1: (H - camera.panY) / zoom };
    const m = C.size.cloudy[1] * tile;
    const out = { x0: v.x0 - m, y0: v.y0 - m, x1: v.x1 + m, y1: v.y1 + m };
    const first = !this.view;
    const moved = first || ['x0', 'y0', 'x1', 'y1'].some((k) => this.view[k] !== v[k]);
    this.view = v;

    // drift, fade, and let go of those gone off past the edge or faded out
    const step = C.wind * tile * dt;
    const fade = dt / C.fade;
    let changed = moved || dt > 0;
    this.clouds = this.clouds.filter((c) => {
      c.x += this.wind[0] * step;
      c.y += this.wind[1] * step;
      if (c.leaving) c.a -= fade;
      else if (c.a < 1) c.a = Math.min(1, c.a + fade);
      return c.a > 0 && c.x > out.x0 && c.x < out.x1 && c.y > out.y0 && c.y < out.y1;
    });

    // as many as the sky wants over this much map
    const area = ((out.x1 - out.x0) * (out.y1 - out.y0)) / (tile * tile * C.squash);
    const want = Math.min(C.most, Math.round((area / C.spread) * cover * this.more));
    const staying = this.clouds.filter((c) => !c.leaving);
    for (let i = want; i < staying.length; i++) staying[i].leaving = true;
    // new ones come in from beyond the edge – unless the sky is clouding
    // over or the view zoomed, when they may fade in where it is seen
    const anywhere = first || cover > this.cover || zoom !== this.zoom;
    this.cover = cover;
    this.zoom = zoom;
    const inside = (x, y) => x > v.x0 - m / 2 && x < v.x1 + m / 2 && y > v.y0 - m / 2 && y < v.y1 + m / 2;
    for (let i = staying.length; i < want; i++) {
      let x, y, tries = 0;
      do {
        x = out.x0 + Math.random() * (out.x1 - out.x0);
        y = out.y0 + Math.random() * (out.y1 - out.y0);
      } while (!anywhere && inside(x, y) && ++tries < 30);
      if (!anywhere && inside(x, y)) break; // (no room past the edge: wait for the wind)
      this.clouds.push(this.cloud(x, y, cover, tile, inside(x, y) && !first ? 0 : 1));
      changed = true;
    }

    if (!this.clouds.length) return this.clear();
    if (!changed && !this.empty) return;
    // (they drift a few px a second: drawn now and then, moved with the map between)
    if (!this.empty && !this.follow.due(camera)) return this.follow.place(camera);
    this.draw(camera, W, H);
    this.follow.drawn(camera);
  }

  // A cloud: a few lumps strung out along the wind, its wash painted later
  // (draw), when the colour is known.
  cloud(x, y, cover, tile, a) {
    const C = CLOUD_SHADOWS;
    const rnd = Math.random;
    const k = Math.min(1, cover);
    const w = between(rnd, [0, 1].map((i) => C.size.thin[i] + (C.size.cloudy[i] - C.size.thin[i]) * k)) * tile;
    const n = Math.round(between(rnd, C.lumps));
    const lumps = [];
    for (let i = 0; i < n; i++) {
      // on the ground, `u` along the wind and `v` across it
      const u = (n === 1 ? 0 : i / (n - 1) - 0.5) * w * 0.55 + nudge(rnd) * w * 0.08;
      const v = nudge(rnd) * w * 0.12;
      const ru = w * (0.25 + rnd() * 0.12) * (1 - Math.abs(u) / w), rv = ru * (0.55 + rnd() * 0.3);
      lumps.push({ u, v, ru, rv });
    }
    return { x, y, w, tile, lumps, a, sprite: null };
  }

  // Paint a cloud's wash into its own canvas, centred on it.
  wash(c, color) {
    const C = CLOUD_SHADOWS;
    const rnd = Math.random;
    const half = c.w * 0.75;
    const res = C.res;
    const cw = Math.ceil(2 * half * res), ch = Math.ceil(2 * half * C.squash * res);
    const canvas = c.sprite?.canvas ?? document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    // ground (u, v) to the cloud's canvas: turned with the wind, squashed
    const cos = Math.cos(this.windAngle), sin = Math.sin(this.windAngle);
    const at = ([u, v]) => [(half + u * cos - v * sin) * res, (half * C.squash + (u * sin + v * cos) * C.squash) * res];
    const base = c.lumps.map(({ u, v, ru, rv }) => {
      const pts = [];
      const k = 9;
      for (let i = 0; i < k; i++) {
        const t = (i / k) * Math.PI * 2, r = 0.8 + rnd() * 0.35;
        pts.push([u + Math.cos(t) * ru * r, v + Math.sin(t) * rv * r]);
      }
      return rough(rnd, pts, 2, C.wander);
    });
    if (C.look === 'pen') return this.hatch(c, ctx, base.map((pts) => pts.map(at)), color, half);
    ctx.fillStyle = color;
    ctx.globalAlpha = C.layer;
    for (let l = 0; l < C.layers; l++) {
      for (const pts of base) {
        const p = rough(rnd, pts, C.splits - 2, C.wander * 0.6).map(at);
        ctx.beginPath();
        ctx.moveTo(...p[0]);
        for (let i = 1; i < p.length; i++) ctx.lineTo(...p[i]);
        ctx.closePath();
        ctx.fill();
      }
    }
    // the rim, where the pigment gathers as it dries
    ctx.strokeStyle = color;
    ctx.globalAlpha = C.rim.alpha;
    ctx.lineWidth = C.rim.width * res;
    ctx.lineJoin = 'round';
    for (let l = 0; l < C.rim.strokes; l++) {
      for (const pts of base) {
        const p = rough(rnd, pts, 1, C.wander * 0.3).map(at);
        ctx.beginPath();
        ctx.moveTo(...p[0]);
        for (let i = 1; i < p.length; i++) ctx.lineTo(...p[i]);
        ctx.closePath();
        ctx.stroke();
      }
    }
    c.sprite = { canvas, color, half };
  }

  // Hatch the cloud's outlines (`shapes`, in its canvas) with pen lines,
  // kept as a path in scene units around the cloud's middle.
  hatch(c, ctx, shapes, color, half) {
    const C = CLOUD_SHADOWS, P = C.pen;
    const rnd = Math.random;
    const { width: cw, height: ch } = ctx.canvas;
    // where the cloud is: its outlines filled once, read back as a mask
    ctx.fillStyle = '#000';
    for (const p of shapes) {
      ctx.beginPath();
      ctx.moveTo(...p[0]);
      for (let i = 1; i < p.length; i++) ctx.lineTo(...p[i]);
      ctx.closePath();
      ctx.fill();
    }
    const mask = ctx.getImageData(0, 0, cw, ch).data;
    const inside = (x, y) => {
      const i = Math.round(x), j = Math.round(y);
      return i >= 0 && j >= 0 && i < cw && j < ch && mask[(j * cw + i) * 4 + 3] > 0;
    };

    // in scene units from here on: the mask's px / res, about the middle
    const res = C.res, unit = c.tile;
    const gap = P.gap * unit;
    const ang = P.slant + nudge(rnd) * P.tilt;
    const dx = Math.cos(ang), dy = Math.sin(ang); // along the lines
    const nx = -dy, ny = dx;                      // across them
    const R = Math.hypot(half, half * C.squash);
    const step = unit * 0.08;
    const on = (x, y) => inside((x + half) * res, (y + half * C.squash) * res);
    const path = new Path2D();
    const line = (a, b, off) => {
      const len = b - a, bow = nudge(rnd) * P.bow * len;
      const x0 = nx * off, y0 = ny * off;
      path.moveTo(x0 + dx * a, y0 + dy * a);
      path.quadraticCurveTo(x0 + dx * (a + len / 2) + nx * bow, y0 + dy * (a + len / 2) + ny * bow, x0 + dx * b, y0 + dy * b);
    };
    // one row of lines after another across the cloud; on each, every
    // stretch that lies in the cloud is drawn, its ends left loose
    for (let s = -R + gap * rnd(); s < R; s += gap * (0.8 + rnd() * 0.4)) {
      let start = null;
      for (let t = -R; t <= R + step; t += step) {
        const isOn = t <= R && on(nx * s + dx * t, ny * s + dy * t);
        if (isOn && start === null) start = t;
        if (!isOn && start !== null) {
          const end = t + nudge(rnd) * P.ends * gap;
          let a = start + nudge(rnd) * P.ends * gap;
          // a long stretch is a few lines, the pen lifted in between
          while (a < end - gap * 0.5) {
            const b = Math.min(end, a + between(rnd, P.long) * unit);
            if (rnd() > P.skip) line(a, b, s + nudge(rnd) * gap * 0.12);
            a = b + gap * (0.1 + rnd() * 0.4);
          }
          start = null;
        }
      }
    }
    ctx.clearRect(0, 0, cw, ch);
    c.sprite = { path, color, half };
  }

  draw(camera, W, H) {
    const { canvas, ctx } = this;
    const dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const z = dpr * camera.zoom;
    ctx.setTransform(z, 0, 0, z, dpr * camera.panX, dpr * camera.panY);
    const color = THEME.palette.detail;
    const { squash, res, look, pen } = CLOUD_SHADOWS;
    if (look === 'hatch' && this.paper?.hatch) return this.drawHatch(camera, color);
    const tone = look === 'pen' ? pen.tone : CLOUD_SHADOWS.tone;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = (pen.width * (CONFIG.render.lineWeight ?? 1)) / z;
    for (const c of this.clouds) {
      if (c.sprite?.color !== color) this.wash(c, color);
      const { canvas: sp, path, half } = c.sprite;
      ctx.globalAlpha = tone * Math.max(0, Math.min(1, c.a));
      if (path) {
        ctx.setTransform(z, 0, 0, z, dpr * camera.panX + z * c.x, dpr * camera.panY + z * c.y);
        ctx.stroke(path);
      } else {
        ctx.setTransform(z, 0, 0, z, dpr * camera.panX, dpr * camera.panY);
        ctx.drawImage(sp, c.x - half, c.y - half * squash, sp.width / res, sp.height / res);
      }
    }
    ctx.globalAlpha = 1;
    this.empty = false;
  }

  // Look 'hatch': each cloud's outline filled, and its edge stroked
  // broken, with a sheet of the paper's strokes laid as the map's (turned
  // to their angle about the scene's origin), so they are the very strokes
  // the shadows and the night have there.
  drawHatch(camera, color) {
    const { ctx } = this, H = CLOUD_SHADOWS.hatch;
    const { hatch, stroke = 1 } = this.paper;
    const dpr = devicePixelRatio || 1, z = dpr * camera.zoom, px = camera.tile;
    if (!(z > 0 && px > 0)) return; // (the view not set up yet)
    // the densest tier whose lines are at least H.least apart on the screen
    const gap = hatchFrame(hatch).gap * px * z;
    let tier = H.tier;
    while (tier > 0 && gap * 2 ** (3 - tier) < H.least * dpr) tier--;
    const t = this.tileFor(tier, hatch, px, stroke, z, color);
    const view = new DOMMatrix([z, 0, 0, z, dpr * camera.panX, dpr * camera.panY]);
    ctx.lineWidth = EDGE.width;
    ctx.setLineDash(EDGE.dash);
    ctx.lineJoin = 'round';
    ctx.fillStyle = ctx.strokeStyle = t.pattern;
    for (const c of this.clouds) {
      c.shape ??= this.outline(c);
      ctx.globalAlpha = H.tone * Math.max(0, Math.min(1, c.a));
      ctx.setTransform(view.translate(c.x, c.y));
      t.pattern.setTransform(new DOMMatrix().translate(-c.x, -c.y).rotate(hatch.angle).scale(1 / t.scale));
      ctx.fill(c.shape);
      ctx.stroke(c.shape);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    this.empty = false;
  }

  // A cloud's outline (look 'hatch'): each lump's, roughened, as a path in
  // scene units about its middle – turned with the wind, squashed.
  outline(c) {
    const C = CLOUD_SHADOWS, rnd = Math.random;
    const cos = Math.cos(this.windAngle), sin = Math.sin(this.windAngle);
    const path = new Path2D();
    for (const { u, v, ru, rv } of c.lumps) {
      const pts = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2, r = 0.8 + rnd() * 0.35;
        pts.push([u + Math.cos(a) * ru * r, v + Math.sin(a) * rv * r]);
      }
      rough(rnd, pts, C.splits - 1, C.wander * 0.6).forEach(([a, b], i) => {
        const x = a * cos - b * sin, y = (a * sin + b * cos) * C.squash;
        if (i) path.lineTo(x, y);
        else path.moveTo(x, y);
      });
      path.closePath();
    }
    return path;
  }

  // The paper's strokes up to `tier` as a pattern, drawn at `scale` window
  // px to a scene px (in steps of a quarter of a doubling, so zooming
  // redraws it only now and then), in the pen H.pen times --stroke, as the
  // map's hatching (as NightCanvas.tileFor).
  tileFor(tier, hatch, px, stroke, scale, color) {
    const q = 2 ** (Math.round(Math.log2(scale) * 4) / 4);
    const H = CLOUD_SHADOWS.hatch;
    const pen = this.pen ??= parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--pen-${H.pen}`)) || 0.5;
    const key = `${tier}|${JSON.stringify(hatch)}|${px}|${stroke}|${q}|${color}|${pen}`;
    if (this.tile?.key === key) return this.tile;
    const { d, size } = hatchTileLines(tier, hatch, px);
    const n = Math.max(1, Math.round(size * q));
    const off = new OffscreenCanvas(n, n), c = off.getContext('2d');
    c.scale(n / size, n / size);
    c.strokeStyle = color;
    c.lineWidth = pen * stroke;
    c.lineCap = c.lineJoin = 'round';
    c.stroke(new Path2D(d));
    this.tile = { key, pattern: this.ctx.createPattern(off, 'repeat'), scale: n / size };
    return this.tile;
  }

  clear() {
    if (this.empty) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.empty = true;
    this.follow.set('');
  }
}
