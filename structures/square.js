// Squares: 1×1 and 2×2 paved public spaces. The náměstí is one tool: the
// small one a plácek with a statue of St John of Nepomuk, a Marian column
// or a kašna; the large one the town square round a kašna or a Marian
// column, or on market day. Space steps through them. The 70s shopping
// precinct of a sídliště, and the ČSAD bus station (paved like them, but
// built from Doprava). Pedestrians like them. Reachable by road or footpath.
// Paving fills g.site (up to the road, merging with neighbouring squares
// and parks), without a border; trees and monuments stay near the middle.

import {
  tree, bench, lamp, fountain, paving, sculpture, planter, streetClock, phoneBooth,
  newsKiosk, noticeboard, figure, kindOf,
} from './kit.js';

const common = {
  category: 'spaces',
  tags: ['square'],
  code: 'Q',
  access: 'any',
  site: true,
  keepsGrid: true, // paving that joins its neighbours': never turned to a road
  sim: { destinations: [] },
  stats: {},
  agents: 0,
};

// Is point p inside polygon poly?
function inside([x, y], poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[j];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) c = !c;
  }
  return c;
}

// No border, and no grid over all of it: the paving is hinted the way a
// hand sketches cobbles – a patch round what stands in the middle (cx, cy,
// r out) and a few more scattered about, the rest left white.
function pave(g, step, [cx, cy] = [0, 0], r = 0.22) {
  const { x0, y0, x1, y1, outline } = g.site;
  const patch = (x, y, w, h) => {
    const [a, b, c, d] = [Math.max(x0, x - w), Math.max(y0, y - h), Math.min(x1, x + w), Math.min(y1, y + h)];
    const box = [[a, b], [c, b], [c, d], [a, d]];
    if (c - a > step && d - b > step && box.every((p) => inside(p, outline))) paving(g, box, step, { dash: null, outline: false, lod: 1 });
  };
  patch(cx, cy, r, r);
  const n = Math.round(((x1 - x0) * (y1 - y0)) * 2.5);
  for (let i = 0; i < n; i++) patch(g.range(x0, x1), g.range(y0, y1), g.range(0.08, 0.16), g.range(0.06, 0.12));
}

// ----- what stands on the náměstí -----

// Mariánský (morový) sloup: a column on a stepped base with the Virgin on
// top, put up after a plague; saints on the corners of the base, a low
// railing round it. `k` scales it (1: the small square's).
function marianColumn(g, x, y, k = 1) {
  if (!g.isFree(x, y, 0.13 * k)) return;
  const b = 0.13 * k, p = 0.055 * k, h = 0.42 * k;
  g.box(x - b, y - b, 0, 2 * b, 2 * b, 0.02 * k);
  g.box(x - b * 0.7, y - b * 0.7, 0.02 * k, 1.4 * b, 1.4 * b, 0.025 * k);
  g.box(x - p, y - p, 0.045 * k, 2 * p, 2 * p, 0.09 * k);
  g.lathe(x, y, 0.135 * k, [[0.026 * k, 0], [0.02 * k, h - 0.17 * k], [0.032 * k, h - 0.15 * k], [0.032 * k, h - 0.135 * k]], 10);
  figure(g, x, y, h, 0.09 * k, 'mother');
  g.detailed(1, () => {
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) figure(g, x + sx * b * 0.8, y + sy * b * 0.8, 0.045 * k, 0.06 * k);
  });
  g.detailed(2, () => g.groundPoly([[x - b - 0.04, y - b - 0.04], [x + b + 0.04, y - b - 0.04], [x + b + 0.04, y + b + 0.04], [x - b - 0.04, y + b + 0.04]], { dash: '1 1.5' }));
}

// Svatý Jan Nepomucký: the saint on a tall pedestal with a cornice, a ring
// of stars over his head.
function nepomuk(g, x, y, k = 1.3) {
  if (!g.isFree(x, y, 0.07 * k)) return;
  g.box(x - 0.06 * k, y - 0.06 * k, 0, 0.12 * k, 0.12 * k, 0.02 * k);
  g.box(x - 0.04 * k, y - 0.04 * k, 0.02 * k, 0.08 * k, 0.08 * k, 0.15 * k);
  g.box(x - 0.05 * k, y - 0.05 * k, 0.17 * k, 0.1 * k, 0.1 * k, 0.015 * k);
  figure(g, x, y, 0.185 * k, 0.12 * k);
  g.detailed(2, () => {
    const z = (0.185 + 0.13) * k, r = 0.025 * k;
    g.line(Array.from({ length: 11 }, (_, i) => [x + Math.cos((i / 10) * Math.PI * 2) * r, y + Math.sin((i / 10) * Math.PI * 2) * r, z]));
  });
}

// Kašna: an eight-sided stone basin, a pillar in the middle with a bowl
// and a little figure on top.
function kasna(g, x, y, r = 0.12) {
  if (!g.isFree(x, y, r)) return;
  const k = r / 0.12; // pillar and figure grow with the basin
  g.cylinder(x, y, 0, r, 0.045, 8);
  g.detailed(2, () => g.groundCircle(x, y, r * 1.35, { dash: '2 2' }));
  g.lathe(x, y, 0.045, [[r * 0.16, 0], [r * 0.12, 0.08 * k], [r * 0.4, 0.1 * k], [r * 0.12, 0.11 * k], [r * 0.1, 0.15 * k]], 8);
  figure(g, x, y, 0.045 + 0.15 * k, 0.06 * k);
}

// Market day: rows of stánky, trestle tables under pitched canvas.
function stalls(g, x0, x1, y, n) {
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.5) / n) * (x1 - x0);
    if (!g.isFree(x, y, 0.07)) continue;
    g.box(x - 0.07, y - 0.045, 0, 0.14, 0.09, 0.04);
    g.gable(x - 0.08, y - 0.055, 0.075, 0.16, 0.11, 0, 0.035);
    g.detailed(1, () => {
      for (const sx of [-1, 1]) g.line([[x + sx * 0.075, y - 0.05, 0.04], [x + sx * 0.075, y - 0.05, 0.075]]);
    });
  }
}

// ----- the náměstí -----

// The plácek: a small paved square with a statue of St John of Nepomuk, a
// Marian column or a kašna, two lindens, a bench and a lamp.
export const plaza = {
  ...common,
  id: 'plaza',
  name: 'Square',
  blurb: 'A saint, a column or a fountain',
  footprint: [[0, 0]],
  kinds: ['nepomuk', 'column', 'fountain'],
  draw(g, s) {
    const kind = kindOf(g, s, this.kinds);
    pave(g, 0.14);
    if (kind === 'nepomuk') nepomuk(g, 0, 0);
    else if (kind === 'column') marianColumn(g, 0, 0);
    else kasna(g, 0, 0, 0.11);
    // two lindens behind it, never in front
    for (const [x, y] of [[-0.3, -0.3], g.pick([[0.3, -0.3], [-0.3, 0.3]])]) tree(g, x, y, 1, 'spreading');
    bench(g, 0, 0.3);
    lamp(g, -0.25, 0.1);
  },
};

// The town square: a kašna or a Marian column in the middle, lindens along
// two sides, lamps; on market day rows of stalls, the kašna at one end.
export const marketSquare = {
  ...common,
  id: 'market-square',
  name: 'Square',
  blurb: 'A saint, a column or a fountain',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  kinds: ['fountain', 'column', 'market'],
  draw(g, s) {
    const kind = kindOf(g, s, this.kinds);
    const m = 0.5;
    pave(g, 0.16, [0.5, 0.5], 0.4);
    if (kind === 'column') marianColumn(g, m, m, 1.4);
    else if (kind === 'fountain') kasna(g, m, m, 0.24);
    else {
      kasna(g, 1.05, m, 0.12);
      for (const y of [0.05, 0.45, 0.85]) stalls(g, -0.25, 0.8, y, 4);
    }
    if (kind !== 'market') for (const [x, y] of [[m, 0.12], [m, 0.88]]) bench(g, x, y);
    for (const t of [-0.25, 0.25, 0.75, 1.25]) {
      tree(g, t, -0.32, 1, 'spreading');
      tree(g, -0.32, t + 0.02, 1, 'spreading');
    }
    lamp(g, 0.1, m);
    lamp(g, 1.25, 1.2);
  },
};

// ----- the modern square: precincts, bus stations -----

// Low shop pavilion of a shopping precinct (nákupní středisko) along x from
// x0 to x1, back at y1: a glass front under a deep flat roof, a sign on top.
function shopPavilion(g, x0, x1, y1, d = 0.3) {
  g.box(x0, y1 - d, 0, x1 - x0, d, 0.13);
  g.windows(x0, y1 - d, x1 - x0, d, 0, 0.13, 0.13, 0.1, { ribbon: true, skip: ['back'] });
  g.box(x0 - 0.04, y1 - d - 0.06, 0.13, x1 - x0 + 0.08, d + 0.06, 0.03);
  const m = (x0 + x1) / 2;
  g.box(m - 0.15, y1 - d - 0.04, 0.16, 0.3, 0.02, 0.05);
}

// Bus platform along x with a shelter: a thin curved roof on posts.
function busPlatform(g, x0, x1, y) {
  g.box(x0, y - 0.05, 0, x1 - x0, 0.1, 0.012);
  const a = x0 + 0.06, b = x1 - 0.06;
  g.detailed(1, () => {
    g.solid((a + b) / 2, y, 0.06);
    for (let x = a; x <= b + 1e-6; x += (b - a) / 3) g.line([[x, y + 0.02, 0.012], [x, y + 0.02, 0.11]]);
  });
  g.vault(a - 0.03, y - 0.06, 0.11, b - a + 0.06, 0.12, 0.004, 0.02, 4);
  g.detailed(2, () => {
    for (let x = a + 0.05; x < b - 0.04; x += 0.12) bench(g, x, y + 0.035, true, 1);
  });
}

// ----- 2×2 -----

// ČSAD bus station: platforms with curved shelters, a clock, a kiosk.
// Paved like a square, but in Doprava with the stations.
export const busStation = {
  ...common,
  category: 'transport',
  id: 'bus-station',
  name: 'Bus station',
  blurb: 'Platforms under curved shelters',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  draw(g) {
    pave(g, 0.16);
    for (const y of [0.05, 0.45, 0.85]) busPlatform(g, -0.3, 1.0, y);
    streetClock(g, 1.2, 0.05, 0.24);
    newsKiosk(g, 1.2, 0.5);
    phoneBooth(g, 1.25, 0.85);
    for (const t of [-0.25, 0.25, 0.75, 1.25]) tree(g, t, 1.3, 1);
  },
};

// Shopping precinct (nákupní středisko): a shop pavilion across the back, a
// grid of planters, a sculpture fountain, a clock, booths.
export const precinctLarge = {
  ...common,
  id: 'precinct-large',
  name: 'Shopping precinct',
  blurb: 'Planters, kiosks, a sculpture',
  size: 'Large',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  draw(g) {
    const m = 0.5;
    pave(g, 0.16);
    shopPavilion(g, -0.3, 1.3, 1.35);
    fountain(g, m, 0.45, 0.12);
    sculpture(g, m, 0.45);
    for (const x of [-0.2, 0.2, 0.8, 1.2]) for (const y of [-0.15, 0.7]) planter(g, x, y, 0.055);
    streetClock(g, 0.05, 0.3, 0.24);
    phoneBooth(g, 1.15, 0.3);
    phoneBooth(g, 1.22, 0.3);
    noticeboard(g, 0.9, -0.3);
    newsKiosk(g, 0.1, -0.3);
    for (const [x, y] of [[0.2, 0.45], [0.8, 0.45]]) bench(g, x, y, false, x < m ? -1 : 1);
  },
};
