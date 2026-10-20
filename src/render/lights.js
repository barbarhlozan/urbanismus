// Lights in the night: where a lamp shines, the night is left out – a
// pool of bare paper on the ground under it, its edge broken as the
// shadows' are, so the night's strokes stop unevenly there – and the lamp's
// head is left out too. The pools are holes in the night's mask (and in
// the shadows', at the dusk they come on in, DAY.steps `lamps`), drawn by
// Renderer.renderLights.
//
//   lampPool(x, y, project, px)  -> [the pool, the lamp's head] as path data,
//                                   each turned anticlockwise (ring)

import { hash } from './hatch.js';

//   pool    the pool's radius on the ground (grid units)
//   ragged  how far its edge strays in and out, as a share of the radius
//   points  points round its edge
//   high    the lamp's head above the ground (structures/kit.js lamp)
//   head    the radius of the light round the head (grid units)
export const LIGHTS = {
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
