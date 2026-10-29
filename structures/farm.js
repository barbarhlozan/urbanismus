// Farms: a 1×1 smallholding, and three kinds 3×2. The village side of the era: an old
// courtyard farm (statek), the collective farm (JZD) with its long
// cowsheds, silage towers and tractors, and the big state farm (státní
// statek) with steel silos, a grain drier and a machine station. Tagged 'farm' – homes send workers here, trucks come and go.
//
// Local area covers x from about -0.4 to 2.4 and y from -0.4 to 1.4 (three
// dots wide, two deep), front on -y.

import { door, stack, heap, tree, tractor, haystack, tank, transformer, hoops, kindOf } from './kit.js';
import { LOOK } from '../src/render/painter.js';

const FRONT = [0, -1, 0];

// Long cowshed (kravín) along y, with a ventilation lantern on the ridge
// and a row of small windows.
function cowshed(g, x, y, w, d, h = 0.14) {
  const r = w * 0.3;
  g.gableY(x, y, 0, w, d, h, r);
  g.windows(x, y, w, d, 0, h, h, 0.1, { skip: ['front', 'back'], w: 0.5, h: 0.4 });
  g.gableY(x + w * 0.4, y + d * 0.1, h + r * 0.6, w * 0.2, d * 0.8, 0.03, 0.03);
  door(g, x + w / 2, y, w * 0.3, h * 0.8);
}

// Silage tower: a concrete cylinder hooped every few metres, a domed cap.
function silageTower(g, x, y, r, h) {
  g.lathe(x, y, 0, [[r, 0], [r, h], [r * 1.04, h + 0.01], [r * 0.75, h + r * 0.45], [0, h + r * 0.75]], 24, { smooth: true, rings: [1], hatch: [3] });
  hoops(g, x, y, r, [0.12, 0.24, 0.36, 0.48].filter((z) => z < h - 0.05));
}

// Steel silo (the 70s blue kind): tall and slim, ribbed, a cone on top.
function steelSilo(g, x, y, r, h) {
  g.lathe(x, y, 0, [[r, 0], [r, h], [r * 0.35, h + r * 0.6], [0, h + r * 0.7]], 24, { smooth: true, rings: [1] });
  hoops(g, x, y, r, [0.15, 0.3, 0.45, 0.6, 0.75].filter((z) => z < h - 0.05));
}

// Open hay barn: a roof on posts, hay under it.
function hayBarn(g, x, y, w, d, h) {
  g.detailed(1, () => {
    g.solid(x + w / 2, y + d / 2, h / 2);
    for (const [px, py] of [[x, y], [x + w, y], [x + w, y + d], [x, y + d]]) g.line([[px, py, 0], [px, py, h]]);
  });
  g.box(x + 0.03, y + 0.03, 0, w - 0.06, d - 0.06, h * 0.6);
  g.roofed(x - 0.02, y - 0.02, h, w + 0.04, d + 0.04, 0.005, { h: 0.07 });
}

// A field strip beside the farm: furrows along y from x0 to x1.
function field(g, x0, x1, y0, y1, step = 0.07) {
  g.groundPoly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], { lod: 1 });
  for (let x = x0 + step; x < x1 - step / 2; x += step) g.groundLine([[x, y0 + 0.03], [x, y1 - 0.03]], { dash: '3 2', lod: 2 });
}

// A window on the front (-y) wall: an ink block (LOOK.ink) or an outline,
// (cx, z) its bottom middle.
function frontWindow(g, cx, y, z, w, h) {
  g.line([[cx - w / 2, y, z], [cx + w / 2, y, z], [cx + w / 2, y, z + h], [cx - w / 2, y, z + h], [cx - w / 2, y, z]],
    { facing: FRONT, cls: LOOK.ink ? 'ink' : undefined });
}

// The farmhouse of the statek, its gable to the street as at Holašovice
// (the small farmstead in structures/residential.js, a size up): a steep
// roof, a trim along the gable's edge, windows in the gable, quoins on the
// corners, a plinth; its door opens into the yard.
function farmhouse(g, x, y, w, d, h, r) {
  const x1 = x + w, cx = x + w / 2, line = (pts) => g.line(pts, { facing: FRONT });
  g.gableY(x, y, 0, w, d, h, r);
  g.windows(x, y, w, d, 0, h, h, 0.1, { h: 0.42, skip: ['front', 'right'] });
  for (const k of [-1, 0, 1]) frontWindow(g, cx + k * w * 0.27, y, h * 0.3, 0.045, 0.07);
  line([[x, y, 0.025], [x1, y, 0.025]]);
  for (let z = 0.04; z < h - 0.01; z += 0.03) {
    line([[x, y, z], [x + 0.025, y, z]]);
    line([[x1 - 0.025, y, z], [x1, y, z]]);
  }
  line([[x + 0.025, y, h + 0.014], [cx, y, h + r - 0.04], [x1 - 0.025, y, h + 0.014]]);
  for (const k of [-1, 1]) frontWindow(g, cx + k * w * 0.2, y, h + 0.04, 0.035, 0.05);
  frontWindow(g, cx, y, h + r * 0.5, 0.03, 0.045);
  // the door from the yard, near the front
  const yd = y + 0.16;
  g.line([[x1, yd - 0.03, 0], [x1, yd - 0.03, 0.12], [x1, yd + 0.03, 0.12], [x1, yd + 0.03, 0]], { facing: [1, 0, 0], round: LOOK.round.windows });
}

// The farmhouse of a four-sided statek (Central Bohemia, the Haná): long,
// its eaves to the street and half-hipped, a row of windows to the street,
// quoins and a plinth; its door is in the yard.
function longFarmhouse(g, x, y, w, d, h, r) {
  const x1 = x + w, line = (pts) => g.line(pts, { facing: FRONT });
  g.roofed(x, y, 0, w, d, h, { h: r, hip: [0.07, 0] });
  g.windows(x, y, w, d, 0, h, h, 0.11, { h: 0.42, skip: ['front', 'right', 'back'] });
  for (let k = 0; k < 5; k++) frontWindow(g, x + w * (k + 0.5) / 5, y, h * 0.3, 0.045, 0.07);
  line([[x, y, 0.025], [x1, y, 0.025]]);
  for (let z = 0.04; z < h - 0.01; z += 0.03) line([[x, y, z], [x + 0.025, y, z]]);
}

// The gateway (brána) between the house and the side range: a wall raised
// over a wide arch with the gates in it, and the small door (branka) beside.
function gateway(g, x0, x1, y, h) {
  const line = (pts) => g.line(pts, { facing: FRONT });
  g.box(x0, y, 0, x1 - x0, 0.06, h);
  const gw = (x1 - x0) * 0.55, gm = x0 + gw / 2 + 0.03, spring = h * 0.55, arch = [];
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI * (1 - i / 8);
    arch.push([gm + Math.cos(a) * gw / 2, y, spring + Math.sin(a) * gw * 0.4]);
  }
  line([[gm - gw / 2, y, 0], ...arch, [gm + gw / 2, y, 0]]);
  line([[gm, y, 0], [gm, y, spring + gw * 0.4]]);
  const bx = (gm + gw / 2 + x1) / 2;
  line([[bx - 0.025, y, 0], [bx - 0.025, y, 0.09], [bx + 0.025, y, 0.09], [bx + 0.025, y, 0]]);
  line([[x0, y, h - 0.02], [x1, y, h - 0.02]]); // the coping
}

function barnDoor(g, x, y, w, h) {
  g.line([[x, y, 0], [x, y, h], [x + w, y, h], [x + w, y, 0]], { facing: FRONT });
  g.detailed(2, () => g.line([[x, y, 0], [x + w, y, h]], { facing: FRONT }));
}

// ----- 1×1 -----

// A smallholding (hospodářství): a cottage with its gable to the street, a
// byre behind it with a barn door, a haystack, the dung heap in the yard
// and a fruit tree. The few cows that stay out of the JZD.
export const smallholding = {
  id: 'smallholding',
  name: 'Hospodářství',
  blurb: 'A cottage with a byre',
  category: 'farming',
  tags: ['farm'],
  code: 'F',
  footprint: [[0, 0]],
  access: 'any', // a footpath will do
  plot: { props: 'garden', boundary: 0.3, kinds: ['fence'], density: 0.35 },
  sim: { destinations: ['residential'] },
  stats: { jobs: 1 },
  agents: 1,
  yards: ['garden', 'trees'],
  draw(g) {
    // (the cottage and the byre side by side, not overlapping, so each
    // sorts in depth on its own)
    const w = g.range(0.26, 0.3), h = 0.13;
    g.gableY(-0.36, -0.32, 0, w, 0.4, h, g.range(0.13, 0.16));
    g.windows(-0.36, -0.32, w, 0.4, 0, h, h, 0.1, { h: 0.5 });
    door(g, -0.36 + w * 0.5, -0.32, 0.05, 0.09);
    const bw = g.range(0.44, 0.52);
    g.gable(-0.36, 0.12, 0, bw, 0.24, 0.11, 0.1);
    barnDoor(g, -0.36 + bw * 0.62, 0.12, 0.13, 0.1);
    haystack(g, 0.27, -0.2, 0.07);
    heap(g, 0.06, -0.06, 0.05);
    tree(g, 0.28, 0.26, 0.75, 'spreading');
  },
};

// ----- 3×2 -----

export const farmstead = {
  id: 'farmstead',
  name: 'Farmstead',
  blurb: 'An old courtyard farm',
  category: 'farming',
  tags: ['farm'],
  code: 'F',
  footprint: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  plot: { props: 'garden', boundary: 0.6, kinds: ['fence'], density: 0.35 },
  sim: { destinations: ['residential'] },
  stats: { jobs: 4 },
  agents: 1,
  yards: ['garden', 'trees'],
  // the layouts round the yard (saves from before version 7 are the first)
  kinds: ['three-sided', 'walled', 'four-sided'],
  draw(g, s) {
    // A courtyard farm: the farmhouse at the street, the big barn across
    // the back, a wall with its gateway at the front; a field and an orchard
    // beside. The ranges meet side by side, not in an L, so each sorts in
    // depth on its own (likewise the wall's pieces).
    //   three-sided  the farmhouse gable-end to the street with the stables
    //                behind it down the left, a side range down the right
    //   walled       the same with a wall down the right instead, and an
    //                open hay barn in the one big yard
    //   four-sided   the farmhouse long, its eaves to the street, the gateway
    //                beside it; stables down the left, a side range right
    const kind = kindOf(g, s, this.kinds);
    // roofs of their own (g.paint, ROOF_OF in painter.js): the farmhouse
    // the farm's, the stables and side range one, the barn another, as
    // each was re-roofed in its time (eternit on the barn, tiles kept on
    // the house)
    const paint = g.paint, ranges = g.int(0, 11), barn = g.int(0, 11);
    if (kind === 'four-sided') {
      longFarmhouse(g, -0.32, -0.3, 1.02, 0.34, 0.17, 0.2);
      g.paint = ranges;
      g.gableY(-0.3, 0.04, 0, 0.34, 1.32, 0.15, 0.13);
      g.windows(-0.3, 0.04, 0.34, 1.32, 0, 0.15, 0.15, 0.12, { skip: ['front', 'back', 'left'], w: 0.35, h: 0.35 });
      gateway(g, 0.7, 1.25, -0.31, 0.21);
    } else {
      farmhouse(g, -0.32, -0.3, 0.38, 0.7, 0.18, 0.26);
      g.paint = ranges;
      g.gableY(-0.3, 0.4, 0, 0.34, 0.96, 0.15, 0.13);
      g.windows(-0.3, 0.4, 0.34, 0.96, 0, 0.15, 0.15, 0.12, { skip: ['front', 'back', 'left'], w: 0.35, h: 0.35 });
      g.box(0.06, -0.3, 0, 0.36, 0.05, 0.12);
      gateway(g, 0.42, 0.9, -0.31, 0.21);
      g.box(0.9, -0.3, 0, 0.35, 0.05, 0.12);
    }
    g.paint = barn;
    g.gable(0.04, 0.9, 0, 1.21, 0.46, 0.2, 0.22);
    barnDoor(g, 0.55, 0.9, 0.22, 0.17);
    g.paint = ranges;
    if (kind === 'walled') {
      // the wall down the right, from the front wall to the barn's end
      g.box(1.25, -0.3, 0, 0.05, 1.66, 0.12);
      hayBarn(g, 0.95, 0.3, 0.24, 0.4, 0.16);
      tree(g, 0.6, 0.35, 1.1, 'spreading');
    } else {
      g.gableY(1.25, -0.1, 0, 0.34, 1.46, 0.15, 0.13);
      g.windows(1.25, -0.1, 0.34, 1.46, 0, 0.15, 0.15, 0.12, { skip: ['front', 'back', 'right'], w: 0.35, h: 0.35 });
      g.box(1.25, -0.3, 0, 0.05, 0.2, 0.12);
      tree(g, 0.9, 0.4, 1.1, 'spreading');
    }
    g.paint = paint;
    field(g, 1.75, 2.36, -0.32, 0.7);
    for (const [x, y] of [[1.85, 1.0], [2.1, 0.95], [2.3, 1.2], [1.95, 1.28]]) tree(g, x, y, 0.8, 'spreading');
  },
};

export const jzd = {
  id: 'jzd',
  name: 'JZD',
  blurb: 'The collective farm',
  category: 'farming',
  tags: ['farm'],
  code: 'F',
  footprint: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  plot: { props: 'garden', boundary: 0.6, kinds: ['fence'], density: 0.35 },
  sim: { destinations: ['residential'] },
  stats: { jobs: 12 },
  agents: 1,
  yards: ['depot', 'garden'],
  draw(g) {
    // collective farm: three long cowsheds, silage towers, a hay barn,
    // haystacks, tractors in the yard and the farm office
    cowshed(g, -0.32, -0.15, 0.38, 1.45);
    cowshed(g, 0.18, 0.1, 0.38, 1.2);
    cowshed(g, 0.68, 0.1, 0.38, 1.2);
    for (const x of [1.25, 1.47]) silageTower(g, x, 1.15, 0.1, g.range(0.5, 0.6));
    hayBarn(g, 1.2, 0.3, 0.65, 0.45, 0.2);
    for (const [x, y] of [[2.1, -0.1], [2.28, 0.25]]) haystack(g, x, y, 0.07);
    tractor(g, 1.3, -0.2, true);
    tractor(g, 1.55, -0.25, true);
    heap(g, 1.12, 0.95, 0.07);
    g.roofed(1.95, 0.85, 0, 0.4, 0.3, 0.16, { h: 0.12, hip: 0.08 });
    g.windows(1.95, 0.85, 0.4, 0.3, 0, 0.16, 0.16, 0.1, { h: 0.5 });
    door(g, 2.15, 0.85, 0.05, 0.09);
  },
};

export const stateFarm = {
  id: 'state-farm',
  name: 'Státní statek',
  blurb: 'Silos, a grain drier, machines',
  category: 'farming',
  tags: ['farm'],
  code: 'F',
  trucks: 2,
  footprint: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  plot: { props: 'garden', boundary: 0.6, kinds: ['fence'], density: 0.35 },
  sim: { destinations: ['residential'] },
  stats: { jobs: 25 },
  agents: 2,
  yards: ['depot', 'parking'],
  draw(g) {
    // agricultural cooperative: three big cowsheds, a row of steel
    // silos, the grain drier tower, a vaulted machine station, an
    // office block and the fuel tank
    for (const x of [-0.32, 0.2, 0.72]) cowshed(g, x, 0.3, 0.42, 1.05, 0.16);
    for (let i = 0; i < 4; i++) steelSilo(g, 1.35 + i * 0.2, 1.2, 0.085, g.range(0.8, 0.95));
    g.box(2.1, 0.5, 0, 0.16, 0.16, 0.95);                      // grain drier
    g.box(2.06, 0.46, 0.95, 0.24, 0.24, 0.1);
    g.windows(2.06, 0.46, 0.24, 0.24, 0.95, 1.05, 0.1, 0.08, { ribbon: true });
    g.box(1.92, 0.55, 0, 0.18, 0.12, 0.18);
    g.vault(1.3, -0.2, 0, 0.75, 0.55, 0.16, 0.12, 6);           // machine station
    g.line([[1.45, -0.2, 0], [1.45, -0.2, 0.13], [1.65, -0.2, 0.13], [1.65, -0.2, 0]], { facing: FRONT });
    g.box(-0.32, -0.36, 0, 0.62, 0.22, 0.24);                   // office
    g.windows(-0.32, -0.36, 0.62, 0.22, 0, 0.24, 0.12, 0.1, { ribbon: true });
    door(g, 0.2, -0.36, 0.06, 0.1);
    tank(g, 0.6, -0.2, 0.06, 0.12);
    tank(g, 2.25, -0.2, 0.06, 0.12);
    tractor(g, 0.9, 0.05, true);
    tractor(g, 1.15, -0.1, false);
    transformer(g, 2.3, 0.2);
    stack(g, 1.2, 1.25, 0.55, 0.04);
  },
};
