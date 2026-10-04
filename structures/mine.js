// Coal mines, 4×3: a pit, a colliery and a deep mine, after the Ostrava
// and Kladno coalfields. Headframes (timber, steel trestle, concrete tower)
// over the shafts, winding houses, the pithead baths, a coal preparation
// plant on a conveyor, and the spoil heap (halda) that keeps growing.
// Tagged 'industrial' and 'mine', so trucks and trips treat them as industry.
//
// Local area covers x from about -0.4 to 3.4 and y from -0.4 to 2.4 (four
// dots wide, three deep), front on -y: the pithead in front, the siding
// and the stacks of pit props behind it, the spoil heap in the back corner. Buildings stand side by side rather
// than in L-shapes, so they sort in depth cleanly.

import { stack, door, heap, mound, gallery, transformer, pipes, wagons, timber, FRAME } from './kit.js';
import { coolingTower } from './industrial.js';

// Sheave wheel of radius r at (x, y, z), in the vertical plane along x
// (the hoisting ropes run along x to the winding house).
function sheave(g, x, y, z, r) {
  g.line(Array.from({ length: 13 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
  }), FRAME);
  g.detailed(2, () => g.line([[x - r, y, z], [x + r, y, z]]));
}

// Hoisting ropes from the sheave tops at (x, z) down to the winding house
// at (hx, hz), for each y in ys.
function ropes(g, x, z, hx, hz, ys) {
  g.detailed(2, () => {
    for (const y of ys) g.line([[x, y, z], [hx, y, hz]], { width: 0.6 });
  });
}

// Timber headframe: four raking legs, a platform, one sheave; the back
// strut leans towards +x.
function timberFrame(g, x, y, h) {
  const b = 0.1;
  g.detailed(1, () => {
    g.solid(x, y, h / 2);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.line([[x + sx * b, y + sy * b, 0], [x + sx * 0.03, y + sy * 0.03, h]], FRAME);
    for (const k of [0.35, 0.7]) {
      const r = b + (0.03 - b) * k;
      g.line([[x - r, y - r, h * k], [x + r, y - r, h * k], [x + r, y + r, h * k], [x - r, y + r, h * k], [x - r, y - r, h * k]]);
    }
    g.line([[x + 0.03, y, h], [x + 0.3, y, 0]], FRAME);
    sheave(g, x, y, h + 0.04, 0.05);
  });
}

// Steel trestle headframe: a braced tower of four legs, two big sheaves
// side by side on top, and raking back legs towards +x.
function steelFrame(g, x, y, h, lean = 0.4) {
  const b = 0.12, t = 0.065;
  g.detailed(1, () => {
    g.solid(x, y, h / 2);
    const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sy] of legs) g.line([[x + sx * b, y + sy * b, 0], [x + sx * t, y + sy * t, h]], FRAME);
    g.detailed(2, () => {
      const n = 8;
      for (const [a, c] of [[legs[0], legs[1]], [legs[3], legs[0]]]) {
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const k = i / n, r = b + (t - b) * k, p = i % 2 ? c : a;
          pts.push([x + p[0] * r, y + p[1] * r, h * k]);
        }
        g.line(pts);
      }
    });
    // back legs
    for (const sy of [-1, 1]) g.line([[x + t, y + sy * t, h], [x + lean, y + sy * 0.08, 0]], FRAME);
    g.line([[x - t, y - t, h], [x + t, y - t, h], [x + t, y + t, h], [x - t, y + t, h], [x - t, y - t, h]], FRAME);
    for (const dy of [-0.035, 0.035]) sheave(g, x, y + dy, h + 0.06, 0.09);
  });
}

// Concrete tower headframe with the winding machine house on top (the
// "hammerhead"); returns its height.
function towerFrame(g, x, y, h) {
  const t = 0.12;
  g.box(x - t, y - t, 0, 2 * t, 2 * t, h);
  g.mullions(x - t, y - t, 2 * t, 2 * t, 0.1, h, 0.08);
  g.box(x - t - 0.04, y - t - 0.03, h, 2 * t + 0.08, 2 * t + 0.06, 0.16);
  g.windows(x - t - 0.04, y - t - 0.03, 2 * t + 0.08, 2 * t + 0.06, h, h + 0.16, 0.16, 0.08, { ribbon: true });
  return h + 0.16;
}

// Winding house: a tall brick hall with arched-looking windows.
function windingHouse(g, x, y, w, d, h) {
  g.roofed(x, y, 0, w, d, h, { h: 0.1, ridge: 'y', hip: 0 });
  g.windows(x, y, w, d, 0, h, h, 0.11, { w: 0.4, h: 0.7 });
}

// Spoil heap (halda): a big mound, drawn at every zoom.
function halda(g, x, y, r, h) {
  mound(g, x, y, r, h);
}

// Pit props (důlní dříví): stacks of timber in rows between x0 and x1,
// y0 and y1.
function propYard(g, x0, x1, y0, y1) {
  for (let y = y0; y <= y1 + 1e-6; y += 0.25) {
    for (let x = x0; x <= x1 + 1e-6; x += 0.25) timber(g, x, y, true);
  }
}

// Settling pond (kalová nádrž) for the pit water: a rounded basin inside
// x0…x1, y0…y1 with a low bank round it.
function pond(g, x0, y0, x1, y1) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  const ring = (k) => Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return [cx + Math.cos(a) * rx * k * (1 - 0.12 * Math.abs(Math.sin(2 * a))), cy + Math.sin(a) * ry * k];
  });
  g.groundPoly(ring(0.82), { fill: 'url(#hatch-water)' });
  g.groundPoly(ring(1), { lod: 1 });
}

// Loading bin over the siding at (x, y): a raised box on legs, open below.
function loadingBin(g, x, y) {
  g.detailed(1, () => {
    g.solid(x, y, 0.1);
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.line([[x + dx * 0.12, y + dy * 0.07, 0], [x + dx * 0.12, y + dy * 0.07, 0.2]], FRAME);
  });
  g.box(x - 0.14, y - 0.09, 0.2, 0.28, 0.18, 0.16);
}

export const pit = {
  id: 'pit',
  name: 'Pit',
  blurb: 'A timber headframe, a spoil heap',
  category: 'work',
  tags: ['industrial', 'mine'],
  code: 'M',
  footprint: [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2]],
  plot: { props: 'works', boundary: 0.7, kinds: ['tall'], density: 0.35 },
  sim: { destinations: ['residential'] },
  stats: { jobs: 12 },
  agents: 1,
  yards: ['depot'],
  draw(g) {
    // a timber headframe over the shaft, the winding house and its
    // boiler, the lamp room, tubs on a short track, the first heap
    timberFrame(g, 0.3, 0.55, 0.6);
    windingHouse(g, 0.75, 0.35, 0.4, 0.45, 0.22);
    door(g, 0.95, 0.35, 0.06, 0.11);
    ropes(g, 0.35, 0.69, 0.75, 0.22, [0.55]);
    g.roofed(1.25, 0.4, 0, 0.32, 0.36, 0.2, { h: 0.1 });
    g.windows(1.25, 0.4, 0.32, 0.36, 0, 0.2, 0.2, 0.1, { h: 0.45 });
    stack(g, 1.68, 0.9, 0.75, 0.055);
    g.roofed(-0.32, -0.32, 0, 0.46, 0.3, 0.15, { h: 0.12 });  // lamp room
    g.windows(-0.32, -0.32, 0.46, 0.3, 0, 0.15, 0.15, 0.1, { h: 0.45 });
    door(g, -0.1, -0.32, 0.06, 0.11);
    wagons(g, 0.35, -0.15, 4);
    heap(g, 1.25, -0.15, 0.1);
    propYard(g, 1.9, 2.3, 0.0, 0.5);
    // the ventilation shaft's fan house, tubs running out to the tip
    g.roofed(-0.3, 1.45, 0, 0.36, 0.3, 0.18, { h: 0.1 });
    stack(g, 0.2, 1.6, 0.45, 0.04);
    wagons(g, 1.0, 1.75, 6);
    pond(g, 2.5, -0.2, 3.3, 0.75);
    halda(g, 2.75, 1.65, 0.5, 0.42);
  },
};

export const colliery = {
  id: 'colliery',
  name: 'Colliery',
  blurb: 'Steel headframes, the pithead baths',
  category: 'work',
  tags: ['industrial', 'mine'],
  code: 'M',
  footprint: [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2]],
  plot: { props: 'works', boundary: 0.7, kinds: ['tall'], density: 0.35 },
  sim: { destinations: ['residential'] },
  stats: { jobs: 36 },
  agents: 2,
  yards: ['depot', 'parking'],
  draw(g) {
    // pithead baths and offices along the front, a steel headframe, the
    // winding house, the boiler house and its chimney, wagons on the
    // siding and a spoil heap
    g.roofed(-0.32, -0.36, 0, 1.62, 0.28, 0.26, { h: 0.12, hip: 0.1 });
    g.windows(-0.32, -0.36, 1.62, 0.28, 0, 0.26, 0.13, 0.1);
    door(g, 0.5, -0.36, 0.08, 0.12);
    steelFrame(g, 0.25, 0.55, 1.25, 0.5);
    windingHouse(g, 0.85, 0.3, 0.45, 0.55, 0.32);
    door(g, 1.07, 0.3, 0.08, 0.14);
    ropes(g, 0.3, 1.39, 0.85, 0.32, [0.515, 0.585]);
    g.roofed(1.45, 0.35, 0, 0.36, 0.45, 0.3, { h: 0.1 });
    g.windows(1.45, 0.35, 0.36, 0.45, 0, 0.3, 0.3, 0.11, { w: 0.4, h: 0.6 });
    stack(g, 1.63, 1.02, g.range(1.25, 1.4), 0.075);
    wagons(g, 1.45, -0.2, 3, true);
    transformer(g, 2.25, 0.25);
    propYard(g, -0.25, 0.75, 1.45, 1.75);
    loadingBin(g, 1.2, 2.15);
    wagons(g, -0.25, 2.15, 7, true);
    g.roofed(2.2, -0.34, 0, 0.9, 0.3, 0.22, { h: 0.1, hip: 0.1 }); // lamp room and offices
    g.windows(2.2, -0.34, 0.9, 0.3, 0, 0.22, 0.11, 0.1);
    door(g, 2.65, -0.34, 0.07, 0.11);
    pond(g, 2.55, 0.15, 3.3, 0.9);
    halda(g, 2.8, 1.6, 0.55, 0.52);
  },
};

export const deepMine = {
  id: 'deep-mine',
  name: 'Deep mine',
  blurb: 'Concrete towers, a preparation plant',
  category: 'work',
  tags: ['industrial', 'mine'],
  code: 'M',
  trucks: 2,
  footprint: [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2]],
  plot: { props: 'works', boundary: 0.7, kinds: ['tall'], density: 0.35 },
  sim: { destinations: ['residential'] },
  stats: { jobs: 75 },
  agents: 3,
  yards: ['depot', 'parking'],
  draw(g) {
    // a concrete tower headframe over the main shaft, a steel one over
    // the second with its winding house, the coal preparation plant fed
    // by a conveyor gallery, two chimneys, the baths and a big heap
    const th = towerFrame(g, 0.1, 0.55, g.range(1.4, 1.5));
    steelFrame(g, 0.75, 1.0, 1.1, 0.42);
    windingHouse(g, 1.2, 0.8, 0.36, 0.45, 0.3);
    ropes(g, 0.8, 1.24, 1.2, 0.3, [0.965, 1.035]);
    g.box(1.35, -0.32, 0, 0.95, 0.7, 0.62);
    g.windows(1.35, -0.32, 0.95, 0.7, 0, 0.62, 0.155, 0.1, { ribbon: true });
    g.box(1.6, -0.2, 0.62, 0.45, 0.45, 0.14);
    g.windows(1.6, -0.2, 0.45, 0.45, 0.62, 0.76, 0.14, 0.1, { ribbon: true, h: 0.5 });
    gallery(g, [0.23, 0.45, th * 0.55], [1.35, 0.1, 0.48], 0.06, 0.06);
    g.box(-0.34, -0.36, 0, 1.24, 0.26, 0.26);
    g.windows(-0.34, -0.36, 1.24, 0.26, 0, 0.26, 0.13, 0.1, { ribbon: true });
    door(g, 0.3, -0.36, 0.08, 0.12);
    for (const x of [1.95, 2.2]) stack(g, x, 0.72, g.range(1.45, 1.6), 0.08);
    pipes(g, [1.7, 0.4], [1.7, 0.62], 0.2);
    // the pit's own power station and its cooling tower, a conveyor
    // from the preparation plant to the loading bin over the siding
    coolingTower(g, 3.0, 0.15, g.range(0.9, 1.0), 0.26);
    g.box(2.45, 0.55, 0, 0.5, 0.4, 0.42);
    g.windows(2.45, 0.55, 0.5, 0.4, 0.06, 0.4, 0.34, 0.09, { w: 0.5, h: 0.85 });
    loadingBin(g, 1.75, 2.1);
    gallery(g, [1.85, 0.38, 0.5], [1.75, 1.95, 0.36], 0.06, 0.06);
    wagons(g, -0.3, 2.1, 9, true);
    propYard(g, -0.25, 1.1, 1.55, 1.8);
    halda(g, 2.85, 1.75, 0.55, 0.6);
  },
};
