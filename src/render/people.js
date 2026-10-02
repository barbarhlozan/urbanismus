// People close up: little blocky pen figures after the figure sheet – a
// box of a body on two stub legs, topped by something round: a round head
// (open or inked in), or a knob on a smaller box, or a bobble on a pointed
// hood; maybe a line across the coat, and some carry an inked-in bag. They
// face the viewer like the map's other glyphs; the renderer mirrors them to
// face the way they walk. A cyclist is the same kind of figure, shorter,
// seated and empty-handed, on a sketched bike set along the way it rides.
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
  stride: 0.05,  // grid units walked per step (one dip)
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

const svgOf = (parts) => parts.map(([cls, d]) => `<path class="${cls}" d="${d}"/>`).join('');

const cache = new Map();

// Inner SVG of a walker (body variant `variant`).
export function walkerSVG(variant) {
  const key = `w${variant}`;
  if (!cache.has(key)) {
    cache.set(key, svgOf(figure(variant, PEOPLE.height)));
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
