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
//
// The clouds live in scene units (the map's own px at zoom 1), so they stay
// put on the map as it is panned or zoomed; each is squashed onto the
// ground (the view is isometric). Only those
// near the view are kept: they come in from beyond its edge, and any that
// have to appear inside it (the weather turning) fade in, as they fade out
// when it clears. Rain and storm have none – it is all shade then, and
// the walls lose their shading instead (config.weather.sun).

import { THEME } from '../theme.js';
import { CONFIG } from '../config.js';

export const CLOUD_SHADOWS = {
  // grid units² of map per cloud, by weather (none: no clouds)
  spread: { fair: 3600, cloudy: 520 },
  size: { fair: [3, 7], cloudy: [5, 20] }, // a cloud's width, grid units
  lumps: [2, 4],      // blobs of wash in one cloud
  squash: 0.58,       // on the ground: height per width (isometric)
  wind: 0.22,         // grid units per simulated second
  look: 'pen',        // 'pen' (hatched lines) or 'wash' (watercolour)
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

  clear() {
    if (this.empty) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.empty = true;
  }
}
