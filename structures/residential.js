// A structure definition. Everything the game knows about a building type
// lives here. Housing: House, Apartments and Block, each one dot or two
// (the Wide ones) – separate things to build, nothing grows into another.
//
//   id          unique key (saved in save files, don't rename casually)
//   name        shown in the UI
//   footprint   grid offsets it occupies, relative to its anchor dot
//               ([[0,0]] = one dot, [[0,0],[1,0],[0,1],[1,1]] = 2×2)
//   sim         agent behaviour: which activity weights its dots use
//               (activities, config.activities), where they work
//               (destinations) and relax (leisure)
//   stats       free-form numbers read by the HUD / future economy
//   agents      how many moving dots it spawns
//   yards       surroundings styles it may get (structures/yards.js)
//   join        { group, chance }: may share walls with its neighbours
//               (see joinSides in structures/index.js and g.join)
//   tilt        true: may stand a little askew when on its own
//               (see tiltOf in structures/index.js and LOOK.tilt)
//   plot        sides and back of the building (structures/plots.js)
//   draw(g,s)   drawing, using the painter API documented in src/render/painter.js.
//               Local units: (0,0,0) is the anchor dot, 1 = one grid step, z is up.
//               The front (door, shop window) goes on the -y side: single-dot
//               buildings are turned so that side faces their road.
//               Use g.pick / g.range / g.chance for variety – they are seeded
//               per building, so each one keeps its look.
//               Keep within about ±0.4 of the footprint dots, and keep separate
//               solids side by side rather than overlapping.

import { door, panel, chimney, aerials, frontage, shared, hips } from './kit.js';
import { LOOK } from '../src/render/painter.js';

const FRONT = [0, -1, 0];

// What every home shares.
const HOME = {
  category: 'housing',
  tags: ['residential'],
  code: 'R',
  access: 'any', // a footpath will do: people walk or cycle
  sim: { activities: 'resident', destinations: ['business', 'industrial', 'farm'], leisure: ['park', 'square', 'heritage', 'cemetery'] },
};

// A few windows high up in a street-facing gable (ridge along y).
function gableWindow(g, x, y, z, s = 0.035) {
  panel(g, x - s / 2, x + s / 2, y, z, z + s * 1.3);
}

// One window on the front (-y) wall at depth y, like g.windows() draws
// them: an ink block (LOOK.ink) or an outline. (cx, z): bottom middle.
function frontWindow(g, cx, y, z, w, h) {
  g.line([[cx - w / 2, y, z], [cx + w / 2, y, z], [cx + w / 2, y, z + h], [cx - w / 2, y, z + h], [cx - w / 2, y, z]],
    { facing: FRONT, cls: LOOK.ink ? 'ink' : undefined });
}

// South Bohemian farmstead (Holašovice): a one-storey house with a steep
// gable to the street and its door on the side; a trim along the gable's
// edge, windows in the gable and quoins on the corners.
function farmstead(g) {
  const side = g.pick([-1, 1]); // the side the door is on: local -x or +x
  const w = g.range(0.26, 0.3), d = g.range(0.42, 0.48), h = g.range(0.15, 0.17), r = g.range(0.26, 0.31);
  const cx = 0, x0 = cx - w / 2, x1 = cx + w / 2, y = -d / 2;
  const line = (pts) => g.line(pts, { facing: FRONT });

  // the house: three windows to the street, a plinth and a cornice
  g.roofed(x0, y, 0, w, d, h, { h: r, ridge: 'y' });
  g.windows(x0, y, w, d, 0, h, h, 0.085, { h: 0.42, skip: ['front'] });
  for (const k of [-1, 0, 1]) frontWindow(g, cx + k * w * 0.29, y, h * 0.36, 0.034, h * 0.38);
  line([[x0, y, 0.025], [x1, y, 0.025]]);
  line([[x0 - 0.008, y, h], [x1 + 0.008, y, h]]);
  // quoins: short courses up both corners
  for (let z = 0.04; z < h - 0.01; z += 0.03) {
    line([[x0, y, z], [x0 + 0.022, y, z]]);
    line([[x1 - 0.022, y, z], [x1, y, z]]);
  }
  // trim along the gable's edge, windows in the gable
  line([[x0 + 0.02, y, h + 0.012], [cx, y, h + r - 0.035], [x1 - 0.02, y, h + 0.012]]);
  for (const k of [-1, 1]) frontWindow(g, cx + k * w * 0.2, y, h + 0.035, 0.03, 0.045);
  frontWindow(g, cx, y, h + r * 0.5, 0.026, 0.04);
  chimney(g, cx + g.range(-0.02, 0.02), g.range(0.02, 0.12), h + r * 0.4, r * 0.75);

  // the door on the side, near the front
  const xd = side > 0 ? x1 : x0, yd = y + d * 0.3;
  g.line([[xd, yd - 0.025, 0], [xd, yd - 0.025, 0.1], [xd, yd + 0.025, 0.1], [xd, yd + 0.025, 0]], { facing: [side, 0, 0] });
}

// Family houses: the 70s "cube" with a pyramid roof, village houses
// with their gable to the street, long farmhouses, villas, and old
// farmsteads with their gable to the street.
export const house = {
  id: 'house',
  name: 'House',
  blurb: 'A family house',
  ...HOME,
  footprint: [[0, 0]],
  plot: { props: 'garden', boundary: 0.6, kinds: ['fence', 'hedge'], density: 0.4 },
  stats: { residents: 4 },
  agents: 1,
  yards: ['garden', 'garden', 'trees'],
  tilt: true,
  draw(g) {
    const kind = g.pick(['cube', 'cube', 'street', 'street', 'farm', 'villa', 'mansard', 'farmstead', 'farmstead']);
    if (kind === 'farmstead') {
      farmstead(g);
    } else if (kind === 'cube') {
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
};

// Town blocks: pre-war tenements (mansard or hipped), 50s blocks,
// narrow gabled burgher houses. Neighbours often share walls and
// form a street front.
export const apartments = {
  id: 'apartments',
  name: 'Apartments',
  blurb: 'Tenements and town blocks',
  ...HOME,
  footprint: [[0, 0]],
  plot: { props: 'green', boundary: 0.3, kinds: ['hedge'], density: 0.4 },
  stats: { residents: 12 },
  agents: 2,
  yards: ['garden', 'trees', 'plaza'],
  join: { group: 'street', chance: 0.75 },
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
};

// Prefab panel housing: long slabs built in sections (joined
// neighbours make one long block, sections slightly offset) and
// point towers.
export const block = {
  id: 'block',
  name: 'Block',
  blurb: 'Prefab panel housing',
  ...HOME,
  footprint: [[0, 0]],
  plot: { props: 'estate', boundary: 0.2, kinds: ['hedge'], density: 0.4 },
  stats: { residents: 32 },
  agents: 3,
  yards: ['plaza', 'trees', 'parking', 'garages'],
  join: { group: 'slab', chance: 0.85 },
  draw(g) {
    const joined = g.join.left || g.join.right;
    const kind = joined ? 'slab' : g.pick(['slab', 'slab', 'point']);
    const fh = 0.1, skip = shared(g);
    const machineRoom = (x, y, z) => g.box(x - 0.07, y - 0.05, z, 0.14, 0.1, 0.07);
    if (kind === 'slab') {
      const [x0, x1] = frontage(g, 0.92);
      const w = x1 - x0, d = 0.46, y = -d / 2 + (joined ? g.pick([-0.04, 0, 0.04]) : 0);
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
      const sx = g.range(0.4, 0.44), sy = g.range(0.24, 0.28), h = fh * g.int(12, 14);
      g.box(-sx, -sy, 0, 2 * sx, 2 * sy, h);
      g.windows(-sx, -sy, 2 * sx, 2 * sy, 0, h, fh, 0.1, { w: 0.5, from: 1 });
      g.floors(-sx, -sy, 2 * sx, 2 * sy, 0, h, fh, { inset: 0 });
      machineRoom(0, 0, h);
      aerials(g, -sx + 0.05, sx - 0.05, sy * 0.5, h, 2);
      g.box(-0.08, -sy - 0.06, 0.08, 0.16, 0.06, 0.015);
    }
  },
};

// ----- 2×1 -----
// Two dots side by side along the road: local x from about -0.4 to 1.4,
// y from -0.4 to 0.4, front on -y. The player turns it to face the road.
// The way in may come to either dot, so there is a door near both (x = 0, 1).

// Balconies on the front (-y) wall at depth y: one at each x, every storey
// `fh` from z0 up to z1.
function balconies(g, xs, y, z0, z1, fh) {
  g.detailed(2, () => {
    for (let z = z0; z < z1 - 1e-6; z += fh) {
      for (const x of xs) g.box(x - 0.05, y - 0.035, z, 0.1, 0.035, 0.03);
    }
  });
}

// Semi-detached houses (dvojdomek) under one roof, a pair of 70s
// cubes, a row of 80s terraced houses, and a village house with its
// eaves to the street and the barn under the same ridge.
export const houseWide = {
  id: 'house-wide',
  name: 'House',
  blurb: 'Houses, two plots',
  size: 'Wide',
  ...HOME,
  footprint: [[0, 0], [1, 0]],
  plot: { props: 'garden', boundary: 0.6, kinds: ['fence', 'hedge'], density: 0.4 },
  stats: { residents: 8 },
  agents: 2,
  yards: ['garden', 'garden', 'trees'],
  draw(g) {
    const kind = g.pick(['twin', 'twin', 'cubes', 'row', 'longhouse']);
    if (kind === 'twin') {
      const w = g.range(0.96, 1.04), d = g.range(0.36, 0.4), h = 0.28, r = g.range(0.1, 0.13);
      const x0 = 0.5 - w / 2, y = -d / 2;
      g.roofed(x0, y, 0, w, d, h, { h: r, hip: g.range(0.14, 0.2) });
      g.windows(x0, y, w, d, 0, h, h / 2, 0.11, { h: 0.4 });
      g.line([[0.5, y, 0], [0.5, y, h]], { facing: FRONT });              // party wall
      for (const x of [x0 + 0.07, x0 + w - 0.07]) door(g, x, y, 0.06, 0.11);
      for (const x of [0.3, 0.7]) chimney(g, x, 0.04, h, r + 0.05);
      if (g.chance(0.5)) g.box(x0 + w, y + 0.12, 0, 0.16, d - 0.12, 0.11); // garage
    } else if (kind === 'cubes') {
      for (const cx of [0, 1]) {
        const s = g.range(0.34, 0.4), h = 0.3, r = g.range(0.07, 0.1);
        g.roofed(cx - s / 2, -s / 2, 0, s, s, h, { h: r, hip: s / 2 });
        g.windows(cx - s / 2, -s / 2, s, s, 0, h, h / 2, 0.11, { h: 0.4 });
        chimney(g, cx + g.range(-0.06, 0.06), 0.04, h, r + 0.06);
        door(g, cx + g.range(-0.06, 0.06), -s / 2, 0.06, 0.11);
      }
    } else if (kind === 'row') {
      const n = g.int(3, 4), x0 = -0.3, x1 = 1.3, w = (x1 - x0) / n, d = 0.4;
      const flat = g.chance(0.4);
      for (let i = 0; i < n; i++) {
        const a = x0 + i * w, y = -d / 2 + (i % 2 ? 0.03 : 0), h = 0.26;
        const skip = [i > 0 && 'left', i < n - 1 && 'right'].filter(Boolean);
        if (flat) g.box(a, y, 0, w, d, h);
        else g.roofed(a, y, 0, w, d, h, { h: g.range(0.14, 0.17), ridge: 'y' });
        g.windows(a, y, w, d, 0, h, h / 2, 0.1, { skip, h: 0.4 });
        door(g, a + w * 0.3, y, 0.05, 0.1);
      }
    } else {
      // house on the left, barn on the right, one long ridge
      const d = g.range(0.32, 0.36), y = -d / 2, h = 0.17, r = g.range(0.18, 0.22);
      const x0 = -0.32, xm = x0 + g.range(0.7, 0.8), x1 = 1.3;
      g.roofed(x0, y, 0, xm - x0, d, h, { h: r, hip: [0.07, 0] });
      g.windows(x0, y, xm - x0, d, 0, h, h, 0.11, { h: 0.4, skip: ['right'] });
      door(g, x0 + 0.1, y, 0.06, 0.11);
      chimney(g, (x0 + xm) / 2, 0.02, h + r * 0.5, r * 0.65);
      g.roofed(xm, y, 0, x1 - xm, d, h + 0.02, { h: r, hip: [0, 0.07] });
      g.line([[x1 - 0.32, y, 0], [x1 - 0.32, y, 0.15], [x1 - 0.1, y, 0.15], [x1 - 0.1, y, 0]], { facing: FRONT });
      g.detailed(2, () => g.line([[x1 - 0.32, y, 0], [x1 - 0.1, y, 0.15]], { facing: FRONT }));
      door(g, xm + 0.1, y, 0.06, 0.11);
    }
  },
};

// Town blocks two plots long: a 50s block with two entrances, a pair
// of tenements of different heights, an early-60s block with
// balconies under a low roof.
export const apartmentsWide = {
  id: 'apartments-wide',
  name: 'Apartments',
  blurb: 'Town blocks, two plots',
  size: 'Wide',
  ...HOME,
  footprint: [[0, 0], [1, 0]],
  plot: { props: 'green', boundary: 0.3, kinds: ['hedge'], density: 0.4 },
  stats: { residents: 24 },
  agents: 3,
  yards: ['garden', 'trees', 'plaza'],
  draw(g) {
    const kind = g.pick(['sorela', 'tenements', 'balconies']);
    const x0 = -0.32, x1 = 1.32, w = x1 - x0;
    if (kind === 'sorela') {
      const fh = 0.14, h = fh * 4, d = g.range(0.4, 0.44), y = -d / 2;
      g.roofed(x0, y, 0, w, d, h, { h: 0.13, hip: 0.14 });
      g.windows(x0, y, w, d, 0, h, fh, 0.1, { from: 1 });
      g.floors(x0, y, w, d, 0, fh * 1.05, fh);
      g.line([[x0 - 0.01, y, h - 0.02], [x1 + 0.01, y, h - 0.02]], { facing: FRONT }); // cornice
      for (const cx of [0.05, 0.95]) {
        panel(g, cx - 0.06, cx + 0.06, y, 0, fh * 1.4);
        door(g, cx, y, 0.06, fh * 0.8);
      }
      for (const cx of [0.25, 0.75]) chimney(g, cx, y + d * 0.7, h, 0.16);
    } else if (kind === 'tenements') {
      const d = g.range(0.4, 0.46), y = -d / 2, fh = 0.13, xm = 0.5 + g.range(-0.08, 0.08);
      const mansard = g.chance(0.5);
      for (const [a, b, hip, skip, dx] of [[x0, xm, [0.12, 0], ['right'], 0.05], [xm, x1, [0, 0.12], ['left'], 0.95]]) {
        const h = fh * g.int(4, 5);
        if (mansard) g.roofed(a, y, 0, b - a, d, h, { h: 0.05, hip, mansard: { h: 0.1, inset: 0.05 } });
        else g.roofed(a, y, 0, b - a, d, h, { h: g.range(0.13, 0.17), hip });
        g.windows(a, y, b - a, d, 0, h, fh, 0.085, { skip });
        door(g, dx, y, 0.07, fh * 0.8);
        chimney(g, (a + b) / 2, y + d * 0.7, h, 0.17);
      }
    } else {
      const fh = 0.12, h = fh * 4, d = 0.36, y = -d / 2;
      g.roofed(x0, y, 0, w, d, h, { h: 0.06 });
      g.windows(x0, y, w, d, 0, h, fh, 0.1, { w: 0.5 });
      g.floors(x0, y, w, d, 0, h, fh, { inset: 0 });
      balconies(g, [-0.12, 0.3, 0.7, 1.12], y, fh, h, fh);
      for (const cx of [0.05, 0.95]) {
        door(g, cx, y, 0.06, fh * 0.8);
        g.box(cx - 0.06, y - 0.05, 0.1, 0.12, 0.05, 0.012); // canopy
      }
      aerials(g, x0 + 0.1, x1 - 0.1, 0, h + 0.03, 3);
    }
  },
};

// A prefab panel slab in two sections, the second a step back and
// sometimes taller, with an entrance and a lift room to each.
export const blockWide = {
  id: 'block-wide',
  name: 'Block',
  blurb: 'Panel slab, two plots',
  size: 'Wide',
  ...HOME,
  footprint: [[0, 0], [1, 0]],
  plot: { props: 'estate', boundary: 0.2, kinds: ['hedge'], density: 0.4 },
  stats: { residents: 64 },
  agents: 5,
  yards: ['plaza', 'trees', 'parking', 'garages'],
  draw(g) {
    const fh = 0.1, d = 0.46;
    const floors = g.pick([[8, 8], [8, 8], [12, 12], [8, 12], [12, 8]]);
    const step = g.pick([0, 0.04, -0.04]);
    [[-0.46, 0.5, 0], [0.5, 1.46, step]].forEach(([a, b, dy], i) => {
      const w = b - a, y = -d / 2 + dy, h = fh * floors[i];
      const skip = [i === 1 && !dy && floors[0] >= floors[1] ? 'left' : null, i === 0 && !step && floors[1] >= floors[0] ? 'right' : null].filter(Boolean);
      g.box(a, y, 0, w, d, h);
      g.windows(a, y, w, d, 0, h, fh, 0.105, { skip, w: 0.5, from: 1 });
      g.floors(a, y, w, d, 0, h, fh, { skip, inset: 0 });
      const cx = (a + b) / 2;
      for (const lx of [cx - 0.06, cx + 0.06]) g.line([[lx, y, fh], [lx, y, h]], { facing: FRONT });
      g.box(cx - 0.07, y + d / 2 - 0.05, h, 0.14, 0.1, 0.07); // lift room
      aerials(g, a + 0.08, b - 0.08, y + d * 0.6, h, 2);
      g.box(cx - 0.08, y - 0.06, 0.08, 0.16, 0.06, 0.015);   // entrance canopy
    });
  },
};
