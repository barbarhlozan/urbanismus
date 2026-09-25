// Business: shop -> offices -> skyscraper. Vertical facade lines distinguish
// commercial towers from residential ones (horizontal floor lines).
// Front (shop window, entrance) is the -y side.

const FRONT = [0, -1, 0];

function rect(g, x0, x1, y, z0, z1) {
  g.line([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [x0, y, z0]], { facing: FRONT });
}

export default {
  id: 'business',
  name: 'Business',
  hotkey: '2',
  category: 'zone',
  footprint: [[0, 0]],
  sim: { destinations: ['residential'] },
  plot: { props: 'service', boundary: 0.2, kinds: ['hedge'], density: 0.3 },

  levels: [
    {
      name: 'Shop',
      stats: { jobs: 3 },
      agents: 1,
      yards: ['parking', 'plaza', 'trees'],
      draw(g) {
        const kind = g.pick(['sign', 'awning', 'gable', 'twostorey']);
        const w = g.range(0.44, 0.56), d = g.range(0.34, 0.42);
        const x = -w / 2, y = -d / 2;
        if (kind === 'gable') {
          const h = 0.22;
          g.gable(x, y, 0, w, d, h, 0.12);
          rect(g, x + 0.05, x + w - 0.05, y, 0.04, 0.15);
        } else if (kind === 'twostorey') {
          const h = 0.36;
          g.box(x, y, 0, w, d, h);
          g.floors(x, y, w, d, 0, h, 0.18);
          rect(g, x + 0.05, x + w - 0.05, y, 0.03, 0.13);
          rect(g, -0.12, 0.12, y, 0.24, 0.31); // sign on the facade
        } else {
          const h = g.range(0.2, 0.25);
          g.box(x, y, 0, w, d, h);
          rect(g, x + 0.05, x + w - 0.05, y, 0.04, h - 0.06);
          if (kind === 'sign') g.box(-w * 0.35, y, h, w * 0.7, 0.04, 0.09);
          else g.box(x + 0.03, y - 0.07, h * 0.62, w - 0.06, 0.07, 0.025); // awning
        }
      },
    },
    {
      name: 'Offices',
      stats: { jobs: 8 },
      agents: 2,
      yards: ['plaza', 'parking'],
      grow: {
        requires: [{ type: 'residential', count: 3, radius: 3 }],
        boost: [{ type: 'square', radius: 3, factor: 1.6 }],
      },
      draw(g) {
        const kind = g.pick(['glass', 'ribbon', 'slab', 'podium']);
        if (kind === 'glass' || kind === 'ribbon') {
          const s = g.range(0.18, 0.23), h = g.range(0.8, 1.05);
          g.box(-s, -s, 0, 2 * s, 2 * s, h);
          if (kind === 'glass') g.mullions(-s, -s, 2 * s, 2 * s, 0, h, 0.08);
          else g.floors(-s, -s, 2 * s, 2 * s, 0, h, 0.09);
          if (g.chance(0.5)) g.box(-s * 0.6, -s * 0.6, h, s * 1.2, s * 1.2, 0.08);
        } else if (kind === 'slab') {
          const w = 0.58, d = 0.3, h = g.range(0.65, 0.85);
          g.box(-w / 2, -d / 2, 0, w, d, h);
          g.mullions(-w / 2, -d / 2, w, d, 0, h, 0.07);
        } else {
          const b = 0.3, s = 0.18, hb = 0.2, h = g.range(0.85, 1.05);
          g.box(-b, -b, 0, 2 * b, 2 * b, hb);
          rect(g, -b + 0.05, b - 0.05, -b, 0.03, hb - 0.05);
          g.box(-s, -s, hb, 2 * s, 2 * s, h - hb);
          g.mullions(-s, -s, 2 * s, 2 * s, hb, h, 0.08);
        }
      },
    },
    {
      name: 'Skyscraper',
      stats: { jobs: 24 },
      agents: 3,
      yards: ['plaza', 'trees'],
      grow: {
        requires: [
          { type: 'residential', count: 8, radius: 4 },
          { type: 'residential', count: 4, radius: 4, minLevel: 2 },
          { type: 'business', count: 2, radius: 3 },
          { type: 'business', count: 1, radius: 3, minLevel: 2 },
        ],
        coveredBy: ['services'],
        boost: [{ type: 'square', radius: 3, factor: 1.6 }],
      },
      draw(g) {
        const kind = g.pick(['stepped', 'needle', 'round', 'slab']);
        if (kind === 'stepped') {
          const b = 0.32, s = 0.22, c = 0.13, h = g.range(1.45, 1.75);
          g.box(-b, -b, 0, 2 * b, 2 * b, 0.32);
          g.floors(-b, -b, 2 * b, 2 * b, 0, 0.32, 0.11);
          g.box(-s, -s, 0.32, 2 * s, 2 * s, h - 0.32);
          g.mullions(-s, -s, 2 * s, 2 * s, 0.32, h, 0.07);
          g.box(-c, -c, h, 2 * c, 2 * c, 0.24);
          g.line([[0, 0, h + 0.24], [0, 0, h + 0.5]]);
        } else if (kind === 'needle') {
          const s = g.range(0.18, 0.21), h = g.range(1.8, 2.1);
          g.box(-s, -s, 0, 2 * s, 2 * s, h);
          g.mullions(-s, -s, 2 * s, 2 * s, 0, h, 0.06);
          g.line([[0, 0, h], [0, 0, h + 0.4]]);
        } else if (kind === 'round') {
          // facet edges of the cylinder read as a curtain wall
          const r = 0.25, h = g.range(1.4, 1.75);
          g.cylinder(0, 0, 0, r, h, 14);
          g.cylinder(0, 0, h, r * 0.65, 0.16, 14);
        } else {
          const w = 0.62, d = 0.32, h = g.range(1.3, 1.6);
          g.box(-w / 2, -d / 2, 0, w, d, h);
          g.mullions(-w / 2, -d / 2, w, d, 0, h, 0.065);
          g.box(-0.12, -0.08, h, 0.24, 0.16, 0.12);
        }
      },
    },
  ],
};
