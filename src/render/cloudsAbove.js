// Clouds overhead: zoomed right out under a cloudy sky, the clouds whose
// shadows drift over the map (cloudShadows.js) are drawn too, up in the
// air above their shadows – filled with paper, so they hide the town
// under them, and outlined in the pen, as the clouds in a photo's sky are
// (clouds.js). Zoom back in and they part; the sky clears and they go.
//
// The same clouds as the shadows, so they drift with the same wind and
// come and go with them: each lifted `lift` up the screen from its shadow.
// Drawn on their own canvas (#clouds-above) over the map, a few times a
// second and moved with the map in between (follow.js), as the shadows.
//
// Three looks (CLOUDS_ABOVE.look):
//   heap    each of the cloud's lumps a heap with a scalloped edge, the
//           heaps run together into one outline, a few short strokes along
//           the underside (as a photo's fair-weather heaps)
//   shaded  the same heaps with a band of hatching all along the underside,
//           as an engraver shades a cloud's belly
//   kasumi  long flat banks, two or three laid one above another, their
//           tops lobed and their undersides straight, as the valley mist
//           (mist.js) and the cloud bands of old Japanese maps

import { THEME } from '../theme.js';
import { CONFIG } from '../config.js';
import { CLOUD_SHADOWS } from './cloudShadows.js';
import { Follow } from './follow.js';

export const CLOUDS_ABOVE = {
  look: 'kasumi',      // 'kasumi', 'heap' or 'shaded'
  zoom: 0.72,          // shown at this zoom and further out (config.camera.minZoom is 0.55)
  fade: 0.9,           // seconds to come or go
  cover: [0.45, 0.95], // the sky's cover (config.weather.cover) from which the first are up, and all of them
  lift: 2.4,           // grid units up the screen from the shadow
  scale: 0.85,         // a cloud's size as a share of its shadow's
  bump: 0.55,          // grid units: a scallop of the edge, about
  pen: 3,              // the outline's pen (styles.css --pen-n); the strokes under it one finer
  under: 0.35,         // heap: strokes along the underside per grid unit of it
  band: 0.32,          // shaded: the hatched band's depth, share of a heap's height
  gap: 0.09,           // shaded: grid units between its lines
  more: 3,             // times as many clouds in the sky while they're shown (their shadows too)
  fps: 6,
};

const nudge = (rnd) => (rnd() + rnd() + rnd() - 1.5) / 1.5;

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
    // (the whole drawing faded as one, so one cloud's outlines don't show through another's)
    if (this.k !== was) this.canvas.style.opacity = this.k;
    // which clouds are up: a share of them, the more the cloudier
    const share = Math.min(1, Math.max(0, (cover - C.cover[0]) / (C.cover[1] - C.cover[0])));
    const up = this.shadows.clouds.filter((c) => c.a > 0 && (c.pick ??= Math.random()) < share);
    if (!this.k || !up.length) return this.clear();
    const fading = this.k !== was;
    if (!fading && !this.empty && !this.follow.due(camera)) return this.follow.place(camera);
    this.draw(camera, up, stroke);
    this.follow.drawn(camera);
  }

  draw(camera, clouds, stroke) {
    const { canvas } = this, C = CLOUDS_ABOVE;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);
    const dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    }
    const z = dpr * camera.zoom, tile = camera.tile;
    if (!(z > 0 && tile > 0)) return;
    const css = getComputedStyle(document.documentElement);
    const pen = (n) => (parseFloat(css.getPropertyValue(`--pen-${n}`)) || 1) * stroke * (CONFIG.render.lineWeight ?? 1) * dpr / z;
    const { bg, main, detail } = THEME.palette;
    const lift = C.lift * tile;
    // far ones first: a nearer cloud hides the back of one behind it
    for (const c of [...clouds].sort((p, q) => p.y - q.y)) {
      const s = (c.above?.look === C.look && c.above.tile === tile) ? c.above : (c.above = this.shape(c, tile));
      // one coming or going is drawn whole on a sheet of its own, then laid
      // on faded, so its heaps' outlines don't show through each other
      const a = Math.min(1, c.a);
      const ctx = a < 1 ? this.sheet(canvas.width, canvas.height) : this.ctx;
      ctx.setTransform(z, 0, 0, z, dpr * camera.panX + z * c.x, dpr * camera.panY + z * (c.y - lift));
      ctx.lineJoin = ctx.lineCap = 'round';
      // the outline twice as wide under the fill: only its outer half
      // shows, round the heaps run together
      ctx.strokeStyle = main;
      ctx.lineWidth = 2 * pen(C.pen);
      ctx.fillStyle = bg;
      if (s.apart) { // kasumi: each bank outlined, the nearer laid over the one behind
        for (const p of s.parts) {
          ctx.stroke(p);
          ctx.fill(p);
        }
      } else {
        for (const p of s.parts) ctx.stroke(p);
        for (const p of s.parts) ctx.fill(p);
      }
      if (s.hatch) { // shaded: the band of lines along the underside
        ctx.save();
        ctx.clip(s.all);
        ctx.strokeStyle = detail;
        ctx.lineWidth = pen(C.pen - 1);
        ctx.stroke(s.hatch);
        ctx.fillStyle = bg;
        ctx.translate(0, -s.band);
        for (const p of s.parts) ctx.fill(p);
        ctx.restore();
      }
      if (s.under) {
        ctx.strokeStyle = detail;
        ctx.lineWidth = pen(C.pen - 1);
        ctx.stroke(s.under);
      }
      if (a < 1) {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.globalAlpha = a;
        this.ctx.drawImage(ctx.canvas, 0, 0);
        this.ctx.globalAlpha = 1;
      }
    }
    this.empty = false;
  }

  // A clear sheet the size of the canvas, to draw one cloud on.
  sheet(w, h) {
    if (this.scratch?.width !== w || this.scratch?.height !== h) this.scratch = new OffscreenCanvas(w, h);
    const ctx = this.scratch.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }

  // A cloud's drawing in scene units about its middle: `parts` filled and
  // outlined, and what goes over them.
  shape(c, tile) {
    const C = CLOUDS_ABOVE, rnd = Math.random;
    const k = C.scale;
    if (C.look === 'kasumi') return { look: C.look, tile, ...this.banks(c, tile, rnd) };
    // the lumps as the shadow lays them out, turned with the wind and
    // squashed onto the ground, each a heap seen from above and the side
    const a = this.shadows.windAngle, cos = Math.cos(a), sin = Math.sin(a), sq = CLOUD_SHADOWS.squash;
    const heaps = c.lumps.map(({ u, v, ru, rv }) => {
      const x = (u * cos - v * sin) * k, y = (u * sin + v * cos) * sq * k;
      const rx = Math.max(ru, rv) * k * 1.05, ry = rx * 0.62;
      return { x, y, rx, ry };
    });
    const parts = heaps.map((h) => scalloped(rnd, h, C.bump * tile));
    const all = new Path2D();
    for (const p of parts) all.addPath(p);
    const out = { look: C.look, tile, parts, all };
    if (C.look === 'shaded') {
      const top = Math.min(...heaps.map((h) => h.y - h.ry)), bottom = Math.max(...heaps.map((h) => h.y + h.ry));
      out.band = (bottom - top) * C.band;
      out.hatch = new Path2D();
      const left = Math.min(...heaps.map((h) => h.x - h.rx)) - out.band, right = Math.max(...heaps.map((h) => h.x + h.rx));
      const gap = C.gap * tile, lean = 0.55;
      for (let x = left; x < right + (bottom - top) * lean; x += gap * (0.8 + rnd() * 0.4)) {
        out.hatch.moveTo(x, top - 2);
        out.hatch.lineTo(x - (bottom - top + 4) * lean, bottom + 2);
      }
      return out;
    }
    // heap: short strokes along the underside of each heap, where no other
    // heap covers it, leaning the one way
    out.under = new Path2D();
    for (const h of heaps) {
      const n = Math.max(2, Math.round(((Math.PI * h.rx) / tile) * C.under));
      for (let i = 0; i < n; i++) {
        const t = Math.PI * (0.18 + (0.64 * (i + 0.5 + nudge(rnd) * 0.3)) / n);
        const x = h.x + Math.cos(t) * h.rx * 0.82, y = h.y + Math.sin(t) * h.ry * 0.78;
        if (heaps.some((o) => o !== h && o.y > h.y && ((x - o.x) / o.rx) ** 2 + ((y - o.y) / o.ry) ** 2 < 1.1)) continue;
        const l = (0.12 + rnd() * 0.1) * tile;
        out.under.moveTo(x, y);
        out.under.lineTo(x - l * 0.55, y - l);
      }
    }
    return out;
  }

  // Kasumi: two to four long thin banks, stepped – each further up a
  // little shorter and set off to one side – their tops a run of low
  // lobes, their undersides flat, their ends rounded off.
  banks(c, tile, rnd) {
    const C = CLOUDS_ABOVE;
    const w = c.w * C.scale * 1.2;
    const n = 2 + Math.floor(rnd() * 3);
    const parts = [];
    const all = new Path2D();
    let shift = 0;
    for (let i = 0; i < n; i++) {
      const len = w * (1 - i * 0.17) * (0.8 + rnd() * 0.3);
      shift += i ? (rnd() < 0.5 ? -1 : 1) * w * (0.08 + rnd() * 0.1) : 0;
      const x0 = -len / 2 + shift, x1 = x0 + len;
      const h = w * (0.034 + rnd() * 0.016);
      const y = w * 0.1 - i * h * (2.1 + rnd() * 0.6);
      const p = new Path2D();
      p.moveTo(x1 - h, y);
      p.lineTo(x0 + h, y);
      p.arc(x0 + h, y - h, h, Math.PI / 2, Math.PI * 1.5);
      const lobes = Math.max(1, Math.round((len - 2 * h) / (C.bump * tile * 2.6)));
      let x = x0 + h;
      for (let j = 0; j < lobes; j++) {
        const nx = x0 + h + ((len - 2 * h) * (j + 1 + (j + 1 < lobes ? nudge(rnd) * 0.35 : 0))) / lobes;
        p.quadraticCurveTo(x + (nx - x) * (0.35 + rnd() * 0.3), y - 2 * h - h * (0.4 + rnd() * 1.3), nx, y - 2 * h);
        x = nx;
      }
      p.arc(x1 - h, y - h, h, Math.PI * 1.5, Math.PI / 2);
      parts.push(p);
      all.addPath(p);
    }
    // the highest (furthest back) first
    return { parts: parts.reverse(), all, apart: true };
  }

  clear() {
    if (this.empty) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.empty = true;
    this.follow.set('');
  }
}

// A heap ({ x, y, rx, ry }) with a scalloped edge: bulges about `bump`
// wide all round, a little uneven, flatter along its underside.
function scalloped(rnd, { x, y, rx, ry }, bump) {
  const per = Math.PI * (rx + ry);
  const n = Math.max(5, Math.round(per / bump));
  const ts = Array.from({ length: n }, (_, i) => ((i + nudge(rnd) * 0.25) / n) * Math.PI * 2 - Math.PI / 2);
  const at = (t) => [x + Math.cos(t) * rx, y + Math.sin(t) * ry];
  const p = new Path2D();
  p.moveTo(...at(ts[0]));
  for (let i = 0; i < n; i++) {
    const a = ts[i], b = i + 1 < n ? ts[i + 1] : ts[0] + Math.PI * 2;
    const m = (a + b) / 2;
    // underneath (sin > 0) the bulges are shallow, on top full
    const out = 1 + (Math.sin(m) > 0.3 ? 0.06 : 0.22 + rnd() * 0.12) * (bump / Math.max(rx, ry)) * 3;
    const [cx, cy] = [x + Math.cos(m) * rx * out, y + Math.sin(m) * ry * out];
    p.quadraticCurveTo(cx, cy, ...at(b));
  }
  p.closePath();
  return p;
}
