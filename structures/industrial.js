// Industrial: 2×2 footprint. Workshop -> factory -> plant.
// Local area covers x, y from about -0.4 to 1.4 (four dots: 0 and 1).
// Brick halls with sawtooth roofs, tapered chimneys, a water tower on a
// column, and a cooling tower at the plant.

import { stack } from './kit.js';

// Water tower: a drum on a column (the mushroom kind).
function waterTower(g, x, y, h) {
  g.lathe(x, y, 0, [[0.05, 0], [0.04, h * 0.7], [0.12, h * 0.82], [0.12, h * 0.95], [0.07, h], [0, h + 0.03]], 10);
}

// Hyperboloid cooling tower.
function coolingTower(g, x, y, h, r = 0.3) {
  g.lathe(x, y, 0, [[r, 0], [r * 0.8, h * 0.4], [r * 0.64, h * 0.8], [r * 0.66, h]], 14);
}

// Hall with a sawtooth roof: each tooth is a triangular prism along y.
function sawtoothHall(g, x0, y0, x1, y1, h, teeth, th) {
  g.box(x0, y0, 0, x1 - x0, y1 - y0, h);
  g.windows(x0, y0, x1 - x0, y1 - y0, 0, h, h, 0.13, { w: 0.5, h: 0.55, skip: ['front'] });
  const tw = (x1 - x0) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = x0 + i * tw, b = a + tw;
    g.solid((a + b) / 2, (y0 + y1) / 2, h + th / 2);
    g.face([[a, y1, h], [a, y0, h], [a, y0, h + th], [a, y1, h + th]]); // glazing (-x)
    g.face([[a, y0, h + th], [b, y0, h], [b, y1, h], [a, y1, h + th]]); // slope
    g.face([[a, y0, h], [b, y0, h], [a, y0, h + th]]);                 // front end (-y)
    g.face([[b, y1, h], [a, y1, h], [a, y1, h + th]]);                 // back end (+y)
  }
}

function loadingDoor(g, x, y, w, h) {
  g.line([[x, y, 0], [x, y, h], [x + w, y, h], [x + w, y, 0]], { facing: [0, -1, 0] });
}

export default {
  id: 'industrial',
  name: 'Industrial',
  hotkey: '3',
  category: 'zone',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  plot: { props: 'works', boundary: 0.7, kinds: ['tall'], density: 0.4 },
  sim: { destinations: ['residential'] },

  levels: [
    {
      name: 'Workshop',
      stats: { jobs: 8 },
      agents: 1,
      yards: ['depot', 'parking'],
      draw(g) {
        if (g.chance(0.5)) {
          g.gable(-0.3, -0.25, 0, 1.0, 0.65, g.range(0.24, 0.3), g.range(0.14, 0.2));
          loadingDoor(g, g.range(-0.1, 0.35), -0.25, 0.2, 0.16);
          g.box(0.8, 0.75, 0, 0.45, 0.4, 0.22);
          if (g.chance(0.6)) stack(g, 0.05, 1.05, g.range(0.45, 0.65), 0.05);
        } else {
          g.gableY(-0.3, -0.3, 0, 0.62, 1.1, g.range(0.24, 0.3), g.range(0.16, 0.22));
          loadingDoor(g, -0.1, -0.3, 0.22, 0.16);
          g.box(0.5, -0.1, 0, 0.5, 0.4, 0.2);
          if (g.chance(0.5)) g.box(0.6, 0.55, 0, 0.6, 0.5, 0.26);
          if (g.chance(0.6)) stack(g, 1.2, 1.25, g.range(0.45, 0.65), 0.05);
        }
      },
    },
    {
      name: 'Factory',
      stats: { jobs: 20 },
      agents: 2,
      yards: ['parking', 'depot'],
      grow: {
        requires: [{ type: 'residential', count: 3, radius: 6 }],
      },
      draw(g) {
        const teeth = g.int(3, 5);
        const x1 = g.range(1.1, 1.3), y1 = g.range(0.75, 0.9);
        sawtoothHall(g, -0.3, -0.25, x1, y1, g.range(0.26, 0.34), teeth, 0.13);
        loadingDoor(g, 0.0, -0.25, 0.22, 0.18);
        if (g.chance(0.6)) loadingDoor(g, 0.5, -0.25, 0.22, 0.18);
        const [cx, annexX] = g.pick([[1.12, 0.2], [-0.15, 0.55]]);
        stack(g, cx, 1.18, g.range(0.85, 1.1), 0.08);
        if (g.chance(0.5)) g.box(annexX, 1.0, 0, 0.45, 0.3, 0.2);
        else waterTower(g, annexX + 0.2, 1.15, g.range(0.5, 0.65));
      },
    },
    {
      name: 'Plant',
      stats: { jobs: 45 },
      agents: 3,
      yards: ['depot', 'parking'],
      grow: {
        requires: [
          { type: 'residential', count: 8, radius: 6 },
          { type: 'residential', count: 3, radius: 6, minLevel: 2 },
          { type: 'industrial', count: 1, radius: 3, minLevel: 2 },
        ],
        coveredBy: ['services'],
      },
      draw(g) {
        sawtoothHall(g, -0.32, -0.32, 0.98, 0.72, g.range(0.34, 0.42), 3, 0.16);
        loadingDoor(g, -0.1, -0.32, 0.26, 0.22);

        const chimneys = g.int(1, 3);
        for (let i = 0; i < chimneys; i++) stack(g, 1.2, -0.2 + i * 0.32, g.range(1.1, 1.5), 0.09);

        if (g.chance(0.5)) {
          coolingTower(g, 0.3, 1.08, g.range(0.95, 1.15));
        } else {
          const silos = g.int(1, 3);
          const siloH = g.range(0.45, 0.7);
          for (let i = 0; i < silos; i++) g.cylinder(-0.1 + i * 0.4, 1.1, 0, 0.17, siloH, 10);
        }

        if (g.chance(0.6)) g.box(0.95, 0.95, 0, 0.4, 0.4, g.range(0.2, 0.32));
      },
    },
  ],
};
