// Signs at level crossings (trains.crossingList()), one on each side, at
// the right of whoever comes up to the track, facing them:
//   path, lane  a St Andrew's cross on a pole
//   road        the cross, and under it a box with two round lights; while
//               the crossing is closed the lights flash in turn – three
//               short lines out of the lit one (flashSVG)
// Drawn like the vehicles (vehicles.js): on the map an SVG snippet per
// heading, kind and camera rotation, cached, put on the canvas by the
// renderer; through any view for the photo camera (signSVGIn, photo.js).

import { rotateQuarter } from '../core/grid.js';
import { VEHICLES } from './vehicles.js';

// Where a sign stands from the crossing: `along` the road, `aside` to its
// right; pole height.
const PLACE = {
  road: { along: 0.3, aside: 0.17, h: 0.2 },
  lane: { along: 0.26, aside: 0.12, h: 0.16 },
  path: { along: 0.22, aside: 0.07, h: 0.15 },
};
const FLASH = 0.9; // seconds for both lights to flash once

const LIGHT = { y: 0.018, z: -0.055, r: 0.009 }; // the lights, from the cross
const COS30 = Math.cos(Math.PI / 6);
const r2 = (n) => Math.round(n * 100) / 100;

// The signs at crossing c: [{ x, y, heading (angle it faces), kind }].
// Each stands `along` the road from the crossing – following the road as
// drawn (c.near), so round a bend too – and `aside` to its right there.
export function signsAt(c) {
  const { along, aside } = PLACE[c.kind];
  return [-1, 1].map((side) => {
    let [x, y] = c.pos, [dx, dy] = [side * c.dir[0], side * c.dir[1]];
    const steps = 12, step = along / steps;
    for (let i = 0; i < steps; i++) {
      [x, y] = [x + dx * step, y + dy * step];
      const hit = nearest(c.near, x, y);
      if (!hit) continue;
      [x, y] = hit.at;
      // the road's direction there, kept pointing away from the crossing
      const [tx, ty] = hit.dir;
      [dx, dy] = tx * dx + ty * dy >= 0 ? [tx, ty] : [-tx, -ty];
    }
    // coming up from this side, heading h = -(dx, dy); its right is (-hy, hx)
    const [hx, hy] = [-dx, -dy];
    return { x: x - hy * aside, y: y + hx * aside, heading: Math.atan2(-hy, -hx), kind: c.kind };
  });
}

// The point of segments `segs` nearest (x, y), and the direction there.
function nearest(segs = [], x, y) {
  let best = null, bd = Infinity;
  for (const [p, q] of segs) {
    const [ex, ey] = [q[0] - p[0], q[1] - p[1]], l2 = ex * ex + ey * ey;
    if (l2 < 1e-12) continue;
    const t = Math.max(0, Math.min(1, ((x - p[0]) * ex + (y - p[1]) * ey) / l2));
    const at = [p[0] + ex * t, p[1] + ey * t], d = Math.hypot(at[0] - x, at[1] - y);
    if (d < bd) [bd, best] = [d, { at, dir: [ex / Math.sqrt(l2), ey / Math.sqrt(l2)] }];
  }
  return best;
}

// Is the lit light (0 or 1) at time t (seconds) – or none while open.
export function litLight(t) {
  return Math.floor((t / FLASH) * 2) % 2;
}

// The map's isometric view, around the sign's foot in scene px (as in
// vehicles.js). Views take world offsets from the foot:
//   project(o) -> [x, y] on screen, facing(n, o) -> is a surface seen
function isoView(camera) {
  return {
    project([wx, wy, wz]) {
      const [rx, ry] = rotateQuarter(wx, wy, camera.rotation);
      return [(rx - ry) * COS30 * camera.tile, (rx + ry) * 0.5 * camera.tile - wz * camera.zScale * camera.tile];
    },
    facing: (n) => camera.facing(n),
  };
}

// model (x towards the traffic, y to its left, z up) -> world offset, the
// model drawn at SCALE
const SCALE = 0.65;
function modelView(view, angle) {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const toWorld = ([x, y, z]) => [(x * c - y * s) * SCALE, (x * s + y * c) * SCALE, z * SCALE];
  return {
    project: (p) => view.project(toWorld(p)),
    facing: (n, p = [0, 0, 0]) => view.facing(toWorld(n), toWorld(p)),
  };
}

const cache = new Map();
const cached = (key, make) => {
  let svg = cache.get(key);
  if (svg === undefined) cache.set(key, (svg = make()));
  return svg;
};
const snap = (angle) => {
  const n = VEHICLES.headings;
  return ((((Math.round((angle / (Math.PI * 2)) * n) % n) + n) % n) / n) * Math.PI * 2;
};
const camKey = (camera) => `${camera.rotation}|${camera.tile}|${camera.zScale}`;

// The sign's inner SVG around its foot on the map (cached per heading).
export function signSVG(camera, angle, kind) {
  const a = snap(angle);
  return cached(`s|${kind}|${a}|${camKey(camera)}`, () => signSVGIn(isoView(camera), a, kind));
}

// Three short lines out of light `which` (0: the one on the sign's left, 1:
// right) of a road sign, or '' when its front doesn't show.
export function flashSVG(camera, angle, which) {
  const a = snap(angle);
  return cached(`f|${which}|${a}|${camKey(camera)}`, () => flashSVGIn(isoView(camera), a, which));
}

// The same through any view (not cached), e.g. the photo camera.
export function signSVGIn(view, angle, kind) {
  const { project, facing } = modelView(view, angle);
  const poly = (pts) => `M${pts.map((p) => project(p).map(r2).join(' ')).join('L')}Z`;
  const line = (pts) => `M${pts.map((p) => project(p).map(r2).join(' ')).join('L')}`;
  const h = PLACE[kind].h;
  // two bars crossed at the top of the pole, just in front of it
  const bar = (k) => {
    const [a, b, t] = [0.04, 0.034 * k, 0.0075];
    const l = Math.hypot(a, b), [ny, nz] = [(-b / l) * t, (a / l) * t];
    return [[-a - ny, -b - nz], [a - ny, b - nz], [a + ny, b + nz], [-a + ny, -b + nz]].map(([y, z]) => [0.004, y, h + z]);
  };
  let out = `<path class="sgl" d="${line([[0, 0, 0], [0, 0, h + 0.02]])}"/>`;
  if (kind === 'road') {
    // the light box, and its lights on the front when that shows
    const [x0, x1, y0, y1, zc] = [0.002, 0.018, -0.035, 0.035, h + LIGHT.z];
    const [z0, z1] = [zc - 0.018, zc + 0.018];
    const mid = [(x0 + x1) / 2, 0, zc];
    const faces = [
      { n: [1, 0, 0], pts: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]] },
      { n: [-1, 0, 0], pts: [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]] },
      { n: [0, 1, 0], pts: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]] },
      { n: [0, -1, 0], pts: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
      { n: [0, 0, 1], pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
    ].filter((f) => facing(f.n, f.pts[0].map((v, i) => (v + mid[i]) / 2)));
    out += `<path class="vb" d="${faces.map((f) => poly(f.pts)).join('')}"/>`;
    if (facing([1, 0, 0], [x1, 0, zc])) {
      const lamps = [-1, 1].map((sd) => poly(Array.from({ length: 10 }, (_, i) => {
        const t = (i / 10) * Math.PI * 2;
        return [x1 + 0.001, sd * LIGHT.y + Math.cos(t) * LIGHT.r, zc + Math.sin(t) * LIGHT.r];
      })));
      out += `<path class="vi" d="${lamps.join('')}"/>`;
    }
  }
  out += `<path class="vb" d="${[bar(1), bar(-1)].map(poly).join('')}"/>`;
  return out;
}

export function flashSVGIn(view, angle, which) {
  const { project, facing } = modelView(view, angle);
  const zc = PLACE.road.h + LIGHT.z, x = 0.02;
  if (!facing([1, 0, 0], [x, 0, zc])) return '';
  const side = which ? -1 : 1; // +y is the sign's left
  const d = [-0.7, 0, 0.7].map((a) => {
    const [dy, dz] = [side * Math.cos(a), Math.sin(a)];
    const from = [x, side * LIGHT.y + dy * 0.026, zc + dz * 0.026];
    const to = [x, side * LIGHT.y + dy * 0.05, zc + dz * 0.05];
    return `M${project(from).map(r2).join(' ')}L${project(to).map(r2).join(' ')}`;
  }).join('');
  return `<path class="flash" d="${d}"/>`;
}
