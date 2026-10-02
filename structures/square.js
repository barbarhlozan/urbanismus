// Squares: 1×1 and 2×2 paved public spaces – plazas, fountains, monuments,
// a market, and the modern kinds: a shopping precinct, a bus station, a
// parade square with a tribune. Nearby businesses grow faster;
// pedestrians like them. Reachable by road or footpath.
// Paving fills g.site (up to the road, merging with neighbouring squares
// and parks), without a border; trees and monuments stay near the middle.

import {
  tree, bench, lamp, fountain, statue, paving, sculpture, planter, streetClock, phoneBooth,
  newsKiosk, noticeboard, flagpole, star,
} from './kit.js';

const common = {
  category: 'civic',
  tags: ['square'],
  code: 'Q',
  access: 'any',
  site: true,
  keepsGrid: true, // paving that joins its neighbours': never turned to a road
  sim: { destinations: [] },
};

// No border: the paving pattern itself marks the square (solid thin lines,
// so it can't be mistaken for a footpath).
function pave(g, step) {
  paving(g, g.site.outline, step, { dash: null, outline: false, lod: 1 });
}

// ----- the modern square: precincts, bus stations, parades -----

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

// Speakers' tribune for May Day parades: a stepped stand with a back wall,
// a star over it, a row of flags on each side; front towards -y.
function tribune(g, x, y, w = 0.6) {
  g.box(x - w / 2, y, 0, w, 0.2, 0.06);
  g.box(x - w / 2 + 0.04, y + 0.05, 0.06, w - 0.08, 0.15, 0.07);
  g.box(x - w / 2, y + 0.18, 0, w, 0.05, 0.34);
  g.box(x - 0.08, y + 0.17, 0.34, 0.16, 0.06, 0.08);
  star(g, x, y + 0.17, 0.5, 0.055);
  for (const k of [-1, 1]) for (let i = 0; i < 3; i++) flagpole(g, x + k * (w / 2 + 0.07 + i * 0.1), y + 0.1, 0.42);
}

export const small = {
  ...common,
  id: 'square',
  name: 'Square',
  blurb: 'A paved plaza',
  hotkey: 's',
  footprint: [[0, 0]],
  levels: [
    {
      name: 'Plaza',
      stats: {},
      agents: 0,
      draw(g) {
        pave(g, 0.14);
        for (const [x, y] of g.pick([[[-0.28, -0.28], [0.28, 0.28]], [[0.28, -0.28], [-0.28, 0.28]]])) tree(g, x, y, 1);
        if (g.chance(0.4)) statue(g, 0, 0, 'bust'); // a poet or a teacher
      },
    },
    {
      name: 'Fountain square',
      stats: {},
      agents: 0,
      grow: {
        requires: [
          { type: 'business', count: 1, radius: 3 },
          { type: 'residential', count: 3, radius: 3 },
        ],
      },
      draw(g) {
        pave(g, 0.14);
        if (g.chance(0.45)) {
          // 70s precinct corner: planters, a street clock, a phone booth,
          // a newspaper kiosk and an abstract sculpture
          sculpture(g, 0, 0);
          for (const [x, y] of [[-0.22, -0.22], [0.22, -0.22], [0.22, 0.22], [-0.22, 0.22]]) planter(g, x, y);
          streetClock(g, -0.3, 0.02);
          phoneBooth(g, 0.3, -0.05);
          newsKiosk(g, 0.02, 0.3);
          bench(g, 0, -0.3);
          return;
        }
        fountain(g, 0, 0, 0.1);
        bench(g, 0, -0.3);
        bench(g, 0, 0.3);
        tree(g, -0.3, -0.3, 1);
        tree(g, 0.3, 0.3, 1);
      },
    },
    {
      name: 'Monument square',
      stats: {},
      agents: 0,
      grow: {
        requires: [
          { type: 'business', count: 1, radius: 3, minLevel: 2 },
          { type: 'residential', count: 6, radius: 3 },
        ],
      },
      draw(g) {
        pave(g, 0.14);
        g.groundCircle(0, 0, 0.2);
        statue(g, 0, 0, null, 1.5);
        for (const x of [-0.36, 0.36]) for (const y of [-0.36, 0.36]) tree(g, x, y, 0.9);
        lamp(g, -0.2, 0.05);
      },
    },
  ],
};

export const large = {
  ...common,
  id: 'square-large',
  name: 'Large square',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  levels: [
    {
      name: 'Market square',
      stats: {},
      agents: 0,
      draw(g) {
        pave(g, 0.16);
        if (g.chance(0.4)) {
          // bus station: platforms with curved shelters, a clock, a kiosk
          for (const y of [0.05, 0.45, 0.85]) busPlatform(g, -0.3, 1.0, y);
          streetClock(g, 1.2, 0.05, 0.24);
          newsKiosk(g, 1.2, 0.5);
          phoneBooth(g, 1.25, 0.85);
          for (const t of [-0.25, 0.25, 0.75, 1.25]) tree(g, t, 1.3, 1);
          return;
        }
        for (const t of [-0.25, 0.25, 0.75, 1.25]) {
          tree(g, t, -0.3, 1);
          tree(g, t, 1.3, 1);
        }
        g.box(0.3, 0.35, 0, 0.4, 0.3, 0.12); // market stall
      },
    },
    {
      name: 'Fountain square',
      stats: {},
      agents: 0,
      grow: {
        requires: [
          { type: 'business', count: 2, radius: 4 },
          { type: 'residential', count: 5, radius: 4 },
        ],
      },
      draw(g) {
        const m = 0.5;
        pave(g, 0.16);
        if (g.chance(0.45)) {
          // shopping precinct (nákupní středisko): a shop pavilion across the
          // back, a grid of planters, a sculpture fountain, a clock, booths
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
          return;
        }
        g.groundCircle(m, m, 0.4);
        fountain(g, m, m, 0.16);
        for (const [x, y] of [[m, 0.0], [m, 1.0], [0.0, m], [1.0, m]]) bench(g, x, y, y !== m);
        for (const [x, y] of [[-0.25, -0.25], [1.25, -0.25], [-0.25, 1.25], [1.25, 1.25]]) tree(g, x, y, 1.1);
      },
    },
    {
      name: 'Grand square',
      stats: {},
      agents: 0,
      grow: {
        requires: [
          { type: 'business', count: 2, radius: 4, minLevel: 2 },
          { type: 'residential', count: 10, radius: 5 },
        ],
      },
      draw(g) {
        const m = 0.5;
        pave(g, 0.16);
        if (g.chance(0.4)) {
          // parade square: the tribune at the back, lamps lining the
          // parade route across the front, a row of lindens behind
          tribune(g, m, 0.95);
          for (const x of [-0.25, 0.25, 0.75, 1.25]) {
            lamp(g, x, 0.0);
            lamp(g, x, 0.55);
            tree(g, x, 1.35, 1);
          }
          for (const x of [-0.2, 1.2]) planter(g, x, 0.95, 0.06);
          g.groundLine([[-0.4, 0.28], [1.4, 0.28]], { dash: '4 3', lod: 1 });
          return;
        }
        g.groundCircle(m, m, 0.5);
        g.groundCircle(m, m, 0.3);
        // the centrepiece: an obelisk, an equestrian statue or a statue group
        const centre = g.pick(['obelisk', 'equestrian', 'pair']);
        if (centre === 'obelisk') {
          g.box(m - 0.09, m - 0.09, 0, 0.18, 0.18, 0.08);
          g.box(m - 0.03, m - 0.03, 0.08, 0.06, 0.06, 0.35);
        } else {
          statue(g, m, m, centre, 1.6);
        }
        for (const t of [-0.25, 0.25, 0.75, 1.25]) {
          tree(g, t, -0.3, 1);
          tree(g, -0.3, t + 0.02, 1);
        }
        g.box(1.08, -0.3, 0, 0.22, 0.18, 0.14); // kiosk
        lamp(g, 0.1, m);
        lamp(g, 0.9, m);
      },
    },
  ],
};
