// Heritage: old landmarks the town grew around – a wayside chapel, a
// baroque church, a town hall in three sizes, a war memorial, a castle
// (ruin, castle or chateau). They draw visitors and strollers (tag
// 'heritage').
// A church can also appear by itself in a grown neighbourhood without one
// (see spawnChurch in src/sim/growth.js).
//
// 2×2 ones: local area covers x, y from about -0.4 to 1.4, front on -y.

import { door, panel, paving, star, flagpole, flowerBed, tree, fountain, heap, roundWindows, FRAME, outward, statue, figure, kindOf } from './kit.js';

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
  blurb: 'Wayside chapel',
  footprint: [[0, 0]],
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
};

export const church = {
  ...common,
  id: 'church',
  name: 'Church',
  blurb: 'Village church',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  stats: { jobs: 2 },
  agents: 1,
  yards: ['trees', 'plaza'],
  kinds: ['onion', 'onion', 'twin', 'gothic'],
  draw(g, s) {
    const kind = kindOf(g, s, this.kinds);
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
};

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
};
