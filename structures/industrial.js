// Industry: workshops, works, factories and plants, each its own thing to
// build, in up to three sizes:
//   large   2×3 (workshop, factory, plant). Local area covers x from about
//           -0.4 to 1.4 and y from -0.4 to 2.4 (two dots wide, three deep);
//           the back third holds stores, sheds and a siding (backRange).
//   medium  2×1 (workshop, works, plant) along the road.
//   small   1×1 (workshop, works, plant: a boiler house, brewery, gasworks…).
// All are tagged 'industrial', so trucks and trips treat them the same.
// Brick halls with sawtooth or vaulted roofs, tapered chimneys, water towers,
// gasometers, silos, cooling towers, sawmills with gantry cranes; a
// glassworks, a panel plant, a coal power station, a lime works, a dairy and
// a Benzina petrol station. Coal mines are in mine.js.

import { stack, door, panel, timber, heap, tank, barrels, gantry, pipes, transformer, gallery, crates, roundWindows, hoops, fenceAlong, wagons, woodpile, trailer, bricks, concreteRings, FRAME } from './kit.js';

// Water tower: a drum on a column (the mushroom kind).
function waterTower(g, x, y, h) {
  g.lathe(x, y, 0, [[0.05, 0], [0.04, h * 0.7], [0.12, h * 0.82], [0.12, h * 0.95], [0.07, h], [0, h + 0.03]], 10);
}

// Hyperboloid cooling tower.
export function coolingTower(g, x, y, h, r = 0.3) {
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

// The back third of the 2×3 works (y from about 1.5 to 2.4), behind the
// main buildings: stores, open sheds, heaps and a railway siding, bigger
// with each size of works (1–3).
function backRange(g, level) {
  const kind = g.pick([['store', 'shed', 'heaps'], ['hall', 'store', 'siding'], ['store', 'tanks', 'siding']][level - 1]);
  if (kind === 'store') {
    // a long store with loading doors onto the yard
    const w = level === 1 ? 0.95 : 1.6, h = 0.18 + level * 0.05;
    g.gable(-0.3, 1.65, 0, w, 0.6, h, 0.14);
    g.windows(-0.3, 1.65, w, 0.6, 0, h, h, 0.14, { skip: ['front'], h: 0.4 });
    loadingDoor(g, -0.05, 1.65, 0.22, h * 0.7);
    if (level > 1) loadingDoor(g, 0.75, 1.65, 0.22, h * 0.7);
    else {
      timber(g, 1.05, 1.85, false);
      woodpile(g, 1.05, 2.25, true);
    }
  } else if (kind === 'shed') {
    openShed(g, -0.25, 1.65, 0.8, 0.6, 0.2);
    timber(g, 0.95, 1.8, false);
    trailer(g, 1.05, 2.22, true);
  } else if (kind === 'heaps') {
    // sand and gravel, a shed for the mixer and the tools
    heap(g, -0.05, 1.95, 0.14);
    heap(g, 0.4, 2.15, 0.1);
    g.gable(0.75, 1.7, 0, 0.5, 0.45, 0.18, 0.12);
    loadingDoor(g, 0.9, 1.7, 0.18, 0.13);
    concreteRings(g, 0.35, 1.7);
    bricks(g, 1.0, 2.3);
  } else if (kind === 'hall') {
    g.gable(-0.3, 1.6, 0, 1.6, 0.65, 0.26, 0.16);
    g.windows(-0.3, 1.6, 1.6, 0.65, 0, 0.26, 0.26, 0.13, { w: 0.5, h: 0.55 });
    loadingDoor(g, 0.4, 1.6, 0.24, 0.18);
  } else if (kind === 'tanks') {
    for (const x of [-0.15, 0.2, 0.55]) tank(g, x, 1.8, 0.1, 0.22);
    silos(g, 0.85, 2.05, 2, 0.12, g.range(0.55, 0.7));
    pipes(g, [-0.25, 2.2], [0.7, 2.2]);
  } else {
    // a siding along the back with wagons, the goods shed on its ramp
    g.gable(-0.3, 1.55, 0, 1.1, 0.34, 0.2, 0.12);
    loadingDoor(g, 0.1, 1.55, 0.22, 0.15);
    g.box(-0.3, 1.89, 0, 1.1, 0.1, 0.05);                              // ramp
    wagons(g, -0.25, 2.2, 5, true);
    if (level === 3) gantry(g, [0.95, 1.6], [0.95, 2.35], 0.32);
  }
}

export const workshopLarge = {
  id: 'workshop-large',
  name: 'Workshop',
  blurb: 'Workshops and yards',
  size: 'Large',
  category: 'work',
  tags: ['industrial'],
  code: 'I',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]],
  plot: { props: 'works', boundary: 0.7, kinds: ['tall'], density: 0.4 },
  sim: { destinations: ['residential'] },
  stats: { jobs: 10 },
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
    backRange(g, 1);
  },
};

export const factory = {
  id: 'factory',
  name: 'Factory',
  blurb: 'Brick halls and a chimney',
  category: 'work',
  tags: ['industrial'],
  code: 'I',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]],
  plot: { props: 'works', boundary: 0.7, kinds: ['tall'], density: 0.4 },
  sim: { destinations: ['residential'] },
  stats: { jobs: 26 },
  agents: 2,
  yards: ['parking', 'depot'],
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
    backRange(g, 2);
  },
};

export const plant = {
  id: 'plant',
  name: 'Plant',
  blurb: 'Heavy industry, power, chemicals',
  size: 'Large',
  category: 'work',
  tags: ['industrial'],
  code: 'I',
  trucks: 2,
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]],
  plot: { props: 'works', boundary: 0.7, kinds: ['tall'], density: 0.4 },
  sim: { destinations: ['residential'] },
  stats: { jobs: 55 },
  agents: 3,
  yards: ['depot', 'parking'],
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
    backRange(g, 3);
  },
};

// ----- 1×1 -----
// Front on -y (turned towards the road), keep within about ±0.4.

export const workshop = {
  id: 'workshop',
  name: 'Workshop',
  blurb: 'Workshops and yards',
  size: 'Small',
  category: 'work',
  tags: ['industrial'],
  code: 'I',
  footprint: [[0, 0]],
  plot: { props: 'works', boundary: 0.6, kinds: ['tall', 'fence'], density: 0.45 },
  sim: { destinations: ['residential'] },
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
};

export const works = {
  id: 'works',
  name: 'Works',
  blurb: 'Bakery, dairy, print shop',
  size: 'Small',
  category: 'work',
  tags: ['industrial'],
  code: 'I',
  footprint: [[0, 0]],
  plot: { props: 'works', boundary: 0.6, kinds: ['tall', 'fence'], density: 0.45 },
  sim: { destinations: ['residential'] },
  stats: { jobs: 8 },
  agents: 1,
  yards: ['depot', 'parking'],
  draw(g) {
    const kind = g.pick(['bakery', 'boiler', 'print', 'depot', 'dairy', 'substation']);
    if (kind === 'substation') {
      // electrical substation: a fenced switchyard of transformers under
      // a steel portal carrying the lines, and a brick control house
      g.roofed(-0.34, -0.3, 0, 0.26, 0.22, 0.16, { h: 0.08, hip: 0.08 });
      g.windows(-0.34, -0.3, 0.26, 0.22, 0, 0.16, 0.16, 0.09, { skip: ['front'], h: 0.45 });
      door(g, -0.21, -0.3, 0.05, 0.1);
      for (const [x, y] of [[0.0, 0.05], [0.22, 0.05], [0.0, 0.28], [0.22, 0.28]]) transformer(g, x, y);
      g.detailed(1, () => {
        g.solid(0.11, 0.17, 0.2);
        for (const x of [-0.1, 0.32]) for (const y of [0.0, 0.34]) g.line([[x, y, 0], [x, y, 0.32]], FRAME);
        for (const y of [0.0, 0.34]) g.line([[-0.1, y, 0.32], [0.32, y, 0.32]], FRAME);
        for (const x of [-0.1, 0.11, 0.32]) g.line([[x, 0.0, 0.3], [x, 0.34, 0.3]]);
      });
      fenceAlong(g, [[-0.05, -0.12], [0.38, -0.12], [0.38, 0.4], [-0.16, 0.4], [-0.16, -0.05]], 0.07);
    } else if (kind === 'dairy') {
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
};

export const plantSmall = {
  id: 'plant-small',
  name: 'Plant',
  blurb: 'Heavy industry, power, chemicals',
  size: 'Small',
  category: 'work',
  tags: ['industrial'],
  code: 'I',
  footprint: [[0, 0]],
  plot: { props: 'works', boundary: 0.6, kinds: ['tall', 'fence'], density: 0.45 },
  sim: { destinations: ['residential'] },
  stats: { jobs: 16 },
  agents: 2,
  yards: ['depot', 'parking'],
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
      // grain silo: two concrete bins with conical caps, the elevator
      // tower beside them (not on top: solids must stand side by side
      // to sort in depth), a low hall in front
      const sh = g.range(0.7, 0.8);
      for (const x of [-0.24, -0.04]) {
        g.lathe(x, 0.2, 0, [[0.1, 0], [0.1, sh], [0.03, sh + 0.07], [0, sh + 0.07]], 16, { smooth: true, rings: [1] });
        hoops(g, x, 0.2, 0.1, [0.2, 0.4, 0.6]);
      }
      g.roofed(0.08, 0.12, 0, 0.18, 0.18, sh + 0.2, { h: 0.1, hip: 0.09 });
      g.windows(0.08, 0.12, 0.18, 0.18, 0.1, sh + 0.2, 0.15, 0.08, { w: 0.35 });
      g.roofed(-0.32, -0.34, 0, 0.64, 0.28, 0.2, { h: 0.1 });
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
};

// ----- 2×1 -----
// Two dots side by side along the road: local x from about -0.4 to 1.4,
// y from -0.4 to 0.4, front on -y.

export const workshopMedium = {
  id: 'workshop-medium',
  name: 'Workshop',
  blurb: 'Workshops and yards',
  size: 'Medium',
  category: 'work',
  tags: ['industrial'],
  code: 'I',
  footprint: [[0, 0], [1, 0]],
  plot: { props: 'works', boundary: 0.65, kinds: ['tall', 'fence'], density: 0.45 },
  sim: { destinations: ['residential'] },
  stats: { jobs: 5 },
  agents: 1,
  yards: ['depot', 'parking'],
  draw(g) {
    const kind = g.pick(['builders', 'garage', 'joinery']);
    if (kind === 'builders') {
      // the town's builders' yard: a tool shed, an open shed, sand,
      // bricks and well rings
      g.gable(-0.32, -0.1, 0, 0.7, 0.42, 0.2, 0.13);
      g.windows(-0.32, -0.1, 0.7, 0.42, 0, 0.2, 0.2, 0.12, { skip: ['front'], h: 0.4 });
      loadingDoor(g, -0.15, -0.1, 0.18, 0.14);
      openShed(g, 0.5, -0.02, 0.5, 0.34, 0.16);
      heap(g, 1.2, -0.18, 0.1);
      bricks(g, 0.7, -0.25);
      concreteRings(g, 1.22, 0.22);
    } else if (kind === 'garage') {
      // vehicle depot (ČSAD, the local services): a row of bays under a flat roof
      const y = -0.2, d = 0.42, h = 0.2;
      g.box(-0.3, y, 0, 1.6, d, h);
      for (const x of [-0.24, 0.14, 0.52, 0.9]) loadingDoor(g, x, y, 0.3, 0.15);
      g.box(0.2, y, h, 0.6, 0.025, 0.06);
      barrels(g, 1.36, 0.3);
    } else {
      // joinery: a long gabled shed, the sawdust burner's chimney,
      // planks and firewood outside
      g.gable(-0.3, -0.2, 0, 1.1, 0.4, 0.2, 0.15);
      g.windows(-0.3, -0.2, 1.1, 0.4, 0, 0.2, 0.2, 0.12, { skip: ['front'], h: 0.45 });
      loadingDoor(g, -0.1, -0.2, 0.2, 0.14);
      loadingDoor(g, 0.45, -0.2, 0.2, 0.14);
      stack(g, 0.65, 0.12, 0.5, 0.035);
      timber(g, 1.1, -0.1, false);
      woodpile(g, 1.12, 0.25, false);
    }
  },
};

export const worksMedium = {
  id: 'works-medium',
  name: 'Works',
  blurb: 'Bakery, dairy, print shop',
  size: 'Medium',
  category: 'work',
  tags: ['industrial'],
  code: 'I',
  footprint: [[0, 0], [1, 0]],
  plot: { props: 'works', boundary: 0.65, kinds: ['tall', 'fence'], density: 0.45 },
  sim: { destinations: ['residential'] },
  stats: { jobs: 12 },
  agents: 2,
  yards: ['depot', 'parking'],
  draw(g) {
    const kind = g.pick(['sawtooth', 'bakery', 'metal']);
    if (kind === 'sawtooth') {
      // a sawtooth hall behind a two-storey office front
      sawtoothHall(g, 0.15, -0.2, 1.32, 0.3, 0.24, 4, 0.1);
      loadingDoor(g, 0.85, -0.2, 0.24, 0.17);
      g.box(-0.32, -0.3, 0, 0.44, 0.5, 0.28);
      g.windows(-0.32, -0.3, 0.44, 0.5, 0, 0.28, 0.14, 0.1, { ribbon: true, skip: ['right'] });
      door(g, 0, -0.3);
    } else if (kind === 'bakery') {
      // bread works (pekárna): a flat-roofed block, the vans' covered ramp
      g.box(-0.3, -0.2, 0, 1.2, 0.42, 0.3);
      g.windows(-0.3, -0.2, 1.2, 0.42, 0, 0.3, 0.15, 0.1, { ribbon: true });
      door(g, 0, -0.2);
      g.box(0.9, -0.12, 0, 0.38, 0.3, 0.05);                  // ramp
      g.box(0.88, -0.16, 0.17, 0.44, 0.36, 0.015);            // its roof
      stack(g, 0.7, 0.3, 0.72, 0.05);
    } else {
      // metalworks co-op (Kovo): an arched hall along the road, an office
      g.vault(0.1, -0.2, 0, 1.2, 0.42, 0.16, 0.14, 6);
      loadingDoor(g, 0.85, -0.2, 0.22, 0.13);
      g.roofed(-0.32, -0.25, 0, 0.38, 0.34, 0.22, { h: 0.1, hip: 0.1 });
      g.windows(-0.32, -0.25, 0.38, 0.34, 0, 0.22, 0.11, 0.1, { h: 0.45 });
      door(g, -0.03, -0.25, 0.06, 0.1);
      stack(g, 1.25, 0.3, 0.6, 0.045);
    }
  },
};

export const plantMedium = {
  id: 'plant-medium',
  name: 'Plant',
  blurb: 'Heavy industry, power, chemicals',
  size: 'Medium',
  category: 'work',
  tags: ['industrial'],
  code: 'I',
  footprint: [[0, 0], [1, 0]],
  plot: { props: 'works', boundary: 0.65, kinds: ['tall', 'fence'], density: 0.45 },
  sim: { destinations: ['residential'] },
  stats: { jobs: 26 },
  agents: 2,
  yards: ['depot', 'parking'],
  draw(g) {
    const kind = g.pick(['brewery', 'dairy', 'heating']);
    if (kind === 'brewery') {
      // town brewery: the brewhouse, a tall malt house with its vent,
      // the cellar block, a chimney and barrels
      g.gable(-0.32, -0.2, 0, 0.5, 0.42, 0.28, 0.14);
      g.windows(-0.32, -0.2, 0.5, 0.42, 0, 0.28, 0.14, 0.1, { skip: ['right'] });
      door(g, -0.07, -0.2);
      g.roofed(0.22, -0.14, 0, 0.32, 0.3, 0.5, { h: 0.12, hip: 0.15 });
      g.windows(0.22, -0.14, 0.32, 0.3, 0, 0.5, 0.125, 0.08, { w: 0.35 });
      g.lathe(0.38, 0.01, 0.62, [[0.035, 0], [0.035, 0.05], [0.05, 0.06], [0, 0.1]], 6);
      g.roofed(0.58, -0.2, 0, 0.72, 0.4, 0.2, { h: 0.08 });
      g.windows(0.58, -0.2, 0.72, 0.4, 0, 0.2, 0.2, 0.12, { h: 0.35, skip: ['left'] });
      loadingDoor(g, 0.9, -0.2, 0.2, 0.14);
      stack(g, 1.2, 0.3, 0.85, 0.055);
      barrels(g, 1.35, -0.28);
    } else if (kind === 'dairy') {
      // district dairy: ribbon-windowed works, steel milk tanks, a ramp
      g.box(-0.3, -0.1, 0, 0.9, 0.42, 0.28);
      g.windows(-0.3, -0.1, 0.9, 0.42, 0, 0.28, 0.14, 0.1, { ribbon: true });
      g.box(-0.34, -0.25, 0, 0.7, 0.15, 0.04);
      g.box(-0.36, -0.27, 0.15, 0.74, 0.17, 0.015);
      for (const x of [0.82, 1.12]) for (const y of [-0.15, 0.17]) {
        g.lathe(x, y, 0, [[0.08, 0], [0.08, 0.26], [0.045, 0.3], [0, 0.31]], 20, { smooth: true, rings: [1] });
        hoops(g, x, y, 0.08, [0.09, 0.18]);
      }
      stack(g, 0.4, 0.3, 0.65, 0.045);
    } else {
      // heating plant (výtopna): the offices, the tall boiler house, a
      // conveyor up from the coal heap, a tall chimney
      g.roofed(-0.3, -0.2, 0, 0.5, 0.42, 0.25, { h: 0.07 });
      g.windows(-0.3, -0.2, 0.5, 0.42, 0, 0.25, 0.125, 0.1, { skip: ['right'] });
      door(g, 0, -0.2);
      g.box(0.2, -0.25, 0, 0.55, 0.5, 0.5);
      g.windows(0.2, -0.25, 0.55, 0.5, 0.08, 0.48, 0.4, 0.09, { w: 0.5, h: 0.85, skip: ['left'] });
      stack(g, 1.18, 0.22, g.range(1.2, 1.4), 0.08);
      heap(g, 1.12, -0.18, 0.12);
      gallery(g, [1.06, -0.12, 0.06], [0.75, -0.02, 0.42], 0.05, 0.05);
      transformer(g, 0.95, 0.3);
    }
  },
};
