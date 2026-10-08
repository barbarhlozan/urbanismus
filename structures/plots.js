// Plots: the ground around a building beyond its front yard – sides and back.
// Each building's plot reaches halfway to the neighbouring dots. Props are
// scattered wherever there is room: not on the building, not in the front
// yard, and clear of roads and footpaths (props check g.isFree themselves).
//
// A structure type (or a level) sets `plot`:
//   props      a style from PLOT_STYLES below
//   boundary   chance (0–1) that the plot has a boundary line
//   lone       the same with no other building around (default: boundary
//              times LONE – out in the open few bother; 'tall' security
//              fences stay), see boundaryChance()
//   kinds      boundary kinds it may pick from: 'fence', 'hedge', 'tall'
//
// Coordinates: plot painters use world axes, (0, 0) = the building's anchor dot.

import { tree, bush, shed, bench, bins, crates, pallets, bricks, cableDrum, concreteRings, woodpile, trailer, fenceAlong, hedgeAlong, carpetRack, dryingFrame, sandpit, climbingFrame, barrels, timber, heap, tank, transformer } from './kit.js';

// Share of the trees a garden would have that it gets (the rest of their
// spots stay open lawn): fewer, so a street of gardens isn't too busy.
// The garden front yard (yards.js) uses it too.
export const GARDEN_TREES = 0.8;

// Plot styles that spread over the empty ground round them (up to this many
// dots out, render/lots.js plotClaim) rather than keep to their own square:
// a garden with nobody next door, or in a road's bend, runs up to the road.
// Past its own square it is kept sparser (SPREAD_DENSITY of the plot's
// density): more open lawn, the odd fruit tree.
export const SPREAD = { garden: 1 };
export const SPREAD_DENSITY = 0.25;

// Share of a style's density kept (gardens are the most common plot, and
// every prop is SVG: fewer of them draw faster and look calmer).
const STYLE_DENSITY = { garden: 0.8 };

// Weighted props per style: [weight, radius, draw(g, x, y), most per plot]
export const PLOT_STYLES = {
  garden: [
    [5, 0.07, (g, x, y) => g.chance(GARDEN_TREES) && tree(g, x, y, g.range(0.75, 1.05))],
    [4, 0.045, (g, x, y) => bush(g, x, y, g.range(0.03, 0.045))],
    [1, 0.09, (g, x, y) => shed(g, x, y), 1],
  ],
  green: [
    [5, 0.07, (g, x, y) => tree(g, x, y, g.range(0.85, 1.1))],
    [3, 0.045, (g, x, y) => bush(g, x, y, 0.04)],
    [1, 0.07, (g, x, y) => bench(g, x, y, g.chance(0.5))],
  ],
  // housing estate greens: carpet racks, drying frames, a playground
  estate: [
    [5, 0.07, (g, x, y) => tree(g, x, y, g.range(0.85, 1.1))],
    [2, 0.07, (g, x, y) => carpetRack(g, x, y)],
    [2, 0.1, (g, x, y) => dryingFrame(g, x, y)],
    [1, 0.09, (g, x, y) => sandpit(g, x, y)],
    [1, 0.07, (g, x, y) => climbingFrame(g, x, y)],
    [1, 0.07, (g, x, y) => bench(g, x, y, g.chance(0.5))],
  ],
  service: [
    [3, 0.05, (g, x, y) => bins(g, x, y)],
    [3, 0.07, (g, x, y) => tree(g, x, y, 0.9)],
    [2, 0.045, (g, x, y) => bush(g, x, y, 0.04)],
  ],
  works: [
    [3, 0.07, (g, x, y) => crates(g, x, y)],
    [2, 0.07, (g, x, y) => pallets(g, x, y)],
    [1, 0.1, (g, x, y) => trailer(g, x, y)],
    [1, 0.07, (g, x, y) => cableDrum(g, x, y)],
    [1, 0.07, (g, x, y) => concreteRings(g, x, y)],
    [1, 0.06, (g, x, y) => bricks(g, x, y)],
    [1, 0.09, (g, x, y) => woodpile(g, x, y)],
    [2, 0.06, (g, x, y) => barrels(g, x, y)],
    [2, 0.1, (g, x, y) => timber(g, x, y)],
    [1, 0.09, (g, x, y) => heap(g, x, y, 0.07)],
    [1, 0.08, (g, x, y) => tank(g, x, y, 0.05, 0.1)],
    [1, 0.06, (g, x, y) => transformer(g, x, y)],
  ],
};

// Share of the boundary chance kept by a structure with no other building
// around (Renderer.isAlone), unless its plot sets `lone`.
export const LONE = 0.25;

export function boundaryChance(plotDef, alone) {
  const chance = plotDef.boundary ?? 0;
  if (!alone) return chance;
  if (plotDef.lone != null) return plotDef.lone;
  return plotDef.kinds?.includes('tall') ? chance : chance * LONE;
}

const BOUNDARY = {
  fence: (g, pts) => fenceAlong(g, pts, 0.06),
  hedge: (g, pts) => hedgeAlong(g, pts, 0.04),
  tall: (g, pts) => fenceAlong(g, pts, 0.1, 0.07),
};

// plot = {
//   style, boundary, kinds          from the structure definition
//   cell   [x0, y0, x1, y1]         the plot rectangle
//   inside(x, y, r)                 true if a prop of radius r fits there
//                                   (in the cell, off the building and front yard)
//   sides  [[a, b], …]              boundary lines this plot draws
//   onLine(x, y)                    true if a boundary point may be drawn there
//   density                         0–1, how full to make it
//   densityAt(x, y)                 optional: that, varying over the plot
// }
export function drawPlot(g, plot) {
  const style = PLOT_STYLES[plot.style];
  if (!style) return;

  // Boundary lines, with gaps wherever something is in the way.
  if (plot.sides.length && g.chance(plot.boundary ?? 0)) {
    const kind = BOUNDARY[g.pick(plot.kinds ?? ['fence'])] ?? BOUNDARY.fence;
    for (const [a, b] of plot.sides) {
      const pts = [];
      const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
      let run = [];
      for (let i = 0; i <= n; i++) {
        const p = [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n];
        if (plot.onLine(p[0], p[1])) run.push(p);
        else {
          if (run.length > 3) pts.push(run);
          run = [];
        }
      }
      if (run.length > 3) pts.push(run);
      for (const r of pts) kind(g, r);
    }
  }

  // Props on a jittered grid, visited in random order.
  const [x0, y0, x1, y1] = plot.cell;
  const step = 0.14;
  const spots = [];
  for (let y = y0 + step / 2; y < y1; y += step) {
    for (let x = x0 + step / 2; x < x1; x += step) spots.push([x + g.range(-0.03, 0.03), y + g.range(-0.03, 0.03)]);
  }
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(g.random() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }

  const total = style.reduce((s, [w]) => s + w, 0);
  const placed = [];
  const thin = STYLE_DENSITY[plot.style] ?? 1;
  const density = (plot.density ?? 0.35) * thin;
  const used = new Map(); // prop -> how many
  for (const [x, y] of spots) {
    if (!g.chance(plot.densityAt ? plot.densityAt(x, y) * thin : density)) continue;
    let pick = g.random() * total;
    const prop = style.find(([w]) => (pick -= w) < 0) ?? style[0];
    const [, r, draw, most = Infinity] = prop;
    if ((used.get(prop) ?? 0) >= most) continue;
    if (!plot.inside(x, y, r) || !g.isFree(x, y, r)) continue;
    if (placed.some(([px, py, pr]) => Math.hypot(px - x, py - y) < pr + r + 0.02)) continue;
    draw(g, x, y);
    used.set(prop, (used.get(prop) ?? 0) + 1);
    placed.push([x, y, r]);
  }
}
