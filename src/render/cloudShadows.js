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
//
// The clouds live in scene units (the map's own px at zoom 1), so they stay
// put on the map as it is panned or zoomed; each is squashed onto the
// ground (the view is isometric). Only those
// near the view are kept: they come in from beyond its edge, and any that
// have to appear inside it (the weather turning) fade in, as they fade out
// when it clears. Overcast and rain have none – it is all shade then, and
// the walls lose their shading instead (config.weather.sun).

import { THEME } from '../theme.js';

export const CLOUD_SHADOWS = {
  // grid units² of map per cloud, by weather (none: no clouds)
  spread: { fair: 3600, cloudy: 520 },
  size: { fair: [3, 7], cloudy: [5, 20] }, // a cloud's width, grid units
  lumps: [2, 4],      // blobs of wash in one cloud
  squash: 0.58,       // on the ground: height per width (isometric)
  wind: 0.22,         // grid units per simulated second
  tone: 0.2,          // how strong the wash is put down
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
  fade: 3,            // seconds to fade in or out
  most: 80,           // clouds kept at most (far zoomed out)
};

const between = (rnd, [a, b]) => a + rnd() * (b - a);
// a number about 0 – roughly bell-shaped, so most nudges are small
const nudge = (rnd) => (rnd() + rnd() + rnd() - 1.5) / 1.5;

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
    // the wind's way across the map, the same for a town every time
    const a = ((seed * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
    this.windAngle = a;
    this.wind = [Math.cos(a), Math.sin(a) * CLOUD_SHADOWS.squash];
  }

  // One frame: `dt` simulated seconds, `kind` the weather.
  frame(dt, camera, kind) {
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

    // as many as the weather wants over this much map
    const spread = C.spread[kind];
    const area = ((out.x1 - out.x0) * (out.y1 - out.y0)) / (tile * tile * C.squash);
    const want = spread ? Math.min(C.most, Math.round(area / spread)) : 0;
    const staying = this.clouds.filter((c) => !c.leaving);
    for (let i = want; i < staying.length; i++) staying[i].leaving = true;
    // new ones come in from beyond the edge – unless the weather has just
    // turned or the view zoomed, when they may fade in where it is seen
    const anywhere = first || kind !== this.kind || zoom !== this.zoom;
    this.kind = kind;
    this.zoom = zoom;
    const inside = (x, y) => x > v.x0 - m / 2 && x < v.x1 + m / 2 && y > v.y0 - m / 2 && y < v.y1 + m / 2;
    for (let i = staying.length; i < want; i++) {
      let x, y, tries = 0;
      do {
        x = out.x0 + Math.random() * (out.x1 - out.x0);
        y = out.y0 + Math.random() * (out.y1 - out.y0);
      } while (!anywhere && inside(x, y) && ++tries < 30);
      if (!anywhere && inside(x, y)) break; // (no room past the edge: wait for the wind)
      this.clouds.push(this.cloud(x, y, kind, tile, inside(x, y) && !first ? 0 : 1));
      changed = true;
    }

    if (!this.clouds.length) return this.clear();
    if (!changed && !this.empty) return;
    this.draw(camera, W, H);
  }

  // A cloud: a few lumps strung out along the wind, its wash painted later
  // (draw), when the colour is known.
  cloud(x, y, kind, tile, a) {
    const C = CLOUD_SHADOWS;
    const rnd = Math.random;
    const w = between(rnd, C.size[kind] ?? C.size.cloudy) * tile;
    const n = Math.round(between(rnd, C.lumps));
    const lumps = [];
    for (let i = 0; i < n; i++) {
      // on the ground, `u` along the wind and `v` across it
      const u = (n === 1 ? 0 : i / (n - 1) - 0.5) * w * 0.55 + nudge(rnd) * w * 0.08;
      const v = nudge(rnd) * w * 0.12;
      const ru = w * (0.25 + rnd() * 0.12) * (1 - Math.abs(u) / w), rv = ru * (0.55 + rnd() * 0.3);
      lumps.push({ u, v, ru, rv });
    }
    return { x, y, w, lumps, a, sprite: null };
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
    const { squash, tone, res } = CLOUD_SHADOWS;
    for (const c of this.clouds) {
      if (c.sprite?.color !== color) this.wash(c, color);
      const { canvas: sp, half } = c.sprite;
      ctx.globalAlpha = tone * Math.max(0, Math.min(1, c.a));
      ctx.drawImage(sp, c.x - half, c.y - half * squash, sp.width / res, sp.height / res);
    }
    ctx.globalAlpha = 1;
    this.empty = false;
  }

  clear() {
    if (this.empty) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.empty = true;
  }
}
