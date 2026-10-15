// Road marks: a planner's pencil note on the map at a building that nothing
// reaches – no road, or for `access: 'any'` buildings no footpath either
// (World.isServed, the same test as the Building card's "Needs a road…").
// It's drawn on the map (the renderer's `notes` layer), never in a photo:
// it's a note on the plan, not part of the town.
//
// Three hands to choose from (ROAD_MARK.style):
//   stub   a short piece of road pencilled out from the door, its two
//          edges breaking off into a dash and then nothing – the road
//          still to be drawn
//   query  a small handwritten question mark by the door
//   cross  a surveyor's cross laid on the ground before the door
// Each is drawn by the building's own seed, so no two are the same stroke.
//
// The mark goes on the building's front (its drawn rotation) when that
// faces the viewer; otherwise on the side that does most, so the building
// never hides its own note.

import { mulberry32 } from '../core/random.js';
import { rotateQuarter, ORTHO } from '../core/grid.js';
import { sketchLine } from './sketch.js';

export const ROAD_MARK = {
  style: 'stub',     // 'stub' | 'query' | 'cross'
  styles: ['stub', 'query', 'cross'],
  out: 0.34,         // where the mark starts, grid units out from the footprint's middle row
  stub: 0.42,        // the stub's length (grid units), before it breaks off
  halfWidth: 0.09,   // half the stub's width, a little narrower than a road (config.road.edge)
};

const r2 = (n) => Math.round(n * 100) / 100;

// The structures that get a mark.
export function unserved(world) {
  const out = [];
  for (const s of world.structures.values()) if (!world.isServed(s)) out.push(s);
  return out;
}

// Where the mark goes: `at`, a point on the ground just off the footprint,
// and `dir`, the way out from the building there (grid units).
export function markPlace(world, camera, s) {
  const nodes = world.nodesOf(s).map((n) => world.grid.xy(n));
  const front = rotateQuarter(0, -1, world.drawnRotation(s));
  // how far down the screen a step that way goes: + is towards the viewer
  const [cx, cy] = [nodes.reduce((a, p) => a + p[0], 0) / nodes.length, nodes.reduce((a, p) => a + p[1], 0) / nodes.length];
  const down = ([dx, dy]) => camera.project(cx + dx, cy + dy, 0)[1] - camera.project(cx, cy, 0)[1];
  const dir = down(front) > 0 ? front : ORTHO.reduce((best, d) => (down(d) > down(best) ? d : best));
  // the middle of the footprint's row on that side
  const reach = Math.max(...nodes.map(([x, y]) => x * dir[0] + y * dir[1]));
  const row = nodes.filter(([x, y]) => x * dir[0] + y * dir[1] === reach);
  const mx = row.reduce((a, p) => a + p[0], 0) / row.length, my = row.reduce((a, p) => a + p[1], 0) / row.length;
  return { at: [mx + dir[0] * ROAD_MARK.out, my + dir[1] * ROAD_MARK.out], dir };
}

// The mark as SVG path data in scene coordinates. `project(x, y)`: a point
// on the ground to the scene; `px`: scene px per screen px at zoom 1 (the
// wobble's scale, camera.tile / 32).
export function roadMarkPath(style, { at, dir }, seed, project, px = 1) {
  const rnd = mulberry32(seed);
  const [ax, ay] = at, [dx, dy] = dir, [nx, ny] = [-dy, dx];
  const g = (along, side) => project(ax + dx * along + nx * side, ay + dy * along + ny * side);
  const line = (a, b, over = 0.6) => sketchLine(a, b, (rnd() * 4294967296) >>> 0, { k: px, over, bow: 1.5 });

  if (style === 'query') {
    // upright, as written on the plan, standing just beside the door
    const [bx, by] = g(0.1, (rnd() < 0.5 ? -1 : 1) * 0.18);
    const h = (11 + rnd() * 2.5) * px, w = h * (0.48 + rnd() * 0.1);
    const lean = (rnd() - 0.3) * 0.25; // a little forward, mostly
    const p = (x, y) => [bx + x * w + -y * h * lean, by - y * h];
    // the hook: up from the left, over the top, down to the middle; then the stem
    const pts = [p(-0.5, 0.72), p(-0.42, 0.92), p(0, 1.02), p(0.45, 0.88), p(0.48, 0.66), p(0.12, 0.48), p(0.02 + (rnd() - 0.5) * 0.1, 0.3)];
    let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      d += `Q${r2(x0)} ${r2(y0)} ${r2((x0 + x1) / 2)} ${r2((y0 + y1) / 2)}`;
    }
    d += `L${r2(pts.at(-1)[0])} ${r2(pts.at(-1)[1])}`;
    // the dot: a tiny stroke, not a circle
    const [ox, oy] = p(0.02 + (rnd() - 0.5) * 0.08, 0.04);
    d += `M${r2(ox - 0.4 * px)} ${r2(oy)}L${r2(ox + 0.5 * px)} ${r2(oy + 0.3 * px)}`;
    return d;
  }

  if (style === 'cross') {
    // on the ground, so it lies flat like a mark on the plan; one arm along
    // the way out, a little turned and uneven
    const s = 0.11 + rnd() * 0.03, turn = (rnd() - 0.5) * 0.5;
    const c = Math.cos(Math.PI / 4 + turn), sn = Math.sin(Math.PI / 4 + turn);
    const m = 0.12;
    const arm = (a, b) => line(g(m + a[0], a[1]), g(m + b[0], b[1]), 0.8);
    return arm([-s * c, -s * sn], [s * c * (0.9 + rnd() * 0.3), s * sn])
      + arm([s * sn, -s * c], [-s * sn * (0.9 + rnd() * 0.3), s * c]);
  }

  // stub: two edges out from the door, drawn like a road's, each going on
  // solid most of the way and then breaking off into one short dash – two
  // lines, so it doesn't read as a (dashed, single) footpath
  const L = ROAD_MARK.stub * (0.85 + rnd() * 0.3);
  const hw = ROAD_MARK.halfWidth * (0.9 + rnd() * 0.2);
  let d = '';
  for (const side of [-hw, hw]) {
    const solid = L * (0.62 + rnd() * 0.14);
    d += line(g(0, side), g(solid, side * (1 + (rnd() - 0.5) * 0.12)), 0.3);
    const t = solid + L * (0.08 + rnd() * 0.06);
    if (t < L) d += line(g(t, side), g(Math.min(L, t + L * (0.08 + rnd() * 0.08)), side), 0);
  }
  return d;
}
