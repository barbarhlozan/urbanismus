// People close up: little pen figures drawn freehand – a coat (or a skirt,
// a short jacket over trousers) as a lumpy rounded shape, a head as a rough
// round, open or inked in, legs as two strokes of their own lengths, and
// some carry an inked-in bag; in the rain an umbrella over the head
// (umbrella()), open or inked in. Each body is a build (BUILDS): tall and
// thin, stout, a long coat to the calves, a wide skirt, stooped, a short
// jacket with long legs, a child – what they wear decides how much leg
// shows. They face the viewer like the map's other glyphs; the renderer
// mirrors them to face the way they walk. A cyclist is the same figure sat
// upright on an old village bike (a Ukrajina: a man's diamond frame with a
// carrier, or a woman's step-through), legs down to the pedals, an arm out
// to the swept-back bars; the bike is set along the way it rides, its
// wheels upright discs that narrow to a line seen end on. In a canoe
// (canoeSVG), one or two of them seated, paddling. At a fire
// (src/sim/fire.js) they carry a bucket, throw it, or hold the hose
// (carried()), always out on their right: the renderer mirrors them to
// face the fire.
//
// Drawn in scene px around the figure's ground point. PEOPLE.bodies
// variants per kind, picked by the agent's id; the cyclists' bikes come in
// VEHICLES.headings directions. Everything is cached.

import { mulberry32 } from '../core/random.js';
import { VEHICLES, headingIndex } from './vehicles.js';

export const PEOPLE = {
  bodies: 24,    // body shapes to pick from (BUILD_ORDER round twice, each its own hand)
  height: 2.5,   // a walker's height to the top of the head, scene px
  legs: 0.22,    // share of the height that is legs, for a plain build
  wobble: 0.02,  // how far each point of an outline strays, a share of the height
  lumpy: 0.18,   // how far a head strays from round
  wheel: 0.07,   // grid units between a bike's wheel centres
  // A walker bobs as it goes: squashed towards its feet a little every step.
  stride: 0.02,  // grid units walked per step (one dip)
  bob: 0.2,     // how much shorter at the bottom of a step
  bobZoom: 2,    // only this close or closer
};

// The builds: height (× PEOPLE.height), half width at the shoulders and
// the hem (× that) as shares of the height, legs (× PEOPLE.legs), how
// round the shoulders, a belly, a stoop.
const BUILDS = {
  thin:    { h: 1.08, w: 0.13, hem: 1,    legs: 1.25, up: 0.5 },
  stout:   { h: 0.9,  w: 0.27, hem: 0.95, legs: 0.8,  up: 0.9, belly: 0.06 },
  coat:    { h: 1,    w: 0.19, hem: 1.15, legs: 0.6,  up: 0.5 },  // a long coat to the calves
  skirt:   { h: 0.95, w: 0.16, hem: 1.6,  legs: 1,    up: 0.5 },
  stooped: { h: 0.92, w: 0.2,  hem: 1,    legs: 0.85, up: 1, lean: 0.09, stoop: 0.05 },
  jacket:  { h: 1,    w: 0.19, hem: 0.9,  legs: 1.6,  up: 0.5 },  // a short jacket, trousers
  plain:   { h: 1,    w: 0.19, hem: 1,    legs: 1,    up: 0.5 },
  child:   { h: 0.62, w: 0.2,  hem: 1,    legs: 1.1,  up: 0.4, head: 1.35 },
};
const BUILD_ORDER = ['thin', 'stout', 'coat', 'skirt', 'stooped', 'plain', 'jacket', 'skirt', 'coat', 'thin', 'stout', 'child'];
const buildOf = (variant) => BUILD_ORDER[variant % BUILD_ORDER.length];

const r2 = (n) => Math.round(n * 100) / 100;
const COS30 = Math.cos(Math.PI / 6);
const P = ([x, y]) => `${r2(x)} ${r2(y)}`;

// A smooth curve through points (Catmull-Rom as cubic Béziers), closed or open.
function smooth(pts, closed) {
  const n = pts.length;
  const at = (i) => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
  let d = `M${P(pts[0])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    d += `C${P([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6])} ${P([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6])} ${P(p2)}`;
  }
  return closed ? `${d}Z` : d;
}

// A rough round of `n` points about (cx, cy), each off by up to `lump`.
function lumpyRound(rnd, cx, cy, rx, ry, lump, n) {
  const a0 = rnd() * Math.PI * 2, pts = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5, k = 1 + (rnd() * 2 - 1) * lump;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return smooth(pts, true);
}

// Which body an agent gets (by its id).
export function bodyFor(id) {
  let h = 0x811c9dc5;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return (h >>> 5) % PEOPLE.bodies;
}

// A figure standing on (ox, bottom), about `height` tall to the top of its
// head (its build makes it taller or shorter), as [class, d] parts – with
// `.shoulder` (the front of its shoulders: [x, y, half width]) and
// `.shoulders` ([left, right] points, for an arm). Seeded by `variant`.
// `seated`: no legs, nothing carried.
function figure(variant, height, bottom = 0, seated = false, ox = 0) {
  const rnd = mulberry32(variant * 2654435761 + 23);
  const range = (a, b) => a + rnd() * (b - a);
  const name = buildOf(variant), b = BUILDS[name];
  const h = height * b.h;
  const jit = () => h * PEOPLE.wobble * range(-1, 1); // a hand's wobble
  const at = ([x, y]) => [x + ox, y + bottom];
  const parts = [];

  const leg = seated ? 0 : h * PEOPLE.legs * b.legs * range(0.9, 1.1);
  const base = -leg;                                     // the coat's hem
  const w = h * b.w * range(0.9, 1.1) * (seated ? 0.85 : 1); // half the shoulders' width
  const foot = w * b.hem * range(0.88, 1.12);            // half the hem's
  const lean = h * (b.lean ?? range(-0.04, 0.04));       // the top a touch off the base
  const r = h * range(0.095, 0.12) * (b.head ?? 1);
  const top = -h + h * (b.stoop ?? 0), hx = lean + h * (b.stoop ?? 0);
  const sh = top + 2 * r + h * (b.stoop ? -0.02 : range(0.01, 0.04)); // the shoulders' line

  // the coat, round from the left shoulder: rounded shoulders, sides a
  // little out (a belly), the hem
  const wl = w * range(0.82, 1.05), wr = w * range(0.82, 1.05), up = h * 0.06 * b.up;
  const mid = (sh + base) / 2, belly = h * (b.belly ?? 0);
  const coat = [
    [lean - wl + jit(), sh + up * range(0.5, 1) + jit()], [lean - wl * 0.45 + jit(), sh - up * 0.2 + jit()],
    [lean + wr * 0.45 + jit(), sh - up * 0.2 + jit()], [lean + wr + jit(), sh + up * range(0.5, 1) + jit()],
    [(lean + wr + foot) / 2 + belly + jit(), mid + jit()], [foot + jit(), base + jit() * 0.5], [jit(), base + jit() * 0.4],
    [-foot * range(0.92, 1.08) + jit(), base + jit() * 0.5], [(lean - wl - foot) / 2 - belly + jit(), mid + jit()],
  ];
  parts.push(['fig-body', smooth(coat.map(at), true)]);
  // the head, open or inked in
  const [cx, cy] = at([hx, top + r]);
  parts.push([rnd() < 0.5 ? 'fig-ink' : 'fig-body', lumpyRound(rnd, cx, cy, r * 0.95, r * 1.05, PEOPLE.lumpy, 7)]);

  if (!seated) {
    // two legs, a little bowed and splayed, not the same: closer under a
    // skirt or a coat, apart in trousers
    const gap = Math.min(foot, w) * (name === 'jacket' ? 0.55 : 0.4);
    let d = '';
    for (const s of [-1, 1]) {
      const x0 = s * gap * range(0.7, 1.3), x1 = x0 + s * leg * range(0, 0.18);
      d += smooth([[x0, base - h * 0.01], [(x0 + x1) / 2 + jit() * 0.6, base / 2], [x1, h * range(-0.02, 0.01)]].map(at), false);
    }
    parts.push(['fig-line', d]);
    // some carry a bag at one side
    if (name !== 'child' && rnd() < 0.3) {
      const side = rnd() < 0.5 ? -1 : 1;
      const [bx, by] = at([side * (foot + h * 0.05), base - h * 0.14]);
      parts.push(['fig-ink', lumpyRound(rnd, bx, by, h * 0.055, h * 0.075, 0.2, 5)]);
    }
  }
  parts.shoulder = [ox + lean, bottom + sh + (base - sh) * 0.15, w];
  parts.shoulders = [at([lean - wl, sh + up]), at([lean + wr, sh + up])];
  return parts;
}

// An umbrella held up over a figure's head, to one side: a dome with a
// scalloped rim, on a handle that comes down to the hand at the body's side.
function umbrella(variant, height, parts) {
  const rnd = mulberry32(variant * 2246822519 + 5);
  const [sx, sy, w] = parts.shoulder;
  const side = rnd() < 0.5 ? -1 : 1;
  const cx = sx + side * w * 1.05, hand = sy + height * 0.12;
  const uw = height * (0.34 + rnd() * 0.06), rim = -height * (1.14 + rnd() * 0.05), rise = height * 0.2;
  const pt = (x, y) => `${r2(x)} ${r2(y)}`;
  let d = `M${pt(cx - uw, rim)}A${r2(uw)} ${r2(rise)} 0 0 1 ${pt(cx + uw, rim)}`;
  for (let i = 2; i >= 0; i--) { // three scallops back along the rim
    const x0 = cx - uw + (2 * uw * (i + 1)) / 3, x1 = cx - uw + (2 * uw * i) / 3;
    d += `Q${pt((x0 + x1) / 2, rim - rise * 0.3)} ${pt(x1, rim)}`;
  }
  parts.push(['fig-line', `M${pt(cx, rim - rise)}L${pt(cx, hand)}`]);
  parts.push([rnd() < 0.5 ? 'fig-ink' : 'fig-body', `${d}Z`]);
}

// What a figure at a fire holds, out on its right (+x): 'bucket' hanging
// from the hand, 'throw' swung up in front with the water flying out of
// it, 'hose' the branch pipe held level in both hands and its jet arcing
// out and down.
function carried(variant, height, parts, what) {
  const rnd = mulberry32(variant * 3266489917 + 7);
  const [sx, sy, w] = parts.shoulder;
  const pt = (x, y) => `${r2(x)} ${r2(y)}`;
  const bw = height * 0.09, bh = height * 0.12; // the bucket: a little tub, wider at the top
  const tub = (x, y, tilt) => {
    const c = Math.cos(tilt), s = Math.sin(tilt);
    const at = (u, v) => pt(x + u * c - v * s, y + u * s + v * c);
    return `M${at(-bw, 0)}L${at(bw, 0)}L${at(bw * 0.75, bh)}L${at(-bw * 0.75, bh)}Z`;
  };
  if (what === 'bucket') {
    const hx = sx + w * 1.15, hy = sy + height * 0.22;
    parts.push(['fig-line', `M${pt(sx + w * 0.9, sy)}L${pt(hx, hy)}`]); // the arm down
    parts.push(['fig-body', tub(hx, hy + height * 0.02, 0)]);
    parts.push(['fig-line', `M${pt(hx - bw, hy + height * 0.02)}Q${pt(hx, hy - height * 0.06)} ${pt(hx + bw, hy + height * 0.02)}`]); // the handle
  } else if (what === 'throw') {
    const hx = sx + w + height * 0.16, hy = sy - height * 0.04;
    parts.push(['fig-line', `M${pt(sx + w * 0.8, sy)}L${pt(hx, hy)}M${pt(sx + w * 0.6, sy + height * 0.06)}L${pt(hx - bw * 0.3, hy + bh * 0.8)}`]);
    parts.push(['fig-body', tub(hx + bw * 0.4, hy - bh * 0.3, -1.1)]);
    // the water, out of its mouth and falling away
    const mx = hx + bw * 1.3, my = hy - bh * 0.9, k = 0.8 + rnd() * 0.4;
    parts.push(['fig-line', `M${pt(mx, my)}Q${pt(mx + height * 0.25 * k, my - height * 0.12)} ${pt(mx + height * 0.42 * k, my + height * 0.2)}`
      + `M${pt(mx + height * 0.08, my + height * 0.05)}Q${pt(mx + height * 0.24 * k, my - height * 0.02)} ${pt(mx + height * 0.33 * k, my + height * 0.25)}`]);
  } else if (what === 'hose') {
    const hy = sy + height * 0.08, nx = sx + w + height * 0.28;
    parts.push(['fig-line', `M${pt(sx + w * 0.8, sy + height * 0.02)}L${pt(nx - height * 0.08, hy)}M${pt(sx + w * 0.4, sy + height * 0.12)}L${pt(nx - height * 0.16, hy + height * 0.02)}`]);
    parts.push(['fig-ink', `M${pt(sx + w * 0.6, hy - height * 0.025)}L${pt(nx, hy - height * 0.012)}L${pt(nx, hy + height * 0.012)}L${pt(sx + w * 0.6, hy + height * 0.03)}Z`]); // the branch pipe
    // the hose itself, down in front to the ground and away behind the feet
    parts.push(['fig-line', `M${pt(sx + w * 0.6, hy + height * 0.02)}Q${pt(sx + w * 1.5, hy + height * 0.3)} ${pt(sx + w * 0.6, -height * 0.01)}L${pt(sx - w * 2.6, height * 0.01)}`]);
    // the jet: up a little, out and falling, breaking up at its end
    const k = 0.9 + rnd() * 0.3, ex = nx + height * 0.85 * k, ey = hy + height * 0.3;
    parts.push(['fig-line', `M${pt(nx, hy)}Q${pt(nx + height * 0.45 * k, hy - height * 0.32)} ${pt(ex, ey)}`
      + `M${pt(ex + height * 0.05, ey + height * 0.06)}L${pt(ex + height * 0.08, ey + height * 0.13)}M${pt(ex - height * 0.06, ey + height * 0.08)}L${pt(ex - height * 0.05, ey + height * 0.14)}`]);
  }
}

const svgOf = (parts) => parts.map(([cls, d]) => `<path class="${cls}" d="${d}"/>`).join('');

const cache = new Map();

// Inner SVG of a walker (body variant `variant`).
// `rain`: under an umbrella; `carry`: what it holds at a fire (carried()).
export function walkerSVG(variant, rain = false, carry = null) {
  const key = `w${variant}${rain ? 'u' : ''}${carry ?? ''}`;
  if (!cache.has(key)) {
    const parts = figure(variant, PEOPLE.height);
    if (carry) carried(variant, PEOPLE.height, parts, carry);
    else if (rain) umbrella(variant, PEOPLE.height, parts);
    cache.set(key, svgOf(parts));
  }
  return cache.get(key);
}

// Inner SVG of a cyclist riding towards `heading` (a VEHICLES.headings
// index) for `camera`: an old upright bike after the pen sketch – two
// wheels, upright discs along the way (round seen side on, a line seen end
// on), mudguards over them, the frame (a man's diamond, or a woman's
// step-through for a skirt or a coat), a carrier at the back, bars swept
// back – and the figure sat upright on the saddle, its legs down to the
// pedals (each rider's pedals somewhere else round), an arm to the bars.
// Every line a hair off true, as the figures.
export function cyclistSVG(camera, heading, variant) {
  // (by the heading on screen: on the ground plus the view's turn)
  const seen = headingIndex((heading / VEHICLES.headings) * Math.PI * 2 + camera.angle);
  const key = `c${variant}|${seen}|${camera.tile}`;
  if (cache.has(key)) return cache.get(key);
  const rnd = mulberry32(variant * 911 + seen * 7 + 3);
  const range = (a, b) => a + rnd() * (b - a);
  const H = PEOPLE.height, jit = (s = 1) => H * 0.012 * s * range(-1, 1);
  const a = (seen / VEHICLES.headings) * Math.PI * 2, half = PEOPLE.wheel / 2;
  const [rx, ry] = [Math.cos(a) * half, Math.sin(a) * half];
  const [dx, dy] = [(rx - ry) * COS30 * camera.tile, (rx + ry) * 0.5 * camera.tile];
  const wr = H * 0.19;
  // a wheel's round in its own plane: `ex, ey` along the bike (at full
  // length side on, nothing end on), up the screen across it
  const side = half * COS30 * camera.tile * Math.SQRT2;
  const [ex, ey] = [dx / side, dy / side];
  // a point `t` of the way from the middle to the front hub (-1 the back
  // one), `h` above the ground
  const at = (t, h) => [t * dx, t * dy - h];
  // a frame line through points, each a hair off, bowed a little between
  const line = (...pts) => {
    const q = pts.map(([t, h]) => { const [x, y] = at(t, h); return [x + jit(), y + jit()]; });
    const all = [];
    q.forEach((p, i) => { if (i) all.push([(q[i - 1][0] + p[0]) / 2 + jit(0.7), (q[i - 1][1] + p[1]) / 2 + jit(0.7)]); all.push(p); });
    return smooth(all, false);
  };
  // part of a wheel's round about (cx, cy), radius r, angles up from the front
  const round = ([cx, cy], r, from = 0, to = Math.PI * 2, n = 8) => {
    const closed = to - from >= Math.PI * 2 - 1e-6, a0 = closed ? rnd() * Math.PI * 2 : 0, pts = [];
    for (let i = 0; i < (closed ? n : n + 1); i++) {
      const t = a0 + from + ((to - from) * i) / n, k = r * (1 + range(-0.05, 0.05));
      pts.push([cx + Math.cos(t) * k * ex, cy + Math.cos(t) * k * ey - Math.sin(t) * k]);
    }
    return smooth(pts, closed);
  };
  const name = buildOf(variant), woman = name === 'skirt' || name === 'coat';
  const back = [-1, wr], front = [1, wr], crank = [-0.12, wr * 0.9];
  const seat = [-0.42, wr * 2.45], head = [0.6, wr * 2.45], low = [0.66, wr * 2];
  const saddle = [-0.42, wr * 2.75], bars = [0.36, wr * 3.35];
  const B = at(...back), F = at(...front);
  const parts = [['fig-wheel', round(B, wr) + round(F, wr) + round(B, wr * 1.18, 0.12 * Math.PI, 0.88 * Math.PI, 5) + round(F, wr * 1.18, 0.12 * Math.PI, 0.88 * Math.PI, 5)]];
  let frame = line(back, crank, seat, back) + line(low, front) + line(seat, saddle);
  frame += woman ? line(head, [0.15, wr * 1.2], crank) + line(head, low) : line(seat, head, low, crank);
  frame += line(head, [0.58, wr * 3.2], [0.5, wr * 3.38], bars);  // the stem, the bars swept back
  frame += line(seat, [-0.95, wr * 2.25], [-1.1, wr * 2.2]);      // the carrier
  parts.push(['fig-line', frame]);
  const [sx, sy] = at(...saddle), fwd = Math.sign(dx) || 1;
  parts.push(['fig-ink', smooth([[sx - fwd * 0.35, sy - 0.02], [sx + fwd * 0.12, sy - 0.07], [sx + fwd * 0.22, sy + 0.04], [sx - fwd * 0.3, sy + 0.08]], true)]);
  // the rider, sat a touch forward
  const ox = sx + fwd * 0.05, oy = sy - 0.05;
  const f = figure(variant, H * (name === 'child' ? 0.75 : 0.62), oy, true, ox);
  // legs from the hip down to the pedals (round the crank in the wheels'
  // plane), the knee bent forward: the far one under the body
  const [cx, cy] = at(...crank), pr = wr * 0.42, phase = range(0, Math.PI * 2);
  const leg = (ang) => {
    const pedal = [cx + Math.cos(ang) * pr * ex, cy + Math.cos(ang) * pr * ey - Math.sin(ang) * pr * 0.6];
    const hip = [ox + fwd * 0.05, oy - 0.05];
    const len = Math.hypot(pedal[0] - hip[0], pedal[1] - hip[1]), bend = Math.max(0, H * 0.42 - len) * 0.9 + H * 0.04;
    const knee = [(hip[0] + pedal[0]) / 2 + ex * bend + jit(0.5), (hip[1] + pedal[1]) / 2 + ey * bend - bend * 0.4];
    return smooth([hip, knee, pedal], false);
  };
  parts.push(['fig-line', leg(phase + Math.PI)], ...f, ['fig-line', leg(phase)]);
  // the arm, from the shoulder on the bars' side
  const [bx, by] = at(...bars);
  const [shx, shy] = f.shoulders[bx < ox ? 0 : 1];
  parts.push(['fig-line', smooth([[shx, shy + 0.18], [(shx + bx) / 2 + jit(), (shy + 0.18 + by) / 2 + 0.12], [bx, by]], false)]);
  if (woman && rnd() < 0.6) { // a bag hung on the bars
    parts.push(['fig-ink', smooth([[bx - 0.1, by + 0.05], [bx + 0.12, by + 0.04], [bx + 0.14, by + 0.36], [bx - 0.12, by + 0.38]].map(([x, y]) => [x + jit(0.5), y + jit(0.5)]), true)]);
  }
  const svg = svgOf(parts);
  cache.set(key, svg);
  return svg;
}

// A canoe as the figures' pen draws it, heading along `angle` (snapped to
// VEHICLES.headings) for `camera`: a long boat pointed and raised at both
// ends – its hull down to the water, the gunwale round the top – with the
// crew sat in it (`crew`: body variants, the back one first; one alone sits
// at the back), each with a paddle across, its blade in the water on one
// side (`stroke` 0 / 1: which; two paddle on opposite sides).
export const CANOE = { length: 0.15, beam: 0.042, rim: 0.27, rise: 0.22, crew: 0.72 };

export function canoeSVG(camera, heading, crew, stroke) {
  // (by the heading on screen: on the ground plus the view's turn)
  const seen = headingIndex((heading / VEHICLES.headings) * Math.PI * 2 + camera.angle);
  const key = `k${seen}|${crew.join(',')}|${stroke}|${camera.tile}`;
  if (cache.has(key)) return cache.get(key);
  const a = (seen / VEHICLES.headings) * Math.PI * 2;
  const screen = (rx, ry) => [(rx - ry) * COS30 * camera.tile, (rx + ry) * 0.5 * camera.tile];
  const A = screen(Math.cos(a) * CANOE.length / 2, Math.sin(a) * CANOE.length / 2); // middle to the bow
  const N = screen(-Math.sin(a) * CANOE.beam / 2, Math.cos(a) * CANOE.beam / 2);   // middle to one side
  const H = PEOPLE.height; // heights in scene px, from the figures
  // t along (-1 stern, 1 bow), u across (-1, 1), h up
  const at = (t, u, h) => [t * A[0] + u * N[0], t * A[1] + u * N[1] - h];
  const rim = (t) => H * (CANOE.rim + CANOE.rise * t ** 4); // the gunwale, swept up at the ends
  const width = (t) => Math.sqrt(Math.max(0, 1 - t * t)) * (1 - 0.15 * t * t);
  const ts = Array.from({ length: 17 }, (_, i) => -1 + i / 8);
  const P = ([x, y]) => `${r2(x)} ${r2(y)}`;
  const poly = (pts, close = true) => `M${pts.map(P).join('L')}${close ? 'Z' : ''}`;
  // the nearer side: the one drawn lower on screen
  const near = N[1] >= 0 ? 1 : -1;
  const gunwale = (u) => ts.map((t) => at(t, u * width(t), rim(t)));
  const water = (u) => ts.map((t) => at(t * 0.92, u * width(t) * 0.8, 0));

  const parts = [];
  // the hull: everything from the waterline up to the gunwale, as one shape
  parts.push(['fig-body', poly(hull([...gunwale(1), ...gunwale(-1), ...water(1), ...water(-1)]))]);
  parts.push(['fig-line', poly([...gunwale(-near), ...gunwale(near).reverse()])]);

  // the crew, the one further back on screen first, and their paddles
  const seats = crew.length > 1 ? [-0.5, 0.45] : [-0.48];
  const sitters = crew.map((variant, i) => {
    const t = seats[i], [x, y] = at(t, 0, rim(t) * 0.6);
    const side = (i + stroke) % 2 ? 1 : -1;
    return { variant, t, x, y, side };
  }).sort((p, q) => p.y - q.y);
  const paddles = [];
  for (const { variant, t, x, y, side } of sitters) {
    const f = figure(variant, H * CANOE.crew, y, true, x);
    parts.push(...f);
    // the paddle: from above the far shoulder down across the body to the
    // water out on its side, a blade at the end
    const [shx, shy, shw] = f.shoulder;
    const blade = at(t + 0.12, side * 1.6, 0);
    const top = [shx - Math.sign(blade[0] - shx || 1) * shw * 1.2, shy - H * 0.22];
    const dx = blade[0] - top[0], dy = blade[1] - top[1], l = Math.hypot(dx, dy) || 1;
    const bw = H * 0.07, bl = H * 0.22, ux = dx / l, uy = dy / l;
    const b0 = [blade[0] - ux * bl, blade[1] - uy * bl];
    const paddle = [
      ['fig-line', `M${P(top)}L${P(b0)}`],
      ['fig-ink', poly([[b0[0] - uy * bw, b0[1] + ux * bw], [blade[0] - uy * bw, blade[1] + ux * bw], [blade[0] + uy * bw, blade[1] - ux * bw], [b0[0] + uy * bw, b0[1] - ux * bw]])],
    ];
    // a blade on the far side goes behind the near side of the hull
    if (side === near) paddles.push(...paddle);
    else parts.push(...paddle);
  }
  // the near side of the hull over their legs: from its gunwale down to the water
  parts.push(['fig-body', poly([...gunwale(near), ...water(near).reverse()])]);
  parts.push(...paddles);
  const svg = svgOf(parts);
  cache.set(key, svg);
  return svg;
}

// Far out: the canoe's outline from above, inked in.
export function canoeMarkSVG(camera, heading) {
  return canoeSVG(camera, heading, [], 0).match(/<path class="fig-body" d="[^"]*"\/>/)[0].replace('fig-body', 'fig-ink');
}

// The convex hull of points (the hull's outline seen from anywhere).
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half(p.reverse())];
}
