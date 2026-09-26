// People close up: little pen figures after the figure sheet – an open
// circle for a head over an angular, legless body tapering to a point
// (wide at the shoulders, one elbow sticking out). They face the viewer
// like the map's other glyphs; the renderer mirrors them to face the way
// they walk. A cyclist is the same kind of figure, shorter and seated,
// over two wheel rings set along the way it rides.
//
// Drawn in scene px around the figure's ground point. PEOPLE.bodies
// variants per kind, picked by the agent's id; the cyclists' wheels come in
// VEHICLES.headings directions. Everything is cached.

import { rotateQuarter } from '../core/grid.js';
import { mulberry32 } from '../core/random.js';
import { VEHICLES } from './vehicles.js';

export const PEOPLE = {
  bodies: 8,     // body shapes to pick from
  height: 2.5,   // a walker's height to the top of the head, scene px
  wheel: 0.05,   // grid units between a bike's wheel centres
};

const r2 = (n) => Math.round(n * 100) / 100;
const COS30 = Math.cos(Math.PI / 6);

// Which body an agent gets (by its id).
export function bodyFor(id) {
  let h = 0x811c9dc5;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return (h >>> 5) % PEOPLE.bodies;
}

// Body outline and head, standing on (0, bottom), `height` tall to the top
// of the head. Seeded by `variant`.
function figure(variant, height, bottom = 0) {
  const rnd = mulberry32(variant * 2654435761 + 11);
  const range = (a, b) => a + rnd() * (b - a);
  const head = height * 0.13, neck = height * 0.06;
  const top = bottom - height + head * 2 + neck; // shoulder line
  const w = height * range(0.12, 0.19);         // half the shoulder width
  const lean = height * range(-0.06, 0.06);
  const elbow = rnd() < 0.5 ? -1 : 1;           // which side sticks out
  const out = height * range(0.05, 0.12), at = range(0.3, 0.5);
  const foot = height * range(0, 0.08);         // a point, or a narrow base
  const drop = height * range(-0.04, 0.04);     // shoulders not quite level
  const tip = lean * 0.3;
  const side = (s) => {
    const x = s * w + lean, y = top + (s > 0 ? drop : -drop);
    const pts = [[x, y]];
    if (s === elbow) pts.push([x + s * out, top + (bottom - top) * at]);
    return pts;
  };
  const left = side(-1), right = side(1);
  const body = [...left, [tip - foot, bottom], [tip + foot, bottom], ...right.reverse()];
  const hx = lean * 0.8, hy = top - neck - head;
  return {
    body: `M${body.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}Z`,
    head: `M${r2(hx - head)} ${r2(hy)}a${r2(head)} ${r2(head)} 0 1 0 ${r2(2 * head)} 0a${r2(head)} ${r2(head)} 0 1 0 ${r2(-2 * head)} 0`,
  };
}

const cache = new Map();

// Inner SVG of a walker (body variant `variant`).
export function walkerSVG(variant) {
  const key = `w${variant}`;
  if (!cache.has(key)) {
    const f = figure(variant, PEOPLE.height);
    cache.set(key, `<path class="fig-body" d="${f.body}"/><path class="fig-head" d="${f.head}"/>`);
  }
  return cache.get(key);
}

// Inner SVG of a cyclist riding towards `heading` (a VEHICLES.headings
// index) for `camera`: two wheel rings along the way, the figure between
// them, sat up on the saddle, on a frame joining the hubs.
export function cyclistSVG(camera, heading, variant) {
  const key = `c${variant}|${heading}|${camera.rotation}|${camera.tile}`;
  if (!cache.has(key)) {
    const a = (heading / VEHICLES.headings) * Math.PI * 2;
    const half = PEOPLE.wheel / 2;
    const [rx, ry] = rotateQuarter(Math.cos(a) * half, Math.sin(a) * half, camera.rotation);
    const [dx, dy] = [(rx - ry) * COS30 * camera.tile, (rx + ry) * 0.5 * camera.tile];
    const wr = PEOPLE.height * 0.13;
    const ring = (cx, cy) => `M${r2(cx - wr)} ${r2(cy)}a${r2(wr)} ${r2(wr)} 0 1 0 ${r2(2 * wr)} 0a${r2(wr)} ${r2(wr)} 0 1 0 ${r2(-2 * wr)} 0`;
    // the frame: hub to the seat under the rider to hub
    const seat = -wr * 1.9;
    const frame = `M${r2(dx)} ${r2(dy - wr)}L0 ${r2(seat)}L${r2(-dx)} ${r2(-dy - wr)}`;
    const f = figure(variant, PEOPLE.height * 0.75, seat + wr * 0.3);
    cache.set(key, `<path class="fig-wheel" d="${ring(dx, dy - wr) + ring(-dx, -dy - wr) + frame}"/><path class="fig-body" d="${f.body}"/><path class="fig-head" d="${f.head}"/>`);
  }
  return cache.get(key);
}
