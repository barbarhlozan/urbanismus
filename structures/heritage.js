// Heritage: old landmarks the town grew around – a wayside chapel, a
// baroque church, a town hall with a clock tower, a plague column, a war
// memorial, a gate tower left from the town walls, a castle (ruin, castle or chateau). They
// don't develop (one level each); they draw visitors and strollers, and
// make nearby apartments and offices grow faster (tag 'heritage').
// A church can also appear by itself in a grown neighbourhood without one
// (see spawnChurch in src/sim/growth.js).
//
// 2×2 ones: local area covers x, y from about -0.4 to 1.4, front on -y.

import { door, panel, paving, star, flagpole, flowerBed, tree, fountain, heap, roundWindows, FRAME, outward } from './kit.js';

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

function cross(g, x, y, z, s = 0.035) {
  g.detailed(1, () => {
    g.solid(x, y, z + s);
    g.line([[x, y, z], [x, y, z + s * 2.2]]);
    g.line([[x - s * 0.6, y, z + s * 1.5], [x + s * 0.6, y, z + s * 1.5]]);
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
  blurb: 'Homes and offices nearby grow faster',
  footprint: [[0, 0]],
  levels: [
    {
      name: 'Chapel',
      stats: {},
      agents: 0,
      yards: ['trees', 'garden'],
      draw(g) {
        if (g.chance(0.3)) {
          // wayside shrine: a pillar with a niche and a little roof
          g.box(-0.05, -0.05, 0, 0.1, 0.1, 0.24);
          panel(g, -0.025, 0.025, -0.05, 0.14, 0.21);
          g.roofed(-0.07, -0.07, 0.24, 0.14, 0.14, 0, { h: 0.07, hip: 0.07 });
          cross(g, 0, 0, 0.31, 0.025);
          return;
        }
        const w = 0.26, d = 0.38, y = -0.2, h = 0.22, r = 0.17;
        g.roofed(-w / 2, y, 0, w, d, h, { h: r, ridge: 'y' });
        door(g, 0, y, 0.07, 0.13);
        naveWindows(g, -w / 2, y, w, d, h);
        // bell turret on the front of the ridge
        g.box(-0.035, y + 0.04, h + r * 0.75, 0.07, 0.07, 0.08);
        onion(g, 0, y + 0.075, h + r * 0.75 + 0.08, 0.04);
      },
    },
  ],
};

export const church = {
  ...common,
  id: 'church',
  name: 'Church',
  blurb: 'Homes and offices nearby grow faster',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  levels: [
    {
      name: 'Church',
      stats: { jobs: 2 },
      agents: 1,
      yards: ['trees', 'plaza'],
      draw(g) {
        const kind = g.pick(['onion', 'onion', 'twin', 'gothic']);
        const nx = 0.18, nw = 0.64, ny = 0.06, nd = 1.08, nh = 0.46, nr = 0.36;
        // nave, ridge running away from the street
        g.roofed(nx, ny, 0, nw, nd, nh, { h: nr, ridge: 'y' });
        naveWindows(g, nx, ny, nw, nd, nh);
        // chancel at the back, narrower and lower, hipped at its end
        g.roofed(0.3, ny + nd, 0, 0.4, 0.26, nh * 0.85, { h: 0.26, ridge: 'y', hip: [0, 0.16] });
        if (kind === 'twin') {
          const t = 0.12;
          for (const cx of [nx + t, nx + nw - t]) {
            const h = tower(g, cx, ny - t - 0.02, t, 0.95);
            onion(g, cx, ny - t - 0.02, h, t);
          }
          door(g, 0.5, ny, 0.12, 0.22);
        } else {
          const t = 0.16, cy = ny - t - 0.02;
          const h = tower(g, 0.5, cy, t, kind === 'gothic' ? 0.9 : 1.0);
          if (kind === 'gothic') spire(g, 0.5, cy, h, t, 0.6);
          else onion(g, 0.5, cy, h, t);
          door(g, 0.5, cy - t, 0.1, 0.2);
        }
      },
    },
  ],
};

export const townHall = {
  ...common,
  id: 'town-hall',
  name: 'Town hall',
  blurb: 'Homes and offices nearby grow faster',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  plot: { props: 'green', boundary: 0.2, kinds: ['hedge'], density: 0.2 },
  levels: [
    {
      name: 'Town hall',
      stats: { jobs: 12 },
      agents: 2,
      yards: ['plaza'],
      draw(g) {
        const fh = 0.15, h = fh * 3, y0 = -0.3, d = 0.62;
        const t = 0.13, tx = 0.5;
        // two front wings either side of the clock tower
        for (const [a, b] of [[-0.32, tx - t], [tx + t, 1.32]]) {
          g.roofed(a, y0, 0, b - a, d, h, { h: 0.2, hip: [a < 0 ? 0.16 : 0, a < 0 ? 0 : 0.16] });
          g.windows(a, y0, b - a, d, 0, h, fh, 0.09, { skip: [a < 0 ? 'right' : 'left'], from: 1 });
          // arcade along the ground floor
          const n = Math.round((b - a) / 0.14);
          for (let i = 0; i < n; i++) {
            const xa = a + ((b - a) * i) / n + 0.025, xb = a + ((b - a) * (i + 1)) / n - 0.025;
            g.line([[xa, y0, 0], [xa, y0, fh * 0.6], [(xa + xb) / 2, y0, fh * 0.85], [xb, y0, fh * 0.6], [xb, y0, 0]], { facing: FRONT });
          }
        }
        // clock tower with a gallery and a spire or an onion
        const th = 1.05, ty = y0 + t;
        g.box(tx - t, ty - t, 0, 2 * t, 2 * t, th);
        g.floors(tx - t, ty - t, 2 * t, 2 * t, 0, th, fh, { inset: 0 });
        clockFaces(g, tx, ty, t, th - 0.12);
        g.box(tx - t - 0.02, ty - t - 0.02, th, 2 * t + 0.04, 2 * t + 0.04, 0.02); // gallery
        g.box(tx - t * 0.7, ty - t * 0.7, th + 0.02, 1.4 * t, 1.4 * t, 0.1);
        if (g.chance(0.5)) onion(g, tx, ty, th + 0.12, t * 0.7);
        else spire(g, tx, ty, th + 0.12, t * 0.7, 0.35);
        // back wings round a courtyard
        g.roofed(-0.32, y0 + d + 0.08, 0, 0.4, 0.95, fh * 2, { h: 0.16, ridge: 'y', hip: [0, 0.12] });
        g.windows(-0.32, y0 + d + 0.08, 0.4, 0.95, 0, fh * 2, fh, 0.09);
        g.roofed(0.92, y0 + d + 0.08, 0, 0.4, 0.95, fh * 2, { h: 0.16, ridge: 'y', hip: [0, 0.12] });
        g.windows(0.92, y0 + d + 0.08, 0.4, 0.95, 0, fh * 2, fh, 0.09);
        g.roofed(0.14, 1.05, 0, 0.72, 0.28, fh * 2, { h: 0.14 });
      },
    },
  ],
};


export const column = {
  ...common,
  id: 'plague-column',
  name: 'Plague column',
  size: 'Plague column',
  blurb: 'Homes and offices nearby grow faster',
  footprint: [[0, 0]],
  plot: { props: 'green', boundary: 0, density: 0.2 },
  levels: [
    {
      name: 'Plague column',
      stats: {},
      agents: 0,
      yards: ['plaza'],
      draw(g) {
        paving(g, [[-0.34, -0.34], [0.34, -0.34], [0.34, 0.34], [-0.34, 0.34]], 0.1, { lod: 1 });
        // stepped base, saints on the corners, column, figure on top
        g.box(-0.2, -0.2, 0, 0.4, 0.4, 0.04);
        g.box(-0.14, -0.14, 0.04, 0.28, 0.28, 0.1);
        g.lathe(0, 0, 0.14, [[0.05, 0], [0.035, 0.05], [0.03, 0.55], [0.045, 0.58], [0.045, 0.6]], 8);
        g.lathe(0, 0, 0.74, [[0.025, 0], [0.03, 0.05], [0.012, 0.1], [0, 0.12]], 6);
        g.detailed(1, () => {
          for (const [x, y] of [[-0.17, -0.17], [0.17, -0.17], [0.17, 0.17], [-0.17, 0.17]]) {
            g.lathe(x, y, 0.04, [[0.018, 0], [0.02, 0.05], [0.01, 0.08], [0, 0.09]], 5);
          }
        });
      },
    },
  ],
};

// ----- memorials, town gates, castles -----

// A little figure on a pedestal top at z: body, head (and a rifle).
function figure(g, x, y, z, s = 1) {
  g.lathe(x, y, z, [[0.022 * s, 0], [0.02 * s, 0.07 * s], [0.012 * s, 0.085 * s], [0.014 * s, 0.1 * s], [0, 0.115 * s]], 6);
  g.detailed(2, () => g.line([[x + 0.025 * s, y, z], [x + 0.03 * s, y, z + 0.13 * s]]));
}

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
  size: 'Memorial',
  blurb: 'Homes and offices nearby grow faster',
  footprint: [[0, 0]],
  plot: { props: 'green', boundary: 0, density: 0.3 },
  levels: [
    {
      name: 'Memorial',
      stats: {},
      agents: 0,
      yards: ['plaza', 'trees'],
      draw(g) {
        const kind = g.pick(['soldier', 'tank', 'pylon']);
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
        figure(g, 0, 0, 0.25, 1.3);
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
    },
  ],
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

export const townGate = {
  ...common,
  id: 'town-gate',
  name: 'Gate tower',
  blurb: 'Homes and offices nearby grow faster',
  footprint: [[0, 0]],
  plot: { props: 'green', boundary: 0, density: 0.2 },
  levels: [
    {
      name: 'Gate tower',
      stats: {},
      agents: 0,
      yards: ['plaza'],
      draw(g) {
        // a gothic or baroque gate tower standing on its own, the town
        // walls long gone
        const t = 0.15, h = g.range(0.72, 0.85);
        g.box(-t, -t, 0, 2 * t, 2 * t, h);
        g.windows(-t, -t, 2 * t, 2 * t, 0.3, h - 0.05, 0.14, 0.1, { w: 0.3, h: 0.55 });
        // the gateway, front and back
        for (const [y, n] of [[-t, [0, -1, 0]], [t, [0, 1, 0]]]) {
          g.line([[-0.07, y, 0], [-0.07, y, 0.13], [-0.04, y, 0.18], [0, y, 0.2], [0.04, y, 0.18], [0.07, y, 0.13], [0.07, y, 0]], { facing: n, lod: 1 });
        }
        if (g.chance(0.6)) {
          // gothic: a gallery, a steep spire and four corner pinnacles
          g.box(-t - 0.02, -t - 0.02, h, 2 * t + 0.04, 2 * t + 0.04, 0.03);
          spire(g, 0, 0, h + 0.03, t * 0.95, 0.5);
          g.detailed(1, () => {
            for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
              g.lathe(sx * t, sy * t, h + 0.03, [[0.022, 0], [0, 0.14]], 4, { phase: 0.5 });
            }
          });
        } else {
          // baroque: hipped roof with an onion
          g.roofed(-t, -t, h, 2 * t, 2 * t, 0, { h: 0.12, hip: t });
          onion(g, 0, 0, h + 0.12, t * 0.5);
        }
      },
    },
  ],
};

// Round tower (a castle keep): a smooth shaft on a battered plinth, rows
// of small windows, and on top either a corbelled parapet under a hatched
// cone roof ('cone'), battlements ('crenel') or broken masonry ('broken').
// Returns the height of its walls.
function roundTower(g, x, y, r, h, roof = 'cone') {
  g.lathe(x, y, 0, [[r * 1.08, 0], [r, 0.08], [r, h]], 24, { smooth: true, rings: [1] });
  g.detailed(1, () => roundWindows(g, x, y, r, 0.22, h - 0.1, 0.18, 5, { phase: g.random() }));
  if (roof === 'broken') {
    // the top crumbled away: stumps of the parapet round the rim
    g.detailed(1, () => {
      for (let i = 0; i < 12; i++) {
        if (g.chance(0.4)) continue;
        const a = (i / 12) * Math.PI * 2, s = 0.035;
        g.box(x + Math.cos(a) * r * 0.86 - s / 2, y + Math.sin(a) * r * 0.86 - s / 2, h, s, s, g.range(0.015, 0.07));
      }
    });
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
  blurb: 'Homes and offices nearby grow faster',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  plot: { props: 'green', boundary: 0.2, kinds: ['hedge'], density: 0.45 },
  levels: [
    {
      name: 'Castle',
      stats: { jobs: 3 },
      agents: 1,
      yards: ['trees'],
      draw(g) {
        const kind = g.pick(['ruin', 'castle', 'chateau']);
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
        const ring = [[-0.34, -0.3], [1.34, -0.3], [1.34, 1.3], [-0.34, 1.3], [-0.34, -0.3]];
        const seg = 0.14, d = 0.07;
        for (let i = 0; i < 4; i++) {
          const [a, b] = [ring[i], ring[i + 1]];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.round(len / seg);
          let hgt = g.range(0.12, 0.3);
          for (let k = 0; k < n; k++) {
            hgt = Math.min(0.32, Math.max(0.03, hgt + g.range(-0.08, 0.08)));
            if (g.chance(0.15)) continue; // a breach
            const t0 = k / n, t1 = (k + 1) / n;
            const x0 = a[0] + (b[0] - a[0]) * t0, y0 = a[1] + (b[1] - a[1]) * t0;
            const x1 = a[0] + (b[0] - a[0]) * t1, y1 = a[1] + (b[1] - a[1]) * t1;
            const [bx, by] = [Math.min(x0, x1) - (y0 === y1 ? 0 : d / 2), Math.min(y0, y1) - (x0 === x1 ? 0 : d / 2)];
            g.box(bx, by, 0, Math.abs(x1 - x0) || d, Math.abs(y1 - y0) || d, hgt);
          }
        }
        slits(g, 0.0, 1.0, -0.335, 0.06);
        // roofless palace: walls with window holes, gable standing
        g.box(-0.2, 0.55, 0, 0.7, 0.07, 0.36);
        g.windows(-0.2, 0.55, 0.7, 0.07, 0.12, 0.36, 0.12, 0.14, { skip: ['left', 'right', 'back'] });
        g.face([[-0.2, 0.55, 0.36], [0.5, 0.55, 0.36], [0.15, 0.55, 0.52]]);
        g.box(-0.2, 0.62, 0, 0.07, 0.4, 0.28);
        heap(g, 0.5, 0.2, 0.08);
        heap(g, 1.2, 0.2, 0.06);
        tree(g, 0.25, 0.95, 1, 'spreading');
        tree(g, 1.25, 0.45, 0.9);
      },
    },
  ],
};
