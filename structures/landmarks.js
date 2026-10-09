// Landmarks of the new town, 1950s–80s: a TV tower on a hilltop, a
// stadium – and a house of culture, which sits among the civic amenities
// (občanská vybavenost). Like the heritage ones (structures/heritage.js)
// they draw visitors and strollers (tag 'heritage').
//
// 2×2 ones: local area covers x, y from about -0.4 to 1.4, front on -y.

import { door, panel, flagpole, star, sculpture, bench, lamp, floodlight, pitch, planter, tree, transformer, FRAME, roundWindows, kindOf } from './kit.js';

const FRONT = [0, -1, 0];

const common = {
  access: 'any', // a footpath will do
  category: 'heritage',
  tags: ['heritage'],
  code: 'H',
  sim: { destinations: ['residential'] },
  plot: { props: 'green', boundary: 0.3, kinds: ['hedge'], density: 0.35 },
};

// Columns in front of a facade, from x0 to x1 at depth y, n + 1 of them.
function columns(g, x0, x1, y, h, n) {
  g.detailed(1, () => {
    g.solid((x0 + x1) / 2, y, h / 2);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      g.line([[x, y, 0], [x, y, h]], { width: 2.2 });
    }
  });
}

// ----- house of culture -----

export const cultureHouse = {
  ...common,
  id: 'culture-house',
  name: 'House of culture',
  blurb: 'Cinema and dance hall',
  // a civic amenity rather than a landmark (Build menu: Občanská
  // vybavenost); it keeps the 'heritage' tag, so visitors still come
  category: 'amenities',
  code: 'K',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  stats: { jobs: 10 },
  agents: 2,
  yards: ['plaza', 'forecourt'],
  kinds: ['sorela', 'brutalist', 'sixties'],
  draw(g, s) {
    const kind = kindOf(g, s, this.kinds);
    if (kind === 'sorela') {
      // 50s socialist realism: a symmetrical block, a columned portico
      // with a pediment and a star, flags either side of the steps
      const fh = 0.16, h = fh * 3;
      g.roofed(-0.32, 0.12, 0, 1.64, 0.95, h, { h: 0.12, hip: 0.3 });
      g.windows(-0.32, 0.12, 1.64, 0.95, 0, h, fh, 0.12, { w: 0.35, h: 0.6 });
      g.box(0.18, -0.12, 0, 0.64, 0.24, 0.02); // steps
      columns(g, 0.2, 0.8, -0.1, h - 0.06, 5);
      g.box(0.18, -0.12, h - 0.06, 0.64, 0.24, 0.06);
      g.solid(0.5, -0.12, h + 0.06);
      g.face([[0.18, -0.12, h], [0.82, -0.12, h], [0.5, -0.12, h + 0.14]]);
      g.face([[0.82, 0.12, h], [0.18, 0.12, h], [0.5, 0.12, h + 0.14]]);
      g.face([[0.18, -0.12, h], [0.5, -0.12, h + 0.14], [0.5, 0.12, h + 0.14], [0.18, 0.12, h]]);
      g.face([[0.82, 0.12, h], [0.5, 0.12, h + 0.14], [0.5, -0.12, h + 0.14], [0.82, -0.12, h]]);
      star(g, 0.5, -0.125, h + 0.06, 0.035);
      door(g, 0.5, 0.12, 0.1, 0.18);
      flagpole(g, 0.05, -0.3, 0.5);
      flagpole(g, 0.95, -0.3, 0.5);
      return;
    }
    if (kind === 'brutalist') {
      // 70s: a glass foyer under a heavy ribbed concrete band, the
      // auditorium behind with the stage's fly tower rising over it,
      // a side wing of clubrooms
      g.box(-0.3, -0.25, 0, 1.6, 0.63, 0.18);
      g.windows(-0.3, -0.25, 1.6, 0.63, 0, 0.18, 0.18, 0.1, { ribbon: true, h: 0.75, skip: ['back'] });
      g.box(-0.32, -0.28, 0.18, 1.64, 0.66, 0.17);
      g.mullions(-0.32, -0.28, 1.64, 0.66, 0.18, 0.35, 0.07, { skip: ['back'] });
      g.box(0.05, 0.38, 0, 0.9, 0.9, 0.44);
      g.box(0.25, 0.75, 0.44, 0.5, 0.45, 0.28); // fly tower, standing on the auditorium
      g.box(-0.34, 0.45, 0, 0.36, 0.85, 0.26);
      g.windows(-0.34, 0.45, 0.36, 0.85, 0, 0.26, 0.13, 0.1, { ribbon: true, skip: ['right'] });
      g.box(0.9, -0.3, 0.35, 0.36, 0.02, 0.07); // name sign on the band
      sculpture(g, 1.2, -0.37);
      planter(g, -0.2, -0.36);
      planter(g, 0.15, -0.36);
      return;
    }
    // 60s, Brussels Expo style: a glass pavilion under a thin roof, a
    // folded-roof hall behind, a pylon with the sign
    g.box(-0.25, -0.18, 0, 1.0, 0.55, 0.24);
    g.mullions(-0.25, -0.18, 1.0, 0.55, 0, 0.24, 0.05);
    g.box(-0.29, -0.22, 0.24, 1.08, 0.63, 0.018);
    door(g, 0.25, -0.18, 0.12, 0.14);
    const n = 5, w = 1.5 / n;
    for (let i = 0; i < n; i++) g.gableY(-0.25 + i * w, 0.45, 0, w, 0.85, 0.32, 0.1);
    g.windows(-0.25, 0.45, 1.5, 0.85, 0, 0.32, 0.32, 0.13, { skip: ['front'], w: 0.3, h: 0.7 });
    g.box(1.08, -0.3, 0, 0.08, 0.04, 0.62);
    g.box(1.05, -0.31, 0.46, 0.14, 0.06, 0.1);
    bench(g, 0.1, -0.36);
    lamp(g, 0.9, -0.36);
  },
};

// ----- TV tower / lookout, on a hilltop -----

// Hilltop: higher than the ground around it (the average `radius` dots
// away) by at least `rise` metres – a summit or a ridge, not a slope.
export function onHilltop(world, node, radius = 3, rise = 8) {
  const elev = world.elevation;
  const [x, y] = world.grid.xy(node);
  const e = elev(x, y);
  let sum = 0;
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    sum += elev(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
  }
  return e - sum / n >= rise;
}

// Steel lattice mast: four legs from half-width b at the foot to t at h,
// braced in zig-zags.
function latticeMast(g, x, y, h, b, t, n = 10) {
  g.detailed(1, () => {
    g.solid(x, y, h / 2);
    const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sy] of legs) g.line([[x + sx * b, y + sy * b, 0], [x + sx * t, y + sy * t, h]], FRAME);
    g.detailed(2, () => {
      for (let s = 0; s < 4; s++) {
        const a = legs[s], c = legs[(s + 1) % 4], pts = [];
        for (let i = 0; i <= n; i++) {
          const k = i / n, r = b + (t - b) * k, p = i % 2 ? c : a;
          pts.push([x + p[0] * r, y + p[1] * r, h * k]);
        }
        g.line(pts);
      }
    });
  });
}

export const tvTower = {
  ...common,
  id: 'tv-tower',
  name: 'Tower',
  blurb: 'On a hilltop',
  footprint: [[0, 0]],
  plot: { props: 'green', boundary: 0.3, kinds: ['fence'], density: 0.4 },
  canPlace(world, nodes) {
    return nodes.every((n) => onHilltop(world, n)) ? { ok: true } : { ok: false, reason: 'Needs a hilltop' };
  },
  stats: { jobs: 2 },
  agents: 0,
  yards: ['trees', 'garden'],
  kinds: ['shaft', 'lattice', 'lookout'],
  draw(g, s) {
    const kind = kindOf(g, s, this.kinds);
    if (kind === 'shaft') {
      // concrete TV tower: a tapering shaft, the transmitter cabin with a
      // glazed gallery near the top, an aerial mast, the station house
      g.box(-0.34, -0.3, 0, 0.3, 0.2, 0.12);
      g.windows(-0.34, -0.3, 0.3, 0.2, 0, 0.12, 0.12, 0.08, { ribbon: true });
      g.lathe(0.12, 0.08, 0, [[0.085, 0], [0.075, 0.06], [0.055, 1.2]], 24, { smooth: true, rings: [1] });
      g.lathe(0.12, 0.08, 1.2, [[0.055, 0], [0.13, 0.04], [0.13, 0.13], [0.1, 0.17], [0.06, 0.19]], 24, { smooth: true, rings: [1, 2, 3] });
      g.detailed(1, () => roundWindows(g, 0.12, 0.08, 0.13, 1.255, 1.33, 0.2, 10, { w: 0.03, h: 0.06 }));
      g.lathe(0.12, 0.08, 1.39, [[0.035, 0], [0.025, 0.25], [0.012, 0.25], [0.008, 0.6]], 8, { smooth: true, rings: [1] });
      return;
    }
    if (kind === 'lattice') {
      // steel transmitter mast and its equipment house
      latticeMast(g, 0.1, 0.1, 1.8, 0.16, 0.025, 20);
      g.roofed(-0.34, -0.32, 0, 0.3, 0.2, 0.12, { h: 0 });
      door(g, -0.24, -0.32, 0.06, 0.1);
      transformer(g, 0.3, -0.25);
      return;
    }
    // lookout tower (rozhledna): a slim tapering stone shaft with small
    // windows up the stair, an open gallery on top and a hatched cone
    const top = 0.8;
    g.lathe(0, 0.05, 0, [[0.1, 0], [0.095, 0.06], [0.07, top]], 24, { smooth: true, rings: [1] });
    g.detailed(1, () => roundWindows(g, 0, 0.05, 0.085, 0.2, top - 0.1, 0.16, 4, { phase: 0.125 }));
    g.lathe(0, 0.05, top, [[0.07, 0], [0.11, 0.03]], 24, { smooth: true });
    g.detailed(1, () => {
      g.solid(0, 0.05, top + 0.07);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, [cx, cy] = [Math.cos(a) * 0.1, 0.05 + Math.sin(a) * 0.1];
        g.line([[cx, cy, top + 0.03], [cx, cy, top + 0.12]]);
      }
      g.line(Array.from({ length: 17 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return [Math.cos(a) * 0.1, 0.05 + Math.sin(a) * 0.1, top + 0.075];
      }));
    });
    g.lathe(0, 0.05, top + 0.12, [[0.13, 0], [0.1, 0.03], [0, 0.17]], 24, { smooth: true, hatch: [0, 1] });
    door(g, 0, -0.045, 0.05, 0.09);
    tree(g, -0.28, 0.25, 0.9, 'spruce');
    tree(g, 0.3, -0.2, 0.8, 'spruce');
  },
};

// ----- stadium / Sokol hall -----

// Main stand along x from x0 to x1, seats rising towards +y from y, with a
// cantilevered roof on a back wall.
function stand(g, x0, x1, y, rows = 3) {
  const step = 0.07;
  for (let i = 0; i < rows; i++) {
    g.box(x0, y + i * step, 0, x1 - x0, step, 0.03 + i * 0.03);
    g.detailed(2, () => g.line([[x0 + 0.01, y + i * step + 0.02, 0.03 + i * 0.03 + 0.01], [x1 - 0.01, y + i * step + 0.02, 0.03 + i * 0.03 + 0.01]]));
  }
  const back = y + rows * step;
  g.box(x0, back, 0, x1 - x0, 0.05, 0.26);
  g.box(x0 - 0.02, y - 0.02, 0.26, x1 - x0 + 0.04, back - y + 0.07, 0.02);
  g.detailed(2, () => {
    g.solid((x0 + x1) / 2, y, 0.13);
    const n = Math.max(2, Math.round((x1 - x0) / 0.3));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      g.line([[x, back, 0.26], [x, y + 0.02, 0.26]]);
    }
  });
}

// Running track: two straights along x and a half round at each end.
function track(g, x0, y0, x1, y1) {
  const r = (y1 - y0) / 2, cy = (y0 + y1) / 2;
  const arc = (cx, from) => Array.from({ length: 9 }, (_, i) => {
    const a = from + (i / 8) * Math.PI;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
  const loop = [...arc(x1 - r, -Math.PI / 2), ...arc(x0 + r, Math.PI / 2)];
  g.groundPoly(loop);
}

export const stadium = {
  ...common,
  id: 'stadium',
  name: 'Stadium',
  blurb: 'Sports ground',
  // 3×2: local x from about -0.4 to 2.4, y from -0.4 to 1.4
  footprint: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  plot: { props: 'green', boundary: 0.5, lone: 0.5, kinds: ['fence', 'hedge'], density: 0.3 }, // fenced in, wherever it is
  stats: { jobs: 4 },
  agents: 2,
  yards: ['parking', 'trees'],
  draw(g) {
    if (g.chance(0.35)) {
      // Sokol hall: a gymnasium with tall windows behind a front house,
      // and an exercise ground beside it
      g.gableY(-0.3, 0.3, 0, 0.7, 1.0, 0.3, 0.2);
      g.windows(-0.3, 0.3, 0.7, 1.0, 0, 0.3, 0.3, 0.14, { skip: ['front', 'back'], w: 0.4, h: 0.75 });
      g.roofed(-0.34, -0.12, 0, 0.78, 0.42, 0.3, { h: 0.14, hip: 0.12 });
      g.windows(-0.34, -0.12, 0.78, 0.42, 0, 0.3, 0.15, 0.1, { from: 1 });
      door(g, 0.05, -0.12, 0.1, 0.14);
      panel(g, -0.25, -0.05, -0.12, 0.03, 0.12);
      panel(g, 0.15, 0.35, -0.12, 0.03, 0.12);
      pitch(g, 0.75, -0.22, 2.3, 1.02);
      for (const x of [1.1, 1.5, 1.9]) bench(g, x, 1.14, true, 1);
      flagpole(g, 0.55, -0.3, 0.5);
      tree(g, 2.3, 1.3, 1);
      return;
    }
    // stadium: a pitch in a running track, a covered stand along the
    // back, floodlight masts on the corners, a scoreboard at the front
    track(g, -0.38, -0.34, 2.38, 0.98);
    pitch(g, 0.12, -0.2, 1.88, 0.84);
    stand(g, 0.2, 1.8, 1.03);
    for (const [x, y] of [[-0.38, -0.38], [2.38, -0.38], [-0.38, 1.32], [2.38, 1.32]]) {
      floodlight(g, x, y, 1.1, [1 - x, 0.4 - y]);
    }
    g.detailed(1, () => {
      g.solid(1.0, -0.42, 0.1);
      g.line([[0.86, -0.42, 0], [0.86, -0.42, 0.14]], FRAME);
      g.line([[1.14, -0.42, 0], [1.14, -0.42, 0.14]], FRAME);
    });
    g.box(0.82, -0.43, 0.14, 0.36, 0.02, 0.1);
  },
};
