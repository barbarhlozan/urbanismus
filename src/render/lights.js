// Lights in the night: where a lamp shines, the night is left out – a
// pool of bare paper on the ground under it, its edge broken as the
// shadows' are, so the night's strokes stop unevenly there – and the lamp's
// head is left out too. The pools are holes in the night's mask (and in
// the shadows', at the dusk they come on in, DAY.steps `lamps`), drawn by
// Renderer.renderLights.
//
//   lampPool(x, y, project, px)  -> [the pool, the lamp's head] as path data,
//                                   each turned anticlockwise (ring)
//   headBeam(x, y, dx, dy, train, seed) -> a vehicle's beam, world points

import { hash } from './hatch.js';

//   pool    the pool's radius on the ground (grid units)
//   ragged  how far its edge strays in and out, as a share of the radius
//   points  points round its edge
//   high    the lamp's head above the ground (structures/kit.js lamp)
//   head    the radius of the light round the head (grid units)
//   beam    a vehicle's headlights: how far ahead they reach, how wide
//           they are at the lamps and at the far end (grid units); a
//           train's reach `train` times as far
export const LIGHTS = {
  beam: { reach: 1.0, near: 0.04, far: 0.3, train: 1.5 },
  pool: 0.3,
  ragged: 0.18,
  points: 20,
  high: 0.24,
  head: 0.05,
};

const r2 = (n) => Math.round(n * 100) / 100;

// A closed ring as path data, turned anticlockwise on screen, so that rings
// of one colour in a mask add up where they overlap rather than cancel.
function ring(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
  return `M${(a > 0 ? pts : [...pts].reverse()).map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}Z`;
}

// The light of a street lamp standing at world (x, y): the pool, a ring of
// ground points projected (`project(x, y, z)` -> scene px, with the
// relief), each a little further out or in, seeded by where the lamp
// stands; and a small round of light at its head, `px` scene px to a grid
// unit.
export function lampPool(x, y, project, px, opts = LIGHTS) {
  const n = opts.points, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const r = opts.pool * (1 + opts.ragged * (hash(x * 7.1 + i, y * 3.3) * 2 - 1));
    pts.push(project(x + Math.cos(a) * r, y + Math.sin(a) * r, 0));
  }
  const [hx, hy] = project(x, y, opts.high), hr = opts.head * px;
  const head = Array.from({ length: 10 }, (_, i) => [hx + Math.cos((i / 10) * 2 * Math.PI) * hr, hy + Math.sin((i / 10) * 2 * Math.PI) * hr]);
  return [ring(pts), ring(head)];
}

// A vehicle's headlights at world (x, y), going (dx, dy) (unit): a beam on
// the ground widening ahead, its far end rounded and a little uneven,
// seeded by the vehicle (`seed`), so it keeps its shape as it goes; a
// train's reaching further. World points, for the caller to project.
export function headBeam(x, y, dx, dy, train = false, seed = 0, opts = LIGHTS.beam) {
  const reach = opts.reach * (train ? opts.train : 1), [nx, ny] = [-dy, dx];
  const out = [[x + nx * opts.near, y + ny * opts.near]];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n, side = opts.far * (1 - 2 * t);
    const r = reach * (1 + 0.12 * Math.sin(Math.PI * t) + 0.08 * (hash(seed, i + 0.5) - 0.5));
    out.push([x + dx * r * (1 - 0.25 * Math.abs(1 - 2 * t) ** 2) + nx * side, y + dy * r * (1 - 0.25 * Math.abs(1 - 2 * t) ** 2) + ny * side]);
  }
  out.push([x - nx * opts.near, y - ny * opts.near]);
  return out;
}
