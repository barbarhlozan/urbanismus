// A building on fire (World.igniteStructure: s.burning), drawn in red
// pencil on a canvas of its own (#fire) over the buildings and their smoke.
// flames.html sketches it.
//
// The fire starts inside: first a window alight – the room behind it
// filled with the red pencil, now and then a tall tongue out of its head
// and up the wall – then more windows, nearest first, and the roof catches
// after them, lower: the windows are the fire. Each window and the roof
// give off dark smoke, shaded darkest as it leaves the fire and lightening
// smoothly as it rises.
//
//   ablaze     how far it has burnt (1 - left / total) sets how much is
//              alight and how tall
//   burning out  when it has burnt down (s.ruin), low flames along the
//              ruin's stumps for OUT seconds, sinking, and smoke after
//   put out    when it is put out (s.burning gone, no ruin), the flames
//              sink back in DOUSE seconds and the smoke thins out
//
// A tongue is three tongues one inside the other – a pale rim, the red
// body, an orange heart – each a ground of colour pressed over with upright
// strokes of a deeper shade; all the rims are laid first, then the bodies,
// then the hearts, so the tongues run together into one fire. It grows from
// nothing at its foot and sinks back into it, flickering on tens (a drawn
// film's frames), and leans with the wind as the trees and the smoke do.
// Nothing is kept from frame to frame: it all follows from the town's time.
//
// The windows and the outline come from the building's own drawing (its
// entry's night: the panes as drawn, and the outlines of its solids).

import { THEME } from '../theme.js';
import { PEN } from './agentCanvas.js';
import { PARTICLES, eachParticle, drawn, hash } from './particles.js';

const FPS = 10;     // drawn on tens
const OUT = 70;     // seconds a ruin burns out
const DOUSE = 25;   // seconds a fire put out takes to die down (the smoke longer)
const STORM_WIND = 0.14;

// the pencils: rim, body, heart (a ground, and the strokes over it)
//   w, h   the layer's tongue against the body's (width, height)
//   down   how far its foot reaches below the seat (× the tongue's width)
const PENCIL = [
  { w: 1.35, h: 1.16, down: 0.5, ground: '#eba08f', strokes: '#d86f60' },
  { w: 1, h: 1, down: 0.25, ground: '#e4643a', strokes: '#c43c1f' },
  { w: 0.5, h: 0.58, down: 0, ground: '#f3b347', strokes: '#e48a2a' },
];
// (on dark paper the pencils show a shade lighter)
const DARK = [
  { ground: '#c97a6c', strokes: '#e0907f' },
  { ground: '#c4502c', strokes: '#e3683f' },
  { ground: '#d99a3a', strokes: '#f3b347' },
];
const SPARK = '#c43c1f';

// How a seat gives off tongues:
//   every  seconds between tongues   life  [shortest, longest] seconds
//   tall   heights against the roof's  skip  share of turns with none
//   foot   how far the rounded foot reaches below the seat
const ROOF = { every: 0.45, life: [0.7, 1.3], tall: 1, skip: 0, foot: 1, spread: 1 };
const WINDOW = { every: 0.7, life: [1.3, 2.1], tall: 2.8, skip: 0.25, foot: 0.15, spread: 0.3 };

// the smoke: the game's puffs (particles.js), a bigger and faster kind than
// a works' stack; the roof's as slow as a window's, though it goes higher
const WINDOW_SMOKE = { ...PARTICLES.stack, rate: 1.6, life: 11, rise: 2.6, size: [0.1, 0.36], on: null };
const ROOF_SMOKE = { ...WINDOW_SMOKE, rate: 1.0, life: 18 };
const SHADE = [0.7, 0.12]; // share of the pen in a puff's shade: given off → at its end

// ---------- the stages ----------

const clamp = (v) => Math.max(0, Math.min(1, v));
const ease = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// What burns at progress p (0 just caught – 1 about to fall in):
//   windows  how many of its windows (from the first, nearest next)
//   share    how much of the roof, from the end nearest the first window
//   k, roof  how tall the windows' flames and the roof's
//   smoke    the size of the roof's smoke and the windows'
//   surge    how much it flares up and sinks back
function stageAt(p, panes) {
  const n = panes;
  return {
    windows: n ? 1 + (n - 1) * ease(0.15, 0.7, p) : 0,
    share: ease(0.3, 0.75, p),
    k: 0.55 + 0.5 * ease(0.1, 0.7, p),
    roof: 0.4 + 0.1 * ease(0.5, 0.8, p),
    smoke: 0.45 + 0.9 * ease(0.2, 0.8, p),
    surge: 0.15 + 0.3 * ease(0.4, 0.8, p),
  };
}

// A blaze surges: every few seconds it flares up for a while and sinks back.
function surge(t, amount, seed) {
  const a = t / 4 + seed * 0.37, i = Math.floor(a), f = a - i, e = f * f * (3 - 2 * f);
  const v = hash(i, 4242) * (1 - e) + hash(i + 1, 4242) * e;
  return 1 + amount * (v * v * 1.6 - 0.35);
}

// ---------- the tongues ----------

// one tongue of seat s, its number i, at time t: [x, y, w, h, lean, u] or
// null between tongues
function tongue(s, i, t, k, wind, T, o) {
  const h0 = hash(s.seed, i), life = o.life[0] + (o.life[1] - o.life[0]) * h0;
  if (o.skip && hash(i, s.seed ^ 0x51) < o.skip) return null;
  const born = i * o.every + h0 * o.every * 0.66, a = t - born;
  if (a < 0 || a > life) return null;
  const u = a / life;
  // it grows from nothing at the foot and sinks back into it
  const rise = Math.min(1, u / 0.3, (1 - u) / 0.35), grow = rise * rise * (3 - 2 * rise);
  const h = T * k * o.tall * (0.22 + 0.3 * hash(i, s.seed + 3)) * grow;
  const w = T * k * (0.07 + 0.04 * hash(s.seed, i + 9)) * (0.25 + 0.75 * grow);
  const sway = Math.sin(t * 7 + h0 * 6.283) * 0.25 - wind;
  const dx = (hash(i, s.seed) - 0.5) * T * 0.08 * o.spread;
  return [s.x + dx, s.y, w, h, sway, u];
}

// A tongue's outline: up the left side to the tip, which leans and flicks
// over, and down the right – a round belly low down, narrowing to the tip,
// the sides wavering.
function tongueShape(x, y, w, h, lean, v) {
  const pts = [], n = 14;
  for (let j = 0; j <= n; j++) {
    const t = j / n, up = 1 - Math.abs(2 * t - 1), side = t < 0.5 ? -1 : 1;
    const hw = w * (1 - up) ** 0.85 * (0.75 + 0.5 * Math.sin(Math.PI * Math.min(1, up * 1.8)));
    const wave = Math.sin(up * 8 + v * 1.7 + side) * w * 0.2 * up * (1 - up) * 3;
    pts.push([x + side * hw + wave + lean * h * up ** 2, y - h * up]);
  }
  return pts;
}

const darkPaper = (pal) => {
  const c = parseInt(pal.bg.slice(1), 16);
  return ((c >> 16) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11) < 90;
};

// The seats' fire in red pencil, the rims, bodies and hearts each as one.
function pencilFire(ctx, seats, t, k, wind, d, o = ROOF) {
  const { T } = d;
  const tongues = [];
  for (const s of seats) {
    for (let i = Math.floor((t - o.life[1] - o.every) / o.every) - 1; i <= Math.floor(t / o.every); i++) {
      const g = tongue(s, i, t, k * (s.k ?? 1), wind, T, o);
      if (g) tongues.push([...g, i]);
    }
  }
  if (!tongues.length) return;
  const lean = tongues.reduce((m, g) => m + g[4], 0) / tongues.length;
  PENCIL.forEach((L, n) => {
    const ink = d.dark ? { ...L, ...DARK[n] } : L;
    ctx.save();
    ctx.beginPath();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y, w, h, tl, , i] of tongues) {
      const down = L.down * o.foot, r = w * L.w;
      const pts = tongueShape(x, y + w * down, w * L.w, h * L.h + w * down, tl, i + n);
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const [px, py] of pts) {
        ctx.lineTo(px, py);
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py);
      }
      // a round foot under it
      ctx.quadraticCurveTo(x, y + w * down + r * 0.7 * o.foot, pts[0][0], pts[0][1]);
      y1 = Math.max(y1, y + w * down + r * 0.7 * o.foot);
    }
    ctx.fillStyle = ink.ground;
    ctx.fill('nonzero');
    ctx.clip('nonzero');
    // upright strokes, leaning with the fire, close as a pencil hatches,
    // each broken in two or three where the pencil lifted
    const gap = 1.5 * d.unit, tall = y1 - y0, f = Math.floor(t * FPS);
    ctx.beginPath();
    let c = 0;
    for (let x = x0 - tall * Math.abs(lean); x <= x1 + tall * Math.abs(lean); x += gap, c++) {
      let y = y1;
      for (let p = 0; y > y0 && p < 4; p++) {
        const len = tall * (0.25 + 0.5 * hash(c * 7 + p, f + n * 31));
        const dx = lean * len + (hash(c, p + 5) - 0.5) * 1.2 * d.unit;
        const xs = x + (y1 - y) * lean;
        ctx.moveTo(xs, y);
        ctx.quadraticCurveTo(xs + dx * 0.5 + 0.6 * d.unit, y - len * 0.5, xs + dx, y - len);
        y -= len + (1 + 2 * hash(p, c)) * d.unit;
      }
    }
    ctx.strokeStyle = ink.strokes;
    ctx.lineWidth = PEN[2] * d.unit;
    ctx.stroke();
    ctx.restore();
  });
}

// A burning window: the room behind it alight – the pane filled with the
// red pencil, the orange heart rising and sinking in its lower part – and
// now and then a tall tongue out of its head and up the wall. `k` its
// flames' height (0: only just catching), j its number.
function windowFire(ctx, pane, j, t, k, wind, d) {
  const [a, b, , e] = pane;
  const ink = (n) => (d.dark ? { ...PENCIL[n], ...DARK[n] } : PENCIL[n]);
  const at = (u, v) => [a[0] + (b[0] - a[0]) * u + (e[0] - a[0]) * v, a[1] + (b[1] - a[1]) * u + (e[1] - a[1]) * v];
  const quad = (v0, v1) => {
    ctx.beginPath();
    [at(0, v0), at(1, v0), at(1, v1), at(0, v1)].forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y));
    ctx.closePath();
  };
  const lit = clamp(k * 2); // (a window catching fills from the sill up)
  ctx.save();
  quad(0, lit);
  ctx.fillStyle = ink(1).ground;
  ctx.fill();
  ctx.clip();
  const f = Math.floor(t * FPS);
  quad(0, lit * (0.45 + 0.25 * Math.sin(t * 5 + j * 2.1) + 0.1 * hash(j, f)));
  ctx.fillStyle = ink(2).ground;
  ctx.fill();
  const wpx = Math.hypot(b[0] - a[0], b[1] - a[1]);
  ctx.beginPath();
  for (let u = 0.08; u < 1; u += (1.5 * d.unit) / Math.max(d.unit, wpx)) {
    const [x0, y0] = at(u, 0), [x1, y1] = at(u, 0.6 + 0.4 * hash(Math.round(u * 50), f + j));
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1 + 0.4 * d.unit, y1);
  }
  ctx.strokeStyle = ink(1).strokes;
  ctx.lineWidth = PEN[2] * d.unit;
  ctx.stroke();
  ctx.restore();
  const [x, y] = at(0.5, 1);
  pencilFire(ctx, [{ x, y, seed: 300 + j * 13 + d.seed }], t, k * Math.max(0.45, wpx / (d.T * 0.1)), wind, d, WINDOW);
}

// sparks: a few short strokes thrown up over a blaze
function sparks(ctx, seats, t, k, wind, d) {
  if (k < 0.45 || !seats.length) return;
  const { T } = d;
  ctx.beginPath();
  for (const s of seats) {
    for (let i = Math.floor(t * 1.2) - 3; i <= Math.floor(t * 1.2); i++) {
      if (hash(i, s.seed) > 0.35) continue;
      const a = t - i / 1.2, life = 2.5;
      if (a < 0 || a > life) continue;
      const u = a / life;
      const x = s.x + (hash(s.seed, i) - 0.5) * T * 0.4 - wind * T * u * 1.5 + Math.sin(a * 3 + i) * T * 0.05;
      const y = s.y - T * k * (0.5 + 1.4 * u);
      ctx.moveTo(x, y);
      ctx.lineTo(x + T * 0.012, y - T * 0.03);
    }
  }
  ctx.strokeStyle = SPARK;
  ctx.lineWidth = PEN[2] * d.unit;
  ctx.stroke();
}

// ---------- the smoke ----------

const mix = (a, b, f) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * f + parseInt(b.slice(i, i + 2), 16) * (1 - f)).toString(16).padStart(2, '0')).join('');
function puffShape(v) {
  // a round of shallow lobes, as particles.js's puffs
  const lobes = 5 + (v % 3), pts = [], n = lobes * 6;
  for (let j = 0; j <= n; j++) {
    const th = (j / n) * Math.PI * 2 + v * 0.7;
    const r = 0.4 + 0.1 * Math.abs(Math.sin((th * lobes) / 2));
    pts.push([r * Math.cos(th), r * Math.sin(th) * 0.8]);
  }
  return pts;
}
const PUFFS = [0, 1, 2, 3].map(puffShape);

// Dark smoke from emitters ({ x, y, k, seed }, scene px) of kind K, each
// puff shaded in with the pen mixed into the paper, darkest as it leaves
// the fire; `keep` the share of each emitter's puffs drawn (a fire dying
// down gives off fewer).
function darkSmoke(ctx, emitters, K, d) {
  ctx.lineWidth = PEN[3] * d.unit;
  ctx.strokeStyle = d.pal.main;
  for (const e of emitters) {
    eachParticle(e, K, d.time, d.env, (x, y, sz, u, h, i) => {
      if (e.until != null && (i + h * 0.7) / K.rate > e.until) return;
      const [a, b] = drawn(K, u);
      if (b <= a) return;
      const pts = PUFFS[i & 3], m = h < 0.5 ? 1 : -1, n = pts.length - 1;
      ctx.beginPath();
      if (b >= 1 && a < 0.5) {
        for (let j = 0; j <= n; j++) ctx[j ? 'lineTo' : 'moveTo'](x + m * sz * pts[j][0], y + sz * pts[j][1]);
        ctx.fillStyle = mix(d.pal.main, d.pal.bg, SHADE[0] + (SHADE[1] - SHADE[0]) * u ** 0.7);
        ctx.fill();
        ctx.beginPath();
      }
      for (let f = a, first = true; f <= b + 1e-6; f += 1 / n, first = false) {
        const p = pts[Math.round(Math.min(1, f) * n)];
        ctx[first ? 'moveTo' : 'lineTo'](x + m * sz * p[0], y + sz * p[1]);
      }
      ctx.stroke();
    }, { tile: d.T, zScale: d.zScale, keep: e.keep ?? 1 });
  }
}

// ---------- where it burns ----------

// The top of a drawing's outline, column by column: from its solids'
// outlines (hulls, scene px). `cols` x → the highest y there.
function skyline(all, T) {
  const covers = all?.filter((h) => !h.aside); // (the building's own, not its yard's)
  if (!covers?.length) return null;
  let top = Infinity, bottom = -Infinity;
  for (const h of covers) for (const [, y] of h) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
  // the building itself: what stands in the upper half (not the yard's fences)
  const tall = covers.filter((h) => Math.min(...h.map((p) => p[1])) < top + (bottom - top) * 0.5);
  let x0 = Infinity, x1 = -Infinity;
  for (const h of tall) for (const [x] of h) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  const at = (x) => {
    let best = Infinity;
    for (const h of tall) {
      for (let i = 0; i < h.length; i++) {
        const [ax, ay] = h[i], [bx, by] = h[(i + 1) % h.length];
        if ((ax - x) * (bx - x) > 0 || ax === bx) continue;
        best = Math.min(best, ay + ((by - ay) * (x - ax)) / (bx - ax));
      }
    }
    return best;
  };
  return { x0, x1, at, T };
}

// The seats of a roof (or a ruin's stumps) fire: along the top of its
// outline, a little down into it so the flames stand on it, from the end
// nearest `from` (scene x).
function roofSeats(sky, share, from, seed, T) {
  if (!sky || share <= 0) return [];
  const width = sky.x1 - sky.x0, n = Math.max(4, Math.min(16, Math.round(width / (T * 0.09))));
  const fromLeft = from == null || from < (sky.x0 + sky.x1) / 2;
  const seats = [];
  for (let j = 0; j < n; j++) {
    const t = (j + 0.5) / n;
    if (t > share) break;
    const x = sky.x0 + width * (0.1 + 0.8 * (fromLeft ? t : 1 - t));
    const y = sky.at(x);
    if (Number.isFinite(y)) seats.push({ x, y: y + T * 0.04, seed: seed + 101 + j * 17 });
  }
  return seats;
}

// A building's windows in the order they catch: the first a low one (the
// fire starts in a room downstairs), picked by the building's seed among
// the lowest, then the nearest to it next.
function windowOrder(wins, seed) {
  const panes = wins.filter((w) => !w.aside).map((w) => w.pts);
  if (!panes.length) return [];
  const low = panes.slice().sort((p, q) => Math.max(q[0][1], q[1][1]) - Math.max(p[0][1], p[1][1])).slice(0, 3);
  const first = low[Math.floor(hash(seed, 7) * low.length)];
  const mid = (p) => [(p[0][0] + p[2][0]) / 2, (p[0][1] + p[2][1]) / 2];
  const [fx, fy] = mid(first);
  return panes.slice().sort((p, q) => {
    const [px, py] = mid(p), [qx, qy] = mid(q);
    return Math.hypot(px - fx, py - fy) - Math.hypot(qx - fx, qy - fy);
  });
}

// ---------- the canvas ----------

export class FireCanvas {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d') ?? null;
    this.world = world;
    this.out = new Map();    // id -> world time it burnt down (burning out)
    this.doused = new Map(); // id -> { at, p } put out at world time `at`, at progress p
    this.was = new Map();    // id -> its last progress, while it burns
    this.shapes = new WeakMap(); // an entry's night -> its skyline and windows in order
    this.drawn = false;
    this.ruins = new Set(); // the ruins there were: a new one burns out (burnt down at once too)
    world.events.on('structure:changed', (s) => {
      if (s.burning) {
        this.was.set(s.id, this.progress(s));
        this.doused.delete(s.id);
        return;
      }
      if (s.ruin && !this.ruins.has(s.id)) {
        this.ruins.add(s.id);
        this.was.delete(s.id);
        this.out.set(s.id, world.time);
        return;
      }
      if (!s.ruin) this.ruins.delete(s.id);
      if (!this.was.has(s.id)) return;
      this.doused.set(s.id, { at: world.time, p: this.was.get(s.id) });
      this.was.delete(s.id);
    });
    world.events.on('structure:removed', (s) => {
      this.was.delete(s.id);
      this.out.delete(s.id);
      this.doused.delete(s.id);
      this.ruins.delete(s.id);
    });
    for (const s of world.structures.values()) {
      if (s.burning) this.was.set(s.id, this.progress(s));
      if (s.ruin) this.ruins.add(s.id);
    }
  }

  progress(s) {
    const { left, total } = s.burning;
    return clamp(1 - left / Math.max(1e-6, total));
  }

  // What's on fire now, each with its stage: [{ s, p, stage, fade }].
  fires(time) {
    const out = [];
    for (const id of this.was.keys()) {
      const s = this.world.structures.get(id);
      if (!s?.burning) continue;
      const p = this.progress(s);
      this.was.set(id, p);
      out.push({ s, p, fade: 1, ruin: false });
    }
    for (const [id, at] of this.out) {
      const s = this.world.structures.get(id), a = time - at;
      if (!s || a > OUT + ROOF_SMOKE.life) { this.out.delete(id); continue; }
      out.push({ s, p: 1, fade: 1 - a / OUT, ruin: true, since: at });
    }
    for (const [id, d] of this.doused) {
      const s = this.world.structures.get(id), a = time - d.at;
      if (!s || a > DOUSE + ROOF_SMOKE.life) { this.doused.delete(id); continue; }
      out.push({ s, p: d.p, fade: 1 - a / DOUSE, ruin: false, since: d.at });
    }
    return out;
  }

  // One frame. `entryOf` structure id -> its renderer entry (night: panes
  // and covers; shown); `stroke` the map's line width; `time` the town's
  // seconds; `env` the weather.
  frame(camera, stroke, entryOf, time, env) {
    if (!this.ctx) return;
    const fires = this.fires(time);
    const { canvas, ctx } = this;
    if (!fires.length) {
      if (this.drawn) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); this.drawn = false; }
      return;
    }
    const dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const z = camera.zoom;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * camera.panX, dpr * camera.panY);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const pal = THEME.palette, T = camera.tile;
    const t = Math.floor(time * FPS) / FPS;
    const lean = Math.min(1, (env.wind ?? 0) / STORM_WIND) * 0.7;
    const d = { T, zScale: camera.zScale, unit: stroke ?? 1 / z, pal, dark: darkPaper(pal), time, env, seed: 0 };
    this.drawn = false;
    for (const f of fires) {
      const e = entryOf(f.s.id);
      if (!e?.night || e.shown === false) continue;
      let shape = this.shapes.get(e.night);
      if (!shape) this.shapes.set(e.night, (shape = { sky: skyline(e.night.covers, T), panes: f.ruin ? [] : windowOrder(e.night.wins ?? [], f.s.seed ?? f.s.id) }));
      if (!this.inView(shape, camera, T)) continue;
      this.drawn = true;
      d.seed = (f.s.seed ?? f.s.id) % 997;
      this.paint(f, shape, t, lean, d);
    }
  }

  inView(shape, camera, T) {
    const { sky } = shape;
    if (!sky) return false;
    const z = camera.zoom, x0 = camera.panX + z * (sky.x0 - T * 2), x1 = camera.panX + z * (sky.x1 + T * 2);
    const y = camera.panY + z * sky.at((sky.x0 + sky.x1) / 2);
    return x1 > 0 && x0 < innerWidth && y > -z * T * 4 && y < innerHeight + z * T * 2;
  }

  paint(f, shape, t, wind, d) {
    const { ctx } = this, { T } = d;
    const fade = clamp(f.fade);
    const st = f.ruin
      ? { windows: 0, share: 0.75, k: 0, roof: 0.45, smoke: 0.7, surge: 0.2 }
      : stageAt(f.p, shape.panes.length);
    const seed = d.seed;
    const panes = shape.panes.slice(0, Math.ceil(st.windows));
    const firstX = shape.panes[0] ? (shape.panes[0][0][0] + shape.panes[0][1][0]) / 2 : null;
    const seats = roofSeats(shape.sky, st.share, firstX, seed, T);
    // (the smoke goes on a while after the flames: given off until the fire died)
    const until = fade > 0 ? null : f.since + (f.ruin ? OUT : DOUSE);
    const keep = 0.35 + 0.65 * clamp(fade);
    const roofSmoke = seats.filter((_, j) => j % 3 === 1).map((s, j) => ({ x: s.x, y: s.y - T * 0.2 * st.roof, k: st.smoke, seed: seed * 31 + 900 + j, until, keep }));
    const many = panes.length >= 4;
    const windowSmoke = panes.filter((_, j) => !many || j % 3 === 0).map((p, j) => ({ x: (p[2][0] + p[3][0]) / 2, y: (p[2][1] + p[3][1]) / 2 - T * 0.12, k: Math.min(0.6, st.smoke * 0.6), seed: seed * 31 + 950 + j, until, keep }));

    // the roof's smoke behind everything, the windows' fire, the roof's
    // fire, and the windows' smoke in front of it
    darkSmoke(ctx, roofSmoke, ROOF_SMOKE, d);
    if (fade > 0) {
      panes.forEach((pane, j) => {
        // each window catches in its turn, from nothing
        const own = clamp(st.windows - j);
        windowFire(ctx, pane, j, t, st.k * own * fade * surge(d.time + j * 1.7, st.surge, seed), wind, d);
      });
      const k = st.roof * fade * surge(d.time, st.surge, seed) * (1 - 0.2 * wind);
      pencilFire(ctx, seats, t, k, wind, d);
      sparks(ctx, seats, t, k * 2, wind, d);
    }
    darkSmoke(ctx, windowSmoke, WINDOW_SMOKE, d);
  }

  clear() {
    if (!this.drawn || !this.ctx) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawn = false;
  }
}
