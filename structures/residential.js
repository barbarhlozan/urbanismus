// A structure definition. Everything the game knows about a building type
// lives here.
//
//   id          unique key (saved in save files, don't rename casually)
//   name        shown in the UI
//   hotkey      keyboard shortcut for its build tool
//   footprint   grid offsets it occupies, relative to its anchor dot
//               ([[0,0]] = one dot, [[0,0],[1,0],[0,1],[1,1]] = 2×2)
//   sim         agent behaviour: where its dots travel to, and how often
//               they just go for a walk (strollChance, 0–1)
//   levels      one entry per development level (1 = low, 2 = medium, 3 = high):
//     name      shown in the click menu
//     stats     free-form numbers read by the HUD / future economy
//     agents    how many moving dots it spawns
//     grow      conditions to reach (and keep) this level – see src/sim/growth.js
//                 requires: [{ type, count, radius, minLevel }]
//                           at least `count` of `type` within `radius` dots
//                           (only counting those at `minLevel` or above)
//                 avoid:    [{ type, radius }]  none of `type` that close
//                 coveredBy: ['services']       inside the coverage of one of these
//                 boost:    [{ type, radius, factor }]  grows `factor`× faster
//                           when one of `type` is within `radius`
//               `type` can be a structure id or a tag ('park', 'square', 'services').
//     yards     surroundings styles it may get (structures/yards.js)
//   plot        sides and back of the building (structures/plots.js); a level
//               can override parts of it with its own `plot`
//     growTime  optional: ~seconds to grow into this level (default: config)
//     draw(g,s) drawing, using the painter API documented in src/render/painter.js.
//               Local units: (0,0,0) is the anchor dot, 1 = one grid step, z is up.
//               The front (door, shop window) goes on the -y side: single-dot
//               buildings are turned so that side faces their road.
//               Use g.pick / g.range / g.chance for variety – they are seeded
//               per building, so each one keeps its look.
//               Keep within about ±0.4 of the footprint dots, and keep separate
//               solids side by side rather than overlapping.

const FRONT = [0, -1, 0];

function door(g, x, y, w = 0.07, h = 0.12) {
  g.line([[x - w / 2, y, 0], [x - w / 2, y, h], [x + w / 2, y, h], [x + w / 2, y, 0]], { facing: FRONT });
}

export default {
  id: 'residential',
  name: 'Residential',
  hotkey: '1',
  category: 'zone',
  footprint: [[0, 0]],
  sim: { destinations: ['business', 'industrial'], leisure: ['park', 'square'], strollChance: 0.3 },
  plot: { props: 'garden', boundary: 0.6, kinds: ['fence', 'hedge'], density: 0.4 },

  levels: [
    {
      name: 'House',
      stats: { residents: 4 },
      agents: 1,
      yards: ['garden', 'garden', 'trees'],
      draw(g) {
        const kind = g.pick(['gable', 'gable', 'cross', 'tall', 'wing', 'flat']);
        if (kind === 'gable' || kind === 'cross') {
          const w = g.range(0.38, 0.5), d = g.range(0.28, 0.36), h = g.range(0.2, 0.27), roof = g.range(0.14, 0.24);
          const x = -w / 2, y = -d / 2;
          if (kind === 'gable') g.gable(x, y, 0, w, d, h, roof);
          else g.gableY(x, y, 0, w, d, h, roof);
          door(g, g.range(-w / 4, w / 4), y);
          if (g.chance(0.45)) g.box(x + w, -0.03, 0, 0.06, 0.06, h + roof * 0.9); // chimney on the side wall
        } else if (kind === 'tall') {
          const w = g.range(0.28, 0.34), d = 0.3, h = 0.4;
          const x = -w / 2, y = -d / 2;
          g.gableY(x, y, 0, w, d, h, g.range(0.18, 0.26));
          g.floors(x, y, w, d, 0, h, h / 2);
          door(g, 0, y);
        } else if (kind === 'wing') {
          const d = 0.32, y = -d / 2;
          g.gable(-0.26, y, 0, 0.32, d, 0.26, 0.2);
          g.gableY(0.06, y + 0.04, 0, 0.2, d - 0.04, 0.2, 0.14);
          door(g, -0.1, y);
        } else {
          const w = g.range(0.42, 0.52), d = g.range(0.3, 0.36), h = 0.2;
          const x = -w / 2, y = -d / 2;
          g.box(x, y, 0, w, d, h);
          g.box(x + w * 0.55, y + d * 0.3, h, 0.1, 0.1, 0.06);
          door(g, -w / 4, y);
          g.line([[0.02, y, 0.07], [w / 2 - 0.05, y, 0.07], [w / 2 - 0.05, y, 0.14], [0.02, y, 0.14], [0.02, y, 0.07]], { facing: FRONT });
        }
      },
    },
    {
      name: 'Apartments',
      stats: { residents: 12 },
      agents: 2,
      yards: ['garden', 'trees', 'plaza'],
      plot: { props: 'green', boundary: 0.3, kinds: ['hedge'] },
      grow: {
        requires: [
          { type: 'residential', count: 3, radius: 2 },
          { type: 'business', count: 1, radius: 4 },
        ],
        avoid: [{ type: 'industrial', radius: 1 }],
        boost: [{ type: 'park', radius: 3, factor: 1.6 }],
      },
      draw(g) {
        const kind = g.pick(['gable', 'flat', 'row', 'grid']);
        const storeys = g.int(3, 4);
        const fh = 0.16, h = storeys * fh;
        if (kind === 'row') {
          // two narrow row houses of different height, side by side
          const d = 0.44, y = -d / 2;
          const h2 = h - fh;
          g.gableY(-0.32, y, 0, 0.3, d, h, 0.16);
          g.floors(-0.32, y, 0.3, d, 0, h, fh);
          g.gableY(-0.02, y, 0, 0.3, d, h2, 0.16);
          g.floors(-0.02, y, 0.3, d, 0, h2, fh);
          door(g, -0.17, y);
          door(g, 0.13, y);
          return;
        }
        const w = g.range(0.52, 0.64), d = g.range(0.4, 0.48);
        const x = -w / 2, y = -d / 2;
        if (kind === 'gable') {
          g.gable(x, y, 0, w, d, h, g.range(0.12, 0.18));
          g.floors(x, y, w, d, 0, h, fh);
        } else {
          g.box(x, y, 0, w, d, h);
          g.floors(x, y, w, d, 0, h, fh);
          if (kind === 'grid') g.mullions(x, y, w, d, 0, h, 0.12);
          g.box(x + w * g.range(0.15, 0.6), y + d * 0.3, h, 0.14, 0.12, 0.08); // stair house on the roof
        }
        door(g, g.range(-w / 4, w / 4), y);
      },
    },
    {
      name: 'Tower',
      stats: { residents: 32 },
      agents: 3,
      yards: ['plaza', 'trees', 'parking'],
      plot: { props: 'green', boundary: 0.2, kinds: ['hedge'] },
      grow: {
        requires: [
          { type: 'residential', count: 6, radius: 2 },
          { type: 'residential', count: 3, radius: 2, minLevel: 2 },
          { type: 'business', count: 2, radius: 4 },
          { type: 'business', count: 1, radius: 4, minLevel: 2 },
        ],
        avoid: [{ type: 'industrial', radius: 3 }],
        coveredBy: ['services'],
        boost: [{ type: 'park', radius: 3, factor: 1.6 }],
      },
      draw(g) {
        const kind = g.pick(['square', 'square', 'slab', 'stepped', 'twin']);
        const fh = 0.12;
        const roofTop = (x, y, w, d, h) => {
          if (g.chance(0.5)) g.cylinder(x + w * 0.3, y + d * 0.5, h, 0.06, 0.12);
          else g.box(x + w * 0.3, y + d * 0.35, h, w * 0.4, d * 0.3, 0.1);
        };
        if (kind === 'square') {
          const s = g.range(0.22, 0.28), h = fh * g.int(10, 14);
          g.box(-s, -s, 0, 2 * s, 2 * s, h);
          g.floors(-s, -s, 2 * s, 2 * s, 0, h, fh);
          roofTop(-s, -s, 2 * s, 2 * s, h);
        } else if (kind === 'slab') {
          const w = 0.62, d = g.range(0.3, 0.36), h = fh * g.int(8, 11);
          g.box(-w / 2, -d / 2, 0, w, d, h);
          g.floors(-w / 2, -d / 2, w, d, 0, h, fh);
          g.mullions(-w / 2, -d / 2, w, d, 0, h, 0.155);
          roofTop(-w / 2, -d / 2, w, d, h);
        } else if (kind === 'stepped') {
          const b = 0.3, s = 0.2, hb = fh * 4, h = fh * g.int(10, 13);
          g.box(-b, -b, 0, 2 * b, 2 * b, hb);
          g.floors(-b, -b, 2 * b, 2 * b, 0, hb, fh);
          g.box(-s, -s, hb, 2 * s, 2 * s, h - hb);
          g.floors(-s, -s, 2 * s, 2 * s, hb, h, fh);
        } else {
          const d = 0.3, y = -d / 2, ha = fh * g.int(9, 12), hb = fh * g.int(6, 9);
          g.box(-0.32, y, 0, 0.26, d, ha);
          g.floors(-0.32, y, 0.26, d, 0, ha, fh);
          g.box(0.06, y, 0, 0.26, d, hb);
          g.floors(0.06, y, 0.26, d, 0, hb, fh);
        }
      },
    },
  ],
};
