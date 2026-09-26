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
//     join      { group, chance }: may share walls with its neighbours
//               (see joinSides in structures/index.js and g.join)
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

import { door, panel, chimney, aerials, frontage, shared, hips } from './kit.js';

// A few windows high up in a street-facing gable (ridge along y).
function gableWindow(g, x, y, z, s = 0.035) {
  panel(g, x - s / 2, x + s / 2, y, z, z + s * 1.3);
}

export default {
  id: 'residential',
  name: 'Residential',
  blurb: 'Homes',
  hotkey: '1',
  category: 'zone',
  footprint: [[0, 0]],
  sim: { destinations: ['business', 'industrial'], leisure: ['park', 'square', 'heritage'], strollChance: 0.3 },
  plot: { props: 'garden', boundary: 0.6, kinds: ['fence', 'hedge'], density: 0.4 },

  levels: [
    {
      // Family houses: the 70s "cube" with a pyramid roof, village houses
      // with their gable to the street, long farmhouses, villas.
      name: 'House',
      stats: { residents: 4 },
      agents: 1,
      yards: ['garden', 'garden', 'trees'],
      draw(g) {
        const kind = g.pick(['cube', 'cube', 'street', 'street', 'farm', 'villa', 'mansard']);
        if (kind === 'cube') {
          const s = g.range(0.36, 0.42), h = 0.3, r = g.range(0.07, 0.1);
          g.roofed(-s / 2, -s / 2, 0, s, s, h, { h: r, hip: s / 2 });
          g.windows(-s / 2, -s / 2, s, s, 0, h, h / 2, 0.11, { h: 0.4 });
          chimney(g, g.range(-0.06, 0.06), 0.04, h, r + 0.06);
          door(g, g.range(-0.08, 0.08), -s / 2, 0.06, 0.11);
        } else if (kind === 'street') {
          const w = g.range(0.28, 0.34), d = g.range(0.4, 0.46), h = g.range(0.17, 0.2), r = g.range(0.2, 0.26);
          g.roofed(-w / 2, -d / 2, 0, w, d, h, { h: r, ridge: 'y' });
          g.windows(-w / 2, -d / 2, w, d, 0, h, h, 0.1, { h: 0.4 });
          gableWindow(g, 0, -d / 2, h + r * 0.3);
          chimney(g, 0.02, g.range(-0.05, 0.1), h + r * 0.5, r * 0.6);
          if (g.chance(0.5)) g.gable(w / 2, d / 2 - 0.2, 0, 0.14, 0.18, 0.12, 0.07); // lean-to barn
        } else if (kind === 'farm') {
          const w = g.range(0.5, 0.58), d = g.range(0.28, 0.32), h = 0.17, r = g.range(0.18, 0.22);
          g.roofed(-w / 2, -d / 2, 0, w, d, h, { h: r, hip: 0.06 }); // half-hipped
          g.windows(-w / 2, -d / 2, w, d, 0, h, h, 0.11, { h: 0.4 });
          door(g, g.range(-0.12, 0.12), -d / 2, 0.06, 0.11);
          chimney(g, g.range(-0.1, 0.1), 0.02, h + r * 0.5, r * 0.65);
        } else if (kind === 'villa') {
          const w = g.range(0.42, 0.48), d = g.range(0.34, 0.38), h = 0.28, r = g.range(0.13, 0.17);
          g.roofed(-w / 2, -d / 2, 0, w, d, h, { h: r, hip: g.range(0.1, 0.14) });
          g.windows(-w / 2, -d / 2, w, d, 0, h, h / 2, 0.1, { h: 0.45 });
          chimney(g, -w / 4, 0.03, h + r * 0.4, r * 0.8);
          door(g, 0, -d / 2, 0.07, 0.12);
        } else {
          const w = g.range(0.4, 0.46), d = 0.36, h = 0.17;
          g.roofed(-w / 2, -d / 2, 0, w, d, h, { h: 0.05, hip: 0.08, mansard: { h: 0.11, inset: 0.06 } });
          g.windows(-w / 2, -d / 2, w, d, 0, h, h, 0.1, { h: 0.45 });
          door(g, 0, -d / 2, 0.07, 0.12);
        }
      },
    },
    {
      // Town blocks: pre-war tenements (mansard or hipped), 50s blocks,
      // narrow gabled burgher houses. Neighbours often share walls and
      // form a street front.
      name: 'Apartments',
      stats: { residents: 12 },
      agents: 2,
      yards: ['garden', 'trees', 'plaza'],
      plot: { props: 'green', boundary: 0.3, kinds: ['hedge'] },
      join: { group: 'street', chance: 0.75 },
      grow: {
        requires: [
          { type: 'residential', count: 3, radius: 2 },
          { type: 'business', count: 1, radius: 4 },
        ],
        avoid: [{ type: 'industrial', radius: 1 }],
        boost: [{ type: 'park', radius: 3, factor: 1.6 }, { type: 'heritage', radius: 3, factor: 1.3 }],
      },
      draw(g) {
        const joined = g.join.left || g.join.right;
        const kind = g.pick(joined ? ['tenement', 'tenement', 'sorela', 'burgher'] : ['tenement', 'sorela', 'burgher', 'block']);
        const skip = shared(g);
        if (kind === 'burgher') {
          // two narrow houses, gables to the street, different heights
          const [x0, x1] = frontage(g, 0.62);
          const d = 0.44, y = -d / 2, fh = 0.13;
          const mid = (x0 + x1) / 2 + g.range(-0.04, 0.04);
          for (const [a, b] of [[x0, mid], [mid, x1]]) {
            const h = fh * g.int(3, 4), r = g.range(0.16, 0.22);
            g.roofed(a, y, 0, b - a, d, h, { h: r, ridge: 'y' });
            g.windows(a, y, b - a, d, 0, h, fh, 0.08, { skip: ['left', 'right'] });
            gableWindow(g, (a + b) / 2, y, h + r * 0.3);
          }
          panel(g, x0 + 0.04, mid - 0.04, y, 0.02, fh * 0.8); // shop front below
          return;
        }
        if (kind === 'block') {
          // free-standing town villa block
          const s = g.range(0.5, 0.56), h = 0.13 * 3;
          g.roofed(-s / 2, -s / 2, 0, s, s, h, { h: 0.12, hip: s / 2 });
          g.windows(-s / 2, -s / 2, s, s, 0, h, 0.13, 0.09);
          chimney(g, 0.1, 0.05, h, 0.16);
          door(g, 0, -s / 2);
          return;
        }
        const [x0, x1] = frontage(g, g.range(0.56, 0.64));
        const w = x1 - x0, d = g.range(0.4, 0.46), y = -d / 2;
        if (kind === 'tenement') {
          const fh = 0.13, h = fh * g.int(4, 5);
          if (g.chance(0.5)) g.roofed(x0, y, 0, w, d, h, { h: 0.05, hip: hips(g, 0.1), mansard: { h: 0.1, inset: 0.05 } });
          else g.roofed(x0, y, 0, w, d, h, { h: g.range(0.13, 0.17), hip: hips(g, 0.14) });
          g.windows(x0, y, w, d, 0, h, fh, 0.085, { skip });
          door(g, g.range(x0 + 0.1, x1 - 0.1), y, 0.07, fh * 0.8);
          chimney(g, x0 + w * g.range(0.2, 0.8), y + d * 0.7, h, 0.17);
        } else {
          // 50s block: hipped roof, taller storeys, a framed entrance
          const fh = 0.14, h = fh * 4;
          g.roofed(x0, y, 0, w, d, h, { h: 0.12, hip: hips(g, 0.12) });
          g.windows(x0, y, w, d, 0, h, fh, 0.1, { skip, from: 1 });
          g.floors(x0, y, w, d, 0, fh * 1.05, fh, { skip });
          const cx = (x0 + x1) / 2;
          panel(g, cx - 0.06, cx + 0.06, y, 0, fh * 1.4);
          door(g, cx, y, 0.06, fh * 0.8);
        }
      },
    },
    {
      // Prefab panel housing: long slabs built in sections (joined
      // neighbours make one long block, sections slightly offset) and
      // point towers.
      name: 'Panel block',
      stats: { residents: 32 },
      agents: 3,
      yards: ['plaza', 'trees', 'parking', 'garages'],
      plot: { props: 'estate', boundary: 0.2, kinds: ['hedge'] },
      join: { group: 'slab', chance: 0.85 },
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
        const joined = g.join.left || g.join.right;
        const kind = joined ? 'slab' : g.pick(['slab', 'slab', 'point']);
        const fh = 0.1, skip = shared(g);
        const machineRoom = (x, y, z) => g.box(x - 0.07, y - 0.05, z, 0.14, 0.1, 0.07);
        if (kind === 'slab') {
          const [x0, x1] = frontage(g, 0.66);
          const w = x1 - x0, d = 0.3, y = -d / 2 + (joined ? g.pick([-0.04, 0, 0.04]) : 0);
          const h = fh * (joined ? g.pick([8, 8, 12]) : g.int(8, 12));
          g.box(x0, y, 0, w, d, h);
          g.windows(x0, y, w, d, 0, h, fh, 0.105, { skip, w: 0.5, from: 1 });
          g.floors(x0, y, w, d, 0, h, fh, { skip, inset: 0 });
          // loggia strip up the front
          for (const lx of [(x0 + x1) / 2 - 0.06, (x0 + x1) / 2 + 0.06]) g.line([[lx, y, fh], [lx, y, h]], { facing: [0, -1, 0] });
          machineRoom((x0 + x1) / 2, y + d / 2, h);
          aerials(g, x0 + 0.08, x1 - 0.08, y + d * 0.6, h, 3);
          g.box((x0 + x1) / 2 - 0.08, y - 0.06, 0.08, 0.16, 0.06, 0.015); // entrance canopy
        } else {
          const s = g.range(0.2, 0.24), h = fh * g.int(12, 14);
          g.box(-s, -s, 0, 2 * s, 2 * s, h);
          g.windows(-s, -s, 2 * s, 2 * s, 0, h, fh, 0.1, { w: 0.5, from: 1 });
          g.floors(-s, -s, 2 * s, 2 * s, 0, h, fh, { inset: 0 });
          machineRoom(0, 0, h);
          aerials(g, -s + 0.05, s - 0.05, s * 0.5, h, 2);
          g.box(-0.08, -s - 0.06, 0.08, 0.16, 0.06, 0.015);
        }
      },
    },
  ],
};
