// Shadows of clouds drifting over the map, sliding slowly with the wind,
// drawn as every other shadow is: the paper's own strokes (hatch.js, the
// shadows' and the night's) where a cloud lies – the strokes stay put on the
// map and the cloud, drifting over, picks out the ones under it; its edge
// broken, so they stop unevenly there, as the shadows' masks have it. With
// WebGL (gl/hatching.js) on their own <canvas> (#cloud-shadows): they cover
// roofs as much as the ground.
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
import { hatchFrame } from './hatch.js';
import { Hatching, Pieces, meshOf, rgb } from './gl/hatching.js';

export const CLOUD_SHADOWS = {
  // grid units² of map per cloud under a cloudy sky (cover 1; config
  // .weather.cover); a cloud's width, grid units, from a thin sky's to a
  // cloudy one's
  spread: 520,
  size: { thin: [3, 7], cloudy: [5, 20] },
  lumps: [2, 4],      // lumps in one cloud
  squash: 0.58,       // on the ground: height per width (isometric)
  wind: 0.22,         // grid units per simulated second
  // how many times a lump's outline is split, and how far a split may
  // wander (share of the edge's length)
  splits: 4,
  wander: 0.7,
  // the paper's strokes: every line up to this density tier (hatch.js
  // tierOf: 2 every other one), fewer where they would lie closer than
  // `least` window px; drawn with this pen (styles.css --pen-n), this strong
  hatch: { tier: 2, least: 3, pen: 1, tone: 1 },
  fade: 6,            // seconds to fade in or out
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
    this.gl = Hatching.make(canvas);
    this.clouds = [];
    this.view = null;
    this.empty = true;
    // the wind's way across the map, the same for a town every time
    const a = ((seed * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
    this.windAngle = a;
    this.wind = [Math.cos(a), Math.sin(a) * CLOUD_SHADOWS.squash];
  }

  // One frame: `dt` simulated seconds, `cover` how cloudy (config.weather
  // .cover: 1 cloudy, 0 none); `paper`: the map's hatching and --stroke
  // ({ hatch: SUN.hatch, stroke }).
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
    const want = Math.min(C.most, Math.round((area / C.spread) * cover));
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
    if (this.gl && this.paper?.hatch) this.draw(camera); // (every frame: costs the GPU next to nothing)
  }

  // A cloud: a few lumps strung out along the wind, its outline found when
  // it is first drawn (outline).
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
    return { x, y, w, tile, lumps, a };
  }

  // Each cloud's outline, its edge broken, picking out the paper's strokes
  // (gl/hatching.js) – the very strokes the shadows and the night have there.
  draw(camera) {
    const h = this.gl, H = CLOUD_SHADOWS.hatch;
    const { hatch, stroke = 1 } = this.paper;
    const dpr = devicePixelRatio || 1, z = dpr * camera.zoom, px = camera.tile;
    if (!(z > 0 && px > 0)) return;
    const W = innerWidth, Hh = innerHeight;
    const w = Math.round(W * dpr), hh = Math.round(Hh * dpr);
    if (h.canvas.width !== w || h.canvas.height !== hh) Object.assign(h.canvas.style, { width: `${W}px`, height: `${Hh}px` });
    h.size(w, hh);
    h.clear();
    const gap = hatchFrame(hatch).gap * px * z;
    let tier = H.tier;
    while (tier > 0 && gap * 2 ** (3 - tier) < H.least * dpr) tier--;
    const pen = (this.pen ??= parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--pen-${H.pen}`)) || 0.5);
    const q = 2 ** (Math.round(Math.log2(z) * 4) / 4);
    const tile = h.tile(tier, hatch, px, pen * stroke, q);
    const p = new Pieces();
    for (const c of this.clouds) {
      c.shape ??= this.outline(c);
      p.shape(meshOf('shape', c.shape.d), [1, 0, 0, 1, c.x, c.y], H.tone * Math.max(0, Math.min(1, c.a)));
    }
    h.pieces(h.load((this.glBuf ??= h.buffer()), p), { base: [z, dpr * camera.panX, dpr * camera.panY], tile, colour: rgb(THEME.palette.detail) });
    this.empty = false;
  }

  // A cloud's outline: each lump's, roughened, as a path in
  // scene units about its middle – turned with the wind, squashed.
  outline(c) {
    const C = CLOUD_SHADOWS, rnd = Math.random;
    const cos = Math.cos(this.windAngle), sin = Math.sin(this.windAngle);
    let d = '';
    for (const { u, v, ru, rv } of c.lumps) {
      const pts = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2, r = 0.8 + rnd() * 0.35;
        pts.push([u + Math.cos(a) * ru * r, v + Math.sin(a) * rv * r]);
      }
      rough(rnd, pts, C.splits - 1, C.wander * 0.6).forEach(([a, b], i) => {
        const x = a * cos - b * sin, y = (a * sin + b * cos) * C.squash;
        d += `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
      });
      d += 'Z';
    }
    return { d };
  }

  clear() {
    if (this.gl && !this.empty) {
      this.gl.size(this.gl.canvas.width, this.gl.canvas.height);
      this.gl.clear();
    }
    this.empty = true;
  }
}
