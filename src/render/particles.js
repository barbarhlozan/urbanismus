// Particles: little marks given off by points on the map – smoke from
// chimneys first. Drawn on a <canvas> (#smoke) over the buildings, as the
// moving people are (agentCanvas.js): the marks change every frame.
//
// Nothing is kept from one frame to the next. A particle is worked out from
// the time alone: emitter e gives off particle i at about i / rate seconds,
// and where it is now, how big and how much of it is drawn follow from its
// age – so an emitter off screen costs nothing, a plume panned into view is
// there whole, and pausing the game holds it still (the time is the town's,
// world.time). The wind, rain and mist (env) are taken as they are now.
//
// As the mist does (mist.js), a mark comes and goes in the pen, not by
// fading: its line is drawn in along its length as it is given off and
// taken back from where it started as it ends. Nothing soft, no alpha.
//
//   emitter   { x, y } scene px at the camera's tile (the chimney's mouth,
//             Painter.vent), kind (a key of PARTICLES), k (size), seed
//   PARTICLES the kinds: how often, how long, how far up and aside, sizes
//   STYLES    how a kind's particles are drawn (smoke.html sketches them)
//   eachParticle(e, kind, time, env, fn)   the particles alive now
//   ParticleCanvas   one frame: the emitters in view, under a cap

import { THEME } from '../theme.js';
import { PEN } from './agentCanvas.js';

//   rate    particles a second
//   life    seconds each lasts
//   rise    how high it goes, grid units of height
//   drift   how far aside the wind takes it (grid units at a storm's wind)
//   wander  sideways wandering in still air (grid units)
//   size    [given off, at the end] grid units across
//   in/out  shares of its life it takes to be drawn in and taken back
//   on      a house's stove is lit some of the time: in spells of `every`
//           seconds, `share` of them (null: always, a works' boilers)
//   pen     line width (PEN) and ink (palette name)
export const PARTICLES = {
  house: {
    rate: 0.6, life: 10, rise: 1.5, drift: 1.1, wander: 0.05, size: [0.045, 0.13],
    in: 0.12, out: 0.4, on: { every: 70, share: 0.45 }, pen: 2, ink: 'main',
  },
  stack: {
    rate: 1.1, life: 20, rise: 3, drift: 2.2, wander: 0.08, size: [0.1, 0.34],
    in: 0.05, out: 0.45, on: null, pen: 3, ink: 'main',
  },
};

// The weather's say: `wind` as config.weather.wind (a storm 0.14), `rain`
// as config.weather.rain (rain 1, storm 2.4), `mist` how far it has risen
// (0–1, mistRisen).
export const CALM = { wind: 0.02, rain: 0, mist: 0 };
const STORM_WIND = 0.14;

// Integer hash -> [0, 1).
export function hash(a, b) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Is emitter `e` giving off smoke at time t?
export function lit(e, K, t) {
  if (!K.on) return true;
  const { every, share } = K.on;
  const off = (e.seed % 997) / 997 * every;
  return hash(e.seed, Math.floor((t + off) / every)) < share;
}

// The weather's changes to a kind: rain washes it thinner and shorter, mist
// keeps it down, lying about the roofs.
function weathered(K, env) {
  const rain = Math.min(1, env.rain ?? 0), mist = env.mist ?? 0;
  return {
    life: K.life * (1 - 0.2 * rain) * (1 + 0.4 * mist),
    keep: 1 - 0.3 * rain,
    size: 1 - 0.2 * rain,
    rise: (1 - 0.6 * mist),
    spread: 1 + 4 * mist,
  };
}

// Calls fn(x, y, size, u, h, i) for each particle of emitter `e` alive at
// `time`: scene px (y down), size across in px, u its age as a share of its
// life, h its own random number, i its number (older ones first). `tile`,
// `zScale`: the camera's. `keep`: share of them to draw (the cap).
export function eachParticle(e, K, time, env, fn, { tile = 32, zScale = 0.9, keep = 1 } = {}) {
  const W = weathered(K, env);
  const rate = K.rate, life = W.life;
  const k = e.k ?? 1, T = tile * k;
  const wind = Math.min(1.2, (env.wind ?? 0) / STORM_WIND);
  const rise = K.rise * zScale * T * W.rise * (1 - 0.45 * wind);
  const drift = K.drift * tile * wind; // (how far the wind takes it doesn't grow with the chimney)
  const wander = K.wander * T * W.spread;
  const [s0, s1] = K.size;
  const keepShare = keep * W.keep;
  for (let i = Math.floor((time - life) * rate); i <= Math.floor(time * rate); i++) {
    const h = hash(e.seed, i);
    const born = (i + h * 0.7) / rate, a = time - born;
    if (a < 0 || a > life) continue;
    if (hash(i, e.seed ^ 0x2c1b) > keepShare) continue;
    if (!lit(e, K, born)) continue;
    const u = a / life;
    const up = rise * (1 - (1 - u) ** 1.8) * (0.85 + 0.3 * h);
    // the wind bends it over (leaning to the left, as the trees: swayTrees)
    const aside = -drift * u ** 1.5 + wander * u * Math.sin(h * 6.283 + a * (0.7 + h * 0.6));
    const size = (s0 + (s1 - s0) * u ** 0.7) * T * W.size * (0.8 + 0.4 * hash(i, 77));
    fn(e.x + aside, e.y - up, size, u, h, i);
  }
}

// How much of a particle's line is drawn at age u: [from, to] as shares of
// its length – drawn in as it is given off, taken back from its start as
// it ends.
export function drawn(K, u) {
  const to = Math.min(1, u / K.in);
  const from = u > 1 - K.out ? (u - (1 - K.out)) / K.out : 0;
  return [from, to];
}

// ---------- the marks ----------

// Unit shapes (about 1 across, centred), a few of each to pick from.
function curlShape(v) {
  // a little more than a turn of a spiral opening out, as a pen draws a curl
  const pts = [], turns = 1.15 + 0.15 * v, n = 22;
  for (let j = 0; j <= n; j++) {
    const t = j / n, th = t * turns * Math.PI * 2 + v;
    const r = 0.12 + 0.38 * t;
    pts.push([r * Math.cos(th) + 0.18 * t, -r * Math.sin(th) - 0.1 * t]);
  }
  return pts;
}
function puffShape(v) {
  // a round of shallow lobes, as the mist's lobes (mist.js), closed
  const lobes = 5 + (v % 3), pts = [], n = lobes * 6;
  for (let j = 0; j <= n; j++) {
    const th = (j / n) * Math.PI * 2 + v * 0.7;
    const r = 0.4 + 0.1 * Math.abs(Math.sin((th * lobes) / 2));
    pts.push([r * Math.cos(th), r * Math.sin(th) * 0.8]);
  }
  return pts;
}
function dotsShape(v) {
  const pts = [], n = 6;
  for (let j = 0; j < n; j++) {
    const a = hash(v, j) * Math.PI * 2, r = 0.5 * Math.sqrt(hash(j, v + 9));
    pts.push([r * Math.cos(a), r * Math.sin(a) * 0.8]);
  }
  return pts;
}
const VARIANTS = 4;
const SHAPES = {
  curl: Array.from({ length: VARIANTS }, (_, v) => curlShape(v)),
  puff: Array.from({ length: VARIANTS }, (_, v) => puffShape(v)),
  dots: Array.from({ length: VARIANTS }, (_, v) => dotsShape(v + 1)),
};

// Part of a polyline (`pts` scaled by s, mirrored by m, at x, y) from share
// a to b of it into the current path.
function partOf(ctx, pts, x, y, s, m, a, b) {
  const n = pts.length - 1;
  const fa = a * n, fb = b * n;
  const P = (f) => {
    const j = Math.min(n - 1, Math.floor(f)), t = f - j;
    const p = pts[j], q = pts[j + 1];
    return [x + m * s * (p[0] + (q[0] - p[0]) * t), y + s * (p[1] + (q[1] - p[1]) * t)];
  };
  const [x0, y0] = P(fa);
  ctx.moveTo(x0, y0);
  for (let j = Math.floor(fa) + 1; j < fb; j++) ctx.lineTo(x + m * s * pts[j][0], y + s * pts[j][1]);
  const [x1, y1] = P(fb);
  ctx.lineTo(x1, y1);
}

// How each style draws an emitter's particles. `d`: { ctx, K, time, env,
// opts, pal, unit (px of line width) }. Each sets its own stroke/fill.
export const STYLES = {
  // A · small curls, one per puff, each drawn in as a turn of the pen
  curl(e, d) {
    const { ctx } = d;
    ctx.beginPath();
    eachParticle(e, d.K, d.time, d.env, (x, y, s, u, h, i) => {
      const [a, b] = drawn(d.K, u);
      if (b > a) partOf(ctx, SHAPES.curl[i & 3], x, y, s, h < 0.5 ? 1 : -1, a, b);
    }, d.opts);
    ctx.stroke();
  },

  // B · puffs: rounds of lobes on paper, the younger over the older
  puff(e, d) {
    const { ctx, pal } = d;
    eachParticle(e, d.K, d.time, d.env, (x, y, s, u, h, i) => {
      const [a, b] = drawn(d.K, u);
      if (b <= a) return;
      const pts = SHAPES.puff[i & 3], m = h < 0.5 ? 1 : -1;
      if (b >= 1 && a < 0.5) {
        ctx.beginPath();
        partOf(ctx, pts, x, y, s, m, 0, 1);
        ctx.fillStyle = pal.bg;
        ctx.fill();
      }
      ctx.beginPath();
      partOf(ctx, pts, x, y, s, m, a, b);
      ctx.stroke();
    }, d.opts);
  },

  // C · a stippled trail: dots set down one by one, and lifted one by one
  dots(e, d) {
    const { ctx } = d;
    const r = d.unit * 0.9;
    ctx.beginPath();
    eachParticle(e, d.K, d.time, d.env, (x, y, s, u, h, i) => {
      const [a, b] = drawn(d.K, u);
      const pts = SHAPES.dots[i & 3], n = pts.length;
      for (let j = 0; j < n; j++) {
        const at = (j + 0.5) / n;
        if (at < a || at > b) continue;
        ctx.rect(x + pts[j][0] * s - r, y + pts[j][1] * s - r, 2 * r, 2 * r);
      }
    }, d.opts);
    ctx.fillStyle = d.ink;
    ctx.fill();
  },

  // D · one wavering line up from the chimney through the puffs (a works'
  // stack: two, its plume's edges, widening); it grows from the mouth and
  // is taken back from its far end
  wisp(e, d) {
    const { ctx } = d;
    const pts = [];
    eachParticle(e, d.K, d.time, d.env, (x, y, s, u) => pts.push([x, y, s, u]), d.opts);
    if (lit(e, d.K, d.time)) pts.push([e.x, e.y, 0, 0]);
    if (pts.length < 2) return;
    const sides = e.kind === 'stack' ? [-0.5, 0.5] : [0];
    ctx.beginPath();
    for (const side of sides) {
      // the oldest end taken back: from part way along the first stretch
      const [, , , u0] = pts[0];
      const cut = u0 > 1 - d.K.out ? (u0 - (1 - d.K.out)) / d.K.out : 0;
      const P = (p) => [p[0] + side * p[2], p[1]];
      let [px, py] = P(pts[0]);
      const [qx, qy] = P(pts[1]);
      px += (qx - px) * cut; py += (qy - py) * cut;
      ctx.moveTo(px, py);
      for (let j = 1; j < pts.length - 1; j++) {
        const [ax, ay] = P(pts[j]), [bx, by] = P(pts[j + 1]);
        ctx.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
      }
      const [lx, ly] = P(pts[pts.length - 1]);
      ctx.lineTo(lx, ly);
    }
    ctx.stroke();
  },
};

// Draw emitters' particles ([[emitter, kind]…]) on a 2d context already set
// to scene px. `unit`: px of line width; `style` a STYLES key per kind;
// `keep`, `keepFixed` the share of the particles to draw from the emitters
// that come and go (houses) and those always on (works).
export function paintParticles(ctx, shown, { time, env = CALM, tile = 32, zScale = 0.9, unit = 1, style = SMOKE_DRAW.style, keep = 1, keepFixed = 1, pal = THEME.palette }) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const d = { ctx, time, env, pal, K: null, opts: { tile, zScale, keep: 1 }, unit, ink: null };
  // the furthest first, so nearer smoke goes over it
  shown.sort((a, b) => a[0].y - b[0].y);
  for (const [e, K] of shown) {
    d.K = K;
    d.opts.keep = K.on ? keep : keepFixed;
    d.ink = pal[K.ink] ?? pal.main;
    ctx.strokeStyle = d.ink;
    ctx.lineWidth = PEN[K.pen] * unit;
    STYLES[style[e.kind]](e, d);
  }
}

// ---------- the canvas ----------

// How far (css px) past the window an emitter may be and its marks still show.
const MARGIN = 40;

//   style     STYLES key per kind
//   most      the most particles drawn in a frame: beyond it the houses'
//             smoke thins first, then the works' too
//   minZoom   per kind: further out than this, none
//   fps       drawn again this often while the view stands still (smoke
//             moves slowly); at once when the view moves
export const SMOKE_DRAW = {
  style: { house: 'curl', stack: 'puff' },
  most: 1500,
  minZoom: { house: 1, stack: 0 },
  fps: 30,
};

export class ParticleCanvas {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.empty = true;
    this.drawnCount = 0;
  }

  // One frame. `emitters`: [{ x, y, kind, k, seed }] in scene px; `stroke`
  // the map's --stroke; `time` simulated seconds; `env` the weather.
  frame(camera, stroke, emitters, time, env = CALM, draw = SMOKE_DRAW) {
    const { canvas, ctx } = this;
    const dpr = devicePixelRatio || 1;
    const W = innerWidth, H = innerHeight;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    const view = `${camera.zoom} ${camera.panX} ${camera.panY} ${camera.angle} ${w} ${h}`;
    const now = performance.now();
    if (view === this.view && now - this.at < 1000 / draw.fps - 2) return;
    this.view = view;
    this.at = now;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    } else if (!this.empty) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
    }
    this.empty = true;
    this.drawnCount = 0;
    const { zoom, panX, panY } = camera;
    const T = camera.tile;
    // in view: the mouth, or the plume above and aside of it
    const shown = [];
    let load = 0, fixed = 0;
    for (const e of emitters) {
      const K = PARTICLES[e.kind];
      if (!K || zoom < (draw.minZoom[e.kind] ?? 0)) continue;
      const k = e.k ?? 1;
      const up = (K.rise * T * k + K.size[1] * T * k) * zoom, aside = (K.drift + K.wander) * T * zoom * 1.2;
      const x = panX + zoom * e.x, y = panY + zoom * e.y;
      if (x < -MARGIN || x - aside > W + MARGIN || y < -MARGIN || y - up * 1.3 > H + MARGIN) continue;
      const n = K.rate * K.life * (K.on ? K.on.share : 1);
      if (K.on) load += n; else fixed += n;
      shown.push([e, K]);
    }
    if (!shown.length) return;
    const keepHouses = Math.min(1, Math.max(0, draw.most - fixed) / Math.max(1, load));
    const keepWorks = Math.min(1, draw.most / Math.max(1, fixed));

    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY);
    paintParticles(ctx, shown, { time, env, tile: T, zScale: camera.zScale, unit: stroke ?? 1 / zoom, style: draw.style, keep: keepHouses, keepFixed: keepWorks, pal: this.pal ?? THEME.palette });
    this.drawnCount = shown.length;
    this.empty = false;
  }

  clear() {
    this.view = null;
    if (this.empty) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.empty = true;
  }
}

// ---------- as SVG (photo.js) ----------

// A stand-in for a canvas context that writes what is drawn as <path>s,
// so the styles draw a photo's smoke as they draw the map's.
class SVGPen {
  constructor(cls) { this.cls = cls; this.out = ''; this.d = ''; }
  beginPath() { this.d = ''; }
  moveTo(x, y) { this.d += `M${r2(x)} ${r2(y)}`; }
  lineTo(x, y) { this.d += `L${r2(x)} ${r2(y)}`; }
  quadraticCurveTo(a, b, x, y) { this.d += `Q${r2(a)} ${r2(b)} ${r2(x)} ${r2(y)}`; }
  rect(x, y, w, h) { this.d += `M${r2(x)} ${r2(y)}h${r2(w)}v${r2(h)}h${r2(-w)}Z`; }
  stroke() { if (this.d) this.out += `<path class="${this.cls}" d="${this.d}"/>`; }
  fill() {
    if (!this.d) return;
    // (a puff's paper: under its own line; the stipple's dots: ink)
    this.out += `<path class="${this.dots ? `${this.cls} smoke-dots` : 'smoke-paper'}" d="${this.d}"/>`;
  }
}
const r2 = (n) => Math.round(n * 100) / 100;

// One emitter's smoke as SVG, as it is at `time`: `tile` px per grid unit
// where it stands (a photo's scale there), `zScale` its camera's.
export function smokeSVG(e, time, env = CALM, { tile = 32, zScale = 1, style = SMOKE_DRAW.style } = {}) {
  const K = PARTICLES[e.kind];
  if (!K) return '';
  const pen = new SVGPen(`smoke pen-${K.pen}`);
  pen.dots = style[e.kind] === 'dots';
  const d = { ctx: pen, time, env, pal: THEME.palette, K, opts: { tile, zScale, keep: 1 }, unit: 1, ink: null };
  STYLES[style[e.kind]](e, d);
  return pen.out;
}
