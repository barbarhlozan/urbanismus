// Industry. Two types:
//   industrial        2×2: workshop -> factory -> plant. Local area covers x, y
//                     from about -0.4 to 1.4 (four dots: 0 and 1).
//   industrial-small  1×1: small workshops -> works -> small plants (a boiler
//                     house, brewery, gasworks…). Tagged 'industrial', so growth
//                     rules and trips treat both the same.
// Brick halls with sawtooth or vaulted roofs, tapered chimneys, water towers,
// gasometers, silos, cooling towers, sawmills with gantry cranes; a
// glassworks, a panel plant, a coal power station, a lime works, a dairy and
// a Benzina petrol station. Coal mines are in mine.js.

import { stack, door, panel, timber, heap, tank, barrels, gantry, pipes, transformer, gallery, crates, roundWindows, hoops } from './kit.js';

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

// Gasometer: a drum with a shallow dome inside a frame of guide posts.
function gasometer(g, x, y, r, h) {
  g.lathe(x, y, 0, [[r, 0], [r, h], [r * 0.7, h + r * 0.2], [0, h + r * 0.28]], 14);
  g.detailed(1, () => {
    g.solid(x, y, h);
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8) * Math.PI * 2, px = x + Math.cos(a) * r * 1.08, py = y + Math.sin(a) * r * 1.08;
      g.line([[px, py, 0], [px, py, h + 0.08]]);
    }
  });
}

// Row of concrete silos touching each other along x, from x0, n of them.
function silos(g, x0, y, n, r, h) {
  for (let i = 0; i < n; i++) g.cylinder(x0 + r + i * 2 * r, y, 0, r, h, 10);
}

// Open shed: a roof on posts.
function openShed(g, x, y, w, d, h) {
  g.detailed(1, () => {
    g.solid(x + w / 2, y + d / 2, h / 2);
    for (const [px, py] of [[x, y], [x + w, y], [x + w, y + d], [x, y + d]]) g.line([[px, py, 0], [px, py, h]]);
  });
  g.roofed(x - 0.02, y - 0.02, h, w + 0.04, d + 0.04, 0.005, { h: 0.06 });
}

// Stacks of wall panels standing on edge (panel plant yard), along x.
function panelStacks(g, x0, x1, y, h = 0.1) {
  g.detailed(1, () => {
    for (let x = x0; x < x1 - 0.05; x += 0.12) {
      g.box(x, y - 0.04, 0, 0.1, 0.02, h);
      g.box(x, y + 0.01, 0, 0.1, 0.02, h * 0.8);
    }
  });
}

// Shaft kiln of a lime works: a tapered brick tower.
function limeKiln(g, x, y, h) {
  g.lathe(x, y, 0, [[0.11, 0], [0.08, h], [0.09, h + 0.02], [0.09, h + 0.05]], 4, { phase: 0.5 });
}

function loadingDoor(g, x, y, w, h) {
  g.line([[x, y, 0], [x, y, h], [x + w, y, h], [x + w, y, 0]], { facing: [0, -1, 0] });
}

export default {
  id: 'industrial',
  name: 'Industrial',
  blurb: 'Factories and yards · jobs',
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
        const kind = g.pick(['gable', 'long', 'sawmill', 'vaulted']);
        if (kind === 'gable') {
          g.gable(-0.3, -0.25, 0, 1.0, 0.65, g.range(0.24, 0.3), g.range(0.14, 0.2));
          g.windows(-0.3, -0.25, 1.0, 0.65, 0, 0.24, 0.24, 0.13, { skip: ['front'], h: 0.45 });
          loadingDoor(g, g.range(-0.1, 0.35), -0.25, 0.2, 0.16);
          g.box(0.8, 0.75, 0, 0.45, 0.4, 0.22);
          if (g.chance(0.6)) stack(g, 0.05, 1.05, g.range(0.45, 0.65), 0.05);
        } else if (kind === 'long') {
          g.gableY(-0.3, -0.3, 0, 0.62, 1.1, g.range(0.24, 0.3), g.range(0.16, 0.22));
          g.windows(-0.3, -0.3, 0.62, 1.1, 0, 0.24, 0.24, 0.13, { skip: ['front'], h: 0.45 });
          loadingDoor(g, -0.1, -0.3, 0.22, 0.16);
          g.box(0.5, -0.1, 0, 0.5, 0.4, 0.2);
          if (g.chance(0.5)) g.box(0.6, 0.55, 0, 0.6, 0.5, 0.26);
          if (g.chance(0.6)) stack(g, 1.2, 1.25, g.range(0.45, 0.65), 0.05);
        } else if (kind === 'sawmill') {
          // saw shed, an open drying shed, log piles under a gantry crane
          g.gable(-0.3, 0.7, 0, 0.8, 0.5, 0.22, 0.16);
          loadingDoor(g, -0.05, 0.7, 0.2, 0.15);
          openShed(g, 0.7, 0.55, 0.55, 0.65, 0.2);
          gantry(g, [-0.2, 0.25], [1.2, 0.25], 0.32);
          for (const x of [0.0, 0.35, 0.75]) timber(g, x, g.range(0.1, 0.35), true);
          if (g.chance(0.6)) stack(g, 0.4, 1.25, 0.5, 0.045);
        } else {
          // arched hall and a little office
          g.vault(-0.3, -0.2, 0, 0.9, 1.3, 0.18, 0.2, 6, { alongY: true });
          loadingDoor(g, -0.08, -0.2, 0.2, 0.15);
          g.roofed(0.8, -0.25, 0, 0.45, 0.35, 0.2, { h: 0.1, hip: 0.1 });
          g.windows(0.8, -0.25, 0.45, 0.35, 0, 0.2, 0.2, 0.1, { h: 0.45 });
          barrels(g, 1.05, 0.5);
          if (g.chance(0.5)) tank(g, 1.05, 0.95, 0.07, 0.15);
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
        const kind = g.pick(['sawtooth', 'sawtooth', 'vaults', 'mill', 'glass']);
        if (kind === 'glass') {
          // glassworks: the melting hall with a roof lantern, a brick kiln
          // cone, a tall chimney, sand and crates of glass in the yard
          g.gable(-0.32, -0.25, 0, 1.0, 0.6, 0.28, 0.18);
          g.windows(-0.32, -0.25, 1.0, 0.6, 0, 0.28, 0.28, 0.14, { w: 0.45, h: 0.6 });
          g.gable(-0.1, -0.1, 0.46, 0.56, 0.3, 0.06, 0.06);
          loadingDoor(g, 0.05, -0.25, 0.2, 0.16);
          g.lathe(0.95, 0.85, 0, [[0.26, 0], [0.25, 0.06], [0.2, 0.3], [0.09, 0.7], [0.07, 0.78]], 24, { smooth: true, rings: [1, 2] });
          g.detailed(2, () => roundWindows(g, 0.95, 0.85, 0.25, 0.0, 0.12, 0.2, 3, { w: 0.06, h: 0.11 }));
          stack(g, 1.22, 0.3, g.range(1.0, 1.2), 0.07);
          g.box(-0.3, 0.6, 0, 0.6, 0.45, 0.22);
          g.windows(-0.3, 0.6, 0.6, 0.45, 0, 0.22, 0.22, 0.12, { skip: ['front'], h: 0.45 });
          heap(g, 0.45, 1.2, 0.09);
          crates(g, 0.55, 0.55);
        } else if (kind === 'vaults') {
          // two arched halls side by side
          const h = g.range(0.22, 0.28);
          g.vault(-0.32, -0.28, 0, 0.62, 1.2, h, 0.22, 6, { alongY: true });
          g.vault(0.34, -0.28, 0, 0.62, 1.2, h, 0.22, 6, { alongY: true });
          loadingDoor(g, -0.12, -0.28, 0.22, 0.18);
          loadingDoor(g, 0.54, -0.28, 0.22, 0.18);
          stack(g, 1.22, 1.15, g.range(0.8, 1.0), 0.07);
          transformer(g, 1.2, 0.3);
          if (g.chance(0.5)) tank(g, 1.2, 0.7, 0.07, 0.18);
        } else if (kind === 'mill') {
          // old brick mill: tall storeys with rows of windows, a stair tower,
          // a boiler house and its chimney
          const fh = 0.15, h = fh * g.int(3, 4);
          g.roofed(-0.32, -0.25, 0, 1.2, 0.5, h, { h: 0.1, hip: 0 });
          g.windows(-0.32, -0.25, 1.2, 0.5, 0, h, fh, 0.1, { w: 0.5, h: 0.55 });
          g.roofed(0.9, -0.3, 0, 0.18, 0.18, h + 0.12, { h: 0.1, hip: 0.09 });
          g.gable(-0.3, 0.55, 0, 0.7, 0.45, 0.22, 0.12);
          loadingDoor(g, 0.1, -0.25, 0.16, 0.14);
          stack(g, 0.7, 0.95, g.range(0.9, 1.15), 0.08);
          heap(g, 1.1, 0.8, 0.1);
        } else {
          const teeth = g.int(3, 5);
          const x1 = g.range(1.1, 1.3), y1 = g.range(0.75, 0.9);
          sawtoothHall(g, -0.3, -0.25, x1, y1, g.range(0.26, 0.34), teeth, 0.13);
          loadingDoor(g, 0.0, -0.25, 0.22, 0.18);
          if (g.chance(0.6)) loadingDoor(g, 0.5, -0.25, 0.22, 0.18);
          const [cx, annexX] = g.pick([[1.12, 0.2], [-0.15, 0.55]]);
          stack(g, cx, 1.18, g.range(0.85, 1.1), 0.08);
          if (g.chance(0.5)) g.box(annexX, 1.0, 0, 0.45, 0.3, 0.2);
          else waterTower(g, annexX + 0.2, 1.15, g.range(0.5, 0.65));
        }
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
        const kind = g.pick(['works', 'works', 'heating', 'chemical', 'grain', 'panel', 'power', 'lime']);
        if (kind === 'panel') {
          // panel plant (panelárna): the casting hall, a gantry crane over
          // the yard of finished wall panels, cement silos and a mixing
          // tower fed by a conveyor
          g.roofed(-0.32, 0.45, 0, 1.64, 0.6, 0.34, { h: 0.08 });
          g.windows(-0.32, 0.45, 1.64, 0.6, 0.06, 0.3, 0.24, 0.12, { ribbon: true, skip: ['front'] });
          loadingDoor(g, 0.1, 0.45, 0.24, 0.24);
          gantry(g, [-0.3, 0.05], [1.3, 0.05], 0.38);
          panelStacks(g, -0.25, 1.25, -0.1);
          panelStacks(g, -0.25, 0.6, 0.2, 0.08);
          silos(g, 0.95, 1.2, 2, 0.08, 0.7);
          g.box(0.72, 1.08, 0, 0.16, 0.16, 0.8);
          g.box(0.7, 1.06, 0.8, 0.2, 0.2, 0.08);
          gallery(g, [1.3, 0.7, 0.05], [0.88, 1.12, 0.6], 0.05, 0.05);
        } else if (kind === 'power') {
          // coal power station: boiler house, turbine hall, one very tall
          // chimney, two cooling towers and the switchyard
          g.box(-0.32, 0.25, 0, 0.5, 0.5, 0.75);
          g.windows(-0.32, 0.25, 0.5, 0.5, 0.1, 0.72, 0.62, 0.08, { w: 0.5, h: 0.85 });
          g.roofed(-0.32, -0.3, 0, 0.9, 0.5, 0.36, { h: 0 });
          g.windows(-0.32, -0.3, 0.9, 0.5, 0, 0.36, 0.36, 0.1, { w: 0.45, h: 0.7 });
          stack(g, 0.4, 0.55, g.range(1.8, 2.1), 0.1);
          coolingTower(g, 0.1, 1.1, g.range(0.85, 0.95), 0.24);
          coolingTower(g, 0.65, 1.12, g.range(0.85, 0.95), 0.24);
          for (const x of [0.8, 1.0, 1.2]) transformer(g, x, -0.2);
          for (const x of [0.75, 1.3]) g.detailed(1, () => {
            g.solid(x, 0.1, 0.15);
            g.line([[x, 0.02, 0], [x, 0.1, 0.3], [x, 0.18, 0]]);
            g.line([[x, 0.03, 0.26], [x, 0.17, 0.26]]);
          });
          g.detailed(2, () => g.line([[0.75, 0.1, 0.26], [1.3, 0.1, 0.26]]));
          heap(g, 1.15, 0.55, 0.14);
          heap(g, 1.2, 0.95, 0.1);
        } else if (kind === 'lime') {
          // lime works (vápenka): a row of shaft kilns with a charging
          // bridge on top, a conveyor from the stone crusher, stone heaps
          const kh = g.range(0.65, 0.75);
          for (const x of [-0.15, 0.2, 0.55]) limeKiln(g, x, 0.9, kh);
          g.box(-0.3, 0.84, kh + 0.05, 1.0, 0.12, 0.06);
          g.box(0.9, 0.2, 0, 0.35, 0.35, 0.3);
          g.windows(0.9, 0.2, 0.35, 0.35, 0, 0.3, 0.15, 0.1, { w: 0.4 });
          gallery(g, [1.0, 0.55, 0.28], [0.68, 0.9, kh + 0.05], 0.05, 0.05);
          g.roofed(-0.32, -0.3, 0, 0.8, 0.4, 0.22, { h: 0.1 });
          g.windows(-0.32, -0.3, 0.8, 0.4, 0, 0.22, 0.22, 0.12, { skip: ['front'], h: 0.45 });
          loadingDoor(g, 0.0, -0.3, 0.2, 0.15);
          stack(g, 0.85, 1.2, g.range(0.9, 1.05), 0.06);
          heap(g, 1.1, -0.15, 0.12);
          heap(g, 1.15, 0.9, 0.13);
        } else if (kind === 'heating') {
          // heating plant: tall boiler house, twin stacks, coal, a cooling tower
          g.box(-0.32, -0.3, 0, 0.7, 0.55, 0.62);
          g.windows(-0.32, -0.3, 0.7, 0.55, 0.1, 0.6, 0.5, 0.08, { w: 0.6, h: 0.8 });
          g.roofed(0.42, -0.3, 0, 0.45, 0.55, 0.3, { h: 0.08 });
          g.windows(0.42, -0.3, 0.45, 0.55, 0, 0.3, 0.15, 0.1);
          stack(g, 1.15, -0.15, g.range(1.35, 1.6), 0.1);
          stack(g, 1.15, 0.25, g.range(1.2, 1.4), 0.09);
          coolingTower(g, 0.05, 1.0, g.range(0.9, 1.05), 0.28);
          heap(g, 0.75, 0.75, 0.13);
          heap(g, 1.1, 1.1, 0.11);
          pipes(g, [0.38, 0.3], [0.38, 0.72]);
        } else if (kind === 'chemical') {
          // tanks, a process column, pipe bridges, a gasometer
          g.box(-0.32, -0.3, 0, 0.8, 0.45, 0.3);
          g.windows(-0.32, -0.3, 0.8, 0.45, 0, 0.3, 0.15, 0.1, { ribbon: true });
          gasometer(g, 1.0, 1.0, 0.26, g.range(0.4, 0.5));
          g.lathe(0.95, -0.1, 0, [[0.06, 0], [0.06, 0.95], [0.03, 1.0], [0, 1.02]], 8);
          for (const [x, y] of [[-0.15, 0.55], [0.15, 0.55], [-0.15, 0.95], [0.15, 0.95]]) tank(g, x, y, 0.09, 0.2);
          pipes(g, [0.4, 0.35], [0.4, 1.2]);
          pipes(g, [0.4, 0.1], [0.9, 0.1], 0.18);
          stack(g, 1.25, 0.4, g.range(0.9, 1.1), 0.06);
        } else if (kind === 'grain') {
          // grain silos with a head house on top, a hall and a gantry
          const r = 0.12, h = g.range(0.75, 0.9);
          silos(g, -0.3, 0.95, 4, r, h);
          silos(g, -0.3, 0.71, 4, r, h);
          g.roofed(-0.1, 0.75, h, 0.45, 0.2, 0.15, { h: 0.06, hip: 0.06 });
          g.roofed(-0.32, -0.3, 0, 1.2, 0.5, 0.3, { h: 0.14 });
          g.windows(-0.32, -0.3, 1.2, 0.5, 0, 0.3, 0.3, 0.12, { skip: ['front'], h: 0.45 });
          loadingDoor(g, 0.2, -0.3, 0.26, 0.2);
          gantry(g, [0.95, 0.3], [0.95, 1.3], 0.34);
          stack(g, 1.25, -0.2, 0.9, 0.07);
        } else {
          sawtoothHall(g, -0.32, -0.32, 0.98, 0.72, g.range(0.34, 0.42), 3, 0.16);
          loadingDoor(g, -0.1, -0.32, 0.26, 0.22);
          const chimneys = g.int(1, 3);
          for (let i = 0; i < chimneys; i++) stack(g, 1.2, -0.2 + i * 0.32, g.range(1.1, 1.5), 0.09);
          if (g.chance(0.5)) {
            coolingTower(g, 0.3, 1.08, g.range(0.95, 1.15));
          } else {
            const n = g.int(1, 3);
            const siloH = g.range(0.45, 0.7);
            for (let i = 0; i < n; i++) g.cylinder(-0.1 + i * 0.4, 1.1, 0, 0.17, siloH, 10);
          }
          if (g.chance(0.6)) g.box(0.95, 0.95, 0, 0.4, 0.4, g.range(0.2, 0.32));
        }
      },
    },
  ],
};

// ----- 1×1 -----
// Front on -y (turned towards the road), keep within about ±0.4.

export const small = {
  id: 'industrial-small',
  name: 'Small industry',
  hotkey: 'i',
  category: 'zone',
  tags: ['industrial'],
  footprint: [[0, 0]],
  plot: { props: 'works', boundary: 0.6, kinds: ['tall', 'fence'], density: 0.45 },
  sim: { destinations: ['residential'] },

  levels: [
    {
      name: 'Workshop',
      stats: { jobs: 3 },
      agents: 1,
      yards: ['depot', 'parking'],
      draw(g) {
        const kind = g.pick(['garage', 'joinery', 'smithy', 'fuel']);
        if (kind === 'fuel') {
          // Benzina petrol station: a flat canopy over two pumps, a small
          // kiosk with a shop window, the price sign on a pole
          g.box(-0.34, -0.26, 0.12, 0.44, 0.24, 0.025);
          g.detailed(1, () => {
            g.solid(-0.12, -0.14, 0.06);
            for (const x of [-0.3, 0.06]) g.line([[x, -0.14, 0], [x, -0.14, 0.12]]);
          });
          for (const x of [-0.2, -0.05]) g.box(x - 0.015, -0.155, 0, 0.03, 0.03, 0.05);
          g.box(0.08, 0.02, 0, 0.3, 0.24, 0.12);
          g.windows(0.08, 0.02, 0.3, 0.24, 0, 0.12, 0.12, 0.1, { ribbon: true, skip: ['back'] });
          g.box(0.28, -0.33, 0, 0.02, 0.02, 0.2);
          g.box(0.24, -0.335, 0.2, 0.1, 0.03, 0.07);
          barrels(g, 0.3, 0.33);
        } else if (kind === 'garage') {
          // car repair shop: flat roof, two bays, a sign
          const w = 0.54, d = 0.4, y = -0.2, h = 0.18;
          g.box(-w / 2, y, 0, w, d, h);
          for (const x of [-0.22, 0.0]) loadingDoor(g, x, y, 0.18, 0.13);
          g.box(-0.15, y, h, 0.3, 0.025, 0.06);
          barrels(g, 0.3, 0.3);
        } else if (kind === 'joinery') {
          // gabled shed with a lean-to and planks drying outside
          g.gable(-0.3, -0.18, 0, 0.44, 0.36, 0.18, 0.13);
          loadingDoor(g, -0.18, -0.18, 0.14, 0.12);
          openShed(g, 0.16, -0.18, 0.18, 0.36, 0.13);
          timber(g, 0.05, 0.3, true);
        } else {
          // smithy / locksmith: a small gabled house with a stubby chimney
          g.roofed(-0.22, -0.18, 0, 0.44, 0.34, 0.17, { h: 0.14, hip: 0.05 });
          loadingDoor(g, -0.12, -0.18, 0.12, 0.12);
          g.windows(-0.22, -0.18, 0.44, 0.34, 0, 0.17, 0.17, 0.12, { skip: ['front'], h: 0.4 });
          stack(g, 0.15, 0.08, 0.42, 0.035);
          heap(g, -0.3, 0.3, 0.06);
        }
      },
    },
    {
      name: 'Works',
      stats: { jobs: 8 },
      agents: 1,
      yards: ['depot', 'parking'],
      grow: { requires: [{ type: 'residential', count: 3, radius: 4 }] },
      draw(g) {
        const kind = g.pick(['bakery', 'boiler', 'print', 'depot', 'dairy']);
        if (kind === 'dairy') {
          // dairy (mlékárna): a flat-roofed works with ribbon windows, steel
          // milk tanks beside it and a covered loading ramp for the churns
          g.box(-0.3, -0.05, 0, 0.44, 0.38, 0.26);
          g.windows(-0.3, -0.05, 0.44, 0.38, 0, 0.26, 0.13, 0.1, { ribbon: true });
          g.box(-0.34, -0.2, 0, 0.4, 0.15, 0.04);
          g.box(-0.36, -0.22, 0.14, 0.44, 0.17, 0.015);
          for (const [x, y] of [[0.28, -0.2], [0.28, 0.05], [0.28, 0.3]]) {
            g.lathe(x, y, 0, [[0.07, 0], [0.07, 0.22], [0.04, 0.26], [0, 0.27]], 20, { smooth: true, rings: [1] });
            hoops(g, x, y, 0.07, [0.08, 0.15]);
          }
          stack(g, -0.2, 0.3, 0.55, 0.04);
        } else if (kind === 'bakery') {
          // bakery / dairy: two storeys, hipped roof, a chimney at the back
          const w = 0.52, d = 0.38, y = -0.2, fh = 0.14, h = fh * 2;
          g.roofed(-w / 2, y, 0, w, d, h, { h: 0.12, hip: 0.1 });
          g.windows(-w / 2, y, w, d, 0, h, fh, 0.09, { from: 1 });
          loadingDoor(g, -0.2, y, 0.16, 0.11);
          panel(g, 0.0, 0.2, y, 0.03, 0.1);
          stack(g, 0.2, 0.3, 0.62, 0.045);
        } else if (kind === 'boiler') {
          // estate boiler house: tall blank brick box, big chimney, coal heap
          g.box(-0.3, -0.2, 0, 0.42, 0.36, 0.34);
          g.windows(-0.3, -0.2, 0.42, 0.36, 0.1, 0.32, 0.22, 0.1, { w: 0.4, h: 0.8 });
          loadingDoor(g, -0.22, -0.2, 0.14, 0.14);
          stack(g, 0.25, 0.15, g.range(0.9, 1.1), 0.07);
          heap(g, 0.25, -0.2, 0.08);
        } else if (kind === 'print') {
          // print works: a short sawtooth hall with an office front
          sawtoothHall(g, -0.3, -0.05, 0.3, 0.35, 0.2, 3, 0.09);
          g.box(-0.3, -0.3, 0, 0.6, 0.22, 0.26);
          g.windows(-0.3, -0.3, 0.6, 0.22, 0, 0.26, 0.13, 0.1, { ribbon: true, skip: ['back'] });
          door(g, 0.2, -0.3);
        } else {
          // arched depot shed with a tank beside it
          g.vault(-0.32, -0.25, 0, 0.44, 0.6, 0.14, 0.14, 6, { alongY: true });
          loadingDoor(g, -0.2, -0.25, 0.2, 0.13);
          tank(g, 0.25, 0.15, 0.07, 0.16);
          transformer(g, 0.25, -0.2);
        }
      },
    },
    {
      name: 'Small plant',
      stats: { jobs: 16 },
      agents: 2,
      yards: ['depot', 'parking'],
      grow: {
        requires: [
          { type: 'residential', count: 6, radius: 5 },
          { type: 'industrial', count: 1, radius: 3, minLevel: 2 },
        ],
        coveredBy: ['services'],
      },
      draw(g) {
        const kind = g.pick(['brewery', 'gasworks', 'silo', 'water']);
        if (kind === 'brewery') {
          // brewery: brewhouse, a tall malt house with a vent on its roof, chimney
          g.gable(-0.32, -0.2, 0, 0.36, 0.4, 0.26, 0.14);
          g.windows(-0.32, -0.2, 0.36, 0.4, 0, 0.26, 0.13, 0.1);
          g.roofed(0.06, -0.12, 0, 0.26, 0.26, 0.48, { h: 0.12, hip: 0.13 });
          g.windows(0.06, -0.12, 0.26, 0.26, 0, 0.48, 0.12, 0.08, { w: 0.35 });
          g.lathe(0.19, 0.01, 0.6, [[0.035, 0], [0.035, 0.05], [0.05, 0.06], [0, 0.1]], 6);
          stack(g, 0.28, 0.3, 0.75, 0.05);
          barrels(g, -0.25, 0.32);
        } else if (kind === 'gasworks') {
          gasometer(g, 0.08, 0.08, 0.26, g.range(0.34, 0.42));
          g.box(-0.36, -0.36, 0, 0.26, 0.16, 0.14);
          stack(g, -0.3, 0.3, 0.55, 0.04);
        } else if (kind === 'silo') {
          // concrete silo tower with a head house, a low hall in front
          silos(g, -0.2, 0.18, 2, 0.1, 0.8);
          g.roofed(-0.2, 0.08, 0.8, 0.4, 0.2, 0.12, { h: 0.05, hip: 0.05 });
          g.roofed(-0.32, -0.34, 0, 0.64, 0.3, 0.2, { h: 0.1 });
          loadingDoor(g, -0.1, -0.34, 0.2, 0.14);
        } else {
          // waterworks: pump house and a water tower
          g.roofed(-0.32, -0.2, 0, 0.4, 0.34, 0.22, { h: 0.14, hip: 0.1 });
          g.windows(-0.32, -0.2, 0.4, 0.34, 0, 0.22, 0.22, 0.1, { h: 0.5 });
          door(g, -0.12, -0.2);
          waterTower(g, 0.22, 0.18, g.range(0.8, 0.95));
          pipes(g, [0.08, 0.05], [0.22, 0.05], 0.08);
        }
      },
    },
  ],
};
