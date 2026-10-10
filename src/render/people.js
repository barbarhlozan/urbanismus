// People close up: little blocky pen figures after the figure sheet – a
// box of a body on two stub legs, topped by something round: a round head
// (open or inked in), or a knob on a smaller box, or a bobble on a pointed
// hood; maybe a line across the coat, and some carry an inked-in bag; in
// the rain an umbrella over the head (umbrella()), open or inked in. They
// face the viewer like the map's other glyphs; the renderer mirrors them to
// face the way they walk. A cyclist is the same kind of figure, shorter,
// seated and empty-handed, on a sketched bike set along the way it rides;
// in a canoe (canoeSVG), one or two of them seated, paddling.
//
// Drawn in scene px around the figure's ground point. PEOPLE.bodies
// variants per kind, picked by the agent's id; the cyclists' wheels come in
// VEHICLES.headings directions. Everything is cached.

import { rotateQuarter } from '../core/grid.js';
import { mulberry32 } from '../core/random.js';
import { VEHICLES } from './vehicles.js';

export const PEOPLE = {
  bodies: 12,    // body shapes to pick from
  height: 2.5,   // a walker's height to the top of the head, scene px
  wheel: 0.065,  // grid units between a bike's wheel centres
  // A walker bobs as it goes: squashed towards its feet a little every step.
  stride: 0.02,  // grid units walked per step (one dip)
  bob: 0.2,     // how much shorter at the bottom of a step
  bobZoom: 2,    // only this close or closer
};

const r2 = (n) => Math.round(n * 100) / 100;
const COS30 = Math.cos(Math.PI / 6);

// Which body an agent gets (by its id).
export function bodyFor(id) {
  let h = 0x811c9dc5;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return (h >>> 5) % PEOPLE.bodies;
}

// A figure standing on (ox, bottom), `height` tall to the top of its head,
// as [class, d] parts (and `.shoulder`, the front of its shoulders).
// Seeded by `variant`. `seated`: no legs, nothing carried.
function figure(variant, height, bottom = 0, seated = false, ox = 0) {
  const rnd = mulberry32(variant * 2654435761 + 11);
  const range = (a, b) => a + rnd() * (b - a);
  const jit = () => height * range(-0.015, 0.015); // a hand's wobble
  const pt = (x, y) => `${r2(x + ox)} ${r2(y)}`;
  const ball = (cx, cy, r) => `M${pt(cx - r, cy)}a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0`;
  const parts = [];

  const leg = seated ? 0 : height * range(0.1, 0.14);
  const base = bottom - leg;                     // the body's bottom edge
  const w = height * range(0.18, 0.23) * (seated ? 0.8 : 1); // half the body's width
  const foot = w * range(0.85, 1.05);            // a little narrower or wider at the hem
  const lean = height * range(-0.03, 0.03);      // the top a touch off the base
  const head = rnd(), top = bottom - height;
  const hood = head >= 0.4 && head < 0.65;

  // the body's top edge, and what sits on it – always something round on top
  let shoulders;
  if (head < 0.4) {                              // a box on the box, a knob on that
    const r = height * 0.075, crown = top + 2 * r;
    shoulders = crown + height * range(0.16, 0.2);
    const hw = w * range(0.7, 0.95);
    parts.push(['fig-body', `M${pt(lean - hw + jit(), crown)}L${pt(lean + hw + jit(), crown + jit())}L${pt(lean + hw, shoulders)}L${pt(lean - hw, shoulders)}Z`]);
    parts.push([rnd() < 0.6 ? 'fig-ink' : 'fig-head', ball(lean, top + r, r)]);
  } else if (hood) {                             // a pointed hood with a bobble
    const r = height * 0.06;
    shoulders = top + 2 * r + height * range(0.26, 0.32);
    parts.push(['fig-ink', ball(lean, top + r, r)]);
  } else {                                       // a round head, open or inked in
    const r = height * 0.12;
    shoulders = top + 2 * r + height * 0.02;
    parts.push([rnd() < 0.5 ? 'fig-ink' : 'fig-head', ball(lean, top + r, r)]);
  }

  // the body: a box, or the hood's peak over one
  const corners = [[lean + w + jit(), shoulders + jit()], [foot + jit(), base], [-foot + jit(), base], [lean - w + jit(), shoulders + jit()]];
  if (hood) corners.push([lean + jit(), top + height * 0.11]);
  parts.unshift(['fig-body', `M${corners.map(([x, y]) => pt(x, y)).join('L')}Z`]);

  // a line across: the hood's brim, or where a coat ends
  const across = hood ? shoulders : rnd() < 0.5 ? shoulders + (base - shoulders) * range(0.45, 0.6) : null;
  if (across !== null) {
    const t = (across - shoulders) / (base - shoulders); // how far down, for the box's width there
    const hw = w + (foot - w) * t, x0 = lean * (1 - t);
    parts.push(['fig-line', `M${pt(x0 - hw, across + jit())}L${pt(x0 + hw, across + jit())}`]);
  }

  if (!seated) {
    // two stub legs
    const lx = foot * range(0.35, 0.55);
    parts.push(['fig-line', `M${pt(-lx, base)}L${pt(-lx + jit(), bottom)}M${pt(lx, base)}L${pt(lx + jit(), bottom)}`]);
    // some carry a bag at one side
    if (rnd() < 0.3) {
      const side = rnd() < 0.5 ? -1 : 1;
      const x = side * (foot + height * 0.01), bw = side * height * range(0.1, 0.14);
      const y = shoulders + (base - shoulders) * 0.4 + height * 0.05, bh = height * range(0.14, 0.2);
      parts.push(['fig-ink', `M${pt(x, y)}L${pt(x + bw, y + jit())}L${pt(x + bw, y + bh)}L${pt(x, y + bh)}Z`]);
    }
  }
  parts.shoulder = [ox + lean, shoulders + (base - shoulders) * 0.15, w];
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

const svgOf = (parts) => parts.map(([cls, d]) => `<path class="${cls}" d="${d}"/>`).join('');

const cache = new Map();

// Inner SVG of a walker (body variant `variant`).
// `rain`: under an umbrella.
export function walkerSVG(variant, rain = false) {
  const key = `w${variant}${rain ? 'u' : ''}`;
  if (!cache.has(key)) {
    const parts = figure(variant, PEOPLE.height);
    if (rain) umbrella(variant, PEOPLE.height, parts);
    cache.set(key, svgOf(parts));
  }
  return cache.get(key);
}

// Inner SVG of a cyclist riding towards `heading` (a VEHICLES.headings
// index) for `camera`: a bike after the pen sketch – two wheel rings along
// the way, a diamond frame between them (chainstay, seat tube, top and down
// tube, fork), a saddle and curled bars – with the figure sat on the saddle,
// one arm out to the bars.
export function cyclistSVG(camera, heading, variant) {
  const key = `c${variant}|${heading}|${camera.rotation}|${camera.tile}`;
  if (!cache.has(key)) {
    const a = (heading / VEHICLES.headings) * Math.PI * 2;
    const half = PEOPLE.wheel / 2;
    const [rx, ry] = rotateQuarter(Math.cos(a) * half, Math.sin(a) * half, camera.rotation);
    const [dx, dy] = [(rx - ry) * COS30 * camera.tile, (rx + ry) * 0.5 * camera.tile];
    const wr = PEOPLE.height * 0.17;
    // a point `t` of the way from the middle to the front hub (-1 the back
    // one), `h` above the ground
    const at = (t, h) => [t * dx, t * dy - h];
    const P = ([x, y]) => `${r2(x)} ${r2(y)}`;
    const line = (...pts) => `M${pts.map((p) => P(at(...p))).join('L')}`;
    const ring = ([cx, cy]) => `M${r2(cx - wr)} ${r2(cy)}a${r2(wr)} ${r2(wr)} 0 1 0 ${r2(2 * wr)} 0a${r2(wr)} ${r2(wr)} 0 1 0 ${r2(-2 * wr)} 0`;
    const back = [-1, wr], front = [1, wr];
    const crank = [-0.15, wr * 0.9], seat = [-0.4, wr * 2.5], head = [0.62, wr * 2.5], low = [0.7, wr * 2];
    const saddle = [-0.45, wr * 2.9], bars = [0.58, wr * 3.1];
    const frame = line(back, crank, seat, back) + line(seat, head, low, crank) + line(low, front)
      + line(seat, saddle) + line(head, bars, [0.8, wr * 3.1], [0.8, wr * 2.75]);
    const seatBar = `${line([-0.62, wr * 2.85], [-0.3, wr * 2.85], [-0.3, wr * 3.1], [-0.62, wr * 3])}Z`; // an inked saddle
    const [sx, sy] = at(...saddle);
    const f = figure(variant, PEOPLE.height * 0.65, sy, true, sx);
    const [bx, by] = at(...bars);
    const [hx, hy, hw] = f.shoulder, side = Math.sign(bx - hx); // from the side facing the bars
    const arm = Math.abs(bx - hx) > hw ? `M${r2(hx + side * hw)} ${r2(hy)}L${r2(bx)} ${r2(by)}` : '';
    cache.set(key, `<path class="fig-wheel" d="${ring(at(...back)) + ring(at(...front)) + frame}"/><path class="fig-ink" d="${seatBar}"/>${svgOf(f)}${arm && `<path class="fig-line" d="${arm}"/>`}`);
  }
  return cache.get(key);
}

// A canoe as the figures' pen draws it, heading along `angle` (snapped to
// VEHICLES.headings) for `camera`: a long boat pointed and raised at both
// ends – its hull down to the water, the gunwale round the top – with the
// crew sat in it (`crew`: body variants, the back one first; one alone sits
// at the back), each with a paddle across, its blade in the water on one
// side (`stroke` 0 / 1: which; two paddle on opposite sides).
export const CANOE = { length: 0.15, beam: 0.042, rim: 0.27, rise: 0.22, crew: 0.72 };

export function canoeSVG(camera, heading, crew, stroke) {
  const key = `k${heading}|${crew.join(',')}|${stroke}|${camera.rotation}|${camera.tile}`;
  if (cache.has(key)) return cache.get(key);
  const a = (heading / VEHICLES.headings) * Math.PI * 2;
  const screen = (wx, wy) => {
    const [rx, ry] = rotateQuarter(wx, wy, camera.rotation);
    return [(rx - ry) * COS30 * camera.tile, (rx + ry) * 0.5 * camera.tile];
  };
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
