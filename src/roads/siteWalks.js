// The walkways through a park or square, from its exits (world.sitePaths),
// in world coordinates – drawn by the park (structures/park.js) and walked
// by people (sim/agents.js smooths their routes through the hub the same
// way, so they keep to the drawn curve):
//   no exit     no walkways: the green is left as it is
//   one         the way in runs to a loop round the middle
//   two         one walkway from one to the other, curving through the
//               middle – straight, with a little plaza, when they face
//               each other
//   more        straight walkways meeting at a round plaza in the middle
//
//   { lines: [[[x, y]…]…], plaza: radius (0: none), loop: radius (0: none),
//     centre: [x, y] – the middle, clear of the walkways (for a fountain…) }

import { CONFIG } from '../config.js';
import { smoothPolyline } from './geometry.js';

export const SITE_WALK = {
  plaza: 0.08, // radius of the plaza where walkways meet
  loop: 0.4,   // radius of the loop, times the site's half size (sitePaths half)
  bend: 0.2,   // a curving walkway leaves the middle free this far (times half) on its inside
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
    const r = SITE_WALK.loop * half;
    const [ux, uy] = unit([exits[0].pos[0] - hx, exits[0].pos[1] - hy]);
    const a0 = Math.atan2(uy, ux), n = 32;
    const ring = Array.from({ length: n + 1 }, (_, i) => {
      const a = a0 + (i / n) * Math.PI * 2;
      return [hx + Math.cos(a) * r, hy + Math.sin(a) * r];
    });
    return { lines: [[exits[0].pos, [hx + ux * r, hy + uy * r]], ring], plaza: 0, loop: r, centre: hub };
  }
  if (exits.length === 2) {
    const [a, b] = exits.map((e) => e.pos);
    const line = smoothPolyline([a, hub, b], hubRadius(exits), CONFIG.path.curveSamples);
    const ua = unit([a[0] - hx, a[1] - hy]), ub = unit([b[0] - hx, b[1] - hy]);
    if (ua[0] * ub[0] + ua[1] * ub[1] < -0.98) return { lines: [line], plaza: SITE_WALK.plaza, loop: 0, centre: hub };
    // the curve bows towards the exits: the other side of the middle is free
    const [bx, by] = unit([ua[0] + ub[0], ua[1] + ub[1]]);
    const d = SITE_WALK.bend * half;
    return { lines: [line], plaza: 0, loop: 0, centre: [hx - bx * d, hy - by * d] };
  }
  return { lines: exits.map((e) => [hub, e.pos]), plaza: SITE_WALK.plaza, loop: 0, centre: hub };
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
