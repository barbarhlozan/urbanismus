// Parks: 1×1 and 2×2. Mostly ground drawing (walkways, ponds)
// plus trees, benches and park furniture. Each level has a few layouts
// (picked by seed): plain greens, playgrounds, memorials, flower gardens,
// bandstands, lime avenues, formal baroque parterres, a spa colonnade. They make nearby homes grow
// faster and are destinations for strolls. Reachable by road or footpath.
// The park fills g.site (up to the road, merging with neighbouring parks).
// There is no border: entrance gates, benches along the walkways and grass
// tufts say "park".

import {
  tree, bush, bench, lamp, fountain, gate, tufts, hedgeAlong, statue,
  playground, bandstand, flowerBed, obelisk, sculpture, kiosk, chessTable, colonnade, footbridge,
} from './kit.js';
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

function pond(g, x, y, r, { island = false } = {}) {
  g.groundCircle(x, y, r, { fill: 'url(#hatch-water)' });
  g.groundCircle(x, y, r);
  if (island) {
    g.groundCircle(x, y, r * 0.3, { fill: 'bg' });
    tree(g, x, y, 0.8);
  }
}

function pavilion(g, x, y) {
  g.cylinder(x, y, 0, 0.08, 0.09, 8);
  g.shape(x, y, 0.09, [[-0.1, 0], [0.1, 0], [0, 0.08]]);
}

// Scatter n trees in a rectangle, keeping clear of walkways and the given circles.
function grove(g, n, x0, y0, x1, y1, avoid = [], kind = null) {
  for (let i = 0, tries = 0; i < n && tries < n * 8; tries++) {
    const x = g.range(x0, x1), y = g.range(y0, y1);
    if (onWalkway(g, x, y, 0.07) || avoid.some(([ax, ay, r]) => Math.hypot(x - ax, y - ay) < r)) continue;
    if (kind || g.chance(0.8)) tree(g, x, y, g.range(0.8, 1.25), kind);
    else bush(g, x, y, g.range(0.035, 0.055));
    i++;
  }
}

// The four spaces between the walkways (diagonals from the hub), `d` out.
function quadrants(g, d) {
  const [hx, hy] = g.site.paths.hub;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [hx + sx * d, hy + sy * d]);
}

// Trees lining the walkways on both sides (an avenue), every `step`.
function avenue(g, step = 0.22, off = 0.09) {
  const { hub, exits } = g.site.paths;
  for (const e of exits) {
    const len = Math.hypot(e.pos[0] - hub[0], e.pos[1] - hub[1]);
    const [ux, uy] = [(e.pos[0] - hub[0]) / len, (e.pos[1] - hub[1]) / len];
    for (let t = 0.18; t < len - 0.05; t += step) {
      for (const k of [-1, 1]) tree(g, hub[0] + ux * t - uy * off * k, hub[1] + uy * t + ux * off * k, 0.85, 'spreading');
    }
  }
}

// Formal parterre: a clipped hedge square in each quadrant, trimmed conifers
// on the corners, something in the middle.
function parterre(g, d, s) {
  for (const [qx, qy] of quadrants(g, d)) {
    const box = [[qx - s, qy - s], [qx + s, qy - s], [qx + s, qy + s], [qx - s, qy + s], [qx - s, qy - s]];
    hedgeAlong(g, box, 0.03);
    g.groundCircle(qx, qy, s * 0.45, { dash: '1 1.5', lod: 1 });
    tree(g, qx, qy, 0.55, 'spruce');
  }
}

function centrepiece(g, x, y) {
  g.pick([() => obelisk(g, x, y), () => statue(g, x, y), () => sculpture(g, x, y), () => fountain(g, x, y, 0.07)])();
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
  blurb: 'Homes nearby grow faster',
  hotkey: '4',
  footprint: [[0, 0]],
  levels: [
    {
      name: 'Green',
      stats: {},
      agents: 0,
      draw(g) {
        walkways(g);
        const kind = g.pick(['trees', 'trees', 'playground', 'memorial']);
        if (kind === 'playground') {
          const [px, py] = g.pick(quadrants(g, 0.23));
          playground(g, px, py, 0.16);
          benches(g, 1);
          grove(g, 2, -0.34, -0.34, 0.34, 0.34, [[px, py, 0.22]]);
        } else if (kind === 'memorial') {
          centrepiece(g, 0, 0);
          grove(g, g.int(2, 4), -0.34, -0.34, 0.34, 0.34, [[0, 0, 0.14]], 'spruce');
          benches(g, 1);
        } else {
          benches(g, 1);
          grove(g, g.int(2, 3), -0.32, -0.32, 0.32, 0.32);
        }
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
        const kind = g.pick(['garden', 'flowers', 'playground', 'kiosk']);
        const qs = quadrants(g, 0.24);
        if (kind === 'flowers') {
          for (const [x, y] of qs) flowerBed(g, x, y, 0.08);
          g.groundCircle(0, 0, 0.09, { lod: 1 });
          benches(g, 3);
          grass(g, 6);
          return;
        }
        if (kind === 'playground') {
          const [px, py] = qs[g.int(0, 3)];
          playground(g, px, py, 0.18);
          benches(g, 2);
          grove(g, 3, -0.34, -0.34, 0.34, 0.34, [[px, py, 0.24]]);
        } else if (kind === 'kiosk') {
          const [kx, ky] = qs[g.int(0, 3)];
          kiosk(g, kx, ky);
          chessTable(g, -kx, -ky);
          benches(g, 2);
          grove(g, 3, -0.34, -0.34, 0.34, 0.34, [[kx, ky, 0.12], [-kx, -ky, 0.1]]);
        } else {
          benches(g, 2);
          grove(g, g.int(4, 5), -0.34, -0.34, 0.34, 0.34, [[0, 0, 0.1]]);
        }
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
        const kind = g.pick(['pavilion', 'bandstand', 'formal']);
        if (kind === 'formal') {
          parterre(g, 0.24, 0.1);
          fountain(g, 0, 0, 0.06);
          benches(g, 2);
          return;
        }
        const withPond = g.chance(0.5);
        if (withPond) pond(g, 0.21, 0.21, 0.13);
        if (kind === 'bandstand') {
          bandstand(g, 0, 0, 0.1);
          for (const [x, y] of quadrants(g, 0.24)) if (!(withPond && x > 0 && y > 0)) flowerBed(g, x, y, 0.06);
        } else {
          pavilion(g, 0, 0); // where the walkways meet
        }
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
        const kind = g.pick(['meadow', 'woods', 'playground']);
        if (kind === 'woods') {
          benches(g, 2);
          grove(g, g.int(12, 16), -0.34, -0.34, 1.34, 1.34, [[0.5, 0.5, 0.12]], g.chance(0.5) ? 'spruce' : null);
        } else if (kind === 'playground') {
          const [px, py] = g.pick(quadrants(g, 0.45));
          playground(g, px, py, 0.24);
          benches(g, 3);
          grove(g, g.int(5, 7), -0.3, -0.3, 1.3, 1.3, [[px, py, 0.3]]);
        } else {
          benches(g, 2);
          grove(g, g.int(5, 7), -0.3, -0.3, 1.3, 1.3);
        }
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
        if (g.chance(0.35)) {
          // lime avenues along the walkways, a playground and a kiosk between them
          avenue(g);
          const qs = quadrants(g, 0.45);
          playground(g, ...qs[0], 0.22);
          kiosk(g, ...qs[2]);
          chessTable(g, qs[1][0], qs[1][1]);
          benches(g, 4);
          grass(g, 20);
          return;
        }
        const px = g.pick([0.05, 0.95]);
        const island = g.chance(0.5);
        pond(g, px, 0.95, 0.3, { island });
        if (!island) footbridge(g, [px - 0.33, 0.95], [px + 0.33, 0.95]);
        if (g.chance(0.5)) kiosk(g, 1 - px, 0.05);
        benches(g, 3);
        grove(g, g.int(8, 10), -0.3, -0.3, 1.3, 1.3, [[px, 0.95, 0.4], [0.5, 0.5, 0.15], [1 - px, 0.05, 0.12]]);
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
        const kind = g.pick(['city', 'formal', 'spa']);
        if (kind === 'formal') {
          // baroque garden: hedged parterres, clipped conifers, an obelisk
          parterre(g, 0.42, 0.22);
          obelisk(g, m, m, 0.34);
          for (const [x, y] of quadrants(g, 0.78)) tree(g, x, y, 1.1, 'spreading');
          benches(g, 4);
          return;
        }
        if (kind === 'spa') {
          // spa colonnade along the back, fountain and flower beds in front
          colonnade(g, -0.2, 1.2, 1.15);
          fountain(g, m, m, 0.09);
          for (const [x, y] of quadrants(g, 0.38)) flowerBed(g, x, y, 0.1);
          lamp(g, 0.3, 0.3);
          lamp(g, 0.7, 0.7);
          benches(g, 4);
          grove(g, g.int(4, 6), -0.32, -0.32, 1.32, 0.9, [[m, m, 0.25], ...quadrants(g, 0.38).map(([x, y]) => [x, y, 0.14])]);
          grass(g, 15);
          return;
        }
        fountain(g, m, m, 0.08); // where the walkways meet
        pond(g, 1.05, 0.05, 0.22);
        if (g.chance(0.5)) bandstand(g, 0.0, 1.0, 0.12);
        else pavilion(g, 0.0, 1.0);
        lamp(g, 0.3, 0.4);
        lamp(g, 0.7, 0.6);
        benches(g, 4);
        grove(g, g.int(10, 13), -0.32, -0.32, 1.32, 1.32, [[m, m, 0.25], [1.05, 0.05, 0.32], [0, 1, 0.18]]);
        grass(g, 30);
      },
    },
  ],
};
