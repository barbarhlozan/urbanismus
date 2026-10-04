// Shops, pubs and offices of a Central European town from the 50s to the
// 80s – none of it private: the Jednota co-op shop, the hospoda, the
// department store, Tuzex, the národní výbor (the town's administration),
// the post office and the hotel. Each is its own thing to build, with a
// wide (two-plot) size where there is one. All are tagged 'business': where
// people work and shop (src/sim/agents.js).
// Front (shop window, entrance) is the -y side.

import { door, panel, chimney, frontage, shared, hips, aerials, flagpole, star, crates, barrels, bikeRack, bench, streetClock, tree } from './kit.js';

const FRONT = [0, -1, 0];

// Sign box standing on thin posts on a flat roof at height z.
function roofSign(g, cx, y, z, w = 0.3) {
  g.box(cx - w / 2, y, z + 0.04, w, 0.025, 0.07);
  g.detailed(2, () => {
    g.solid(cx, y, z + 0.02);
    for (const k of [-0.35, 0.35]) g.line([[cx + w * k, y + 0.012, z], [cx + w * k, y + 0.012, z + 0.04]]);
  });
}

// Columns in front of the facade (portico), from x0 to x1 at depth y.
function columns(g, x0, x1, y, h, n) {
  g.detailed(2, () => {
    g.solid((x0 + x1) / 2, y, h / 2);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      g.line([[x, y, 0], [x, y, h]]);
    }
  });
}

// One window on the front (-y) wall at depth y, bottom middle (cx, z).
function frontWindow(g, cx, y, z, w, h) {
  g.line([[cx - w / 2, y, z], [cx + w / 2, y, z], [cx + w / 2, y, z + h], [cx - w / 2, y, z + h], [cx - w / 2, y, z]], { facing: FRONT });
}

// What every one of them shares.
const COMMON = {
  category: 'amenities',
  access: 'any', // a footpath will do: people walk or cycle
  sim: { destinations: ['residential'] },
  plot: { props: 'service', boundary: 0.2, kinds: ['hedge'], density: 0.3 },
};

// ----- 1×1 -----

// Jednota, the consumer co-op that ran the village shops: its 70s shop
// under a flat roof, a self-service shop with a sign on the roof, a village
// shop with its gable to the street, a shop under a townhouse.
export const jednota = {
  ...COMMON,
  id: 'jednota',
  name: 'Jednota',
  blurb: 'The co-op shop',
  tags: ['business', 'shop'],
  code: 'J',
  footprint: [[0, 0]],
  stats: { jobs: 3 },
  agents: 1,
  yards: ['parking', 'plaza', 'trees'],
  join: { group: 'street', chance: 0.6 },
  draw(g) {
    const joined = g.join.left || g.join.right;
    const kind = joined ? 'townhouse' : g.pick(['jednota', 'jednota', 'pavilion', 'village', 'townhouse']);
    if (kind === 'jednota') {
      // Jednota village shop, 70s: one storey under a flat roof, a deep
      // fascia with the co-op's sign board, shop windows, the store room
      // beside it, crates at the side and a bench by the door
      const w = g.range(0.42, 0.48), d = 0.34, x = -0.3, y = -0.18, h = 0.16;
      g.box(x, y, 0, w, d, h);
      g.windows(x, y, w, d, 0, h, h, 0.1, { ribbon: true, h: 0.55, skip: ['back', 'left'] });
      g.box(x - 0.015, y - 0.02, h, w + 0.03, d + 0.035, 0.045); // fascia
      g.box(x + w * 0.2, y - 0.025, h + 0.008, w * 0.6, 0.006, 0.03); // sign board
      door(g, x + w * 0.78, y, 0.06, 0.11);
      g.box(x + w, y + 0.06, 0, 0.16, d - 0.06, 0.12);                 // store room
      g.windows(x + w, y + 0.06, 0.16, d - 0.06, 0, 0.12, 0.12, 0.1, { skip: ['left'], h: 0.4 });
      crates(g, 0.34, 0.26);
      bench(g, x + w * 0.35, y - 0.1, true, -1);
      bikeRack(g, 0.2, 0.32, -0.3);
    } else if (kind === 'townhouse') {
      // two storeys over a shop front
      const [x0, x1] = frontage(g, g.range(0.5, 0.58));
      const w = x1 - x0, d = 0.38, y = -d / 2, fh = 0.15, h = fh * 2;
      g.roofed(x0, y, 0, w, d, h, { h: g.range(0.12, 0.15), hip: hips(g, 0.12) });
      g.windows(x0, y, w, d, 0, h, fh, 0.09, { skip: shared(g), from: 1 });
      panel(g, x0 + 0.04, x1 - 0.04, y, 0.02, fh * 0.75);
    } else if (kind === 'pavilion') {
      // self-service shop: flat roof, glass front, sign on the roof
      const w = g.range(0.5, 0.58), d = g.range(0.36, 0.42), h = 0.17;
      const x = -w / 2, y = -d / 2;
      g.box(x, y, 0, w, d, h);
      g.box(x - 0.02, y - 0.03, h, w + 0.04, d + 0.05, 0.02); // thin roof slab
      g.windows(x, y, w, d, 0, h, h, 0.1, { ribbon: true, h: 0.6, skip: ['back'] });
      roofSign(g, 0, y + 0.03, h + 0.02, w * 0.6);
    } else {
      // village shop: gable to the street
      const w = g.range(0.32, 0.38), d = g.range(0.4, 0.46), h = 0.19;
      g.roofed(-w / 2, -d / 2, 0, w, d, h, { h: g.range(0.18, 0.22), ridge: 'y' });
      panel(g, -w / 2 + 0.04, w / 2 - 0.04, -d / 2, 0.03, 0.13);
      g.box(-w / 2 + 0.02, -d / 2 - 0.06, 0.14, w - 0.04, 0.06, 0.02); // canopy
    }
  },
};

// Hospoda: the village pub – one storey with its eaves to the street, the
// door in the middle under the brewery's sign board, a bench outside and
// barrels by the side wall, sometimes a beer garden under a tree; or, in
// town, the pub on the ground floor of a two-storey house.
export const hospoda = {
  ...COMMON,
  id: 'hospoda',
  name: 'Hospoda',
  blurb: 'The pub',
  tags: ['business', 'pub'],
  code: 'P',
  footprint: [[0, 0]],
  stats: { jobs: 2 },
  agents: 1,
  yards: ['trees', 'garden', 'parking'],
  join: { group: 'street', chance: 0.5 },
  draw(g) {
    const joined = g.join.left || g.join.right;
    const kind = joined ? 'town' : g.pick(['village', 'village', 'town']);
    if (kind === 'town') {
      const [x0, x1] = frontage(g, g.range(0.5, 0.58));
      const w = x1 - x0, d = 0.4, y = -d / 2, fh = 0.15, h = fh * 2, cx = (x0 + x1) / 2;
      g.roofed(x0, y, 0, w, d, h, { h: g.range(0.13, 0.16), hip: hips(g, 0.12) });
      g.windows(x0, y, w, d, 0, h, fh, 0.09, { skip: shared(g), from: 1 });
      for (const k of [-1, 1]) frontWindow(g, cx + k * w * 0.27, y, fh * 0.25, w * 0.26, fh * 0.55);
      door(g, cx, y, 0.07, fh * 0.8);
      g.box(cx - 0.1, y - 0.012, fh * 0.85, 0.2, 0.012, 0.035);       // sign board
      if (!g.join.right) g.box(x1 - 0.04, y - 0.06, fh * 1.15, 0.008, 0.06, 0.05); // hanging sign
      return;
    }
    const garden = g.chance(0.5);
    const w = g.range(0.5, 0.56), d = g.range(0.3, 0.34), h = 0.16, r = g.range(0.15, 0.19);
    const x = -w / 2, y = garden ? -0.06 : -d / 2;
    g.roofed(x, y, 0, w, d, h, { h: r, hip: g.range(0.06, 0.1) });
    g.windows(x, y, w, d, 0, h, h, 0.1, { h: 0.45 });
    door(g, 0, y, 0.07, 0.12);
    g.box(-0.11, y - 0.012, h * 0.8, 0.22, 0.012, 0.03);              // sign board
    chimney(g, x + w * 0.25, y + d / 2, h + r * 0.4, r * 0.7);
    barrels(g, x + w + 0.04, y + d - 0.06);
    if (garden) {
      // the beer garden in front: benches either side of a linden
      tree(g, -0.24, -0.3, 0.9);
      for (const bx of [0.02, 0.22]) {
        bench(g, bx, -0.36, true, -1);
        bench(g, bx, -0.26, true, 1);
      }
    } else {
      bench(g, -0.18, y - 0.1, true, -1);
    }
  },
};

// Tuzex, the hard-currency shop, 70s: a glazed ground floor under a
// cantilevered canopy, a closed upper floor clad in panels, and a blade
// sign on the corner.
export const tuzex = {
  ...COMMON,
  id: 'tuzex',
  name: 'Tuzex',
  blurb: 'Western goods for vouchers',
  tags: ['business', 'shop'],
  code: 'TX',
  footprint: [[0, 0]],
  stats: { jobs: 3 },
  agents: 1,
  yards: ['parking', 'plaza', 'trees'],
  draw(g) {
    const w = g.range(0.5, 0.56), d = 0.38, x = -w / 2, y = -d / 2, h0 = 0.16, h = h0 + 0.14;
    g.box(x, y, 0, w, d, h);
    g.windows(x, y, w, d, 0, h0, h0, 0.1, { ribbon: true, h: 0.7, skip: ['back'] });
    g.mullions(x, y, w, d, h0, h, 0.07, { skip: ['back'] });
    g.box(x - 0.02, y - 0.08, h0, w + 0.04, 0.08, 0.015);            // canopy
    g.box(x + w - 0.01, y - 0.06, h0 + 0.02, 0.01, 0.05, 0.18);      // blade sign
    door(g, 0, y, 0.08, 0.12);
    g.box(x + 0.06, y + 0.08, h, w - 0.12, d - 0.16, 0.03);          // roof plant
  },
};

// Obchodní dům, the department store: a big block of blank panels over a
// glass ground floor, the sign on the roof.
export const store = {
  ...COMMON,
  id: 'store',
  name: 'Obchodní dům',
  blurb: 'The department store',
  tags: ['business', 'shop'],
  code: 'OD',
  footprint: [[0, 0]],
  stats: { jobs: 24 },
  agents: 3,
  yards: ['plaza', 'trees'],
  draw(g) {
    const fh = 0.11;
    const w = 0.66, d = 0.6, x = -w / 2, y = -d / 2, h = fh * 5;
    g.box(x, y, 0, w, d, h);
    g.windows(x, y, w, d, 0, fh, fh, 0.1, { ribbon: true, h: 0.6 });
    g.floors(x, y, w, d, fh, h, fh * 1.35, { inset: 0 });
    g.mullions(x, y, w, d, fh, h, fh * 1.35, 0);
    g.box(x + 0.12, y + 0.14, h, w - 0.24, d - 0.28, 0.08); // plant room
    roofSign(g, 0, y + 0.04, h, 0.36);
  },
};

// Národní výbor, the town's administration (MNV, ONV): a 60s office block
// with ribbon windows, one lifted on posts, a 50s one under a hipped roof
// with a columned entrance.
export const office = {
  ...COMMON,
  id: 'office',
  name: 'Národní výbor',
  blurb: 'Offices of the administration',
  tags: ['business', 'office'],
  code: 'NV',
  footprint: [[0, 0]],
  stats: { jobs: 8 },
  agents: 2,
  yards: ['plaza', 'parking'],
  join: { group: 'street', chance: 0.5 },
  draw(g) {
    const joined = g.join.left || g.join.right;
    const kind = joined ? g.pick(['ribbon', 'classic']) : g.pick(['ribbon', 'pilotis', 'classic', 'ribbon']);
    const skip = shared(g);
    if (kind === 'ribbon') {
      // 60s office block: ribbon windows, thin overhanging roof, glazed stairs
      const [x0, x1] = frontage(g, g.range(0.5, 0.58));
      const w = x1 - x0, d = g.range(0.34, 0.4), y = -d / 2, fh = 0.12, h = fh * g.int(4, 6);
      g.box(x0, y, 0, w, d, h);
      g.windows(x0, y, w, d, 0, h, fh, 0.1, { ribbon: true, skip });
      const ox0 = g.join.left ? 0 : 0.02, ox1 = g.join.right ? 0 : 0.02;
      g.box(x0 - ox0, y - 0.02, h, w + ox0 + ox1, d + 0.04, 0.02);
      if (!g.join.right) {
        g.box(x1, y + 0.06, 0, 0.08, 0.12, h + 0.06); // stair tower
        g.mullions(x1, y + 0.06, 0.08, 0.12, 0, h + 0.06, 0.04);
      }
    } else if (kind === 'pilotis') {
      // lifted on posts over a glazed, recessed ground floor
      const w = g.range(0.54, 0.62), d = 0.34, x = -w / 2, y = -d / 2, fh = 0.12;
      const h = fh * g.int(4, 5), lift = 0.12;
      g.box(x + 0.08, y + 0.06, 0, w - 0.16, d - 0.12, lift);
      g.mullions(x + 0.08, y + 0.06, w - 0.16, d - 0.12, 0, lift, 0.05);
      g.detailed(1, () => {
        g.solid(0, y + 0.02, lift / 2);
        for (let i = 0; i <= 4; i++) g.line([[x + 0.03 + ((w - 0.06) * i) / 4, y + 0.03, 0], [x + 0.03 + ((w - 0.06) * i) / 4, y + 0.03, lift]]);
      });
      g.box(x, y, lift, w, d, h);
      g.windows(x, y, w, d, lift, lift + h, fh, 0.1, { ribbon: true });
    } else {
      // 50s administration: hipped roof, tall windows, columned entrance
      const [x0, x1] = frontage(g, g.range(0.56, 0.62));
      const w = x1 - x0, d = 0.42, y = -d / 2, fh = 0.15, h = fh * 4;
      g.roofed(x0, y, 0, w, d, h, { h: 0.11, hip: hips(g, 0.11) });
      g.windows(x0, y, w, d, 0, h, fh, 0.075, { skip, h: 0.55, w: 0.4 });
      const cx = (x0 + x1) / 2;
      columns(g, cx - 0.12, cx + 0.12, y - 0.05, fh * 1.6, 4);
      g.box(cx - 0.14, y - 0.07, fh * 1.6, 0.28, 0.07, 0.03);
    }
  },
};

// The regional seat (KNV) as a tower: socialist-realist, stepped, with a
// spire and a star; or brutalist on a podium, with a wider crown on top.
export const officeTower = {
  ...COMMON,
  id: 'office-tower',
  name: 'Národní výbor',
  blurb: 'Offices of the administration',
  size: 'Tower',
  tags: ['business', 'office'],
  code: 'NV',
  footprint: [[0, 0]],
  stats: { jobs: 24 },
  agents: 3,
  yards: ['plaza', 'trees'],
  draw(g) {
    const kind = g.pick(['spire', 'crown']);
    const fh = 0.11;
    if (kind === 'spire') {
      // socialist-realist tower: stepped, with a spire and a star
      const b = 0.32, m = 0.21, t = 0.12;
      const hb = fh * 3, hm = hb + fh * g.int(5, 6), ht = hm + fh * 2;
      g.roofed(-b, -b, 0, 2 * b, 2 * b, hb, { h: 0.04, hip: 0.1 });
      g.windows(-b, -b, 2 * b, 2 * b, 0, hb, fh, 0.08);
      g.box(-m, -m, hb, 2 * m, 2 * m, hm - hb);
      g.windows(-m, -m, 2 * m, 2 * m, hb, hm, fh, 0.07);
      g.box(-t, -t, hm, 2 * t, 2 * t, ht - hm);
      g.windows(-t, -t, 2 * t, 2 * t, hm, ht, fh, 0.06);
      g.lathe(0, 0, ht, [[t * 0.9, 0], [0.03, 0.12], [0.012, 0.3], [0, 0.34]], 4, { phase: 0.5 });
      star(g, 0, 0, ht + 0.37);
    } else {
      // brutalist tower on a podium, with a wider crown on top
      const p = 0.32, sw = 0.2, sd = g.range(0.17, 0.2), hp = fh * 2;
      const h = hp + fh * g.int(8, 9), hc = fh * 1.2;
      g.box(-p, -p, 0, 2 * p, 2 * p, hp);
      g.windows(-p, -p, 2 * p, 2 * p, 0, hp, fh, 0.1, { ribbon: true });
      g.box(-sw, -sd, hp, 2 * sw, 2 * sd, h - hp);
      g.mullions(-sw, -sd, 2 * sw, 2 * sd, hp, h, 0.04);
      g.box(-sw - 0.04, -sd - 0.04, h, 2 * sw + 0.08, 2 * sd + 0.08, hc);
      g.windows(-sw - 0.04, -sd - 0.04, 2 * sw + 0.08, 2 * sd + 0.08, h, h + hc, hc, 0.1, { ribbon: true, h: 0.3 });
      g.line([[0.1, 0.05, h + hc], [0.1, 0.05, h + hc + 0.22]]);
    }
  },
};

// Hotel: a slab with fins on a low wide podium, flags out front.
export const hotel = {
  ...COMMON,
  id: 'hotel',
  name: 'Hotel',
  blurb: 'Rooms for visitors',
  tags: ['business', 'hotel'],
  code: 'H',
  footprint: [[0, 0]],
  stats: { jobs: 24 },
  agents: 3,
  yards: ['plaza', 'trees'],
  draw(g) {
    const fh = 0.11;
    const w = 0.64, d = 0.24, hp = fh * 1.3, h = hp + fh * g.int(8, 10);
    g.box(-0.32, -0.32, 0, 0.64, 0.64, hp);
    g.windows(-0.32, -0.32, 0.64, 0.64, 0, hp, hp, 0.1, { ribbon: true, h: 0.55 });
    g.box(-w / 2, -d / 2 + 0.06, hp, w, d, h - hp);
    g.mullions(-w / 2, -d / 2 + 0.06, w, d, hp, h, 0.045);
    g.floors(-w / 2, -d / 2 + 0.06, w, d, hp, h, fh, { inset: 0 });
    flagpole(g, -0.28, -0.38, 0.4);
    aerials(g, -0.2, 0.2, 0.06, h, 2);
  },
};

// ----- 2×1 -----
// Two dots side by side along the road: local x from about -0.4 to 1.4,
// y from -0.4 to 0.4, front on -y. The way in may come to either dot, so
// there is an entrance near both (x = 0, 1).

// A 70s shopping centre (nákupní středisko): two flat-roofed pavilions
// under one canopy; or two townhouses with shop fronts.
export const jednotaWide = {
  ...COMMON,
  id: 'jednota-wide',
  name: 'Jednota',
  blurb: 'The co-op shop',
  size: 'Wide',
  tags: ['business', 'shop'],
  code: 'J',
  footprint: [[0, 0], [1, 0]],
  stats: { jobs: 6 },
  agents: 2,
  yards: ['parking', 'plaza', 'trees'],
  draw(g) {
    const kind = g.pick(['centre', 'centre', 'townhouses']);
    if (kind === 'centre') {
      const d = g.range(0.36, 0.4), y = -d / 2, h = 0.17, split = g.range(0.4, 0.6);
      for (const [a, b] of [[-0.32, split - 0.04], [split + 0.04, 1.32]]) {
        g.box(a, y, 0, b - a, d, h);
        g.windows(a, y, b - a, d, 0, h, h, 0.1, { ribbon: true, h: 0.6, skip: ['back'] });
        roofSign(g, (a + b) / 2, y + 0.03, h + 0.03, (b - a) * 0.55);
      }
      g.box(-0.34, y - 0.1, h - 0.03, 1.68, 0.1, 0.02);          // one canopy along both fronts
      g.detailed(1, () => {
        g.solid(0.5, y - 0.08, h / 2);
        for (const x of [-0.3, 0.2, 0.8, 1.3]) g.line([[x, y - 0.08, 0], [x, y - 0.08, h - 0.03]]);
      });
      for (const x of [0.02, 0.98]) door(g, x, y, 0.08, 0.12);
      bench(g, split, y - 0.14, true, -1);
      bikeRack(g, 1.05, 1.28, y - 0.14);
    } else {
      const d = 0.38, y = -d / 2, fh = 0.15, xm = 0.5 + g.range(-0.06, 0.06);
      for (const [a, b, hip] of [[-0.3, xm, [0.12, 0]], [xm, 1.3, [0, 0.12]]]) {
        const h = fh * g.int(2, 3);
        g.roofed(a, y, 0, b - a, d, h, { h: g.range(0.12, 0.15), hip });
        g.windows(a, y, b - a, d, 0, h, fh, 0.09, { from: 1, skip: [hip[0] ? 'right' : 'left'] });
        panel(g, a + 0.05, b - 0.05, y, 0.02, fh * 0.75);
        g.box(a + 0.04, y - 0.05, fh * 0.8, b - a - 0.08, 0.05, 0.015); // awning
      }
    }
  },
};

// The village inn: gable to the street, the dance hall behind a row of
// tall windows.
export const hospodaWide = {
  ...COMMON,
  id: 'hospoda-wide',
  name: 'Hospoda',
  blurb: 'The pub',
  size: 'Wide',
  tags: ['business', 'pub'],
  code: 'P',
  footprint: [[0, 0], [1, 0]],
  stats: { jobs: 6 },
  agents: 2,
  yards: ['parking', 'plaza', 'trees'],
  draw(g) {
    const d = 0.4, y = -d / 2, w = 0.36, h = 0.19;
    g.roofed(-0.32, y, 0, w, d, h, { h: g.range(0.2, 0.24), ridge: 'y' });
    g.windows(-0.32, y, w, d, 0, h, h, 0.1, { h: 0.4, skip: ['right'] });
    door(g, -0.14, y, 0.07, 0.12);
    chimney(g, -0.2, 0.05, h + 0.1, 0.14);
    const hx = 0.04, hw = 1.26, hh = 0.24;
    g.roofed(hx, y + 0.02, 0, hw, d - 0.04, hh, { h: 0.13, hip: [0, 0.1] });
    g.windows(hx, y + 0.02, hw, d - 0.04, 0.03, hh - 0.02, hh - 0.05, 0.16, { w: 0.35, h: 0.85, skip: ['left'] });
    door(g, 1.0, y + 0.02, 0.07, 0.12);
    barrels(g, 1.3, 0.32);
    bench(g, -0.14, y - 0.12, true, -1);
  },
};

// The department store (Prior) of blank panels over a glazed ground floor.
export const storeWide = {
  ...COMMON,
  id: 'store-wide',
  name: 'Obchodní dům',
  blurb: 'The department store',
  size: 'Wide',
  tags: ['business', 'shop'],
  code: 'OD',
  footprint: [[0, 0], [1, 0]],
  stats: { jobs: 48 },
  agents: 5,
  yards: ['plaza', 'trees'],
  draw(g) {
    const fh = 0.11;
    const x0 = -0.34, x1 = 1.34, d = 0.64, y = -0.32, h = fh * g.int(5, 6);
    g.box(x0, y, 0, x1 - x0, d, h);
    g.windows(x0, y, x1 - x0, d, 0, fh, fh, 0.1, { ribbon: true, h: 0.6 });
    g.floors(x0, y, x1 - x0, d, fh, h, fh * 1.35, { inset: 0 });
    g.mullions(x0, y, x1 - x0, d, fh, h, fh * 1.35, 0);
    g.box(x0 - 0.02, y - 0.08, fh, x1 - x0 + 0.04, 0.08, 0.015); // canopy
    g.box(0.1, y + 0.16, h, 0.8, d - 0.32, 0.09);                 // plant room
    roofSign(g, 0.5, y + 0.04, h, 0.5);
  },
};

// A 60s office block with ribbon windows, or the 50s district office (ONV)
// with a columned entrance.
export const officeWide = {
  ...COMMON,
  id: 'office-wide',
  name: 'Národní výbor',
  blurb: 'Offices of the administration',
  size: 'Wide',
  tags: ['business', 'office'],
  code: 'NV',
  footprint: [[0, 0], [1, 0]],
  stats: { jobs: 16 },
  agents: 3,
  yards: ['plaza', 'parking'],
  draw(g) {
    const kind = g.pick(['ribbon', 'district']);
    if (kind === 'ribbon') {
      const x0 = -0.3, x1 = 1.2, d = g.range(0.34, 0.38), y = -d / 2, fh = 0.12, h = fh * g.int(4, 5);
      g.box(x0, y, 0, x1 - x0, d, h);
      g.windows(x0, y, x1 - x0, d, 0, h, fh, 0.1, { ribbon: true });
      g.box(x0 - 0.02, y - 0.02, h, x1 - x0 + 0.04, d + 0.04, 0.02);
      g.box(x1, y + 0.08, 0, 0.1, 0.14, h + 0.06);                // stair tower
      g.mullions(x1, y + 0.08, 0.1, 0.14, 0, h + 0.06, 0.04);
      for (const x of [0.02, 0.98]) door(g, x, y, 0.07, 0.1);
      aerials(g, x0 + 0.1, x1 - 0.1, y + d * 0.5, h + 0.02, 2);
    } else {
      const x0 = -0.32, x1 = 1.32, d = 0.42, y = -d / 2, fh = 0.15, h = fh * 4;
      g.roofed(x0, y, 0, x1 - x0, d, h, { h: 0.12, hip: 0.14 });
      g.windows(x0, y, x1 - x0, d, 0, h, fh, 0.075, { h: 0.55, w: 0.4 });
      columns(g, 0.3, 0.7, y - 0.05, fh * 1.6, 5);
      g.box(0.28, y - 0.07, fh * 1.6, 0.44, 0.07, 0.03);
      flagpole(g, 0.5, y - 0.07, 0.25 + fh * 1.6);
      for (const x of [0.02, 0.98]) door(g, x, y, 0.06, 0.1);
    }
  },
};

// A brutalist office slab raised on pilotis under a heavy crown, a star on
// its front.
export const officeTowerWide = {
  ...COMMON,
  id: 'office-tower-wide',
  name: 'Národní výbor',
  blurb: 'Offices of the administration',
  size: 'Wide tower',
  tags: ['business', 'office'],
  code: 'NV',
  footprint: [[0, 0], [1, 0]],
  stats: { jobs: 48 },
  agents: 5,
  yards: ['plaza', 'trees'],
  draw(g) {
    const fh = 0.11;
    const lift = 0.12, hc = fh * 1.2, h = lift + fh * g.int(8, 10);
    const x0 = -0.3, x1 = 1.3, d = 0.34, y = -d / 2;
    g.box(0.1, y + 0.07, 0, 0.8, d - 0.14, lift);
    g.mullions(0.1, y + 0.07, 0.8, d - 0.14, 0, lift, 0.05);
    g.detailed(1, () => {
      g.solid(0.5, y + 0.02, lift / 2);
      for (let i = 0; i <= 6; i++) g.line([[x0 + 0.04 + ((x1 - x0 - 0.08) * i) / 6, y + 0.03, 0], [x0 + 0.04 + ((x1 - x0 - 0.08) * i) / 6, y + 0.03, lift]]);
    });
    g.box(x0, y, lift, x1 - x0, d, h - lift);
    g.windows(x0, y, x1 - x0, d, lift, h, fh, 0.1, { ribbon: true });
    g.box(x0 - 0.04, y - 0.04, h, x1 - x0 + 0.08, d + 0.08, hc);
    g.windows(x0 - 0.04, y - 0.04, x1 - x0 + 0.08, d + 0.08, h, h + hc, hc, 0.1, { ribbon: true, h: 0.3 });
    star(g, 0.5, y - 0.045, h + hc / 2);
  },
};

// Pošta a spořitelna, 70s: the post office and the savings bank, glass
// below, panels above, a clock at the corner.
export const postOffice = {
  ...COMMON,
  id: 'post-office',
  name: 'Pošta',
  blurb: 'Post office and savings bank',
  tags: ['business', 'office'],
  code: 'PO',
  footprint: [[0, 0], [1, 0]],
  stats: { jobs: 16 },
  agents: 3,
  yards: ['plaza', 'parking'],
  draw(g) {
    const x0 = -0.3, x1 = 1.3, d = 0.4, y = -d / 2, h0 = 0.16, h = h0 + 0.24;
    g.box(x0, y, 0, x1 - x0, d, h);
    g.windows(x0, y, x1 - x0, d, 0, h0, h0, 0.1, { ribbon: true, h: 0.7, skip: ['back'] });
    g.mullions(x0, y, x1 - x0, d, h0, h, 0.06, { skip: ['back'] });
    g.windows(x0, y, x1 - x0, d, h0, h, 0.12, 0.12, { ribbon: true, h: 0.3, skip: ['back'] });
    g.box(x0 - 0.02, y - 0.08, h0, x1 - x0 + 0.04, 0.08, 0.015); // canopy
    g.box(x1 - 0.01, y - 0.06, h0 + 0.02, 0.01, 0.05, 0.2);      // blade sign
    for (const x of [0.02, 0.98]) door(g, x, y, 0.08, 0.12);
    streetClock(g, 1.37, y + 0.06);
  },
};

// An Interhotel slab on its podium.
export const hotelWide = {
  ...COMMON,
  id: 'hotel-wide',
  name: 'Hotel',
  blurb: 'Rooms for visitors',
  size: 'Wide',
  tags: ['business', 'hotel'],
  code: 'H',
  footprint: [[0, 0], [1, 0]],
  stats: { jobs: 48 },
  agents: 5,
  yards: ['plaza', 'trees'],
  draw(g) {
    const fh = 0.11;
    const hp = fh * 1.3, h = hp + fh * g.int(9, 11), d = 0.24;
    g.box(-0.34, -0.32, 0, 1.68, 0.64, hp);
    g.windows(-0.34, -0.32, 1.68, 0.64, 0, hp, hp, 0.1, { ribbon: true, h: 0.55 });
    g.box(-0.2, -d / 2 + 0.06, hp, 1.4, d, h - hp);
    g.mullions(-0.2, -d / 2 + 0.06, 1.4, d, hp, h, 0.045);
    g.floors(-0.2, -d / 2 + 0.06, 1.4, d, hp, h, fh, { inset: 0 });
    g.box(0.3, -0.02, h, 0.4, 0.16, 0.1);                       // lift room
    for (const x of [-0.2, -0.05, 0.1]) flagpole(g, x, -0.4, 0.4);
    aerials(g, -0.1, 1.1, 0.08, h, 3);
  },
};
