// Open-air swimming pool (koupaliště, "koupák"), 3×2, 1950s: a long
// 50-metre pool with its lanes, a concrete diving tower at the deep end, a
// round paddling pool for the children with a mushroom fountain and a slide,
// the changing rooms along the street with the entrance in the middle, a
// snack bar, and a lawn under the trees for lying in the sun.
// Tagged 'park', so people come here to relax and nearby homes grow faster.
//
// Local area covers x from about -0.4 to 2.4 and y from -0.4 to 1.4 (three
// dots wide, two deep), front on -y. The pools are drawn on the ground; the
// buildings stand beside them, side by side, so they sort in depth cleanly.

import { door, tree, bench, slide, lamp } from './kit.js';

const BACK = [0, 1, 0];
const WATER = { fill: 'url(#hatch-water)' };

// Rectangular pool between x0…x1, y0…y1: the concrete edge, the water, the
// lanes along x (dashed ropes) and ladders on the long sides.
function pool(g, x0, y0, x1, y1, lanes) {
  const rim = 0.03;
  g.groundPoly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  g.groundPoly([[x0 + rim, y0 + rim], [x1 - rim, y0 + rim], [x1 - rim, y1 - rim], [x0 + rim, y1 - rim]], WATER);
  for (let i = 1; i < lanes; i++) {
    const y = y0 + rim + ((y1 - y0 - 2 * rim) * i) / lanes;
    g.groundLine([[x0 + rim, y], [x1 - rim, y]], { dash: '2 2', lod: 2 });
  }
  g.detailed(2, () => {
    for (const x of [x0 + 0.15, x1 - 0.15]) {
      for (const y of [y0, y1]) {
        g.solid(x, y, 0.02);
        g.line([[x - 0.015, y, 0], [x - 0.015, y, 0.04]]);
        g.line([[x + 0.015, y, 0], [x + 0.015, y, 0.04]]);
      }
    }
  });
}

// Concrete diving tower at (x, y), standing beside the pool's end at +x:
// a slim column with three platforms cantilevered off its -x side over the
// water, each a little further out, rails along them, a ladder up the back.
// The platforms touch the column rather than run into it, so they sort.
function divingTower(g, x, y, h) {
  const c = 0.04, w = 0.06;
  g.box(x - c, y - w, 0, 2 * c, 2 * w, h + 0.05);
  [h * 0.35, h * 0.68, h].forEach((z, i) => {
    const reach = 0.1 + i * 0.05;
    g.box(x - c - reach, y - w, z - 0.018, reach, 2 * w, 0.018);
    g.detailed(2, () => {
      for (const dy of [-w, w]) g.line([[x - c - reach * 0.4, y + dy, z], [x - c - reach * 0.4, y + dy, z + 0.04], [x - c, y + dy, z + 0.04]]);
    });
  });
  g.detailed(2, () => {
    g.solid(x + c + 0.01, y, h / 2);
    for (const dy of [-0.02, 0.02]) g.line([[x + c + 0.01, y + dy, 0], [x + c + 0.01, y + dy, h]]);
    for (let z = 0.04; z < h; z += 0.04) g.line([[x + c + 0.01, y - 0.02, z], [x + c + 0.01, y + 0.02, z]]);
  });
}

// Springboard by the pool's edge at (x, y), reaching towards -y over the water.
function springboard(g, x, y) {
  g.detailed(2, () => {
    g.solid(x, y, 0.03);
    g.line([[x, y + 0.04, 0], [x, y + 0.04, 0.04]]);
    g.line([[x - 0.015, y + 0.06, 0.04], [x - 0.015, y - 0.1, 0.05], [x + 0.015, y - 0.1, 0.05], [x + 0.015, y + 0.06, 0.04]]);
  });
}

// Round paddling pool with the mushroom fountain (houba) in the middle.
function paddlingPool(g, x, y, r) {
  g.groundCircle(x, y, r);
  g.groundCircle(x, y, r - 0.025, WATER);
  g.lathe(x, y, 0, [[0.012, 0], [0.012, 0.09], [0.06, 0.1], [0.05, 0.115], [0, 0.125]], 12, { smooth: true });
}

// Sunshade on a pole: a flat cone.
function parasol(g, x, y) {
  if (!g.isFree(x, y, 0.05)) return;
  g.detailed(2, () => {
    g.solid(x, y, 0.05);
    g.line([[x, y, 0], [x, y, 0.1]]);
    g.lathe(x, y, 0.08, [[0.05, 0], [0, 0.025]], 8);
  });
}

// Lifeguard's high chair on four legs, facing -y.
function lifeguardChair(g, x, y) {
  g.detailed(2, () => {
    g.solid(x, y, 0.07);
    for (const [dx, dy] of [[-0.02, -0.02], [0.02, -0.02], [0.02, 0.02], [-0.02, 0.02]]) {
      g.line([[x + dx * 1.6, y + dy * 1.6, 0], [x + dx, y + dy, 0.12]]);
    }
    g.line([[x - 0.02, y - 0.02, 0.12], [x + 0.02, y - 0.02, 0.12], [x + 0.02, y + 0.02, 0.12], [x - 0.02, y + 0.02, 0.12], [x - 0.02, y - 0.02, 0.12]]);
    g.line([[x - 0.02, y + 0.02, 0.12], [x - 0.02, y + 0.02, 0.17], [x + 0.02, y + 0.02, 0.17], [x + 0.02, y + 0.02, 0.12]]);
  });
}

// Changing rooms along the front from x0 to x1: a long low range of cabins,
// their little doors facing the pool (+y), under a hipped roof or a flat
// one with an overhang.
function cabins(g, x0, x1, y, d, flat) {
  const h = 0.13;
  if (flat) {
    g.box(x0, y, 0, x1 - x0, d, h);
    g.box(x0 - 0.02, y - 0.02, h, x1 - x0 + 0.04, d + 0.06, 0.015);
  } else {
    g.roofed(x0, y, 0, x1 - x0, d, h, { h: 0.07, hip: 0.07 });
  }
  g.windows(x0, y, x1 - x0, d, h * 0.6, h * 0.9, h, 0.1, { skip: ['back', 'left', 'right'], h: 0.8, w: 0.5 });
  for (let x = x0 + 0.04; x < x1 - 0.06; x += 0.07) {
    g.line([[x, y + d, 0], [x, y + d, 0.1], [x + 0.045, y + d, 0.1], [x + 0.045, y + d, 0]], { facing: BACK });
  }
}

export default {
  id: 'pool',
  name: 'Swimming pool',
  blurb: 'Open-air pool, 50s',
  category: 'civic',
  access: 'any', // a footpath will do
  tags: ['park'],
  code: 'KP',
  footprint: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  sim: { destinations: ['residential'] },
  plot: { props: 'green', boundary: 0.8, kinds: ['fence', 'hedge'], density: 0.35 },

  levels: [
    {
      name: 'Swimming pool',
      stats: { jobs: 5 },
      agents: 2,
      yards: ['trees', 'parking', 'plaza'],
      draw(g) {
        // the entrance in the middle of the front, changing rooms either side
        const flat = g.chance(0.4), d = 0.24, y = -0.36;
        const ex = g.range(0.75, 0.95), ew = 0.3;
        cabins(g, -0.36, ex - 0.02, y, d, flat);
        cabins(g, ex + ew + 0.02, 1.55, y, d, flat);
        g.roofed(ex, y - 0.02, 0, ew, d + 0.04, 0.22, { h: 0.1, hip: flat ? 0.15 : 0.1 });
        g.windows(ex, y - 0.02, ew, d + 0.04, 0.12, 0.22, 0.1, 0.07, { skip: ['back'], h: 0.5 });
        door(g, ex + ew / 2, y - 0.02, 0.1, 0.11);
        g.box(ex + 0.04, y - 0.025, 0.13, ew - 0.08, 0.005, 0.035);       // name board

        // snack bar (bufet) on the corner, a bench beside it
        g.box(1.75, -0.3, 0, 0.42, 0.24, 0.13);
        g.windows(1.75, -0.3, 0.42, 0.24, 0, 0.13, 0.13, 0.1, { ribbon: true, h: 0.45, skip: ['front'] });
        g.box(1.73, -0.32, 0.13, 0.46, 0.34, 0.015);
        bench(g, 2.3, -0.15, false, 1);

        // the 50-metre pool, the diving tower at its deep end, springboards
        const px0 = -0.3, px1 = g.range(1.9, 2.05), py0 = 0.06, py1 = g.range(0.68, 0.76);
        pool(g, px0, py0, px1, py1, g.int(5, 6));
        divingTower(g, px1 + 0.1, (py0 + py1) / 2, g.range(0.48, 0.56));
        springboard(g, px1 - 0.2, py1 + 0.01);
        lifeguardChair(g, 0.7, py0 - 0.05);

        // children's corner: the paddling pool with its mushroom, a slide
        const cx = g.pick([0.05, 0.25]);
        paddlingPool(g, cx, 1.08, 0.2);
        slide(g, cx + 0.38, 1.1, true);

        // the sunbathing lawn under a row of trees, parasols, a lamp
        for (const x of [0.95, 1.35, 1.75, 2.2]) tree(g, x + g.range(-0.06, 0.06), 1.28, g.range(0.9, 1.1));
        for (const x of [1.15, 1.6, 2.0]) if (g.chance(0.7)) parasol(g, x + g.range(-0.05, 0.05), 0.98);
        tree(g, 2.3, 0.2, 1);
        lamp(g, -0.3, 0.88);
      },
    },
  ],
};
