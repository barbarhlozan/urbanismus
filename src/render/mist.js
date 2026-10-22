// Mist lying in the valleys (weather 'mist', config.weather.mist), drawn as
// on old Japanese screens of a town seen from above (the kasumi bands,
// mist.html option E): a flat top at one height, that hides whatever is
// below it – the ground and its drawing, roads, people, the
// lower part of every house standing in it. It is laid as every shadow
// and the night are, in the paper's strokes (hatch.js), only in the
// paper's own colour and broad: they rub out what is under them, a sliver
// of it showing between each two (mistHatch). Its far shore, where it lies
// against a hillside, stands up in long shallow lobes drawn in the pen with
// one line inside along it; its near edge, where the ground in front comes
// out of it, is a plain pen line; and where it closes round a roof or a
// tree that stands out of it, it lumps up a little.
//
//   mistLevel(lo, hi, opts, risen)   the height of its top (grid units of
//                     height, as the ground's: lift + terrain)
//   mistSurface(camera, height, box, level)   where it shows, worked out a
//                     screen column at a time (as brows.js): walking each
//                     column from the front back, the mist shows where it
//                     is above all the nearer ground and mist seen so far
//   mistSVG(surface, camera, seed)   the paper, the lobes and the lines
//   mistHatch(h)      the paper's strokes it is filled with (h: SUN.hatch):
//                     their settings and width (grid units), for the tile
//                     of gl/objects.js (setTile)
//   coverSVG(camera, at, base, height, level, seed)   what an object standing in it
//                     gets drawn over itself: paper over its front below
//                     the top, lumps along where it is cut; or 'under' when
//                     it is in it altogether
//
// The mist is its own layer, right under the objects (Renderer, layer
// 'mist'), so it hides everything in the layers below; an object is cut by
// its own cover, and what is left of it is above the mist, which then can't
// hide it. (Only the lobes along the far shore are under the objects
// beyond it, which they would cover a little.) The camera's warp is not
// followed (STYLE.warp is 0).

import { mulberry32 } from '../core/random.js';
import { hatchFrame } from './hatch.js';
import { penWatch, penLength } from './draw.js';

const COS30 = Math.cos(Math.PI / 6);

//   du, dt     sampling across and down the view (view units)
//   link       shore points in neighbouring columns join up when this close
//              on the screen (scene px at tile 32)
//   lobe       a lobe along the far shore: its length (scene px at tile 32)…
//   lobeRise   …over its height
//   inner      the line inside along the far shore: this far below it…
//   innerFrom  …on stretches at least this long (scene px at tile 32)
//   lump       the lumps where it closes round an object: each this long…
//   lumpRise   …over its height
//   fade       ms a step of it takes to come or go (mistIn, mistOut)
//   paper      how much it hides an object sunk in it altogether (opacity;
//              styles.css .mist-under, keep the two alike)
//   gap        its strokes: the paper's (hatch.js), this far apart (grid
//              units; made to fit its repeat)…
//   broad      …each as broad as this share of the space between two
export const MIST = {
  du: 0.08,
  dt: 0.04,
  link: 3,
  lobe: [17, 45],
  lobeRise: [4, 8],
  inner: 3.4,
  innerFrom: 50,
  lump: [8, 14],
  lumpRise: [2.4, 3.6],
  fade: 7000,
  paper: 0.9,
  gap: 0.11,
  broad: 0.72,
};

const r2 = (n) => Math.round(n * 100) / 100;

export function mistLevel(lo, hi, { share, least }, risen) {
  return lo + risen * Math.max(least, share * (hi - lo));
}

// `height(x, y)`: the ground's height as drawn (lift + terrain), `box`
// world [x0, y0, x1, y1]. Returns { runs: [[u, tBack, tFront]…], far, near }:
// the stretches of each column where the mist shows, and its shores, as
// lines of [scene x, scene y, t] (t = depth, growing towards the viewer).
export function mistSurface(camera, height, [x0, y0, x1, y1], level, opts = MIST) {
  const { du, dt } = opts;
  const T = camera.tile, Z = camera.zScale, link = (opts.link * T) / 32;
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => {
    const [rx, ry] = camera.rotated(x, y);
    return [rx - ry, rx + ry];
  });
  const uMin = Math.min(...corners.map((c) => c[0])), uMax = Math.max(...corners.map((c) => c[0]));
  const tMin = Math.min(...corners.map((c) => c[1])), tMax = Math.max(...corners.map((c) => c[1]));
  const at = (u, t) => {
    const [x, y] = camera.toWorld((t + u) / 2, (t - u) / 2);
    return [x + camera.cx, y + camera.cy];
  };
  const sy = (t) => (t / 2 - level * Z) * T;
  const runs = [], far = [], near = [];
  // a shore point joins the line it carries on from (the last column's)
  const chain = (lines, open, [x, y, t]) => {
    let l = open.find((l) => Math.abs(l[l.length - 1][1] - y) < link);
    if (l) l.push([x, y, t]);
    else lines.push(l = [[x, y, t]]);
    return l;
  };
  let farOpen = [], nearOpen = [];
  for (let u = uMin + du / 2; u < uMax; u += du) {
    const sx = u * COS30 * T;
    const farNow = [], nearNow = [];
    let horizon = Infinity, front = null, before = 'out';
    for (let t = tMax; t >= tMin - dt; t -= dt) {
      const [x, y] = at(u, t);
      const inside = t >= tMin && x >= x0 && x <= x1 && y >= y0 && y <= y1;
      const h = inside ? height(x, y) : 0;
      const fog = inside && h < level;
      const shows = fog && t / 2 - level * Z < horizon;
      if (shows && front == null) {
        front = t;
        if (before === 'ground') nearNow.push([sx, sy(t), t]);
      }
      if (!shows && front != null) {
        runs.push([u, t + dt, front]);
        if (inside && !fog) farNow.push([sx, sy(t + dt), t + dt]);
        front = null;
      }
      if (inside) horizon = Math.min(horizon, t / 2 - (fog ? level : h) * Z);
      before = !inside ? 'out' : fog ? 'fog' : 'ground';
    }
    farOpen = farNow.map((p) => chain(far, farOpen, p));
    nearOpen = nearNow.map((p) => chain(near, nearOpen, p));
  }
  return { runs, far, near, level, du };
}

export function mistSVG({ runs, far, near, level, du }, camera, seed = 1) {
  if (!runs.length) return '';
  const T = camera.tile, Z = camera.zScale, k = T / 32;
  const rnd = mulberry32(seed);
  const range = ([a, b]) => a + rnd() * (b - a);
  const P = (x, y) => `${r2(x)} ${r2(y)}`;
  // the paper: a strip down each column where it shows (a little wider,
  // so neighbours overlap and leave no seam)
  const w = du * COS30 * T * 0.62;
  let fill = '';
  for (const [u, tb, tf] of runs) {
    const x = u * COS30 * T, y0 = (tb / 2 - level * Z) * T, y1 = (tf / 2 - level * Z) * T + 0.5;
    fill += `M${P(x - w, y0)}H${r2(x + w)}V${r2(y1)}H${r2(x - w)}Z`;
  }
  // the far shore: lobes standing up off it, each filled with paper down
  // to the shore; a line inside along the longer stretches
  // (each line its own <path>, one stroke, so the pen can draw it in along
  // its length: mistIn)
  let lobeFill = '', lines = '';
  const stroke = (cls, d) => (d ? `<path class="${cls}" d="${d}"/>` : '');
  for (const line of far) {
    if (line.length < 3) continue;
    const step = line.length > 1 ? Math.abs(line[1][0] - line[0][0]) || 1 : 1;
    let lobeLine = `M${P(line[0][0], line[0][1])}`;
    let i = 0;
    while (i < line.length - 1) {
      const j = Math.min(line.length - 1, i + Math.max(2, Math.round((range(MIST.lobe) * k) / step)));
      const [ax, ay] = line[i], [bx, by] = line[j];
      const len = Math.hypot(bx - ax, by - ay);
      const turn = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI; // (the lobe stands off the shore however it runs)
      const arc = `A${r2(len / 2)} ${r2(len / range(MIST.lobeRise))} ${r2(turn)} 0 1 ${P(bx, by)}`;
      lobeFill += `M${P(ax, ay)}${arc}${line.slice(i, j).reverse().map(([x, y]) => `L${P(x, y)}`).join('')}Z`;
      lobeLine += arc;
      i = j;
    }
    lines += stroke('mist-line', lobeLine);
    if (line.length * step > MIST.innerFrom * k) {
      const from = Math.floor(line.length * (0.12 + rnd() * 0.15)), to = Math.ceil(line.length * (0.72 + rnd() * 0.15));
      for (let a = from; a < to - 1;) {
        const b = Math.min(to - 1, a + Math.max(3, Math.round((range([10, 28]) * k) / step)));
        lines += stroke('mist-inner', line.slice(a, b + 1).map(([x, y], m) => `${m ? 'L' : 'M'}${P(x, y + MIST.inner * k)}`).join(''));
        a = b + 1 + Math.floor(rnd() * 3);
      }
    }
  }
  // the near edge: a plain pen line, in a few long strokes
  for (const line of near) {
    if (line.length < 3) continue;
    const step = Math.abs(line[1][0] - line[0][0]) || 1;
    for (let a = 0; a < line.length - 1;) {
      const b = Math.min(line.length - 1, a + Math.max(3, Math.round((range([20, 60]) * k) / step)));
      lines += stroke('mist-line', line.slice(a, b + 1).map(([x, y], m) => `${m ? 'L' : 'M'}${P(x, y)}`).join(''));
      a = b + (rnd() < 0.3 ? 1 : 0);
    }
  }
  return `<path class="mist" d="${fill}"/><path class="mist" d="${lobeFill}"/>${lines}`;
}

export function mistHatch(h) {
  const hatch = { ...h, gap: MIST.gap };
  return { hatch, width: MIST.broad * hatchFrame(hatch).gap };
}

// An object's cover. `at`: its place (Renderer.placeOf: world `points`,
// `pad` round them, the `top` it was drawn up to); `base` the height it
// stands on (as the level), `height(x, y)` the ground's. Its front below
// the mist's top is the band between the near edges of its ground area at
// the top and on the ground (an object is drawn inside that area, so the
// band covers just what of it is under the mist) – only along where that
// ground is lower than the top: a garden may climb out of it.
export function coverSVG(camera, at, base, height, level, seed = 1) {
  if (base >= level && !at.points.some(([x, y]) => height(x, y) < level)) return '';
  if (base + (at.top ?? 0) <= level) return 'under';
  const T = camera.tile, Z = camera.zScale, k = T / 32;
  const pad = Math.max(at.pad ?? 0, 0.3);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of at.points) {
    const [rx, ry] = camera.rotated(x, y);
    minX = Math.min(minX, rx - pad); maxX = Math.max(maxX, rx + pad);
    minY = Math.min(minY, ry - pad); maxY = Math.max(maxY, ry + pad);
  }
  // along its near edges (left, nearest and right corners), a sample every
  // so often: [scene x, y at the top, y on the ground or null if above it]
  const corners = [[minX, maxY], [maxX, maxY], [maxX, minY]];
  const samples = [];
  for (let s = 0; s < 2; s++) {
    const [a, b] = [corners[s], corners[s + 1]];
    const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.12));
    for (let i = s ? 1 : 0; i <= n; i++) {
      const rx = a[0] + ((b[0] - a[0]) * i) / n, ry = a[1] + ((b[1] - a[1]) * i) / n;
      const [wx, wy] = camera.toWorld(rx, ry);
      const g = height(wx + camera.cx, wy + camera.cy);
      const t = rx + ry, sx = (rx - ry) * COS30 * T;
      samples.push([sx, (t / 2 - level * Z) * T, g < level ? (t / 2 - g * Z) * T : null]);
    }
  }
  const P = (x, y) => `${r2(x)} ${r2(y)}`;
  const rnd = mulberry32(seed);
  let fill = '', line = '';
  // each stretch under the mist: lumps along its top, the paper down to the ground
  for (let i = 0; i < samples.length;) {
    if (samples[i][2] == null) { i++; continue; }
    let j = i;
    while (j + 1 < samples.length && samples[j + 1][2] != null) j++;
    const run = samples.slice(i, j + 1);
    let lumps = `M${P(run[0][0], run[0][1])}`;
    for (let a = 0; a < run.length - 1;) {
      let b = a + 1, len = 0;
      const want = (MIST.lump[0] + rnd() * (MIST.lump[1] - MIST.lump[0])) * k;
      while (b < run.length - 1 && (len = Math.hypot(run[b][0] - run[a][0], run[b][1] - run[a][1])) < want) b++;
      len = Math.hypot(run[b][0] - run[a][0], run[b][1] - run[a][1]);
      const turn = (Math.atan2(run[b][1] - run[a][1], run[b][0] - run[a][0]) * 180) / Math.PI;
      lumps += `A${r2(len / 2)} ${r2(len / (MIST.lumpRise[0] + rnd() * (MIST.lumpRise[1] - MIST.lumpRise[0])))} ${r2(turn)} 0 1 ${P(run[b][0], run[b][1])}`;
      a = b;
    }
    fill += `${lumps}${run.slice().reverse().map(([x, , y]) => `L${P(x, y)}`).join('')}Z`;
    line += `<path class="mist-line" d="${lumps}"/>`;
    i = j + 1;
  }
  return fill ? `<path class="mist" d="${fill}"/>${line}` : '';
}

// A step of the mist coming and going (the renderer calls these as it
// rises and sinks), slowly, over MIST.fade ms: the paper settles in
// and the pen draws its lines one by one, each along its length, the
// strokes overlapping as a hand would; going, the lines are taken back
// the same way and the paper thins away – so for a while the drawing
// below shows through. `g`: a group of mistSVG / coverSVG's output; `owner`
// the group drawn as one (gl/objects.js: the mist's own, or the object a
// cover is part of), whose pen's plan (draw.js) times its elements.
export function mistIn(g, { fade = MIST.fade, seed = 1, owner = g } = {}) {
  plan(g, owner, fade, false, seed);
}

// …and away; `g` is removed once it is gone.
export function mistOut(g, { fade = MIST.fade, seed = 1, owner = g } = {}) {
  g.classList.add('leaving');
  plan(g, owner, fade, true, seed);
  setTimeout(() => g.remove(), fade + 50);
}

function plan(g, owner, T, out, seed) {
  // (one plan an owner: a cover coming as the last goes shares it; an
  // object being drawn by the pen just gets its cover, or loses it)
  const now = performance.now();
  let pen = owner.pen;
  if (pen && !pen.mist) {
    if (out) g.remove();
    return;
  }
  if (!pen || now - pen.origin >= pen.T) pen = owner.pen = { origin: now, T: 0, reverse: false, mist: true, items: new Map() };
  const at = now - pen.origin;
  // (its elements hidden until the group is gone, a while after it)
  pen.T = Math.max(pen.T, at + T + 1000);
  const rnd = mulberry32(seed);
  // `out`: from all there to none (an end before its start)
  const put = (el, a, b, len, stroke) => pen.items.set(el, {
    t0: at + (out ? T - a : a), t1: at + (out ? T - b : b), f0: at + (out ? T - a : a), f1: at + (out ? T - b : b), px: len, stroke, fill: !stroke,
  });
  for (const el of g.querySelectorAll('path')) {
    if (el.classList.contains('mist')) {
      put(el, 0, T * 0.85, 0, false);
      continue;
    }
    const len = penLength.of?.(el) ?? 0;
    if (!(len > 0)) continue;
    // each stroke in its own part of the time, the longer the longer
    const d = Math.min(T * 0.6, T * 0.15 + len * 12);
    const a = rnd() * (T - d);
    put(el, a, a + d, len, true);
  }
  for (const f of penWatch) f([owner]);
}
