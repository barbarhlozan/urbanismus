// Parks: 1×1 and 2×2. Mostly ground drawing (walkways, ponds)
// plus trees, benches and a pavilion. They make nearby homes grow
// faster and are destinations for strolls. Reachable by road or footpath.
// The park fills g.site (up to the road, merging with neighbouring parks).
// There is no border: entrance gates, benches along the walkways and grass
// tufts say "park".

import { tree, bush, bench, lamp, fountain, gate, tufts } from './kit.js';
import { segmentDistance } from '../src/core/geom2d.js';

// The park's walkways (g.site.paths): straight dashed lines in the footpath
// style from the hub in the middle to each exit on the footpath grid, so
// footpaths drawn up to the park's edge join them. Exits facing a road carry
// on to the lawn edge. People really walk along them (sim/walking.js).
function walkways(g) {
  const { hub, exits } = g.site.paths;
  const { x0, y0, x1, y1 } = g.site;
  for (const e of exits) {
    const [dx, dy] = e.dir;
    const end = e.road ? [dx > 0 ? x1 : dx < 0 ? x0 : e.pos[0], dy > 0 ? y1 : dy < 0 ? y0 : e.pos[1]] : e.pos;
    g.groundLine([hub, end], { cls: 'fp' });
    // entrance posts just inside the park
    gate(g, e.pos[0] - dx * 0.08, e.pos[1] - dy * 0.08, e.dir);
  }
}

// n benches beside the walkways, facing them, about halfway out.
function benches(g, n) {
  const { hub, exits } = g.site.paths;
  const list = exits.slice();
  for (let i = 0; i < n && list.length; i++) {
    const e = list.splice(Math.floor(g.random() * list.length), 1)[0];
    const [dx, dy] = e.dir;
    const t = g.range(0.4, 0.6);
    const side = g.pick([-1, 1]);
    const x = hub[0] + (e.pos[0] - hub[0]) * t - dy * 0.09 * side;
    const y = hub[1] + (e.pos[1] - hub[1]) * t + dx * 0.09 * side;
    // seat runs along the walkway, backrest away from it
    const alongX = dx !== 0;
    bench(g, x, y, alongX, alongX ? dx * side : -dy * side);
  }
}

function grass(g, n) {
  const { x0, y0, x1, y1 } = g.site;
  tufts(g, n, x0 + 0.05, y0 + 0.05, x1 - 0.05, y1 - 0.05, (x, y) => onWalkway(g, x, y, 0.03));
}

// Is (x, y) within r of a walkway?
function onWalkway(g, x, y, r) {
  const { hub, exits } = g.site.paths;
  return exits.some((e) => segmentDistance([x, y], hub, e.pos) < r + 0.05);
}

function pond(g, x, y, r) {
  g.groundCircle(x, y, r, { fill: 'url(#hatch-water)' });
  g.groundCircle(x, y, r);
}

function pavilion(g, x, y) {
  g.cylinder(x, y, 0, 0.08, 0.09, 8);
  g.shape(x, y, 0.09, [[-0.1, 0], [0.1, 0], [0, 0.08]]);
}

// Scatter n trees in a rectangle, keeping clear of walkways and the given circles.
function grove(g, n, x0, y0, x1, y1, avoid = []) {
  for (let i = 0, tries = 0; i < n && tries < n * 8; tries++) {
    const x = g.range(x0, x1), y = g.range(y0, y1);
    if (onWalkway(g, x, y, 0.07) || avoid.some(([ax, ay, r]) => Math.hypot(x - ax, y - ay) < r)) continue;
    if (g.chance(0.8)) tree(g, x, y, g.range(0.8, 1.25));
    else bush(g, x, y, g.range(0.035, 0.055));
    i++;
  }
}

const common = {
  category: 'civic',
  tags: ['park'],
  access: 'any',
  site: true,
  sim: { destinations: [] },
};

export const small = {
  ...common,
  id: 'park',
  name: 'Park',
  hotkey: '4',
  footprint: [[0, 0]],
  levels: [
    {
      name: 'Green',
      stats: {},
      agents: 0,
      draw(g) {
        walkways(g);
        benches(g, 1);
        grove(g, g.int(2, 3), -0.32, -0.32, 0.32, 0.32);
        grass(g, 8);
      },
    },
    {
      name: 'Garden park',
      stats: {},
      agents: 0,
      grow: { requires: [{ type: 'residential', count: 3, radius: 3 }] },
      draw(g) {
        walkways(g);
        benches(g, 2);
        grove(g, g.int(4, 5), -0.34, -0.34, 0.34, 0.34, [[0, 0, 0.1]]);
        grass(g, 10);
      },
    },
    {
      name: 'Pavilion park',
      stats: {},
      agents: 0,
      grow: {
        requires: [
          { type: 'residential', count: 6, radius: 3 },
          { type: 'residential', count: 2, radius: 3, minLevel: 2 },
        ],
      },
      draw(g) {
        walkways(g);
        const withPond = g.chance(0.5);
        if (withPond) pond(g, 0.21, 0.21, 0.13);
        pavilion(g, 0, 0); // where the walkways meet
        benches(g, 3);
        grove(g, g.int(4, 6), -0.36, -0.36, 0.36, 0.36, [[0, 0, 0.15], ...(withPond ? [[0.21, 0.21, 0.17]] : [])]);
        grass(g, 12);
      },
    },
  ],
};

export const large = {
  ...common,
  id: 'park-large',
  name: 'Large park',
  hotkey: '5',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  levels: [
    {
      name: 'Meadow',
      stats: {},
      agents: 0,
      draw(g) {
        walkways(g);
        benches(g, 2);
        grove(g, g.int(5, 7), -0.3, -0.3, 1.3, 1.3);
        grass(g, 20);
      },
    },
    {
      name: 'Pond park',
      stats: {},
      agents: 0,
      grow: { requires: [{ type: 'residential', count: 5, radius: 4 }] },
      draw(g) {
        walkways(g);
        const px = g.pick([0.05, 0.95]);
        pond(g, px, 0.95, 0.3);
        benches(g, 3);
        grove(g, g.int(8, 10), -0.3, -0.3, 1.3, 1.3, [[px, 0.95, 0.4], [0.5, 0.5, 0.15]]);
        grass(g, 25);
      },
    },
    {
      name: 'City park',
      stats: {},
      agents: 0,
      grow: {
        requires: [
          { type: 'residential', count: 10, radius: 5 },
          { type: 'residential', count: 3, radius: 5, minLevel: 2 },
        ],
      },
      draw(g) {
        const m = 0.5;
        walkways(g);
        fountain(g, m, m, 0.08); // where the walkways meet
        pond(g, 1.05, 0.05, 0.22);
        pavilion(g, 0.0, 1.0);
        lamp(g, 0.3, 0.4);
        lamp(g, 0.7, 0.6);
        benches(g, 4);
        grove(g, g.int(10, 13), -0.32, -0.32, 1.32, 1.32, [[m, m, 0.25], [1.05, 0.05, 0.32], [0, 1, 0.18]]);
        grass(g, 30);
      },
    },
  ],
};
