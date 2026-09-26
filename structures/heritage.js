// Heritage: old landmarks the town grew around – a wayside chapel, a
// baroque church, a town hall with a clock tower, a plague column. They
// don't develop (one level each); they draw visitors and strollers, and
// make nearby apartments and offices grow faster (tag 'heritage').
// A church can also appear by itself in a grown neighbourhood without one
// (see spawnChurch in src/sim/growth.js).
//
// 2×2 ones: local area covers x, y from about -0.4 to 1.4, front on -y.

import { door, panel, paving } from './kit.js';

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
