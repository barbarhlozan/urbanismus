// Fenced grounds: the town cemetery, 2×2 – a walled graveyard with a lime
// alley, rows of graves, a mourning chapel at the back. People go there for
// walks (residential sim.leisure).

import { tree, bench, door, star } from './kit.js';

// ----- cemetery -----

// Graves in rows between x0 and x1, from y0 to y1: a mound outline on the
// ground and, close up, a headstone at the head of each.
function graves(g, x0, x1, y0, y1) {
  for (let y = y0; y < y1 - 0.06; y += 0.14) {
    for (let x = x0; x < x1 - 0.03; x += 0.08) {
      g.groundPoly([[x, y], [x + 0.04, y], [x + 0.04, y + 0.07], [x, y + 0.07]], { lod: 1 });
      g.detailed(2, () => g.box(x + 0.005, y + 0.07, 0, 0.03, 0.01, g.pick([0.03, 0.04, 0.05])));
    }
  }
}

export const cemetery = {
  id: 'cemetery',
  name: 'Cemetery',
  blurb: 'A quiet walk',
  category: 'amenities',
  tags: ['cemetery'],
  code: 'C',
  access: 'any',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  sim: { destinations: [] },
  plot: { props: 'green', boundary: 0, density: 0.3 },
  stats: { jobs: 1 },
  agents: 0,
  yards: ['trees', 'plaza'],
  draw(g) {
    const [x0, y0, x1, y1] = [-0.38, -0.3, 1.38, 1.4];
    // wall with a gateway in the middle of the front
    g.box(x0, y0 - 0.03, 0, 0.8, 0.03, 0.08);
    g.box(0.58, y0 - 0.03, 0, x1 - 0.58, 0.03, 0.08);
    for (const x of [0.42, 0.55]) g.box(x - 0.02, y0 - 0.04, 0, 0.05, 0.05, 0.14);
    g.box(x0, y0, 0, 0.03, y1 - y0, 0.08);
    g.box(x1 - 0.03, y0, 0, 0.03, y1 - y0, 0.08);
    g.box(x0, y1 - 0.03, 0, x1 - x0, 0.03, 0.08);
    // the main alley, lined with lindens or spruces, and a cross road
    const kind = g.pick(['spreading', 'spruce']);
    g.groundLine([[0.44, y0], [0.44, 1.05]], { lod: 1 });
    g.groundLine([[0.56, y0], [0.56, 1.05]], { lod: 1 });
    g.groundLine([[x0 + 0.05, 0.5], [x1 - 0.05, 0.5]], { dash: '2 2', lod: 1 });
    for (let y = -0.1; y < 1.0; y += 0.28) for (const x of [0.36, 0.64]) tree(g, x, y, 0.85, kind);
    graves(g, x0 + 0.08, 0.3, y0 + 0.08, 0.42);
    graves(g, 0.7, x1 - 0.06, y0 + 0.08, 0.42);
    graves(g, x0 + 0.08, 0.3, 0.6, 1.0);
    graves(g, 0.7, x1 - 0.06, 0.6, 1.0);
    // mourning chapel at the end of the alley
    g.roofed(0.3, 1.08, 0, 0.4, 0.26, 0.2, { h: 0.18, ridge: 'y', hip: [0, 0.1] });
    door(g, 0.5, 1.08, 0.07, 0.12);
    g.box(0.46, 1.02, 0.2, 0.08, 0.08, 0.1);
    g.lathe(0.5, 1.06, 0.3, [[0.06, 0], [0, 0.12]], 4, { phase: 0.5 });
    // a cross (or a star, for the war graves) in the middle
    if (g.chance(0.8)) {
      g.detailed(1, () => {
        g.solid(0.5, 0.5, 0.1);
        g.line([[0.5, 0.5, 0], [0.5, 0.5, 0.2]], { width: 2.2 });
        g.line([[0.46, 0.5, 0.15], [0.54, 0.5, 0.15]], { width: 2.2 });
      });
    } else {
      g.box(0.46, 0.46, 0, 0.08, 0.08, 0.12);
      star(g, 0.5, 0.5, 0.17, 0.035);
    }
    bench(g, 0.3, 0.5, true, -1);
    bench(g, 0.7, 0.5, true, 1);
  },
};
