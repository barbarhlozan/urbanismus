// Heritage: old landmarks the town grew around – a chapel on the green, a
// church (three kinds), a town hall in three sizes, a war memorial, a castle
// (ruin, castle or chateau). They draw visitors and strollers (tag
// 'heritage').
// A church can also appear by itself in a grown neighbourhood without one
// (see spawnChurch in src/sim/growth.js).
//
// 2×2 ones: local area covers x, y from about -0.4 to 1.4, front on -y.

import { door, panel, paving, star, flagpole, flowerBed, tree, fountain, heap, roundWindows, FRAME, outward, statue, figure, kindOf, fenceAlong } from './kit.js';
import { graves } from './grounds.js';

const FRONT = [0, -1, 0];

// Baroque onion dome with a lantern, for a tower of half-width t.
function onion(g, x, y, z, t) {
  g.lathe(x, y, z, [
    [t * 0.95, 0], [t * 1.0, t * 0.3], [t * 0.72, t * 0.75], [t * 0.4, t * 1.0],
    [t * 0.4, t * 1.15], [t * 0.75, t * 1.4], [t * 0.8, t * 1.65], [t * 0.55, t * 2.05],
    [t * 0.14, t * 2.45], [t * 0.12, t * 2.9], [0, t * 3.2],
  ], 8, { phase: 0.5 });
  cross(g, x, y, z + t * 3.2);
}

// Gothic needle spire over a square tower of half-width t.
function spire(g, x, y, z, t, h) {
  g.lathe(x, y, z, [[t * 1.41, 0], [0, h]], 4, { phase: 0.5 });
  cross(g, x, y, z + h);
}

// A cross on a gable's peak (y a hair before the gable, or the roof hides
// it): bigger and in a heavier pen than one on a spire, or it is lost
// against the roof.
function gableCross(g, x, y, z, s = 0.06) {
  cross(g, x, y, z, s, { width: 2, stroke: 'main' });
}

function cross(g, x, y, z, s = 0.035, pen = {}) {
  g.detailed(1, () => {
    g.solid(x, y, z + s);
    g.line([[x, y, z], [x, y, z + s * 2.2]], pen);
    g.line([[x - s * 0.6, y, z + s * 1.5], [x + s * 0.6, y, z + s * 1.5]], pen);
  });
}

// Square tower from z = 0 with belfry openings at the top; returns its height.
function tower(g, x, y, t, h) {
  g.box(x - t, y - t, 0, 2 * t, 2 * t, h);
  g.windows(x - t, y - t, 2 * t, 2 * t, h - 0.12, h - 0.02, 0.1, t, { w: 0.4, h: 0.7 });
  g.floors(x - t, y - t, 2 * t, 2 * t, 0, h, h * 0.4, { inset: 0 });
  return h;
}

// Tall arched-looking windows along the long walls.
function naveWindows(g, x, y, w, d, h) {
  g.windows(x, y, w, d, 0, h, h, 0.16, { skip: ['front', 'back'], w: 0.3, h: 0.6 });
}

// A clock on each face of a square tower (half-width t) at height z.
function clockFaces(g, x, y, t, z, r = 0.055) {
  const ring = (fn) => Array.from({ length: 13 }, (_, i) => fn(Math.cos((i / 12) * Math.PI * 2) * r, Math.sin((i / 12) * Math.PI * 2) * r));
  g.detailed(1, () => {
    g.line(ring((u, v) => [x + u, y - t, z + v]), { facing: [0, -1, 0], lod: 1 });
    g.line(ring((u, v) => [x + t, y + u, z + v]), { facing: [1, 0, 0], lod: 1 });
    g.line(ring((u, v) => [x - u, y + t, z + v]), { facing: [0, 1, 0], lod: 1 });
    g.line(ring((u, v) => [x - t, y - u, z + v]), { facing: [-1, 0, 0], lod: 1 });
  });
}

const common = {
  access: 'any', // a footpath will do
  category: 'heritage',
  tags: ['heritage'],
  code: 'H',
  sim: { destinations: ['residential'] },
  plot: { props: 'green', boundary: 0.7, kinds: ['fence', 'hedge'], density: 0.35 },
};

export const chapel = {
  ...common,
  id: 'chapel',
  name: 'Chapel',
  blurb: 'Wayside chapel',
  footprint: [[0, 0]],
  stats: {},
  agents: 0,
  // A lime tree beside it, no fence. Space steps through its kinds, in
  // this order (one built before there were kinds is the first):
  //   green   the chapel on the village green (návesní kaple, as at
  //           Holašovice): a little nave, a bell turret on its ridge
  //   niche   a wayside niche chapel (výklenková kaple): a shallow block
  //           with a gable, an arched opening barred by a grille, a cross
  //   belfry  the chapel with its bell storey above it (kaple se
  //           zvoničkou): a square room, a skirt roof, the belfry on top
  //   gable   the bigger chapel with a gable front, its window up in the
  //           gable, an arched door, an open bell turret at the back
  plot: { props: 'green', boundary: 0, density: 0.15 },
  yards: [],
  kinds: ['green', 'niche', 'belfry', 'gable'],
  draw(g, s) {
    const kind = this.kinds.includes(s?.data?.kind) ? s.data.kind : 'green';
    tree(g, 0.3, 0.05, 1.05, 'spreading');
    const paint = g.paint;
    g.paint = 2; // plastered walls, red tiles (as the churches)
    ({ green: greenChapel, niche: nicheChapel, belfry: belfryChapel, gable: gableChapel })[kind](g);
    g.paint = paint;
  },
};

function greenChapel(g) {
  const w = 0.26, d = 0.38, y = -0.2, h = 0.22, r = 0.17;
  g.roofed(-w / 2, y, 0, w, d, h, { h: r, ridge: 'y' });
  door(g, 0, y, 0.07, 0.13);
  naveWindows(g, -w / 2, y, w, d, h);
  // bell turret on the front of the ridge
  g.box(-0.035, y + 0.04, h + r * 0.75, 0.07, 0.07, 0.08);
  onion(g, 0, y + 0.075, h + r * 0.75 + 0.08, 0.04);
}

// The front face of a block whose front is at y: P(u, z), its normal.
const frontAt = (y) => [(u, z) => [u, y, z], [0, -1, 0]];

function nicheChapel(g) {
  const w = 0.2, d = 0.14, y = -0.16, h = 0.25, r = 0.07;
  g.roofed(-w / 2, y, 0, w, d, h, { h: r, ridge: 'y' });
  const [P, n] = frontAt(y);
  g.detailed(1, () => {
    g.line([P(-w / 2, h - 0.025), P(w / 2, h - 0.025)], { facing: n }); // the cornice
    archWindow(g, P, n, 0.11, 0.03, 0.2);
    // the grille's bars
    for (const u of [-0.033, -0.011, 0.011, 0.033]) g.line([P(u, 0.03), P(u, 0.19 - Math.abs(u) * 0.6)], { facing: n });
  });
  standing(g, [[-w / 2 - 0.01, y - 0.05], [w / 2 + 0.01, y]], () => g.box(-w / 2 - 0.01, y - 0.05, 0, w + 0.02, 0.05, 0.012)); // the step
  gableCross(g, 0, y - 0.012, h + r);
}

function belfryChapel(g) {
  const t = 0.11, h = 0.28, t2 = 0.065, h2 = 0.17, y = -0.04;
  g.box(-t, y - t, 0, 2 * t, 2 * t, h);
  // a skirt roof round the top of the room, the belfry standing out of it
  g.roofed(-t - 0.015, y - t - 0.015, h, 2 * t + 0.03, 2 * t + 0.03, 0, { h: 0.06, hip: t + 0.015 });
  g.box(-t2, y - t2, h + 0.02, 2 * t2, 2 * t2, h2);
  g.roofed(-t2 - 0.01, y - t2 - 0.01, h + 0.02 + h2, 2 * t2 + 0.02, 2 * t2 + 0.02, 0, { h: 0.05, hip: t2 + 0.01 });
  const zt = h + 0.02 + h2 + 0.05;
  g.detailed(1, () => {
    for (const [P, n] of towerFaces(0, y, t)) {
      if (n[1] === -1) archWindow(g, P, n, 0.08, 0, 0.19); // the door
      for (const u of [-t + 0.02, t - 0.02]) g.line([P(u, 0.01), P(u, h - 0.01)], { facing: n }); // pilasters
    }
    for (const [P, n] of towerFaces(0, y, t2)) archWindow(g, P, n, 0.045, h + 0.06, h + h2 - 0.02);
  });
  g.lathe(0, y, zt, [[0.012, 0], [0.012, 0.03], [0, 0.07]], 6);
  cross(g, 0, y, zt + 0.07, 0.025);
}

function gableChapel(g) {
  const w = 0.3, d = 0.46, y = -0.26, h = 0.24, r = 0.2;
  g.box(-w / 2 - 0.008, y - 0.008, 0, w + 0.016, d + 0.016, 0.04); // stone plinth
  g.roofed(-w / 2, y, 0, w, d, h, { h: r, ridge: 'y' });
  const [P, n] = frontAt(y);
  g.detailed(1, () => {
    archWindow(g, P, n, 0.09, 0.04, 0.2); // the door
    archWindow(g, P, n, 0.05, h + 0.04, h + 0.12); // up in the gable
    g.line([P(-w / 2, h - 0.01), P(w / 2, h - 0.01)], { facing: n }); // the cornice under it
    for (const u of [-w / 2 + 0.025, w / 2 - 0.025]) g.line([P(u, 0.04), P(u, h - 0.01)], { facing: n }); // pilasters
  });
  sideWindows(g, -w / 2, w / 2, y + 0.06, y + d, 2, 0.045, 0.08, 0.2);
  gableCross(g, 0, y - 0.012, h + r);
  // the open bell turret on the back of the ridge
  // (its base rises from the roof a little below the ridge; open on four posts)
  const ty = y + d - 0.1, k = 0.04, zb = h + r * 0.8, zp = zb + 0.06, zr = zp + 0.08;
  g.box(-k, ty - k, zb, 2 * k, 2 * k, zp - zb);
  for (const [px, py] of [[-k, -k], [k - 0.012, -k], [k - 0.012, k - 0.012], [-k, k - 0.012]]) g.box(px, ty + py, zp, 0.012, 0.012, zr - zp);
  g.roofed(-k - 0.01, ty - k - 0.01, zr, 2 * k + 0.02, 2 * k + 0.02, 0, { h: 0.11, hip: k + 0.01 });
}

export const church = {
  ...common,
  id: 'church',
  name: 'Church',
  blurb: 'Village church',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  stats: { jobs: 2 },
  agents: 1,
  // (the churchyard is drawn with the church; nothing else round it)
  plot: { props: 'green', boundary: 0, density: 0 },
  yards: [],
  // Space steps through them in this order; one the town builds by itself
  // is the first (spawnChurch). Four village churches, then the big one:
  //   onion   baroque, after Černošín: a tall front tower with a slate
  //           helmet, its graves round it but no wall
  //   bulb    white, with a red bulb on its tower and a gothic chancel
  //           with buttresses, the graves round it
  //   stone   old fieldstone under slate, a slim tower with a dark helmet,
  //           in a walled churchyard with an arched gate and a charnel house
  //   gothic  small and old: a short tower with a steep tiled pyramid, a
  //           rounded churchyard wall with a roofed gateway and steps
  //   twin    the big two-towered baroque pilgrimage church, after Skoky:
  //           on a terrace walled all round, no graves
  kinds: ['onion', 'bulb', 'stone', 'gothic', 'twin'],
  // What lies round it, switched on the building's card (Surroundings,
  // tools/inspect.js) in this order: the graves of the churchyard, a few
  // old ones at the back, or none. The village churches have their graves
  // until told otherwise, the big one none.
  // And what encloses it, switched the same way: nothing, a straight wall
  // with an arched gateway, a wall with rounded corners (a roofed gateway,
  // or the terrace's steps), a fence. Each kind starts with the one its
  // model has.
  switches: {
    grounds: { label: 'inspect.yard', values: ['graves', 'few', 'none'], start: (kind) => (kind === 'twin' ? 'none' : 'graves') },
    wall: {
      label: 'inspect.wall',
      values: ['none', 'straight', 'rounded', 'fence'],
      start: (kind) => ({ stone: 'straight', gothic: 'rounded', twin: 'rounded' })[kind] ?? 'none',
    },
  },
  draw(g, s) {
    const kind = kindOf(g, s, this.kinds);
    const grounds = switchOf(this, s, 'grounds', kind), wall = switchOf(this, s, 'wall', kind);
    const draw = { onion: baroqueChurch, bulb: bulbChurch, stone: stoneChurch, gothic: smallChurch, twin: pilgrimageChurch }[kind];
    draw(g, grounds, wall);
  },
};

// ----- the baroque village church, after the one at Černošín -----
// A tall front tower in two stages, each with a cornice, an arched window
// and (below) a round one, the clock under the top cornice; on it a dark
// helmet: a broad low bulb, an open lantern, a small bulb and a needle with
// a cross. Behind it a narrow nave under a red tile roof, pilasters between
// tall round-headed windows; a polygonal chancel nearly as wide, a little
// lower; a sacristy with a hipped roof beside it. No trees round it; its
// graves and wall as chosen (church.switches). (Left out: the volute gables
// beside the tower, pilasters on its corners.)

// A round-headed window on a wall: P(u, z) is the point u along the wall
// (from the window's middle) at height z, n the wall's outward normal.
function archWindow(g, P, n, w, zb, zt) {
  const r = w / 2, zs = zt - r;
  const arc = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 6) * Math.PI;
    return P(Math.cos(a) * r, zs + Math.sin(a) * r);
  });
  g.line([P(-r, zb), P(r, zb), ...arc, P(-r, zb)], { facing: n });
}

// A ring on a wall (an oculus, a clock face), as archWindow.
function ring(g, P, n, z, r) {
  g.line(Array.from({ length: 13 }, (_, i) => P(Math.cos((i / 12) * Math.PI * 2) * r, z + Math.sin((i / 12) * Math.PI * 2) * r)), { facing: n, lod: 1 });
}

// The four faces of a square tower of half-width t round (x, y): each a
// P(u, z) and its normal.
function towerFaces(x, y, t) {
  return [
    [(u, z) => [x + u, y - t, z], [0, -1, 0]],
    [(u, z) => [x + t, y + u, z], [1, 0, 0]],
    [(u, z) => [x - u, y + t, z], [0, 1, 0]],
    [(u, z) => [x - t, y - u, z], [-1, 0, 0]],
  ];
}

// A thin projecting band round a square tower: its cornice.
function cornice(g, x, y, t, z, k = 0.018, h = 0.03) {
  g.box(x - t - k, y - t - k, z, 2 * (t + k), 2 * (t + k), h);
}

// Chancel from y0, x0..x1 wide, `d` deep, walls `h` high, its roof `rh`
// high: a ridge along y running into a hipped end faceted like the walls –
// three sides of an octagon at the back, or (round) a half circle.
function apse(g, x0, x1, y0, d, h, rh, { round = false } = {}) {
  const w = x1 - x0, y1 = y0 + d, xm = (x0 + x1) / 2, r = w / 2;
  let end; // the end's corners, from the right-hand side round to the left
  if (round) end = Array.from({ length: 7 }, (_, i) => [xm + Math.cos((i / 6) * Math.PI) * r, y1 - r + Math.sin((i / 6) * Math.PI) * r]);
  else {
    const c = w * 0.3;
    end = [[x1, y1 - c], [x1 - c, y1], [x0 + c, y1], [x0, y1 - c]];
  }
  const base = [[x0, y0], [x1, y0], ...end];
  g.prism(base, 0, h);
  const zt = h, zr = h + rh;
  const top = [xm, y1 - r, zr]; // where the ridge ends, the end's facets meet
  const [ye0, ye1] = [end[0][1], end[end.length - 1][1]];
  g._plane([[x1, y0, zt], [x1, ye0, zt], top, [xm, y0, zr]]);
  g._plane([[x0, ye1, zt], [x0, y0, zt], [xm, y0, zr], top]);
  for (let i = 0; i + 1 < end.length; i++) g._plane([[...end[i], zt], [...end[i + 1], zt], top]);
  return base;
}

function baroqueChurch(g, grounds, wall) {
  const paint = g.paint;
  g.paint = 2; // plastered walls, red tiles (ROOF_OF; not one whose low annexes are logs)
  const x = 0.5, t1 = 0.14, t2 = 0.12, cy = t1 + 0.06;
  const z1 = 0.5, z2 = 0.86; // the tops of the two stages
  const nw = 0.4, nx = x - nw / 2, ny = cy + t1, nd = 0.56, nh = 0.34, nr = 0.28;

  // nave: pilasters between the windows along both long walls
  g.roofed(nx, ny, 0, nw, nd, nh, { h: nr, ridge: 'y' });
  g.detailed(1, () => {
    for (const [X, s] of [[nx, -1], [nx + nw, 1]]) {
      const P = (yy) => (u, z) => [X, yy - u * s, z];
      const bays = 4, bay = nd / bays;
      for (let i = 0; i < bays; i++) archWindow(g, P(ny + (i + 0.5) * bay), [s, 0, 0], 0.055, 0.1, 0.27);
      for (let i = 1; i < bays; i++) g.line([[X, ny + i * bay, 0.02], [X, ny + i * bay, nh - 0.01]], { facing: [s, 0, 0] });
    }
  });

  // chancel and sacristy
  const cw = nw * 0.88;
  apse(g, x - cw / 2, x + cw / 2, ny + nd, 0.26, nh * 0.94, nr * 0.86);
  g.detailed(1, () => {
    for (const [X, s] of [[x - cw / 2, -1], [x + cw / 2, 1]]) archWindow(g, (u, z) => [X, ny + nd + 0.08 - u * s, z], [s, 0, 0], 0.05, 0.1, 0.25);
  });
  g.roofed(x + cw / 2, ny + nd + 0.02, 0, 0.12, 0.16, 0.17, { h: 0.08, ridge: 'y', hip: 0.06 });

  // tower: the lower stage as high as the nave's eaves and a little over
  const wasStone = g.stone;
  g.box(x - t1, cy - t1, 0, 2 * t1, 2 * t1, z1);
  cornice(g, x, cy, t1, z1 - 0.03);
  g.box(x - t2, cy - t2, z1, 2 * t2, 2 * t2, z2 - z1);
  cornice(g, x, cy, t2, z2);
  g.detailed(1, () => {
    for (const [P, n] of towerFaces(x, cy, t1)) {
      if (n[1] === 1) continue; // (the nave's against it)
      ring(g, P, n, 0.3, 0.022);
      if (n[1] === -1) archWindow(g, P, n, 0.06, 0.24, 0.4); // the choir window over the door
    }
    for (const [P, n] of towerFaces(x, cy, t2)) {
      archWindow(g, P, n, 0.06, z1 + 0.08, z1 + 0.24); // the belfry
      ring(g, P, n, z2 - 0.06, 0.035); // the clock
    }
  });
  // the helmet, in slate: broad bulb, open lantern, small bulb, needle
  g.stone = true;
  const z = z2 + 0.03, T = t2 + 0.02;
  g.lathe(x, cy, z, [
    [T * 0.95, 0], [T * 1.12, T * 0.35], [T * 1.05, T * 0.75], [T * 0.75, T * 1.15], [T * 0.4, T * 1.4], [T * 0.32, T * 1.5],
  ], 8, { phase: 0.5 });
  const zl = z + T * 1.5, lh = T * 0.85;
  g.lathe(x, cy, zl, [[T * 0.32, 0], [T * 0.32, lh]], 8, { phase: 0.5 });
  g.detailed(1, () => {
    for (let j = 0; j < 8; j++) {
      const a = ((j + 1) / 8) * Math.PI * 2, r = T * 0.325;
      const [ux, uy] = [Math.cos(a) * r, Math.sin(a) * r];
      g.line([[x + ux, cy + uy, zl + lh * 0.15], [x + ux, cy + uy, zl + lh * 0.85]], { facing: [Math.cos(a), Math.sin(a), 0] });
    }
  });
  g.lathe(x, cy, zl + lh, [
    [T * 0.45, 0], [T * 0.2, T * 0.14], [T * 0.36, T * 0.4], [T * 0.3, T * 0.65], [T * 0.08, T * 0.9], [T * 0.05, T * 1.1], [0, T * 2.3],
  ], 8, { phase: 0.5 });
  g.stone = wasStone;
  cross(g, x, cy, zl + lh + T * 2.3);
  door(g, x, cy - t1, 0.07, 0.16);
  g.paint = paint;

  enclosure(g, wall, cy - t1);
  graveRows(g, x - cw / 2 - 0.12, x + cw / 2 + 0.12, ny + nd + 0.38, grounds);
}

// ----- the two-towered pilgrimage church, after the one at Skoky -----
// Two towers at the front corners, three stages each with cornices and
// arched windows, under bell-shaped tin helmets with a little lantern; a
// curved gable between them over the portal and a big window; a broad nave
// under red tiles, hipped at the front, pilasters between tall windows; a
// narrower chancel with a round end, a sacristy beside it. It stands on a
// terrace: a retaining wall all round it, curving round the front, with
// steps up the middle.

// What fn draws stands at the highest ground under `pts` (local) rather
// than with the church (Painter.stand): on a slope, the churchyard's walls,
// gates and the like step down with the ground instead of standing level
// with the church and running down to it.
function standing(g, pts, fn) {
  const was = g.level;
  g.stand(pts);
  fn();
  g.level = was;
}

// A wall `h` high, `d` thick, along a polyline, stepping down a slope in
// blocks about 0.12 long, each at its own ground.
function wallAlong(g, pts, h, d = 0.035) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [[ax, ay], [bx, by]] = [pts[i], pts[i + 1]];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    const [nx, ny] = [(-(by - ay) / len) * d, ((bx - ax) / len) * d];
    const at = (t) => [ax + (bx - ax) * t, ay + (by - ay) * t];
    const quad = (t0, t1) => {
      const [[px, py], [qx, qy]] = [at(t0), at(t1)];
      return [[px, py], [qx, qy], [qx + nx, qy + ny], [px + nx, py + ny]];
    };
    // pieces at nearly one height are one block (on flat ground, the whole)
    const n = Math.max(1, Math.round(len / 0.12)), runs = [];
    for (let k = 0; k < n; k++) {
      const was = g.level;
      const level = g.stand(quad(k / n, (k + 1) / n)).level;
      g.level = was;
      const last = runs[runs.length - 1];
      if (last && Math.abs(last.level - level) < 0.006) last.t1 = (k + 1) / n;
      else runs.push({ t0: k / n, t1: (k + 1) / n, level });
    }
    for (const r of runs) {
      const was = g.level;
      g.level = g.relief ? r.level : was;
      g.prism(quad(r.t0, r.t1), 0, h);
      g.level = was;
    }
  }
}

function pilgrimageChurch(g, grounds, wall) {
  const paint = g.paint;
  g.paint = 2; // as the village church
  const nx = 0.2, nw = 0.6, ny = 0.04, nd = 0.82, nh = 0.44, nr = 0.3, t = 0.12;
  const xm = nx + nw / 2;

  // nave, hipped at the front behind the gable
  g.roofed(nx, ny, 0, nw, nd, nh, { h: nr, ridge: 'y', hip: [0.16, 0] });
  g.detailed(1, () => {
    for (const [X, s] of [[nx, -1], [nx + nw, 1]]) {
      const P = (yy) => (u, z) => [X, yy - u * s, z];
      const bays = 4, y0 = ny + 2 * t - 0.06, bay = (ny + nd - y0) / bays;
      for (let i = 0; i < bays; i++) archWindow(g, P(y0 + (i + 0.5) * bay), [s, 0, 0], 0.06, 0.12, 0.34);
      for (let i = 0; i <= bays; i++) g.line([[X, y0 + i * bay, 0.02], [X, y0 + i * bay, nh - 0.01]], { facing: [s, 0, 0] });
    }
  });
  // the curved gable between the towers, the window and portal under it
  const fy = ny - 0.005, xa = nx + 2 * t, xb = nx + nw - 2 * t, gh = 0.2;
  const curve = Array.from({ length: 9 }, (_, i) => {
    const u = i / 8; // from the right-hand tower over to the left
    return [xb - (xb - xa) * u, fy, nh + 0.04 + gh * Math.pow(Math.sin(u * Math.PI), 0.7)];
  });
  g.face([[xa, fy, nh], [xb, fy, nh], ...curve]);
  g.detailed(1, () => {
    const P = (u, z) => [xm + u, fy - 0.001, z];
    archWindow(g, P, [0, -1, 0], 0.08, 0.24, 0.42);
    ring(g, P, [0, -1, 0], nh + 0.11, 0.025);
  });
  door(g, xm, fy, 0.09, 0.18);

  // chancel with a round end, the sacristy beside it
  const cw = nw * 0.7;
  apse(g, xm - cw / 2, xm + cw / 2, ny + nd, 0.36, nh * 0.9, nr * 0.85, { round: true });
  g.roofed(xm + cw / 2, ny + nd + 0.04, 0, 0.12, 0.18, 0.2, { h: 0.08, ridge: 'y', hip: 0.06 });

  // towers: three stages, the top one the belfry
  const cy = ny + t - 0.08;
  for (const cx of [nx + t, nx + nw - t]) {
    const z = [0, 0.38, 0.68, 0.92];
    for (let k = 0; k < 3; k++) {
      const tk = t - k * 0.006;
      g.box(cx - tk, cy - tk, z[k], 2 * tk, 2 * tk, z[k + 1] - z[k]);
      cornice(g, cx, cy, tk, z[k + 1] - 0.025, 0.014, 0.025);
    }
    g.detailed(1, () => {
      for (const [P, n] of towerFaces(cx, cy, t)) {
        if (n[1] === 1 || n[0] * (cx - xm) < 0) continue; // (not into the nave)
        archWindow(g, P, n, 0.05, 0.14, 0.28);
        archWindow(g, P, n, 0.05, 0.44, 0.6);
        archWindow(g, P, n, 0.06, 0.73, 0.88);
      }
    });
    // the helmet, in tin: a broad bell, a lantern, its cap
    const wasStone = g.stone;
    g.stone = true;
    const T = t + 0.01, zh = z[3];
    g.lathe(cx, cy, zh, [
      [T * 0.98, 0], [T * 1.12, T * 0.25], [T * 1.08, T * 0.6], [T * 0.8, T * 1.0], [T * 0.45, T * 1.3], [T * 0.3, T * 1.4],
    ], 8, { phase: 0.5 });
    g.lathe(cx, cy, zh + T * 1.4, [[T * 0.3, 0], [T * 0.3, T * 0.35], [T * 0.4, T * 0.4], [0, T * 0.7]], 8, { phase: 0.5 });
    g.stone = wasStone;
    cross(g, cx, cy, zh + T * 2.1, 0.03);
  }
  g.paint = paint;

  enclosure(g, wall, cy - t, { terrace: true });
  graveRows(g, nx, nx + nw, ny + nd + 0.4, grounds);
}

// A wall `h` high round the rectangle x0..x1, yf..yb, its corners rounded
// (r at the front, rb at the back), open in the front between xm ± gap.
function roundedWall(g, x0, x1, yf, yb, r, rb, xm, gap, h) {
  const arc = (cx, cy, rr, a0, a1) => Array.from({ length: 6 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / 5;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  });
  wallAlong(g, [
    [xm + gap, yf], ...arc(x1 - r, yf + r, r, Math.PI * 1.5, Math.PI * 2),
    ...arc(x1 - rb, yb - rb, rb, 0, Math.PI * 0.5), ...arc(x0 + rb, yb - rb, rb, Math.PI * 0.5, Math.PI),
    ...arc(x0 + r, yf + r, r, Math.PI, Math.PI * 1.5), [xm - gap, yf],
  ], h);
}

// A gateway in a churchyard wall at (x, y), `w` wide: piers, a round arch
// over the way through, and (roofed) a little tiled roof on top.
function gateway(g, x, y, w, h, opts = {}) {
  standing(g, [[x - w / 2 - 0.04, y - 0.025], [x + w / 2 + 0.04, y + 0.025]], () => gatewayHere(g, x, y, w, h, opts));
}

function gatewayHere(g, x, y, w, h, { roofed = false } = {}) {
  const d = 0.05, p = 0.04;
  g.box(x - w / 2 - p, y - d / 2, 0, p, d, h);
  g.box(x + w / 2, y - d / 2, 0, p, d, h);
  g.box(x - w / 2 - p, y - d / 2, h, w + 2 * p, d, 0.05);
  g.detailed(1, () => {
    const arc = Array.from({ length: 7 }, (_, i) => {
      const a = (i / 6) * Math.PI;
      return [x + Math.cos(a) * (w / 2), y - d / 2 - 0.001, h - w / 2 + Math.sin(a) * (w / 2) * 0.9];
    });
    g.line(arc, { facing: [0, -1, 0] });
  });
  if (roofed) g.roofed(x - w / 2 - p - 0.015, y - d / 2 - 0.015, h + 0.05, w + 2 * p + 0.03, d + 0.03, 0, { h: 0.05, ridge: 'x' });
}

// A buttress against a wall at (x, y), standing out along (ux, uy): one
// narrow block whose top slopes down away from the wall, from h at the
// wall to a little over half of it at its face.
function buttress(g, x, y, ux, uy, h, l = 0.04, w = 0.016) {
  const [vx, vy] = [-uy * w, ux * w];
  const at = (k, side) => [x - ux * 0.01 + ux * k * (l + 0.01) + side * vx, y - uy * 0.01 + uy * k * (l + 0.01) + side * vy];
  const foot = [at(0, -1), at(1, -1), at(1, 1), at(0, 1)];
  const [lo, hi] = [h * 0.62, h];
  g.prism(foot, 0, lo);
  const [p0, p1, p2, p3] = foot;
  g.face([[...p0, hi], [...p1, lo], [...p2, lo], [...p3, hi]]);
  // the sides under the slope, wound as the walls below them
  g.face([[...p0, lo], [...p1, lo], [...p0, hi]]);
  g.face([[...p2, lo], [...p3, lo], [...p3, hi]]);
}

// Buttresses round a chancel: one out from each corner of its end (as
// apse() returns the base).
function buttresses(g, base, h) {
  const end = base.slice(2);
  const cx = (base[0][0] + base[1][0]) / 2, cy = end[0][1] - (base[1][0] - base[0][0]) * 0.2;
  for (const [x, y] of end) {
    const [dx, dy] = [x - cx, y - cy], len = Math.hypot(dx, dy);
    buttress(g, x, y, dx / len, dy / len, h);
  }
}

// The nave's tall round-headed windows, `bays` along each long wall from
// y0 to y1, at x = xa and xb.
function sideWindows(g, xa, xb, y0, y1, bays, w, zb, zt) {
  g.detailed(1, () => {
    for (const [X, s] of [[xa, -1], [xb, 1]]) {
      const bay = (y1 - y0) / bays;
      for (let i = 0; i < bays; i++) {
        const yy = y0 + (i + 0.5) * bay;
        archWindow(g, (u, z) => [X, yy - u * s, z], [s, 0, 0], w, zb, zt);
      }
    }
  });
}

// A tower's helmet from z: a bulb (`bulb` of its half-width T wide, `rise`
// T tall), an open lantern and a small bulb with a spike, and the cross.
function helmet(g, x, y, z, T, { bulb = 1.12, rise = 1.4, lantern = 0.7 } = {}) {
  g.lathe(x, y, z, [
    [T * 0.98, 0], [T * bulb, rise * T * 0.22], [T * bulb * 0.95, rise * T * 0.52], [T * 0.7, rise * T * 0.8], [T * 0.36, rise * T * 0.97], [T * 0.28, rise * T],
  ], 8, { phase: 0.5 });
  const zl = z + rise * T, lh = lantern * T;
  g.lathe(x, y, zl, [[T * 0.28, 0], [T * 0.28, lh]], 8, { phase: 0.5 });
  g.detailed(1, () => {
    for (let j = 0; j < 8; j++) {
      const a = ((j + 1) / 8) * Math.PI * 2, r = T * 0.285;
      g.line([[x + Math.cos(a) * r, y + Math.sin(a) * r, zl + lh * 0.15], [x + Math.cos(a) * r, y + Math.sin(a) * r, zl + lh * 0.85]], { facing: [Math.cos(a), Math.sin(a), 0] });
    }
  });
  const zc = zl + lh;
  g.lathe(x, y, zc, [[T * 0.38, 0], [T * 0.18, T * 0.12], [T * 0.3, T * 0.34], [T * 0.24, T * 0.55], [T * 0.06, T * 0.76], [T * 0.04, T * 0.92], [0, T * 1.7]], 8, { phase: 0.5 });
  cross(g, x, y, zc + T * 1.7, 0.03);
}

// ----- the white village church with a red bulb (as at many a village in
// Bohemia): a tall plain tower at the front, its clock under the cornice and
// a window and a niche below, the bulb in red tiles with a lantern; a nave
// under red tiles, and an older gothic chancel, three-sided at its end;
// buttresses (one sloping-topped block each) round it and along the sides.
// The graves round it, no wall.
function bulbChurch(g, grounds, wall) {
  const paint = g.paint;
  g.paint = 2;
  const x = 0.5, t = 0.12, cy = t + 0.06, th = 0.8;
  const nw = 0.42, nx = x - nw / 2, ny = cy + t, nd = 0.56, nh = 0.34, nr = 0.3;
  g.roofed(nx, ny, 0, nw, nd, nh, { h: nr, ridge: 'y' });
  sideWindows(g, nx, nx + nw, ny, ny + nd, 3, 0.055, 0.1, 0.27);
  const cw = 0.34, base = apse(g, x - cw / 2, x + cw / 2, ny + nd, 0.32, nh * 0.96, nr * 0.95);
  buttresses(g, base, nh * 0.7);
  // and along the side walls: between the nave's windows, where the
  // chancel meets it
  for (const [X, sx] of [[nx, -1], [nx + nw, 1]]) {
    for (const k of [1, 2]) buttress(g, X, ny + (nd * k) / 3, sx, 0, nh * 0.7);
    buttress(g, x + sx * cw / 2, ny + nd + 0.03, sx, 0, nh * 0.66);
  }
  g.detailed(1, () => {
    for (const [X, s] of [[x - cw / 2, -1], [x + cw / 2, 1]]) archWindow(g, (u, z) => [X, ny + nd + 0.1 - u * s, z], [s, 0, 0], 0.045, 0.1, 0.27);
  });
  g.box(x - t, cy - t, 0, 2 * t, 2 * t, th);
  cornice(g, x, cy, t, th, 0.016, 0.03);
  g.detailed(1, () => {
    for (const [P, n] of towerFaces(x, cy, t)) {
      if (n[1] === 1) continue;
      ring(g, P, n, th - 0.06, 0.03); // the clock
      archWindow(g, P, n, 0.05, th - 0.26, th - 0.12);
      if (n[1] === -1) archWindow(g, P, n, 0.03, 0.34, 0.44); // the niche with its saint
    }
  });
  helmet(g, x, cy, th + 0.03, t + 0.02, { bulb: 1.18, rise: 1.5, lantern: 0.75 });
  door(g, x, cy - t, 0.07, 0.15);
  g.paint = paint;
  enclosure(g, wall, cy - t);
  graveRows(g, x - cw / 2 - 0.12, x + cw / 2 + 0.12, ny + nd + 0.44, grounds);
}

// ----- the old fieldstone church: a broad nave of rubble stone under a
// steep slate roof, gabled at both ends; a slim tower at the front with a
// round-headed belfry window on each face and a dark helmet, bulb and
// lantern. A walled churchyard with a white arched gateway, and a little
// charnel house (kostnice) inside by the wall.
function stoneChurch(g, grounds, wall) {
  const wasStone = g.stone;
  g.stone = true; // whitewashed masonry under slate (the Watercolour wash)
  const x = 0.5, t = 0.1, cy = t + 0.06, th = 0.66;
  const nw = 0.46, nx = x - nw / 2, ny = cy + t - 0.02, nd = 0.72, nh = 0.3, nr = 0.4;
  g.roofed(nx, ny, 0, nw, nd, nh, { h: nr, ridge: 'y' });
  sideWindows(g, nx, nx + nw, ny + 0.1, ny + nd, 3, 0.04, 0.1, 0.22);
  g.box(x - t, cy - t, 0, 2 * t, 2 * t, th);
  cornice(g, x, cy, t, th, 0.012, 0.025);
  g.detailed(1, () => {
    for (const [P, n] of towerFaces(x, cy, t)) {
      if (n[1] === 1) continue;
      archWindow(g, P, n, 0.045, th - 0.18, th - 0.06);
    }
  });
  helmet(g, x, cy, th + 0.025, t + 0.015, { bulb: 1.1, rise: 1.3, lantern: 0.8 });
  door(g, x, cy - t, 0.06, 0.14);
  // the charnel house in the front left corner (inside any wall)
  standing(g, [[-0.22, -0.22], [-0.02, -0.06]], () => g.roofed(-0.22, -0.22, 0, 0.2, 0.16, 0.13, { h: 0.1, ridge: 'x' }));
  g.stone = wasStone;
  enclosure(g, wall, cy - t);
  graveRows(g, nx - 0.04, nx + nw + 0.04, ny + nd + 0.14, grounds);
}

// ----- the small old church (Romanesque or early gothic, as on many a
// hill above a village): a short white tower before the front gable, a round-
// headed window high up, under a steep tiled pyramid, a ball and a cross
// on top; a nave under red tiles and a three-sided
// chancel. A churchyard wall with rounded corners round it, a roofed
// gateway with an arch and steps up to it.
function smallChurch(g, grounds, wall) {
  const paint = g.paint;
  g.paint = 2;
  // the tower stands whole in front of the nave, its back against the gable
  const x = 0.5, t = 0.12, cy = t + 0.06, th = 0.6, rh = 0.4;
  const nw = 0.42, nx = x - nw / 2, ny = cy + t, nd = 0.5, nh = 0.3, nr = 0.32;
  g.roofed(nx, ny, 0, nw, nd, nh, { h: nr, ridge: 'y' });
  sideWindows(g, nx, nx + nw, ny, ny + nd, 2, 0.045, 0.1, 0.24);
  const cw = 0.32;
  apse(g, x - cw / 2, x + cw / 2, ny + nd, 0.26, nh * 0.95, nr * 0.9);
  g.box(x - t, cy - t, 0, 2 * t, 2 * t, th);
  g.detailed(1, () => {
    const [P, n] = towerFaces(x, cy, t)[0];
    archWindow(g, P, n, 0.06, th - 0.2, th - 0.06);
    for (const [Q, m] of towerFaces(x, cy, t).slice(1)) if (m[1] !== 1) archWindow(g, Q, m, 0.04, th - 0.16, th - 0.06);
  });
  // the steep pyramid roof, tiled like the nave's
  g.roofed(x - t, cy - t, th, 2 * t, 2 * t, 0, { h: rh, hip: t });
  g.detailed(1, () => g.lathe(x, cy, th + rh, [[0, 0], [0.018, 0.012], [0.018, 0.026], [0, 0.038]], 6));
  cross(g, x, cy, th + rh + 0.04, 0.03);
  door(g, x, cy - t, 0.07, 0.15);
  g.paint = paint;
  enclosure(g, wall, cy - t);
  graveRows(g, x - cw / 2 - 0.1, x + cw / 2 + 0.1, ny + nd + 0.36, grounds);
}

// A church's switch (church.switches): the player's choice, else what its
// kind starts with.
function switchOf(def, s, key, kind) {
  const sw = def.switches[key];
  return sw.values.includes(s.data?.[key]) ? s.data[key] : sw.start(kind);
}

// What encloses a church (2×2) whose door is at y = door, x = 0.5, and the
// path up to it from the street:
//   none      only the path
//   straight  a low wall with square corners, a whitewashed arched gateway
//   rounded   a wall with rounded corners, a gateway with a little tiled
//             roof and two steps up to it – or (terrace, the big church)
//             a taller retaining wall, three steps up through it
//   fence     a picket fence, a pier either side of the way in
function enclosure(g, wall, door, { terrace = false } = {}) {
  const [x0, y0, x1, y1, xm] = [-0.36, -0.3, 1.36, 1.38, 0.5];
  let w = 0.04; // half the way in
  // steps up to the way in, outside it: k-th from the wall `d` deep
  const steps = (n, x, ww, d, h0, dh) => {
    for (let k = 0; k < n; k++) {
      const yk = y0 - d * (k + 1);
      standing(g, [[x - ww, yk], [x + ww, yk + d]], () => g.box(x - ww, yk, 0, 2 * ww, d, h0 - k * dh));
    }
  };
  if (wall === 'straight') {
    wallAlong(g, [[xm - 0.06, y0], [x0, y0], [x0, y1], [x1, y1], [x1, y0], [xm + 0.06, y0]], 0.08, 0.03);
    gateway(g, xm, y0 - 0.015, 0.1, 0.17);
  } else if (wall === 'rounded' && terrace) {
    w = 0.08;
    roundedWall(g, x0 + 0.04, x1 - 0.04, y0, y1 - 0.02, 0.36, 0.2, xm, w, 0.1);
    steps(3, xm, w, 0.03, 0.08, 0.025);
  } else if (wall === 'rounded') {
    w = 0.07;
    roundedWall(g, x0, x1, y0, y1, 0.32, 0.16, xm, w + 0.04, 0.1); // (round the graves)
    gateway(g, xm, y0, 2 * w, 0.16, { roofed: true });
    steps(2, xm, w + 0.02, 0.035, 0.05, 0.025);
  } else if (wall === 'fence') {
    const yf = y0 - 0.01, pts = [[xm - 0.07, yf], [x0, yf], [x0, y1], [x1, y1], [x1, yf], [xm + 0.07, yf]];
    // in pieces, each at its own ground (three points: a run fenceAlong draws)
    for (let i = 0; i + 1 < pts.length; i++) {
      const [[ax, ay], [bx, by]] = [pts[i], pts[i + 1]];
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 0.12));
      for (let k = 0; k < n; k++) {
        const at = (t) => [ax + (bx - ax) * t, ay + (by - ay) * t];
        const [p, m, q] = [at(k / n), at((k + 0.5) / n), at((k + 1) / n)];
        standing(g, [p, q], () => fenceAlong(g, [p, m, q], 0.06));
      }
    }
    for (const x of [xm - 0.07, xm + 0.07]) standing(g, [[x - 0.015, yf - 0.015], [x + 0.015, yf + 0.015]], () => g.box(x - 0.015, yf - 0.015, 0, 0.03, 0.03, 0.1));
  }
  g.groundLine([[xm - w, y0], [xm - 0.04, door]], { lod: 1 });
  g.groundLine([[xm + w, y0], [xm + 0.04, door]], { lod: 1 });
}

// Graves round a church (2×2) standing between x = a and b and ending at
// y = back: 'graves' in rows down both sides and behind it, 'few' a short
// row or two at the back of each side, 'none' none.
function graveRows(g, a, b, back, grounds) {
  const [x0, y0, x1, y1] = [-0.36, -0.3, 1.36, 1.38];
  if (grounds === 'none') return;
  const from = grounds === 'few' ? y1 - 0.36 : y0 + 0.28;
  graves(g, x0 + 0.08, a - 0.08, from, y1 - 0.06);
  graves(g, b + 0.08, x1 - 0.06, from, y1 - 0.06);
  if (grounds === 'graves' && back < y1 - 0.2) graves(g, a, b, back, y1 - 0.06);
}

// ----- town halls, in three sizes -----
// Small 1×1 (a little town's hall with a turret on the ridge), Medium 2×1
// (an arcaded hall on the square with its clock tower) and Large 3×2 (the
// big hall of a royal town round a courtyard). One Build tool, S switches.

// Arcade (podloubí) along the front wall at depth y from a to b: round
// arches about 0.14 apart, fh * 0.85 high at the crown.
function arcade(g, a, b, y, fh) {
  const n = Math.max(1, Math.round((b - a) / 0.14));
  for (let i = 0; i < n; i++) {
    const xa = a + ((b - a) * i) / n + 0.025, xb = a + ((b - a) * (i + 1)) / n - 0.025;
    g.line([[xa, y, 0], [xa, y, fh * 0.6], [(xa + xb) / 2, y, fh * 0.85], [xb, y, fh * 0.6], [xb, y, 0]], { facing: FRONT });
  }
}

// Clock tower standing on the ground at (x, y), half-width t, th to the
// gallery; then an onion or a gothic spire. Returns the top of the crown.
function clockTower(g, x, y, t, th, fh, crown = g.pick(['onion', 'spire'])) {
  g.box(x - t, y - t, 0, 2 * t, 2 * t, th);
  g.floors(x - t, y - t, 2 * t, 2 * t, 0, th, fh, { inset: 0 });
  g.windows(x - t, y - t, 2 * t, 2 * t, fh, th - 0.2, fh, t, { w: 0.35, h: 0.5 });
  clockFaces(g, x, y, t, th - 0.1, t * 0.45);
  g.box(x - t - 0.02, y - t - 0.02, th, 2 * t + 0.04, 2 * t + 0.04, 0.02); // gallery
  const lt = t * 0.72;
  g.box(x - lt, y - lt, th + 0.02, 2 * lt, 2 * lt, 0.1);                 // lantern storey
  g.windows(x - lt, y - lt, 2 * lt, 2 * lt, th + 0.02, th + 0.12, 0.1, lt, { w: 0.4, h: 0.6 });
  if (crown === 'onion') onion(g, x, y, th + 0.12, lt);
  else spire(g, x, y, th + 0.12, lt, 0.3 + t);
}

// Renaissance attic: a wall standing above the eaves along the front
// (x from a to b at depth y, from z up), its top a row of round crenels –
// the parapet that hides the roof behind it (Slavonice, Litomyšl).
function attic(g, a, b, y, z, h) {
  const n = Math.max(2, Math.round((b - a) / 0.12)), pts = [[a, y, z]];
  for (let i = 0; i < n; i++) {
    const xa = a + ((b - a) * i) / n, xb = a + ((b - a) * (i + 1)) / n, xm = (xa + xb) / 2, w = (xb - xa) / 2;
    pts.push([xa, y, z + h * 0.7]);
    for (let k = 0; k <= 4; k++) {
      const ang = Math.PI - (k / 4) * Math.PI;
      pts.push([xm + Math.cos(ang) * w, y, z + h * 0.7 + Math.sin(ang) * h * 0.3]);
    }
  }
  pts.push([b, y, z + h * 0.7], [b, y, z]);
  g.solid((a + b) / 2, y, z + h / 2);
  g.face(outward(pts, [(a + b) / 2, y + 0.01, z + h / 2]));
  g.face(outward(pts.map(([px, , pz]) => [px, y + 0.02, pz]), [(a + b) / 2, y + 0.01, z + h / 2]));
  g.detailed(2, () => g.line([[a, y, z + h * 0.35], [b, y, z + h * 0.35]], { facing: FRONT }));
}

// A portal: a stone frame round the door, a balcony slab above it.
function portal(g, x, y, fh) {
  panel(g, x - 0.06, x + 0.06, y, 0, fh * 0.9);
  door(g, x, y, 0.06, fh * 0.75);
  g.box(x - 0.08, y - 0.05, fh * 1.05, 0.16, 0.05, 0.015);
}

const townHallCommon = {
  ...common,
  name: 'Town hall',
  blurb: 'Old town hall',
  tags: ['heritage', 'town-hall'],
  plot: { props: 'green', boundary: 0.2, kinds: ['hedge'], density: 0.2 },
};

export const townHallSmall = {
  ...townHallCommon,
  id: 'town-hall-small',
  size: 'Small',
  footprint: [[0, 0]],
  stats: { jobs: 4 },
  agents: 1,
  yards: ['plaza', 'trees'],
  draw(g) {
    const fh = 0.14, h = fh * 2, w = g.range(0.5, 0.56), d = 0.4, x0 = -w / 2, y = -0.2;
    if (g.chance(0.5)) {
      // hipped roof with a clock turret and a small onion on the ridge
      const r = 0.16;
      g.roofed(x0, y, 0, w, d, h, { h: r, hip: 0.12 });
      g.windows(x0, y, w, d, 0, h, fh, 0.09, { from: 1 });
      g.box(-0.04, -0.04, h + r * 0.7, 0.08, 0.08, 0.1);
      clockFaces(g, 0, 0, 0.04, h + r * 0.7 + 0.06, 0.022);
      onion(g, 0, 0, h + r * 0.7 + 0.1, 0.04);
    } else {
      // baroque gable to the street with the clock in it, a little bell turret
      const r = 0.24;
      g.roofed(x0 + 0.06, y, 0, w - 0.12, d, h, { h: r, ridge: 'y' });
      g.windows(x0 + 0.06, y, w - 0.12, d, 0, h, fh, 0.09, { from: 1 });
      clockFaces(g, 0, y + 0.04, 0.04, h + r * 0.4, 0.035);
      g.line([[x0 + 0.06, y, h], [x0 + 0.03, y, h + 0.04], [x0 + 0.08, y, h + 0.1]], { facing: FRONT });
      g.line([[w / 2 - 0.06, y, h], [w / 2 - 0.03, y, h + 0.04], [w / 2 - 0.08, y, h + 0.1]], { facing: FRONT });
      g.box(-0.03, y + d - 0.12, h + r * 0.7, 0.06, 0.06, 0.07);
      onion(g, 0, y + d - 0.09, h + r * 0.7 + 0.07, 0.035);
    }
    portal(g, 0, y, fh);
  },
};

export const townHall = {
  ...townHallCommon,
  id: 'town-hall',
  size: 'Medium',
  footprint: [[0, 0], [1, 0]],
  stats: { jobs: 8 },
  agents: 2,
  yards: ['plaza'],
  kinds: ['centre', 'corner', 'attic'],
  draw(g, s) {
    const kind = kindOf(g, s, this.kinds);
    const fh = 0.15, d = 0.5, y0 = -0.32;
    if (kind === 'attic') {
      // renaissance hall: an arcade, sgraffito storeys, the attic on top
      const h = fh * 3, x0 = -0.34, x1 = 1.34;
      g.roofed(x0, y0, 0, x1 - x0, d, h, { h: 0.14, hip: 0.12 });
      g.windows(x0, y0, x1 - x0, d, 0, h, fh, 0.1, { from: 1, h: 0.5 });
      g.floors(x0, y0, x1 - x0, d, fh, h, fh, { skip: ['back'] });
      arcade(g, x0 + 0.02, x1 - 0.02, y0, fh);
      attic(g, x0, x1, y0, h, 0.16);
      return;
    }
    // wings either side of (or beside) the clock tower, an arcade under them
    const t = 0.12, tx = kind === 'centre' ? 0.5 : 1.34 - t, ty = y0 + t;
    const h = fh * g.int(2, 3);
    const wings = kind === 'centre' ? [[-0.34, tx - t], [tx + t, 1.34]] : [[-0.34, tx - t]];
    for (const [a, b] of wings) {
      const left = a < 0, hip = kind === 'centre' ? (left ? [0.14, 0] : [0, 0.14]) : [0.14, 0];
      g.roofed(a, y0, 0, b - a, d, h, { h: 0.19, hip });
      g.windows(a, y0, b - a, d, 0, h, fh, 0.09, { from: 1, skip: [kind === 'centre' && !left ? 'left' : 'right'] });
      arcade(g, a + 0.02, b - 0.02, y0, fh);
    }
    clockTower(g, tx, ty, t, h + 0.4, fh);
  },
};

export const townHallLarge = {
  ...townHallCommon,
  id: 'town-hall-large',
  size: 'Large',
  // 3×2: local x from about -0.4 to 2.4, y from -0.4 to 1.4
  footprint: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  stats: { jobs: 16 },
  agents: 3,
  yards: ['plaza'],
  draw(g) {
    // the front range with its arcade, the tall clock tower in the
    // middle (or off to one side), side ranges round a courtyard with
    // a fountain, the back range closing it
    const fh = 0.15, h = fh * 3, d = 0.52, y0 = -0.34, t = 0.15;
    const tx = g.pick([1.0, 1.0, 0.45, 1.55]), ty = y0 + t;
    const roofH = 0.22;
    for (const [a, b] of [[-0.34, tx - t], [tx + t, 2.34]]) {
      if (b - a < 0.1) continue;
      const hip = [a < 0 ? 0.16 : 0, b > 2.3 ? 0.16 : 0];
      g.roofed(a, y0, 0, b - a, d, h, { h: roofH, hip });
      g.windows(a, y0, b - a, d, 0, h, fh, 0.1, { from: 1, skip: [a > 0 && 'left', b < 2.3 && 'right'].filter(Boolean) });
      arcade(g, a + 0.02, b - 0.02, y0, fh);
    }
    clockTower(g, tx, ty, t, h + 0.6, fh);
    // oriel on the corner
    g.box(2.2, y0 - 0.06, fh * 1.2, 0.12, 0.06, fh * 1.6);
    // side and back ranges, lower, round the courtyard
    const yb = y0 + d + 0.06, fh2 = fh * 2;
    g.roofed(-0.34, yb, 0, 0.42, 1.36 - yb, fh2, { h: 0.16, ridge: 'y', hip: [0, 0.12] });
    g.windows(-0.34, yb, 0.42, 1.36 - yb, 0, fh2, fh, 0.1);
    g.roofed(1.92, yb, 0, 0.42, 1.36 - yb, fh2, { h: 0.16, ridge: 'y', hip: [0, 0.12] });
    g.windows(1.92, yb, 0.42, 1.36 - yb, 0, fh2, fh, 0.1);
    g.roofed(0.14, 1.02, 0, 1.72, 0.34, fh2, { h: 0.15 });
    g.windows(0.14, 1.02, 1.72, 0.34, 0, fh2, fh, 0.1, { skip: ['left', 'right'] });
    fountain(g, 1.0, 0.62, 0.09);
    for (const x of [0.4, 1.6]) tree(g, x, 0.68, 0.9);
  },
};

// ----- memorials, castles -----


// A tank on its plinth top at z, gun pointing along -x and up a little.
function tankOn(g, x, y, z) {
  g.box(x - 0.12, y - 0.055, z, 0.24, 0.11, 0.035);            // tracks and hull
  g.box(x - 0.1, y - 0.045, z + 0.035, 0.2, 0.09, 0.025);
  g.cylinder(x + 0.01, y, z + 0.06, 0.04, 0.03, 8);            // turret
  g.detailed(1, () => g.line([[x - 0.03, y, z + 0.075], [x - 0.17, y, z + 0.09]], { width: 2 }));
}

export const memorial = {
  ...common,
  id: 'memorial',
  name: 'Memorial',
  blurb: 'Stone memorial',
  numbered: false,
  footprint: [[0, 0]],
  plot: { props: 'green', boundary: 0, density: 0.3 },
  stats: {},
  agents: 0,
  yards: ['plaza', 'trees'],
  kinds: ['soldier', 'tank', 'pylon', 'group', 'equestrian', 'partisan'],
  draw(g, s) {
    const kind = kindOf(g, s, this.kinds);
    if (kind === 'group' || kind === 'equestrian' || kind === 'partisan') {
      // a statue on a big stepped pedestal in a paved square: a worker
      // and farm woman raising hammer and sheaf, a rider (a Hussite
      // captain, a legionnaire), or a partisan with a flag
      paving(g, [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], 0.1, { lod: 1 });
      g.box(-0.22, -0.16, 0, 0.44, 0.32, 0.025);
      statue(g, 0, 0, { group: 'pair', equestrian: 'equestrian', partisan: 'flag' }[kind], 1.5);
      for (const x of [-0.3, 0.3]) flowerBed(g, x, 0.25, 0.05);
      return;
    }
    if (kind === 'tank') {
      // liberation memorial: a tank on a tall plinth, flowers below
      g.box(-0.24, -0.14, 0, 0.48, 0.28, 0.03);
      g.box(-0.18, -0.09, 0.03, 0.36, 0.18, 0.2);
      panel(g, -0.1, 0.1, -0.09, 0.07, 0.15);
      tankOn(g, 0, 0, 0.23);
      flowerBed(g, -0.2, -0.26, 0.05);
      flowerBed(g, 0.2, -0.26, 0.05);
      return;
    }
    if (kind === 'pylon') {
      // 50s memorial: a tapering pylon with a star, an eternal flame, two flags
      g.box(-0.22, -0.22, 0, 0.44, 0.44, 0.025);
      g.box(-0.15, -0.15, 0.025, 0.3, 0.3, 0.025);
      g.lathe(0, 0.03, 0.05, [[0.07, 0], [0.035, 0.62], [0, 0.66]], 4, { phase: 0.5 });
      star(g, 0, 0.03, 0.78, 0.05);
      g.lathe(0, -0.1, 0.05, [[0.012, 0], [0.012, 0.03], [0.03, 0.05], [0.03, 0.055]], 6); // flame bowl
      flagpole(g, -0.28, -0.1, 0.42);
      flagpole(g, 0.28, -0.1, 0.42);
      return;
    }
    // WWI memorial: a soldier on a stone pedestal inside a chain fence
    g.box(-0.15, -0.15, 0, 0.3, 0.3, 0.03);
    g.box(-0.08, -0.08, 0.03, 0.16, 0.16, 0.22);
    panel(g, -0.05, 0.05, -0.08, 0.08, 0.18);
    figure(g, 0, 0, 0.25, 0.17, 'soldier');
    g.detailed(2, () => {
      const c = 0.2, pts = [[-c, -c], [c, -c], [c, c], [-c, c], [-c, -c]];
      g.solid(0, -c, 0.02);
      for (const [px, py] of pts.slice(0, 4)) g.line([[px, py, 0], [px, py, 0.05]]);
      for (let i = 0; i < 4; i++) {
        const [a, b] = [pts[i], pts[i + 1]];
        g.line([[a[0], a[1], 0.045], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.03], [b[0], b[1], 0.045]]);
      }
    });
    for (const [x, y] of [[-0.28, 0.26], [0.28, 0.26]]) tree(g, x, y, 0.8, 'spruce');
  },
};

// Curtain wall with battlements between two points on one axis, d thick,
// built in short pieces so each sorts in depth with what stands beside it.
function curtain(g, [x0, y0], [x1, y1], h, d = 0.07) {
  const alongX = y0 === y1, len = alongX ? x1 - x0 : y1 - y0;
  const n = Math.max(1, Math.round(Math.abs(len) / 0.3));
  for (let i = 0; i < n; i++) {
    const a = (alongX ? x0 : y0) + (len * i) / n, b = a + len / n;
    const [u0, u1] = [Math.min(a, b), Math.max(a, b)];
    const box = (v0, v1, z, hh) => (alongX
      ? g.box(v0, y0 - d / 2, z, v1 - v0, d, hh)
      : g.box(x0 - d / 2, v0, z, d, v1 - v0, hh));
    box(u0, u1, 0, h);
    // battlements: a notched parapet on both faces of the wall, merlons
    // and gaps about 0.035 wide, part of the same piece
    g.detailed(1, () => {
      const m = Math.max(3, Math.round((u1 - u0) / 0.035) | 1), c = 0.03;
      const prof = [[u0, h]];
      for (let k = 0; k < m; k++) {
        const za = k % 2 ? h : h + c, t0 = u0 + ((u1 - u0) * k) / m, t1 = u0 + ((u1 - u0) * (k + 1)) / m;
        prof.push([t0, za], [t1, za]);
      }
      prof.push([u1, h]);
      for (const side of [-1, 1]) {
        const pts = prof.map(([u, z]) => (alongX ? [u, y0 + (side * d) / 2, z] : [x0 + (side * d) / 2, u, z]));
        const c3 = alongX ? [(u0 + u1) / 2, y0, h] : [x0, (u0 + u1) / 2, h];
        g.face(outward(pts, c3));
      }
    });
  }
}

// Round tower (a castle keep): a smooth shaft on a battered plinth, rows
// of small windows, and on top either a corbelled parapet under a hatched
// cone roof ('cone'), battlements ('crenel') or broken masonry ('broken').
// Returns the height of its walls.
function roundTower(g, x, y, r, h, roof = 'cone') {
  // a broken keep: the shaft stops lower, its ragged crown rises from there
  const hs = roof === 'broken' ? h - 0.14 : h;
  g.lathe(x, y, 0, [[r * 1.08, 0], [r, 0.08], [r, hs]], 24, { smooth: true, rings: [1] });
  g.detailed(1, () => roundWindows(g, x, y, r, 0.22, hs - (hs < h ? 0.04 : 0.1), 0.18, 5, { phase: g.random() }));
  if (roof === 'broken') {
    brokenCrown(g, x, y, r, hs);
    return h;
  }
  // corbelled parapet, a little wider than the shaft
  const R = r * 1.14;
  g.lathe(x, y, h, [[r, 0], [R, 0.035], [R, 0.1]], 24, { smooth: true, rings: [1] });
  if (roof === 'cone') {
    g.lathe(x, y, h + 0.1, [[R * 1.1, 0], [R * 0.86, 0.05], [0, r * 2.7]], 24, { smooth: true, hatch: [0, 1] });
    g.detailed(1, () => g.line([[x, y, h + 0.1 + r * 2.7], [x, y, h + 0.1 + r * 2.7 + 0.06]], FRAME));
  } else {
    g.detailed(2, () => {
      for (let i = 0; i < 12; i += 2) {
        const a = (i / 12) * Math.PI * 2, s = 0.032;
        g.box(x + Math.cos(a) * R * 0.88 - s / 2, y + Math.sin(a) * R * 0.88 - s / 2, h + 0.1, s, s, 0.03);
      }
    });
  }
  return h;
}

// A stretch of ruined wall from a to b (2D, along x or y), d thick: one
// solid whose top runs ragged, highest (hmax) in the middle and crumbling
// down to stumps at both ends.
function ruinWall(g, a, b, hmax, d = 0.07) {
  const alongX = Math.abs(b[1] - a[1]) < 1e-9;
  const [u0, u1] = alongX ? [Math.min(a[0], b[0]), Math.max(a[0], b[0])] : [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  const v = alongX ? a[1] : a[0];
  if (u1 - u0 < 0.08) return;
  // masonry breaks in courses: the top steps up and down in whole courses
  // (a random walk), full height along the middle, falling away steeply
  // at the ends; each step is a flat run then a vertical drop
  const n = Math.max(3, Math.round((u1 - u0) / 0.07)), course = 0.03;
  const prof = [];
  let walk = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, reach = Math.min(1, 2.6 * Math.sin(Math.PI * t));
    walk = Math.max(-0.3, Math.min(0, walk + g.range(-0.15, 0.15)));
    const h = Math.max(course, Math.round((hmax * reach * (1 + walk)) / course) * course);
    const ua = u0 + ((u1 - u0) * i) / n, ub = u0 + ((u1 - u0) * (i + 1)) / n;
    prof.push([ua, h], [ub, h]);
  }
  const P = (u, side, z) => (alongX ? [u, v + (side * d) / 2, z] : [v + (side * d) / 2, u, z]);
  const c = alongX ? [(u0 + u1) / 2, v, hmax / 3] : [v, (u0 + u1) / 2, hmax / 3];
  g.solid(...c);
  for (const side of [-1, 1]) {
    g.face(outward([P(u0, side, 0), P(u1, side, 0), ...prof.slice().reverse().map(([u, z]) => P(u, side, z))], c));
  }
  // tops of the runs, the risers between them, the two ends
  for (let i = 0; i < prof.length - 1; i++) {
    const [[ua, za], [ub, zb]] = [prof[i], prof[i + 1]];
    if (ua === ub && za === zb) continue;
    if (ua === ub) g.face(outward([P(ua, -1, Math.min(za, zb)), P(ua, 1, Math.min(za, zb)), P(ua, 1, Math.max(za, zb)), P(ua, -1, Math.max(za, zb))], c));
    else g.face(outward([P(ua, -1, za), P(ub, -1, zb), P(ub, 1, zb), P(ua, 1, za)], c));
  }
  for (const [u, z] of [prof[0], prof[prof.length - 1]]) g.face(outward([P(u, -1, 0), P(u, 1, 0), P(u, 1, z), P(u, -1, z)], c));
}

// The broken top of a round tower from h0 up: its wall (0.035 thick)
// breaks off unevenly, in whole courses, with a breach or two, and the
// inside of the far wall shows through. Faces fill without outlines; the
// edges are drawn so only the true outline and the steps show.
function brokenCrown(g, x, y, r, h0) {
  const n = 20, t = 0.035, course = 0.03, ri = r - t;
  const tops = [];
  let walk = g.range(0.1, 0.2);
  const breaches = [g.int(0, n - 1), g.chance(0.5) ? g.int(0, n - 1) : -1];
  for (let j = 0; j < n; j++) {
    walk = Math.max(0.03, Math.min(0.27, walk + g.range(-0.05, 0.05)));
    const breach = breaches.some((b) => b >= 0 && Math.min(Math.abs(j - b), n - Math.abs(j - b)) <= 1);
    tops.push(h0 + (breach ? 0 : Math.round(walk / course) * course));
  }
  const ang = (j) => (j / n) * Math.PI * 2;
  const at = (rad, j, z) => [x + Math.cos(ang(j)) * rad, y + Math.sin(ang(j)) * rad, z];
  const fill = { stroke: 'none' };
  const pen = { stroke: 'main', width: 1.2 };
  const out = [], inn = [];
  g.solid(x, y, h0 + 0.1);
  for (let j = 0; j < n; j++) {
    const m = ang(j + 0.5), z = tops[j];
    out.push(g.facing([Math.cos(m), Math.sin(m), 0]));
    inn.push(g.facing([-Math.cos(m), -Math.sin(m), 0]));
    if (z <= h0) continue;
    g.face([at(r, j, h0), at(r, j + 1, h0), at(r, j + 1, z), at(r, j, z)], fill);          // outside
    g.face([at(ri, j + 1, h0), at(ri, j, h0), at(ri, j, z), at(ri, j + 1, z)], fill);      // inside
    g.face([at(ri, j, z), at(r, j, z), at(r, j + 1, z), at(ri, j + 1, z)], fill);          // top
  }
  for (let j = 0; j < n; j++) {
    const z = tops[j], k = (j + 1) % n, zk = tops[k];
    // top edges of this piece: the outer one on the near side, the inner
    // one on the far side
    if (z > h0) {
      if (out[j]) g.line([at(r, j, z), at(r, j + 1, z)], pen);
      if (inn[j]) g.line([at(ri, j, z), at(ri, j + 1, z)], pen);
    }
    // the step down to the next piece (a riser across the wall)
    if (z !== zk) {
      const [lo, hi] = [Math.min(z, zk), Math.max(z, zk)];
      if (out[j] || out[k]) g.line([at(r, j + 1, lo), at(r, j + 1, hi)], pen);
      else g.line([at(ri, j + 1, lo), at(ri, j + 1, hi)], pen);
      g.line([at(ri, j + 1, hi), at(r, j + 1, hi)], pen);
    }
    // the outline where the near side turns away
    if (out[j] !== out[k] && Math.max(z, zk) > h0) g.line([at(r, j + 1, h0), at(r, j + 1, out[j] ? z : zk)], pen);
  }
}

// Arrow slits on the front of a wall at depth y.
function slits(g, x0, x1, y, z) {
  g.detailed(2, () => {
    for (let x = x0 + 0.06; x < x1 - 0.03; x += 0.12) g.line([[x, y, z], [x, y, z + 0.05]], { facing: [0, -1, 0] });
  });
}

export const castle = {
  ...common,
  id: 'castle',
  name: 'Castle',
  blurb: 'Ruin, castle or chateau',
  size: 'Large',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  plot: { props: 'green', boundary: 0.2, kinds: ['hedge'], density: 0.45 },
  stats: { jobs: 3 },
  agents: 1,
  yards: ['trees'],
  kinds: ['ruin', 'castle', 'chateau'],
  draw(g, s) {
    const kind = kindOf(g, s, this.kinds);
    if (kind === 'chateau') {
      // baroque chateau: a main wing and two side wings round a court
      // of honour, a clock turret, a gate and a fountain in the court
      const fh = 0.14, h = fh * 2;
      // The side wings run the full depth and the main block sits
      // between them: the painter sorts solids by their middle, so
      // pieces that meet must be side by side across the join, not in
      // an L, or a hidden wall gets drawn in front.
      const roof = { h: 0.1, mansard: { h: 0.08, inset: 0.05 } };
      for (const x of [-0.32, 1.0]) {
        g.roofed(x, 0.0, 0, 0.32, 1.12, h, { ...roof, ridge: 'y', hip: 0.1 });
        g.windows(x, 0.0, 0.32, 1.12, 0, h, fh, 0.1);
      }
      g.roofed(0, 0.72, 0, 1.0, 0.4, h, { ...roof, hip: 0 });
      g.windows(0, 0.72, 1.0, 0.4, 0, h, fh, 0.1, { skip: ['left', 'right'] });
      g.box(0.4, 0.66, 0, 0.2, 0.06, h + 0.06); // central risalit
      door(g, 0.5, 0.66, 0.08, 0.13);
      g.box(0.45, 0.87, h + 0.14, 0.1, 0.1, 0.1); // clock turret on the ridge
      onion(g, 0.5, 0.92, h + 0.24, 0.05);
      fountain(g, 0.5, 0.3, 0.07);
      for (const x of [0.28, 0.72]) g.box(x - 0.03, -0.34, 0, 0.06, 0.06, 0.16); // gate piers
      return;
    }
    if (kind === 'castle') {
      // gothic castle: the palace across the back, a round keep with a
      // cone roof beside it, curtain walls round the court and a gate
      // tower in the front wall. Nothing overlaps, so it sorts cleanly.
      const mirror = g.chance(0.5), M = (x) => (mirror ? 1 - x : x);
      const [pa, pb] = [M(-0.3), M(0.85)].sort((p, q) => p - q);
      g.roofed(pa, 0.78, 0, pb - pa, 0.52, 0.42, { h: 0.24, hip: 0.12 });
      g.windows(pa, 0.78, pb - pa, 0.52, 0.14, 0.42, 0.14, 0.12);
      roundTower(g, M(1.08), 1.04, 0.16, 0.95, 'cone');
      curtain(g, [-0.34, -0.3], [0.36, -0.3], 0.26);
      curtain(g, [0.64, -0.3], [1.34, -0.3], 0.26);
      slits(g, -0.34, 0.36, -0.335, 0.12);
      slits(g, 0.64, 1.34, -0.335, 0.12);
      curtain(g, [M(-0.34), -0.265], [M(-0.34), 0.78], 0.26);
      curtain(g, [M(1.34), -0.265], [M(1.34), 0.86], 0.26);
      g.box(0.36, -0.42, 0, 0.28, 0.26, 0.5);
      g.windows(0.36, -0.42, 0.28, 0.26, 0.24, 0.5, 0.13, 0.09, { w: 0.35, h: 0.55 });
      g.line([[0.44, -0.42, 0], [0.44, -0.42, 0.14], [0.5, -0.42, 0.19], [0.56, -0.42, 0.14], [0.56, -0.42, 0]], { facing: [0, -1, 0], lod: 1 });
      g.roofed(0.36, -0.42, 0.5, 0.28, 0.26, 0, { h: 0.14, hip: 0.13 });
      return;
    }
    // ruin: a keep with a broken top, a curtain wall crumbling to
    // stumps and gaps, the roofless palace with one gable standing
    roundTower(g, 1.0, 0.95, 0.18, g.range(0.65, 0.8), 'broken');
    // what is left of the curtain wall: a stretch or two on each side,
    // each one piece with a ragged top crumbling down at its ends, gaps
    // between them with fallen stones
    const ring = [[-0.34, -0.3], [1.34, -0.3], [1.34, 1.3], [-0.34, 1.3], [-0.34, -0.3]];
    for (let i = 0; i < 4; i++) {
      const [a, b] = [ring[i], ring[i + 1]];
      const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const spans = g.chance(0.5)
        ? [[g.range(0, 0.25), g.range(0.55, 1)]]
        : [[g.range(0, 0.12), g.range(0.3, 0.45)], [g.range(0.58, 0.7), g.range(0.88, 1)]];
      for (const [t0, t1] of spans) ruinWall(g, at(t0), at(t1), g.range(0.22, 0.34));
      for (let k = 0; k < spans.length; k++) {
        const gap = k + 1 < spans.length ? (spans[k][1] + spans[k + 1][0]) / 2 : spans[k][1] < 0.9 ? (spans[k][1] + 1) / 2 : null;
        if (gap !== null) heap(g, ...at(gap), 0.05);
      }
    }
    // roofless palace: walls with window holes, gable standing (the end
    // wall one face from the ground to its peak, its top sloping off)
    g.box(-0.2, 0.55, 0, 0.7, 0.07, 0.36, { gables: { 0: { peak: 0.52 }, 2: { peak: 0.52 } } });
    g.windows(-0.2, 0.55, 0.7, 0.07, 0.12, 0.36, 0.12, 0.14, { skip: ['left', 'right', 'back'] });
    for (const x of [-0.2, 0.5]) g.face(outward([[x, 0.55, 0.36], [0.15, 0.55, 0.52], [0.15, 0.62, 0.52], [x, 0.62, 0.36]], [0.15, 0.585, 0.4]));
    g.box(-0.2, 0.62, 0, 0.07, 0.4, 0.28);
    heap(g, 0.5, 0.2, 0.08);
    heap(g, 1.2, 0.2, 0.06);
    tree(g, 0.25, 0.95, 1, 'spreading');
    tree(g, 1.25, 0.45, 0.9);
  },
};

// What is left of a small castle on one dot (Kozí Hrádek, Šelmberk): the
// round keep with its top broken off and a stump of the curtain wall
// ('keep'), or one gable of the palace standing with its window holes,
// a crumbling wall behind it ('gable'). Fallen stones and a tree or two.
export const castleSmall = {
  ...castle,
  id: 'castle-small',
  size: 'Small',
  footprint: [[0, 0]],
  plot: { props: 'green', boundary: 0, density: 0.4 },
  stats: {},
  agents: 0,
  kinds: ['keep', 'gable'],
  draw(g, s) {
    const kind = kindOf(g, s, this.kinds);
    const mirror = g.chance(0.5), M = (x) => (mirror ? -x : x);
    if (kind === 'gable') {
      // the palace's end wall, its gable still up; the side wall behind
      // it and a low stretch in front have crumbled to courses
      const [a, b] = [M(-0.3), M(0.2)].sort((p, q) => p - q), h = g.range(0.26, 0.32);
      // (one face from the ground to its peak, front and back, its top sloping off)
      const m = (a + b) / 2, top = h + 0.16, c = [m, 0.09, h + 0.05];
      g.box(a, 0.06, 0, b - a, 0.06, h, { gables: { 0: { peak: top }, 2: { peak: top } } });
      g.windows(a, 0.06, b - a, 0.06, 0.1, h, 0.12, 0.13, { skip: ['left', 'right', 'back'] });
      for (const x of [a, b]) g.face(outward([[x, 0.06, h], [m, 0.06, top], [m, 0.12, top], [x, 0.12, h]], c));
      ruinWall(g, [M(-0.27), 0.16], [M(-0.27), 0.4], g.range(0.18, 0.24));
      ruinWall(g, [M(-0.05), -0.26], [M(0.32), -0.26], g.range(0.09, 0.13));
      heap(g, M(0.3), 0.0, 0.06);
      heap(g, M(-0.2), -0.18, 0.05);
      tree(g, M(0.18), 0.3, 0.9, 'spreading');
      return;
    }
    // the keep, a stretch of curtain wall running off it to the front
    const x = M(0.06), r = 0.13;
    roundTower(g, x, 0.1, r, g.range(0.5, 0.62), 'broken');
    const w = M(-0.34), e = x - M(r + 0.01);
    ruinWall(g, [Math.min(w, e), 0.1], [Math.max(w, e), 0.1], g.range(0.2, 0.26));
    ruinWall(g, [x, -0.04], [x, -0.3], g.range(0.1, 0.15));
    heap(g, M(-0.2), -0.12, 0.06);
    heap(g, M(0.27), -0.2, 0.05);
    tree(g, M(-0.22), 0.33, 0.85);
    tree(g, M(0.3), 0.32, 0.7, 'spruce');
  },
};
