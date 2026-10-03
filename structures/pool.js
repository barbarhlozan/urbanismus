// Village swimming pool (koupaliště, "koupák"), 3×2, 1950s: a 25-metre
// concrete basin the villagers dug in Action Z, a low diving stand at the
// deep end and a springboard, a round paddling pool with a mushroom
// fountain, one wooden shack (a hatch for lemonade and tickets at the
// front, changing rooms behind), a volleyball net and a lawn under the
// trees for lying in the sun.
// Tagged 'park', so people come here to relax and nearby homes grow faster.
//
// Local area covers x from about -0.4 to 2.4 and y from -0.4 to 1.4 (three
// dots wide, two deep), front on -y. The pools are drawn on the ground; what
// stands beside them stands side by side, so it sorts in depth cleanly.

import { panel, tree, bench, slide, crates, bikeRack } from './kit.js';

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

// Low diving stand at (x, y) beside the pool's end at +x: a concrete block
// with one platform (and, now and then, a lower one) cantilevered off its
// -x side over the water, a rail, a ladder up the back. The platforms touch
// the block rather than run into it, so they sort.
function divingStand(g, x, y, h, platforms) {
  const c = 0.035, w = 0.05;
  g.box(x - c, y - w, 0, 2 * c, 2 * w, h);
  const zs = platforms > 1 ? [h * 0.5, h] : [h];
  zs.forEach((z, i) => {
    const reach = 0.08 + i * 0.04;
    g.box(x - c - reach, y - w, z - 0.015, reach, 2 * w, 0.015);
  });
  g.detailed(2, () => {
    g.solid(x + c + 0.01, y, h / 2);
    for (const dy of [-w, w]) g.line([[x - c - 0.03, y + dy, h], [x - c - 0.03, y + dy, h + 0.04], [x + c, y + dy, h + 0.04]]);
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

// The shack at (x0, y0), w × d: boarded walls under a gabled roof, the
// hatch with a flap propped open on the front, a door to the changing rooms
// on the back (towards the pool).
function shack(g, x0, y0, w, d) {
  const h = 0.13;
  g.gable(x0, y0, 0, w, d, h, 0.08);
  g.mullions(x0, y0, w, d, 0, h, 0.025);
  panel(g, x0 + w * 0.25, x0 + w * 0.6, y0, 0.06, 0.11);                  // hatch
  g.box(x0 + w * 0.22, y0 - 0.05, 0.11, w * 0.41, 0.05, 0.008);         // its flap
  for (const k of [0.3, 0.7]) {
    g.line([[x0 + w * k - 0.02, y0 + d, 0], [x0 + w * k - 0.02, y0 + d, 0.1], [x0 + w * k + 0.02, y0 + d, 0.1], [x0 + w * k + 0.02, y0 + d, 0]], { facing: BACK });
  }
}

// Volleyball net on the lawn along y from y0 to y1 at x: two posts and the net.
function volleyball(g, x, y0, y1) {
  g.groundPoly([[x - 0.2, y0 - 0.05], [x + 0.2, y0 - 0.05], [x + 0.2, y1 + 0.05], [x - 0.2, y1 + 0.05]], { dash: '2 3', lod: 2 });
  g.detailed(2, () => {
    g.solid(x, (y0 + y1) / 2, 0.06);
    for (const y of [y0, y1]) g.line([[x, y, 0], [x, y, 0.12]]);
    g.line([[x, y0, 0.12], [x, y1, 0.12]]);
    g.line([[x, y0, 0.08], [x, y1, 0.08]]);
  });
}

export default {
  id: 'pool',
  name: 'Swimming pool',
  blurb: 'Village pool',
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
      stats: { jobs: 2 },
      agents: 2,
      yards: ['trees', 'garden'],
      draw(g) {
        // the shack by the way in, lemonade crates and bikes beside it
        const sx = g.pick([-0.34, -0.2]);
        shack(g, sx, -0.34, 0.42, 0.26);
        crates(g, sx + 0.52, -0.26);
        bench(g, sx + 0.21, 0.0, true, 1);
        bikeRack(g, 0.45, 0.75, -0.3);

        // the 25-metre basin, the low diving stand at its deep end, a
        // springboard, a chair for the lifeguard (plavčík)
        const px0 = g.range(0.25, 0.35), px1 = g.range(1.7, 1.85), py0 = 0.0, py1 = g.range(0.5, 0.58);
        pool(g, px0, py0, px1, py1, g.int(3, 4));
        divingStand(g, px1 + 0.08, (py0 + py1) / 2, g.range(0.16, 0.22), g.chance(0.4) ? 2 : 1);
        springboard(g, px1 - 0.18, py1 + 0.01);
        if (g.chance(0.6)) lifeguardChair(g, (px0 + px1) / 2, py0 - 0.06);

        // children's corner: the paddling pool with its mushroom, a slide
        paddlingPool(g, -0.05, 0.75, 0.16);
        if (g.chance(0.6)) slide(g, -0.1, 1.15, true);

        // the lawn: a volleyball net, parasols by the water, trees round it
        volleyball(g, 2.15, 0.45, 1.05);
        for (const x of [0.6, 1.0, 1.4]) if (g.chance(0.6)) parasol(g, x + g.range(-0.05, 0.05), py1 + 0.22);
        for (const x of [0.35, 0.85, 1.35, 1.8]) tree(g, x + g.range(-0.06, 0.06), 1.28, g.range(0.9, 1.15));
        tree(g, 2.3, -0.25, g.range(0.9, 1.1));
        tree(g, 2.32, 1.3, 1);
      },
    },
  ],
};
