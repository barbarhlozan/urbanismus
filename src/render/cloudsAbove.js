// Clouds overhead: zoomed right out under a cloudy sky, the clouds whose
// shadows drift over the map (cloudShadows.js) are drawn too, up in the
// air above their shadows – filled with paper, so they hide the town
// under them, and outlined in the pen. Zoom back in and they part; the sky
// clears and they go.
//
// Seen from above, as the map is: each cloud has its shadow's shape (the
// same lumps strung out along the wind, flattened onto the ground the same
// way), drawn as the clouds in a photo's sky are (clouds.js, the same
// cloudPen.js): every lump's edge a row of bulges, the lumps run together
// into one outline, and short slanting strokes inside the lower edge, as
// under a heap in a photo. Where one lump lies over the next its edge
// often shows as a fold inside.
//
// The same clouds as the shadows, coming and going with them: each lifted
// `lift` up the screen from its shadow, as big as the shadow is (`scale`).
// Only a few of them (`most`): those overhead in the view, drawn as the
// view is zoomed out and then left where they were drawn – a cloud gliding
// over the paper gives the drawing away, and one changing while it's
// watched too – so a drawing stays put while it is in view, its shadow
// drifting on under it; one more joins only out of sight, past the view's
// edge, for when the view is panned there. Each on a little canvas of its
// own (in #clouds-above, over the map), moved with the map, drawn again
// when the zoom has changed a good deal.
//
// Under rain the sky is all cloud (OVERCAST): zoomed out, the map is
// hidden under rain clouds packed edge to edge, heavy with strokes
// underneath, a storm's heavier still. Drawn in square cells of the ground
// as the view comes to them, each the same for as long as the rain lasts.

import { THEME } from '../theme.js';
import { CONFIG } from '../config.js';
import { CLOUD_SHADOWS } from './cloudShadows.js';
import { canvasDpr } from './dpr.js';
import { bulge, r2, P } from './cloudPen.js';
import { brushPath2D, GRAPHITE } from './brush.js';
import { toothCanvas, TOOTH } from './tooth.js';
import { mulberry32 } from '../core/random.js';

const CLOUDS_ABOVE = {
  zoom: 0.72,          // shown at this zoom and further out (config.camera.minZoom is 0.55)
  fade: 0.9,           // seconds to come or go
  cover: [0.45, 0.95], // the sky's cover (config.weather.cover) from which the first are up, and all of them
  lift: 2.4,           // grid units up the screen from the shadow
  scale: 1,            // a cloud's size as a share of its shadow's
  swell: 1.15,         // each lump a little fuller than the shadow's, so they run together
  lobes: [2, 4],       // smaller lobes bulging out of each lump's edge…
  lobe: [0.35, 0.55],  // …this big, a share of the lump
  bulge: [0.05, 0.11], // how unevenly a lump bulges: the share of its size its edge swells and dips by
  scallop: [1.3, 2.6],  // grid units: one bulge of the edge along it (fewer on a small lobe: at least `bulges`)
  bulges: 4,
  round: [1.05, 1.5],  // a bulge's radius, a share of half its length (1 a half circle; more is flatter)
  under: 1.4,          // strokes under a lump, per grid unit across it
  stroke: [0.1, 0.2],  // their length, a share of the lump's height on the screen
  fold: 0.6,           // the share of lumps lying over another whose edge shows there as a fold
  pen: [2, 1],         // the outline's pen and the strokes' (styles.css --pen-n), as in a photo's sky
  faint: 0.7,          // the strokes' strength (styles.css .photo-cloud-under)
  most: 4,             // clouds overhead at most, under a cloudy sky (fewer under a thinner one)
};

// The rain's clouds: how hard it rains (config.weather.rain) from which
// they are in, all of them, and a storm's; each cell `cell` grid units
// square, its lumps in rows `rows` apart and `cols` along them (grid units,
// on the screen), each `size` times as wide and high as that (ground
// units); `under`, `stroke` as CLOUDS_ABOVE's, heavier, a storm's `storm`
// times as many, and stronger (`faint`); not along the lower edge, which
// the next row hides, but anywhere across the lump in a `band` (shares of
// its height below its middle: up, just over where the next row hides it). Every lump
// outlined all round, not run together with the others, so a cell's edge
// looks like any other lump's.
const OVERCAST = {
  rain: [0.15, 0.8],
  storm: 1.6,
  cell: 12,
  rows: 5.5,
  cols: 11,
  size: [[0.62, 0.8], [0.85, 1.1]],
  big: [0.2, 1.5],     // the share of lumps this much bigger
  scallop: [3.4, 5.4], // fewer, bigger bubbles along the edge than a lone cloud's (CLOUDS_ABOVE)…
  lobes: [0, 2],       // …and fewer lobes
  under: 0.4,
  stroke: [0.07, 0.13],
  band: [-0.3, -0.06],
  faint: 1,
  storms: 1.7,
};

const between = (rnd, [a, b]) => a + rnd() * (b - a);

export class CloudsAbove {
  constructor(el, shadows) {
    this.el = el;         // the clouds' box: a little <canvas> each
    this.shadows = shadows;
    this.k = 0;           // how far they are in, zoomed out (0 gone, 1 there)
    this.up = [];         // drawings: { c (its shadow cloud), x, y (where it was drawn), canvas, b (how far it's in), drawn }
    this.o = 0;           // how far the rain's clouds are in
    this.cells = new Map(); // the rain's clouds: 'i,j' -> a drawing like those in `up`
    this.spell = 0;       // the rain's seed, while its clouds are in
  }

  // One frame: `dt` real seconds; `cover` the sky's; `stroke` the map's
  // --stroke; `rain` how hard it rains.
  frame(dt, camera, cover, stroke = 1, rain = 0) {
    const C = CLOUDS_ABOVE, O = OVERCAST;
    const far = camera.zoom <= C.zoom;
    const ease = (v, to) => (to > v ? Math.min(to, v + dt / C.fade) : Math.max(to, v - dt / C.fade));
    this.k = ease(this.k, far && cover > C.cover[0] ? 1 : 0);
    this.o = ease(this.o, far ? Math.min(1, Math.max(0, (rain - O.rain[0]) / (O.rain[1] - O.rain[0]))) : 0);
    const tile = camera.tile, lift = C.lift * tile, z = camera.zoom;
    const W = innerWidth, H = innerHeight;
    // a drawing at (x, y) on the ground, `w` wide, in the view (or, with
    // `reach`, its middle that far past it, shares of w)
    const inView = (x, y, w, reach = 0) => {
      const sx = camera.panX + z * x, sy = camera.panY + z * y, m = z * w * reach;
      return sx > -m && sx < W + m && sy > -m && sy < H + m;
    };
    // a few of the sky's clouds, the more the cloudier: those up stay put
    // until they're out of view or the view zooms in; others join while
    // they come in, and later only out of sight
    const most = Math.round(C.most * Math.min(1, Math.max(0, (cover - C.cover[0]) / (C.cover[1] - C.cover[0]))));
    let staying = 0;
    for (const u of this.up) {
      u.leaving ||= !this.k || !inView(u.x, u.y - lift, u.c.w, 1.8); // (well past where they join)
      if (!u.leaving) staying++;
    }
    if (this.k && staying < most) {
      const drawn = new Set(this.up.filter((u) => !u.leaving).map((u) => u.c));
      const coming = this.k < 1 && this.up.every((u) => u.b < 1);
      const next = this.shadows.clouds.find((c) => !drawn.has(c) && !c.leaving
        && (coming ? inView(c.x, c.y - lift, c.w) : !inView(c.x, c.y - lift, c.w, 0.6) && inView(c.x, c.y - lift, c.w, 1.4)));
      if (next) this.up.push({ c: next, x: next.x, y: next.y, lift, canvas: null, b: 0, leaving: false, drawn: null });
    }
    const dpr = canvasDpr();
    const place = (u, alpha) => {
      // drawn again only when the zoom has gone far from the one it was drawn at
      if (!u.drawn || Math.abs(z / u.drawn.zoom - 1) > 0.15 || u.drawn.stroke !== stroke || u.drawn.palette !== THEME.palette.main + THEME.palette.bg) {
        this.draw(u, tile, z * dpr, stroke);
        u.drawn = { zoom: z, stroke, palette: THEME.palette.main + THEME.palette.bg };
      }
      const k = z / u.drawn.zoom, [x0, y0] = u.at;
      const x = camera.panX + z * (u.x + x0), y = camera.panY + z * (u.y - u.lift + y0);
      u.canvas.style.transform = `translate(${x}px, ${y}px) scale(${k / dpr})`;
      u.canvas.style.opacity = alpha;
      u.canvas.style.zIndex = Math.round(u.y); // (nearer ones over those behind)
    };
    // each fades in or out by itself
    this.up = this.up.filter((u) => {
      u.b = u.leaving ? u.b - dt / C.fade : Math.min(1, u.b + dt / C.fade);
      if (u.b <= 0) {
        u.canvas?.remove();
        return false;
      }
      place(u, u.b * this.k);
      return true;
    });
    this.overcast(camera, tile, rain, place);
  }

  // The rain's clouds: the cells over the view and round it, the rest let go.
  overcast(camera, tile, rain, place) {
    const O = OVERCAST, z = camera.zoom;
    if (!this.o) {
      for (const u of this.cells.values()) u.canvas?.remove();
      this.cells.clear();
      this.spell = 0;
      return;
    }
    this.spell ||= (Math.random() * 2 ** 31) | 1;
    const S = O.cell * tile;
    const x0 = -camera.panX / z, y0 = -camera.panY / z, x1 = x0 + innerWidth / z, y1 = y0 + innerHeight / z;
    const i0 = Math.floor(x0 / S) - 1, i1 = Math.floor(x1 / S) + 1, j0 = Math.floor(y0 / S) - 1, j1 = Math.floor(y1 / S) + 1;
    for (const [key, u] of this.cells) {
      if (u.i < i0 - 1 || u.i > i1 + 1 || u.j < j0 - 1 || u.j > j1 + 1) {
        u.canvas?.remove();
        this.cells.delete(key);
      }
    }
    const storm = rain >= O.storm;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const key = `${i},${j}`;
        let u = this.cells.get(key);
        if (!u || u.storm !== storm) {
          u?.canvas?.remove();
          const rnd = mulberry32(this.spell ^ Math.imul(i, 73856093) ^ Math.imul(j, 19349663));
          u = { i, j, x: (i + 0.5) * S, y: (j + 0.5) * S, lift: 0, storm, canvas: null, drawn: null };
          u.above = traced(rnd, { lumps: packed(rnd, S, tile) }, 0, tile, {
            under: O.under * (storm ? O.storms : 1), stroke: O.stroke, band: O.band, faint: O.faint, fold: 0, each: true, scallop: O.scallop, lobes: O.lobes,
          });
          this.cells.set(key, u);
        }
        place(u, this.o);
      }
    }
  }

  // A cloud's own little canvas, drawn at `scale` device px per scene px.
  draw(u, tile, scale, stroke) {
    const C = CLOUDS_ABOVE;
    u.above ??= traced(Math.random, u.c, this.shadows.windAngle, tile);
    const { lumps, box, each, faint } = u.above;
    const pad = 4;
    const canvas = u.canvas ?? this.el.appendChild(Object.assign(document.createElement('canvas'), { className: 'cloud-above' }));
    u.canvas = canvas;
    canvas.width = Math.ceil((box[2] - box[0]) * scale) + 2 * pad;
    canvas.height = Math.ceil((box[3] - box[1]) * scale) + 2 * pad;
    u.at = [box[0] - pad / scale, box[1] - pad / scale];
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, pad - box[0] * scale, pad - box[1] * scale);
    const css = getComputedStyle(document.documentElement);
    const [pen, thin] = C.pen.map((n) => ((parseFloat(css.getPropertyValue(`--pen-${n}`)) || 1) * GRAPHITE.width * stroke * (CONFIG.render.lineWeight ?? 1) * canvasDpr()) / scale);
    const { bg, main } = THEME.palette;
    // in the pencil, as the map's lines are: the brush's ribbons (thinner
    // at their ends, swelling along them), their lead with the paper's
    // tooth in it, the specks as big on the screen as the map's
    const lead = ctx.createPattern((this.tooth?.ink === main ? this.tooth : (this.tooth = Object.assign(toothCanvas(main), { ink: main }))), 'repeat');
    const t = TOOTH / this.tooth.width / (scale / canvasDpr());
    lead.setTransform(new DOMMatrix([t, 0, 0, t, 0, 0]));
    const line = (d, width) => {
      const ribbons = brushPath2D(d, width);
      if (ribbons) ctx.fill(ribbons);
      else { ctx.lineWidth = width; ctx.stroke(new Path2D(d)); }
    };
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = lead;
    // each lump's outline twice as wide under all their fills: only the
    // outer half shows, round the lumps run together
    ctx.fillStyle = lead;
    if (!each) for (const l of lumps) line(l.edge, 2 * pen);
    // then far to near, each lump filled over those behind, with its
    // strokes and its fold – a nearer lump hides them where it lies over
    for (const l of lumps) {
      ctx.fillStyle = bg;
      ctx.fill(new Path2D(l.edge));
      ctx.fillStyle = lead;
      if (l.under) {
        ctx.globalAlpha = faint;
        line(l.under, thin);
        ctx.globalAlpha = 1;
      }
      if (each) line(l.edge, pen);
      if (l.over) {
        ctx.save();
        ctx.clip(l.over);
        line(l.edge, pen);
        ctx.restore();
      }
    }
  }
}

// A cloud's drawing in scene px about its middle, from its shadow's lumps
// (`c.lumps`, on the ground along and across the wind): each lump's
// outline, its strokes, the folds.
function traced(rnd, c, wind, tile, { under = CLOUDS_ABOVE.under, stroke = CLOUDS_ABOVE.stroke, fold = CLOUDS_ABOVE.fold, band = null, each = false, faint = CLOUDS_ABOVE.faint, scallop = CLOUDS_ABOVE.scallop, lobes = CLOUDS_ABOVE.lobes } = {}) {
  const C = CLOUDS_ABOVE, sq = CLOUD_SHADOWS.squash, k = C.scale;
  const cos = Math.cos(wind), sin = Math.sin(wind);
  const ground = ([u, v]) => [(u * cos - v * sin) * k, (u * sin + v * cos) * sq * k];
  // each lump fuller, with smaller lobes out of its edge
  const parts = [];
  c.lumps.forEach((l, g) => {
    const ru = l.ru * C.swell, rv = l.rv * C.swell;
    parts.push({ u: l.u, v: l.v, ru, rv, main: true, g });
    const n = Math.round(between(rnd, lobes));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, f = between(rnd, C.lobe);
      parts.push({ u: l.u + Math.cos(a) * ru * 0.78, v: l.v + Math.sin(a) * rv * 0.78, ru: ru * f, rv: rv * f, main: false, g });
    }
  });
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const rings = parts.map(({ u, v, ru, rv, main, g }) => {
    // the lump's outline on the screen, with a few swells and dips round
    // it of their own sizes…
    const swells = [2, 3, 5].map((n) => ({ n, size: between(rnd, C.bulge) / (n / 2), phase: rnd() * Math.PI * 2 }));
    const pts = [];
    const m = 96;
    for (let i = 0; i <= m; i++) {
      const a = (i / m) * Math.PI * 2;
      const r = 1 + swells.reduce((sum, w) => sum + w.size * Math.sin(w.n * a + w.phase), 0);
      pts.push(ground([u + Math.cos(a) * ru * r, v + Math.sin(a) * rv * r]));
    }
    const mid = ground([u, v]);
    const along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = along[m];
    const at = (s) => {
      let i = 1;
      while (i < m && along[i] < s) i++;
      const f = (s - along[i - 1]) / (along[i] - along[i - 1] || 1);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    };
    // …gone round in bulges, each of its own length, all bulging outwards
    const mean = ((scallop[0] + scallop[1]) / 2) * tile, f = Math.min(1, total / C.bulges / mean);
    const knots = [];
    for (let s = rnd() * mean * f * 0.5; s < total - mean * f * 0.4; s += between(rnd, scallop) * tile * f) knots.push(at(s));
    knots.push(knots[0]);
    let d = `M${P(...knots[0])}`;
    for (let i = 1; i < knots.length; i++) {
      const a = knots[i - 1], b = knots[i];
      const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // outwards: the side away from the lump's middle
      const out = (b[1] - a[1]) * ((a[0] + b[0]) / 2 - mid[0]) - (b[0] - a[0]) * ((a[1] + b[1]) / 2 - mid[1]) > 0;
      d += bulge(rnd, a, b, (chord / 2) * between(rnd, C.round), out);
      for (const p of [a, b]) {
        box[0] = Math.min(box[0], p[0]); box[1] = Math.min(box[1], p[1]);
        box[2] = Math.max(box[2], p[0]); box[3] = Math.max(box[3], p[1]);
      }
    }
    // short strokes leaning one way, inside the lower edge (as under a
    // cloud in a photo): from the lower half of the outline, inwards
    let strokes = '';
    if (main) {
      const h = 2 * rv * sq * k, w = 2 * Math.max(ru, rv) * k;
      const low = pts.filter((p) => p[1] > mid[1] + h * 0.22);
      for (let n = Math.round((w / tile) * under * (0.6 + rnd() * 0.8)); n > 0 && low.length; n--) {
        const l = h * between(rnd, stroke);
        let x0, y0;
        if (band) {
          // (anywhere across the lump, this far below its middle)
          x0 = mid[0] + (rnd() * 2 - 1) * ru * k * 0.6;
          y0 = mid[1] + between(rnd, band) * h;
        } else {
          const [x, y] = low[Math.floor(rnd() * low.length)];
          x0 = x + (mid[0] - x) * 0.06;
          y0 = y - h * (0.05 + rnd() * 0.05);
        }
        strokes += `M${P(x0, y0)}l${r2(l * 0.7)} ${r2(-l)}`;
      }
    }
    return { edge: d, under: strokes, main, g, sy: mid[1] };
  });
  // nearer lumps (lower on the screen) over those behind; a fold: a
  // lump's edge where it lies over the lumps behind it
  // (drawn one by one, each lump with its lobes – or, all outlined, as a
  // heap at a time: its lobes, then its strokes, so its own lobes don't
  // hide them)
  let order = [...rings].sort((p, q) => p.sy - q.sy);
  if (each) {
    const at = new Map(rings.filter((r) => r.main).map((r) => [r.g, r.sy]));
    order = [...rings].sort((p, q) => at.get(p.g) - at.get(q.g) || p.g - q.g || p.sy - q.sy);
    for (const r of rings.filter((r) => r.main)) {
      const last = order.findLast((q) => q.g === r.g);
      if (last !== r) [last.under, r.under] = [r.under, ''];
    }
  }
  const lumps = order.map((r, i) => {
    let over = null;
    if (i && r.main && rnd() < fold) {
      over = new Path2D();
      for (let j = 0; j < i; j++) over.addPath(new Path2D(order[j].edge));
    }
    return { edge: r.edge, under: r.under, over };
  });
  // (room for the bulges)
  const m = scallop[1] * tile * 0.6;
  return { tile, lumps, each, faint, box: [box[0] - m, box[1] - m, box[2] + m, box[3] + m] };
}

// A cell of the rain's clouds, S scene px square about its middle: lumps
// in staggered rows (along and across as traced() takes them, with no
// wind: across is up the ground, squashed), each a little askew of its
// place and big enough to run into its neighbours, so no paper between.
function packed(rnd, S, tile) {
  const O = OVERCAST, sq = CLOUD_SHADOWS.squash, k = CLOUDS_ABOVE.scale;
  const rows = Math.max(1, Math.round(S / (O.rows * tile))), cols = Math.max(1, Math.round(S / (O.cols * tile)));
  const gx = S / cols, gy = S / rows, lumps = [];
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const x = -S / 2 + (q + 0.5 + (r % 2 ? 0.25 : -0.25) + (rnd() - 0.5) * 0.6) * gx;
      const y = -S / 2 + (r + 0.5 + (rnd() - 0.5) * 0.5) * gy;
      const big = rnd() < O.big[0] ? O.big[1] : 1;
      lumps.push({ u: x / k, v: y / sq / k, ru: (gx * big * between(rnd, O.size[0])) / k, rv: ((gy / sq) * big * between(rnd, O.size[1])) / k });
    }
  }
  return lumps;
}
