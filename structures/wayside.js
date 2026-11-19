// Boží muka and křížky u cest: the little stone and iron things set by a
// road or a path out of the village, as the Germans of the Chodsko and
// Tachov borderland left them in hundreds – a 1×1 dot beside a road or a
// footpath, facing it (World.facingRotation), with a lime tree or two.
// Space steps through its kinds:
//   muka    boží muka: a granite pillar on a step, a head with an arched
//           niche on each face (a picture behind glass once), under a
//           little stone pyramid with an iron cross on top
//   iron    a cast-iron cross on a stone plinth: a step, the pedestal
//           with its inscription plate, a cornice, the cross with the
//           Christ on it and trefoil ends – the 19th-century kind, out of
//           the foundry catalogue
//   wooden  a tall wooden cross with a little tin roof over its head
//           (a stříška) and a tin Christ under it, a board for the name
// No house number: it is not a building. Nobody goes there on purpose.

import { tree } from './kit.js';

// Road dots straight beside it, or a footpath within reach (the way the
// single-dot buildings find their front, World.frontFor).
function wayBeside(world, nodes) {
  return !!world.frontFor(nodes);
}

// An arch on a face: posts from zb up to where the arch starts, a half
// circle over them. P(u, z) gives the face's points, n its normal.
function arch(g, P, n, w, zb, zt) {
  const r = w / 2, zs = zt - r;
  const top = Array.from({ length: 9 }, (_, i) => {
    const t = (i / 8) * Math.PI;
    return P(Math.cos(t) * r, zs + Math.sin(t) * r);
  });
  g.line([P(r, zb), ...top, P(-r, zb), P(r, zb)], { facing: n });
}

// The four faces of a square block of half-width t round (x, y): P(u, z)
// along each face from its left to its right as seen from outside, and its
// normal.
function faces(x, y, t) {
  return [
    [(u, z) => [x + u, y - t, z], [0, -1, 0]],
    [(u, z) => [x + t, y + u, z], [1, 0, 0]],
    [(u, z) => [x - u, y + t, z], [0, 1, 0]],
    [(u, z) => [x - t, y - u, z], [-1, 0, 0]],
  ];
}

// A thin cross of lines: a shaft from z up h, the arm at 0.7 of it.
function ironCross(g, x, y, z, h, { ends = false, corpus = false } = {}) {
  const a = h * 0.32, za = z + h * 0.7;
  g.detailed(1, () => {
    g.solid(x, y, z + h / 2);
    const pen = { width: 1.5, stroke: 'main' };
    g.line([[x, y, z], [x, y, z + h]], pen);
    g.line([[x - a, y, za], [x + a, y, za]], pen);
  });
  if (!ends && !corpus) return;
  g.detailed(2, () => {
    if (ends) {
      // a trefoil on each end: three little leaves
      const r = h * 0.045;
      for (const [ex, ez, dx, dz] of [[x - a, za, -1, 0], [x + a, za, 1, 0], [x, z + h, 0, 1]]) {
        for (const [ox, oz] of [[dx, dz], [dz, dx], [-dz, -dx]]) {
          const cx = ex + ox * r, cz = ez + oz * r;
          g.line(Array.from({ length: 7 }, (_, i) => {
            const t = (i / 6) * Math.PI * 2;
            return [cx + Math.cos(t) * r, y - 0.002, cz + Math.sin(t) * r];
          }));
        }
      }
    }
    if (corpus) {
      // the Christ: arms along the bar, the body hanging, the feet together
      const k = h * 0.06, yb = y - 0.004;
      g.line([[x - a * 0.8, yb, za - k * 0.2], [x, yb, za - k * 0.9], [x + a * 0.8, yb, za - k * 0.2]]);
      g.line([[x, yb, za + k * 0.6], [x, yb, za - h * 0.38]]);
      g.line([[x - k * 0.35, yb, za + k * 0.6], [x + k * 0.35, yb, za + k * 0.6]]); // the head, bowed
    }
  });
}

// The sizes are a man's height to about 0.09 (a storey is 0.17).

// Boží muka: granite, about two men tall with its cross.
function muka(g, y) {
  const s = 0.03, t = 0.014, hs = 0.075, th = 0.026, hh = 0.036;
  const z1 = 0.011, z2 = z1 + hs, z3 = z2 + 0.006, z4 = z3 + hh;
  g.stone = true;
  g.box(-s, y - s, 0, 2 * s, 2 * s, z1); // the step
  g.box(-t, y - t, z1, 2 * t, 2 * t, hs); // the shaft
  g.box(-th - 0.003, y - th - 0.003, z2, 2 * th + 0.006, 2 * th + 0.006, 0.006); // a slab under the head
  g.box(-th, y - th, z3, 2 * th, 2 * th, hh); // the head
  g.roofed(-th - 0.002, y - th - 0.002, z4, 2 * th + 0.004, 2 * th + 0.004, 0, { h: 0.0375, hip: th + 0.002, hatch: false });
  g.stone = false;
  g.detailed(1, () => {
    for (const [P, n] of faces(0, y, th)) arch(g, P, n, 0.02, z3 + 0.006, z4 - 0.005);
    // the shaft's chamfered edges, a line down each face
    for (const [P, n] of faces(0, y, t)) g.line([P(0, z1 + 0.005), P(0, z2 - 0.005)], { facing: n, lod: 2 });
  });
  ironCross(g, 0, y, z4 + 0.0375, 0.03);
}

// The cast-iron cross on its stone plinth.
function iron(g, y) {
  const s = 0.0341, p = 0.0211, c = 0.026;
  const z1 = 0.0112, z2 = z1 + 0.0074, z3 = z2 + 0.0558, z4 = z3 + 0.0087;
  g.stone = true;
  g.box(-s, y - s, 0, 2 * s, 2 * s, z1); // the step
  g.box(-c, y - c, z1, 2 * c, 2 * c, z2 - z1); // a base moulding
  g.box(-p, y - p, z2, 2 * p, 2 * p, z3 - z2); // the pedestal
  g.box(-c, y - c, z3, 2 * c, 2 * c, z4 - z3); // its cornice
  g.box(-0.0112, y - 0.0112, z4, 0.0223, 0.0223, 0.0124); // a little block the cross is leaded into
  g.stone = false;
  // the inscription plate on the front, a few lines of words on it
  const [P, n] = faces(0, y, p)[0];
  g.detailed(2, () => {
    g.line([P(-0.0136, z2 + 0.0124), P(0.0136, z2 + 0.0124), P(0.0136, z3 - 0.0112), P(-0.0136, z3 - 0.0112), P(-0.0136, z2 + 0.0124)], { facing: n });
    for (const [z, w] of [[z3 - 0.0186, 0.0087], [z3 - 0.026, 0.0074], [z3 - 0.0335, 0.0087]]) g.line([P(-w, z), P(w, z)], { facing: n, lod: 2 });
  });
  ironCross(g, 0, y, z4 + 0.0124, 0.1054, { ends: true, corpus: true });
}

// The wooden cross with its tin roof: a squared beam, a little taller than
// the iron one, gone grey.
function wooden(g, y) {
  const b = 0.0056, h = 0.238, za = 0.175, a = 0.0455;
  g.wood = true;
  g.box(-b, y - b, 0, 2 * b, 2 * b, h); // the upright
  g.box(-a, y - b, za - b, 2 * a, 2 * b, 2 * b); // the arm
  // the tin roof over its head, ridge along the arm, sloping to front and back
  g.roofed(-0.021, y - 0.021, h - 0.0084, 0.042, 0.042, 0, { h: 0.021, ridge: 'x' });
  g.wood = false;
  const [P, n] = faces(0, y, b)[0];
  g.detailed(2, () => {
    // the tin Christ, cut out of a sheet and painted once
    const k = 0.0084;
    g.line([P(-a * 0.75, za - 0.0028), P(0, za - k), P(a * 0.75, za - 0.0028)], { facing: n });
    g.line([P(0, za + 0.0084), P(0, za - 0.063)], { facing: n });
    g.line([P(-0.0042, za + 0.0084), P(0.0042, za + 0.0084)], { facing: n });
    // the board under it with the name of the family who set it up
    g.line([P(-0.014, 0.091), P(0.014, 0.091), P(0.014, 0.0735), P(-0.014, 0.0735), P(-0.014, 0.091)], { facing: n });
  });
}

export const wayside = {
  id: 'wayside-cross',
  name: 'Wayside cross',
  blurb: 'By a road or a path',
  category: 'heritage',
  code: 'K',
  tags: ['heritage'],
  access: 'any', // a footpath will do
  numbered: false,
  footprint: [[0, 0]],
  stats: {},
  agents: 0,
  sim: { destinations: [] },
  plot: { props: 'green', boundary: 0, density: 0 }, // grass, no benches or beds
  yards: [],
  kinds: ['muka', 'iron', 'wooden'],
  canPlace(world, nodes) {
    return wayBeside(world, nodes) ? { ok: true } : { ok: false, reason: 'Needs a road or a path beside' };
  },
  draw(g, s) {
    const pick = g.pick(this.kinds);
    const kind = this.kinds.includes(s?.data?.kind) ? s.data.kind : pick;
    // the road runs along y = -1 (nearer beside a diagonal: g.roadGap)
    const k = 1 - (g.roadGap ?? 1);
    const y = -0.42 + k;
    // a lime tree beside it, or two, one either side (the way a cross was
    // set between two limes planted the same day) – beside, not behind, or
    // seen from the back the crown hides it
    if (g.chance(0.5)) {
      tree(g, -0.32, y + 0.06, 0.85, 'spreading');
      tree(g, 0.32, y + 0.06, 0.85, 'spreading');
    } else {
      tree(g, g.chance(0.5) ? 0.36 : -0.36, y + 0.1, 0.9, 'spreading');
    }
    ({ muka, iron, wooden })[kind](g, y);
  },
};
