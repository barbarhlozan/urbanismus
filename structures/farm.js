// Farm, 3×2: farmstead -> JZD -> cooperative. The village side of the
// era: an old courtyard farm (statek) that becomes the collective farm (JZD)
// with its long cowsheds, silage towers and tractors, and then a big
// agricultural cooperative with steel silos, a grain drier and a machine
// station. Tagged 'farm' – homes send workers here, trucks come and go.
//
// Local area covers x from about -0.4 to 2.4 and y from -0.4 to 1.4 (three
// dots wide, two deep), front on -y.

import { door, stack, heap, tree, tractor, haystack, tank, transformer, hoops } from './kit.js';

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

function barnDoor(g, x, y, w, h) {
  g.line([[x, y, 0], [x, y, h], [x + w, y, h], [x + w, y, 0]], { facing: FRONT });
  g.detailed(2, () => g.line([[x, y, 0], [x + w, y, h]], { facing: FRONT }));
}

export default {
  id: 'farm',
  name: 'Farm',
  blurb: 'Cowsheds and fields · jobs',
  hotkey: 'j',
  category: 'zone',
  tags: ['farm'],
  code: 'F',
  footprint: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  plot: { props: 'garden', boundary: 0.6, kinds: ['fence'], density: 0.35 },
  sim: { destinations: ['residential'] },

  levels: [
    {
      name: 'Farmstead',
      stats: { jobs: 4 },
      agents: 1,
      yards: ['garden', 'trees'],
      draw(g) {
        // courtyard farm: house gable-end to the street, stables and a
        // side building round the yard, the big barn across the back, a
        // wall with a gateway at the front; a field and an orchard beside
        // (the ranges meet side by side, not in an L, so they sort in depth
        // correctly: house and stables down the left, the barn between the
        // side ranges at the back)
        g.gableY(-0.32, -0.3, 0, 0.38, 0.7, 0.18, 0.18);
        g.windows(-0.32, -0.3, 0.38, 0.7, 0, 0.18, 0.18, 0.1, { h: 0.5 });
        g.gableY(-0.3, 0.4, 0, 0.34, 0.96, 0.15, 0.13);
        g.windows(-0.3, 0.4, 0.34, 0.96, 0, 0.15, 0.15, 0.12, { skip: ['front', 'back', 'left'], w: 0.35, h: 0.35 });
        g.gableY(1.25, -0.1, 0, 0.34, 1.46, 0.15, 0.13);
        g.gable(0.04, 0.9, 0, 1.21, 0.46, 0.2, 0.22);
        barnDoor(g, 0.55, 0.9, 0.22, 0.17);
        g.box(0.06, -0.3, 0, 1.19, 0.05, 0.12); // yard wall
        g.box(0.58, -0.32, 0, 0.06, 0.09, 0.2);  // gate piers
        g.box(0.84, -0.32, 0, 0.06, 0.09, 0.2);
        heap(g, 0.35, 0.6, 0.08);
        tree(g, 0.9, 0.35, 1.1, 'spreading');
        field(g, 1.75, 2.36, -0.32, 0.7);
        for (const [x, y] of [[1.85, 1.0], [2.1, 0.95], [2.3, 1.2], [1.95, 1.28]]) tree(g, x, y, 0.8, 'spreading');
      },
    },
    {
      name: 'JZD',
      stats: { jobs: 12 },
      agents: 1,
      yards: ['depot', 'garden'],
      grow: {
        requires: [{ type: 'residential', count: 3, radius: 6 }],
      },
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
    },
    {
      name: 'Cooperative',
      stats: { jobs: 25 },
      agents: 2,
      yards: ['depot', 'parking'],
      grow: {
        requires: [
          { type: 'residential', count: 6, radius: 6 },
          { type: 'residential', count: 2, radius: 6, minLevel: 2 },
        ],
        coveredBy: ['services'],
      },
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
    },
  ],
};
