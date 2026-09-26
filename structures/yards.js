// Surroundings: what fills the ground between a building and its road.
//
// Each style draws into a "yard" in local coordinates where the road is
// towards -y and the building's door dot is at (0, 0):
//   yard.x0 … yard.x1   width of the yard along the road
//   yard.y1             building side (-0.34)
//   yard.frontAt(x)     road-side edge at x – follows the drawn road curve,
//                       so it varies along the yard (render/lots.js)
//   yard.profile        that edge as a polyline [[x, y]…]
//   yard.outline        polygon of the whole yard
//   yard.flat           true if the edge is straight
// Stay inside the outline, and leave a way through from the door (x = 0) to
// the road – the yard replaces the plain driveway.
//
// Levels list the styles they may get in `yards: [...]`; one is picked from
// the building's seed. The player can override it (s.data.yard).

import { tree, bush, hedge, fenceAlong, bench, crates, container, lamp, paving, garages } from './kit.js';

const spots = (x0, x1, step) => {
  const out = [];
  const n = Math.max(1, Math.floor((x1 - x0) / step));
  for (let i = 0; i < n; i++) out.push(x0 + (i + 0.5) * ((x1 - x0) / n));
  return out;
};

// The road-side edge between xa and xb, moved `inset` towards the building.
function edgeLine(yard, inset, xa, xb) {
  if (xb - xa < 0.04) return [];
  const pts = [[xa, yard.frontAt(xa) + inset]];
  for (const [x, y] of yard.profile) if (x > xa && x < xb) pts.push([x, y + inset]);
  pts.push([xb, yard.frontAt(xb) + inset]);
  return pts;
}

// The yard outline with the road side moved `inset` in and the sides `side` in.
function innerOutline(yard, inset, side = 0) {
  const { x0, x1, y1 } = yard;
  return [[x0 + side, y1], [x1 - side, y1], ...edgeLine(yard, inset, x0 + side, x1 - side).reverse()];
}

// Free depth at x between the road-side edge (+inset) and the building side.
const room = (yard, x, inset = 0) => yard.y1 - (yard.frontAt(x) + inset);

export const YARDS = {
  garden: {
    name: 'Garden',
    draw(g, yard) {
      const { x0, x1, y1 } = yard;
      // path from the door to the road
      const f = yard.frontAt(0);
      g.groundLine([[-0.035, -0.18], [-0.035, f]]);
      g.groundLine([[0.035, -0.18], [0.035, f]]);
      const useHedge = yard.flat && g.chance(0.5);
      for (const [a, b] of [[x0 + 0.05, -0.09], [0.09, x1 - 0.05]]) {
        if (useHedge) hedge(g, a, b, yard.frontAt(a) + 0.06);
        else fenceAlong(g, edgeLine(yard, 0.06, a, b));
      }
      for (const side of [-1, 1]) {
        const x = side * g.range(0.18, (side < 0 ? -x0 : x1) - 0.1);
        const tall = g.chance(0.7);
        if (room(yard, x, 0.12) < 0.08) continue;
        const y = (yard.frontAt(x) + 0.12 + y1) / 2 + g.range(-0.04, 0.04);
        if (tall) tree(g, x, y, g.range(0.8, 1.1));
        else bush(g, x, y, g.range(0.035, 0.05));
      }
    },
  },

  trees: {
    name: 'Tree row',
    draw(g, yard) {
      const { x0, x1 } = yard;
      g.groundLine(edgeLine(yard, 0.03, x0 + 0.03, x1 - 0.03));
      for (const x of spots(x0, x1, 0.3)) {
        if (Math.abs(x) <= 0.1 || room(yard, x, 0.12) < 0.04) continue;
        tree(g, x, yard.frontAt(x) + 0.12, g.range(0.9, 1.15));
      }
      const bx = g.pick([-0.25, 0.25]);
      if (g.chance(0.5) && room(yard, bx, 0.2) > 0.05) bush(g, bx, (yard.frontAt(bx) + 0.2 + yard.y1) / 2);
    },
  },

  parking: {
    name: 'Parking',
    draw(g, yard) {
      const { x0, x1, y1 } = yard;
      const a = x0 + 0.04, b = x1 - 0.04, back = y1 - 0.02, stall = 0.2;
      g.groundPoly([[a, back], [b, back], ...edgeLine(yard, 0.03, a, b).reverse()]);
      const xs = [];
      for (let x = a; x <= b + 1e-6; x += 0.13) xs.push(x);
      // stalls only where the lot is deep enough and no footpath runs through
      const ok = (x) => yard.frontAt(x) + 0.03 < back - stall - 0.02 && g.isFree(x, back - stall / 2, 0.04);
      for (const x of xs) if (ok(x)) g.groundLine([[x, back], [x, back - stall]], { lod: 2 });
      // stall spots: parked cars are shown and simulated by src/sim/parking.js
      for (let i = 0; i < xs.length - 1; i++) {
        const mx = (xs[i] + xs[i + 1]) / 2;
        if (ok(xs[i]) && ok(xs[i + 1]) && g.isFree(mx, back - stall / 2, 0.05)) g.spot(mx, back - stall / 2);
      }
      if (g.chance(0.5) && room(yard, b - 0.04, 0.08) > 0.02) lamp(g, b - 0.04, yard.frontAt(b - 0.04) + 0.08);
    },
  },

  plaza: {
    name: 'Plaza',
    draw(g, yard) {
      const { x0, x1, y1 } = yard;
      paving(g, innerOutline(yard, 0.03, 0.04), 0.12);
      for (const side of [-1, 1]) {
        const x = side * Math.min(0.28, (side < 0 ? -x0 : x1) - 0.14);
        if (room(yard, x, 0.03) < 0.2) continue;
        const y = (yard.frontAt(x) + 0.03 + y1) / 2;
        g.groundCircle(x, y, 0.07);
        tree(g, x, y, 0.95);
      }
      if (g.chance(0.6)) bench(g, g.pick([-0.12, 0.12]), y1 - 0.08);
    },
  },

  garages: {
    name: 'Garages',
    draw(g, yard) {
      const { x0, x1, y1 } = yard;
      // a row of lock-ups either side of the way to the door, with an apron
      const back = y1 - 0.02;
      for (const [a, b] of [[x0 + 0.04, -0.1], [0.1, x1 - 0.04]]) {
        if (b - a < 0.12) continue;
        if (room(yard, a, 0.2) < 0.2 || room(yard, b, 0.2) < 0.2) continue;
        if (![a, (a + b) / 2, b].every((x) => g.isFree(x, back - 0.09, 0.05))) continue;
        garages(g, a, b, back);
      }
      g.groundLine(edgeLine(yard, 0.03, x0 + 0.03, x1 - 0.03));
      if (g.chance(0.6) && room(yard, x1 - 0.06, 0.06) > 0.02) lamp(g, x1 - 0.06, yard.frontAt(x1 - 0.06) + 0.06);
    },
  },

  depot: {
    name: 'Yard',
    draw(g, yard) {
      const { x0, x1, y1 } = yard;
      fenceAlong(g, edgeLine(yard, 0.05, x0 + 0.04, -0.12), 0.08);
      fenceAlong(g, edgeLine(yard, 0.05, 0.12, x1 - 0.04), 0.08);
      const places = spots(x0 + 0.05, x1 - 0.05, 0.35).filter((x) => Math.abs(x) > 0.2);
      for (const x of places) {
        if (room(yard, x, 0.05) < 0.16) continue;
        const y = (yard.frontAt(x) + 0.05 + y1) / 2;
        if (g.chance(0.5)) container(g, x, y, true);
        else crates(g, x, y);
      }
    },
  },
};

// Style ids in menu order.
export const YARD_STYLES = Object.keys(YARDS);
