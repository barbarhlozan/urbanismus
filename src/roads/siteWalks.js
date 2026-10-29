// The walkways through a park or square, from its exits (world.sitePaths),
// in world coordinates – drawn by the park (structures/park.js) and walked
// by people (sim/agents.js smooths their routes through the hub the same
// way, so they keep to the drawn curve):
//   no exit     no walkways: the green is left as it is
//   one         the way in runs to the middle and ends there
//   two         one walkway from one to the other, curving through the
//               middle – straight when they face each other
//   more        straight walkways crossing in the middle
// (No loops, no round plazas: a path is only there because a way in
// leads somewhere.)
//
//   { lines: [[[x, y]…]…], plaza: radius (0: none), loop: radius (0: none),
//     centre: [x, y] – the middle, clear of the walkways (for a fountain…) }

import { CONFIG } from '../config.js';
import { smoothPolyline } from './geometry.js';

export const SITE_WALK = {
  end: 0.25,  // past the end of a lone way in, the middle is free this far (times half)
  bend: 0.2,  // a curving walkway leaves the middle free this far (times half) on its inside
};

const unit = ([x, y]) => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};

// How much people round the turn at a site's hub (cornerAt in sim/agents.js).
export function hubRadius(exits) {
  return exits.length > 2 ? CONFIG.path.junctionRadius : CONFIG.path.cornerRadius;
}

export function siteWalks({ hubPos: hub, exits, half }) {
  const [hx, hy] = hub;
  if (!exits.length) return { lines: [], plaza: 0, loop: 0, centre: hub };
  if (exits.length === 1) {
    const [ux, uy] = unit([exits[0].pos[0] - hx, exits[0].pos[1] - hy]);
    const d = SITE_WALK.end * half;
    return { lines: [[exits[0].pos, hub]], plaza: 0, loop: 0, centre: [hx - ux * d, hy - uy * d] };
  }
  if (exits.length === 2) {
    const [a, b] = exits.map((e) => e.pos);
    const line = smoothPolyline([a, hub, b], hubRadius(exits), CONFIG.path.curveSamples);
    const ua = unit([a[0] - hx, a[1] - hy]), ub = unit([b[0] - hx, b[1] - hy]);
    if (ua[0] * ub[0] + ua[1] * ub[1] < -0.98) return { lines: [line], plaza: 0, loop: 0, centre: hub };
    // the curve bows towards the exits: the other side of the middle is free
    const [bx, by] = unit([ua[0] + ub[0], ua[1] + ub[1]]);
    const d = SITE_WALK.bend * half;
    return { lines: [line], plaza: 0, loop: 0, centre: [hx - bx * d, hy - by * d] };
  }
  return { lines: exits.map((e) => [hub, e.pos]), plaza: 0, loop: 0, centre: hub };
}

// Ways in for a site drawn on its own, with no town round it (the Assets
// page, gallery.html, Build menu icons): `n` of them (0–4), on the middle of
// the sides of the rectangle [x0, y0, x1, y1], as footpaths. Two face each
// other, unless `bend`. Hand the result to Painter.setSitePaths.
export function sampleSitePaths([x0, y0, x1, y1], n, { bend = false } = {}) {
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const sides = {
    w: { pos: [x0, my], dir: [-1, 0] },
    e: { pos: [x1, my], dir: [1, 0] },
    n: { pos: [mx, y0], dir: [0, -1] },
    s: { pos: [mx, y1], dir: [0, 1] },
  };
  const pick = ['', 'w', bend ? 'ws' : 'we', 'wes', 'wens'][Math.max(0, Math.min(4, n))];
  return {
    hubPos: [mx, my],
    half: Math.min(x1 - x0, y1 - y0) / 2,
    exits: [...pick].map((k) => ({ ...sides[k], road: -1, site: -1 })),
  };
}
