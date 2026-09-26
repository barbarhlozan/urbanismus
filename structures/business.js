// Business: shop -> offices -> high-rise, in the spirit of a Central
// European town from the 50s to the 80s: flat-roofed self-service shops with
// a sign on the roof, shops under townhouses, 60s office blocks with ribbon
// windows, department stores, socialist-realist towers with a spire and
// brutalist towers with a heavy crown.
// Front (shop window, entrance) is the -y side.

import { door, panel, frontage, shared, hips, aerials, flagpole } from './kit.js';

const FRONT = [0, -1, 0];

// Sign box standing on thin posts on a flat roof at height z.
function roofSign(g, cx, y, z, w = 0.3) {
  g.box(cx - w / 2, y, z + 0.04, w, 0.025, 0.07);
  g.detailed(2, () => {
    g.solid(cx, y, z + 0.02);
    for (const k of [-0.35, 0.35]) g.line([[cx + w * k, y + 0.012, z], [cx + w * k, y + 0.012, z + 0.04]]);
  });
}

// Five-pointed star, facing the screen.
function star(g, x, y, z, r = 0.04) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? 0.45 : 1;
    pts.push([Math.cos(a) * r * k, Math.sin(a) * r * k]);
  }
  g.shape(x, y, z, pts);
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

export default {
  id: 'business',
  name: 'Business',
  hotkey: '2',
  category: 'zone',
  footprint: [[0, 0]],
  sim: { destinations: ['residential'] },
  plot: { props: 'service', boundary: 0.2, kinds: ['hedge'], density: 0.3 },

  levels: [
    {
      name: 'Shop',
      stats: { jobs: 3 },
      agents: 1,
      yards: ['parking', 'plaza', 'trees'],
      join: { group: 'street', chance: 0.6 },
      draw(g) {
        const joined = g.join.left || g.join.right;
        const kind = joined ? 'townhouse' : g.pick(['pavilion', 'pavilion', 'village', 'townhouse']);
        if (kind === 'townhouse') {
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
    },
    {
      name: 'Offices',
      stats: { jobs: 8 },
      agents: 2,
      yards: ['plaza', 'parking'],
      join: { group: 'street', chance: 0.5 },
      grow: {
        requires: [{ type: 'residential', count: 3, radius: 3 }],
        boost: [{ type: 'square', radius: 3, factor: 1.6 }, { type: 'heritage', radius: 3, factor: 1.3 }],
      },
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
    },
    {
      name: 'High-rise',
      stats: { jobs: 24 },
      agents: 3,
      yards: ['plaza', 'trees'],
      grow: {
        requires: [
          { type: 'residential', count: 8, radius: 4 },
          { type: 'residential', count: 4, radius: 4, minLevel: 2 },
          { type: 'business', count: 2, radius: 3 },
          { type: 'business', count: 1, radius: 3, minLevel: 2 },
        ],
        coveredBy: ['services'],
        boost: [{ type: 'square', radius: 3, factor: 1.6 }],
      },
      draw(g) {
        const kind = g.pick(['spire', 'crown', 'store', 'hotel']);
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
        } else if (kind === 'crown') {
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
        } else if (kind === 'store') {
          // department store: a big block of blank panels over a glass ground floor
          const w = 0.66, d = 0.6, x = -w / 2, y = -d / 2, h = fh * 5;
          g.box(x, y, 0, w, d, h);
          g.windows(x, y, w, d, 0, fh, fh, 0.1, { ribbon: true, h: 0.6 });
          g.floors(x, y, w, d, fh, h, fh * 1.35, { inset: 0 });
          g.mullions(x, y, w, d, fh, h, fh * 1.35, 0);
          g.box(x + 0.12, y + 0.14, h, w - 0.24, d - 0.28, 0.08); // plant room
          roofSign(g, 0, y + 0.04, h, 0.36);
        } else {
          // hotel slab with fins, on a low wide podium
          const w = 0.64, d = 0.24, hp = fh * 1.3, h = hp + fh * g.int(8, 10);
          g.box(-0.32, -0.32, 0, 0.64, 0.64, hp);
          g.windows(-0.32, -0.32, 0.64, 0.64, 0, hp, hp, 0.1, { ribbon: true, h: 0.55 });
          g.box(-w / 2, -d / 2 + 0.06, hp, w, d, h - hp);
          g.mullions(-w / 2, -d / 2 + 0.06, w, d, hp, h, 0.045);
          g.floors(-w / 2, -d / 2 + 0.06, w, d, hp, h, fh, { inset: 0 });
          flagpole(g, -0.28, -0.38, 0.4);
          aerials(g, -0.2, 0.2, 0.06, h, 2);
        }
      },
    },
  ],
};
