// Squares: 1×1 and 2×2 paved public spaces. Nearby businesses grow faster;
// pedestrians like them. Reachable by road or footpath.
// Paving fills g.site (up to the road, merging with neighbouring squares
// and parks), without a border; trees and monuments stay near the middle.

import { tree, bench, lamp, fountain, statue, paving } from './kit.js';

const common = {
  category: 'civic',
  tags: ['square'],
  code: 'Q',
  access: 'any',
  site: true,
  sim: { destinations: [] },
};

// No border: the paving pattern itself marks the square (solid thin lines,
// so it can't be mistaken for a footpath).
function pave(g, step) {
  paving(g, g.site.outline, step, { dash: null, outline: false, lod: 1 });
}

export const small = {
  ...common,
  id: 'square',
  name: 'Square',
  blurb: 'Shops nearby grow faster',
  hotkey: '6',
  footprint: [[0, 0]],
  levels: [
    {
      name: 'Plaza',
      stats: {},
      agents: 0,
      draw(g) {
        pave(g, 0.14);
        for (const [x, y] of g.pick([[[-0.28, -0.28], [0.28, 0.28]], [[0.28, -0.28], [-0.28, 0.28]]])) tree(g, x, y, 1);
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
        statue(g, 0, 0);
        for (const x of [-0.3, 0.3]) for (const y of [-0.3, 0.3]) tree(g, x, y, 1);
        lamp(g, -0.2, 0.05);
      },
    },
  ],
};

export const large = {
  ...common,
  id: 'square-large',
  name: 'Large square',
  hotkey: '7',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  levels: [
    {
      name: 'Market square',
      stats: {},
      agents: 0,
      draw(g) {
        pave(g, 0.16);
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
        g.groundCircle(m, m, 0.5);
        g.groundCircle(m, m, 0.3);
        g.box(m - 0.09, m - 0.09, 0, 0.18, 0.18, 0.08);
        g.box(m - 0.03, m - 0.03, 0.08, 0.06, 0.06, 0.35); // obelisk
        for (const t of [-0.25, 0.25, 0.75, 1.25]) {
          tree(g, t, -0.3, 1);
          tree(g, -0.3, t + 0.02, 1);
        }
        g.box(1.0, 1.0, 0, 0.25, 0.2, 0.14); // kiosk
        lamp(g, 0.1, m);
        lamp(g, 0.9, m);
      },
    },
  ],
};
