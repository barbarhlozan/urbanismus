// Bus stop: a 1×1 dot beside a road, turned to face it (single-dot
// buildings face their road, World.facingRotation) and square to it, round
// a bend too (tiltOf in structures/index.js). A sheet-metal shelter
// open towards the road, the round ZASTÁVKA sign in its hoop at the kerb
// (on one pole or two legs, by seed), a bin, and a tree behind.
// Buses come in from off the map through road exits and call at a few stops
// before leaving again (src/sim/agents.js, updateBuses) – no road to the
// map edge, no buses.

import { bench, tree, flowerBed, outward } from './kit.js';

// Size of the shelter, sign and bin relative to their first drawing, which
// stood as tall as a house (the plates keep their thickness).
const S = 0.7;

// Road dots straight next to the footprint (not diagonal ones).
function roadBeside(world, nodes) {
  return nodes.some((n) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
    const m = world.grid.offset(n, dx, dy);
    return m >= 0 && world.hasRoad(m);
  }));
}

// A thin plate: the planar polygon pts (3D) and the same shifted by `off`,
// joined round the edge – a wall of sheet metal seen from either side.
function plate(g, pts, off) {
  const back = pts.map(([x, y, z]) => [x + off[0], y + off[1], z + off[2]]);
  const all = [...pts, ...back];
  const c = [0, 1, 2].map((k) => all.reduce((a, p) => a + p[k], 0) / all.length);
  g.solid(...c);
  g.face(outward(pts, c));
  g.face(outward(back, c));
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    g.face(outward([pts[i], pts[j], back[j], back[i]], c));
  }
}

// Points round a circle in the upright plane y, centre (x, z).
function ring(x, y, z, r, n = 14, from = 0, to = Math.PI * 2) {
  return Array.from({ length: n }, (_, i) => {
    const t = from + ((to - from) * i) / (n - 1 || 1);
    return [x + Math.cos(t) * r, y, z + Math.sin(t) * r];
  });
}

// The ZASTÁVKA sign: a round plate in a steel hoop, facing the road. The
// hoop runs down to the ground on both sides with a timetable board between
// (legs), or only on one, the other side ending under the plate.
function sign(g, x, y, legs) {
  const r = 0.04 * S, top = (legs ? 0.22 : 0.19) * S; // hoop radius, where its arch starts
  const arch = ring(x, y, top, r, 9, 0, Math.PI);
  g.detailed(1, () => {
    g.solid(x, y, 0.1 * S);
    // one pole: as if the other leg were cut off just under the plate
    g.line([[x + r, y, 0], ...arch, [x - r, y, legs ? 0 : top - 0.035 * S]]);
  });
  plate(g, ring(x, y, top, r * 0.78, 14).slice(0, -1), [0, 0.006, 0]);
  if (legs) plate(g, [[x - r, y, 0.1 * S], [x + r, y, 0.1 * S], [x + r, y, 0.155 * S], [x - r, y, 0.155 * S]], [0, 0.006, 0]);
}

// The shelter (a ČSAD one of sheet metal): a back wall, side walls that
// widen towards the top, a roof sloping up towards the road; open in front
// (-y). x0…x1 wide, back wall at yb.
function shelter(g, x0, x1, yb) {
  const hb = 0.15 * S, hf = 0.17 * S, foot = 0.09 * S, reach = 0.2 * S, t = 0.012;
  plate(g, [[x0, yb, 0], [x1, yb, 0], [x1, yb, hb], [x0, yb, hb]], [0, t, 0]);
  for (const [x, side] of [[x0, -1], [x1, 1]]) {
    plate(g, [[x, yb, 0], [x, yb - foot, 0], [x, yb - reach, hf], [x, yb, hb]], [side * t, 0, 0]);
  }
  const e = 0.03 * S, roof = [[x0 - e, yb + t + 0.01, hb], [x1 + e, yb + t + 0.01, hb], [x1 + e, yb - reach - e, hf], [x0 - e, yb - reach - e, hf]];
  plate(g, roof, [0, 0, 0.012]);
  // corrugation
  g.detailed(2, () => {
    for (let x = x0; x <= x1 + 1e-6; x += (x1 - x0) / 6) g.line([[x, yb + t, hb + 0.013], [x, yb - reach - e, hf + 0.013]]);
  });
  bench(g, (x0 + x1) / 2, yb - 0.04 * S);
}

export const busStop = {
  id: 'bus-stop',
  name: 'Bus stop',
  blurb: 'Beside a road',
  category: 'transport',
  hotkey: '6',
  code: 'BS',
  busStop: true,
  facesRoad: true, // can't be turned away from its road
  sim: { destinations: [] },
  footprint: [[0, 0]],
  canPlace(world, nodes) {
    return roadBeside(world, nodes) ? { ok: true } : { ok: false, reason: 'Needs a road alongside' };
  },
  levels: [
    {
      name: 'Bus stop',
      stats: {},
      agents: 0,
      draw(g) {
        // the road runs along y = -1 (or nearer beside a diagonal: g.roadGap,
        // then everything moves back by the difference): the shelter just
        // back from it, the sign at the kerb
        const k = 1 - (g.roadGap ?? 1);
        shelter(g, -0.2, 0.12, -0.58 + k);
        sign(g, 0.3, -0.7 + k, g.chance(0.5));
        g.detailed(2, () => g.box(-0.34, -0.72 + k, 0, 0.03, 0.03, 0.035)); // a bin
        tree(g, 0.14, 0.2 + k, 0.8);
        flowerBed(g, -0.24, 0.08 + k, 0.06);
      },
    },
  ],
};
