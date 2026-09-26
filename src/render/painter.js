// The drawing API that structure and feature files use (the `g` argument of
// their draw(g, instance) function).
//
// Coordinates are LOCAL world units: (0, 0, 0) is the object's grid dot on
// the ground, one grid step = 1, z is up. The painter projects to isometric
// SVG, hides back faces and depth-sorts solids, so drawings are written once
// and look right from every camera rotation.
//
// Primitives
//   g.box(x, y, z, w, d, h, opts)            axis-aligned block
//   g.prism(base[[x,y]…], z0, z1, opts)      any convex CCW footprint, extruded
//   g.gable(x, y, z, w, d, h, roofH, opts)   block with a pitched roof (ridge along x)
//   g.gableY(x, y, z, w, d, h, roofH, opts)  same, ridge along y
//   g.roofed(x, y, z, w, d, h, roof, opts)   block with a hip / gable / pyramid /
//                                            mansard / flat roof (see the method)
//   g.lathe(x, y, z, [[r, h]…], sides, opts) solid of revolution (domes, spires, towers)
//   g.vault(x, y, z, w, d, h, rise, segs, opts) block with a barrel-vault roof (opts.alongY)
//   g.face([[x,y,z]…], opts)                 single polygon, CCW seen from outside
//   g.line([[x,y,z]…], opts)                 polyline; opts.facing = normal to hide it with its wall
//   g.disc(x, y, z, r, opts)                 screen-facing circle (e.g. tree crowns)
//   g.shape(x, y, z, [[u,v]…], opts)         screen-facing polygon, u right / v up, in grid units
//                                            (opts.smooth: a rounded outline through the points' midpoints)
//   g.strokes(x, y, z, [[[u,v]…]…], opts)    screen-facing polylines (one <path>), e.g. tree glyphs
//   g.strokeGroups([{x, y, z, lines}…], opts) the same for several anchors, still one <path>
//   g.solid(x, y, z)                         start a new depth-sorted group manually
//   g.cylinder(x, y, z, r, h, sides, opts)   upright polygonal cylinder (chimneys, silos)
//
// Ground drawing – flat linework at z = 0 (lawns, paving, parking lines,
// paths). It goes to a separate layer under roads and buildings, so it never
// covers anything standing up:
//   g.groundLine([[x,y]…], opts)             polyline
//   g.groundPoly([[x,y]…], opts)             closed outline (opts.fill for hatching, e.g. 'url(#hatch-water)')
//   g.groundCircle(x, y, r, opts)            circle on the ground
//   g.groundCurve([x,y], [cx,cy], [x,y], opts)  quadratic curve (winding paths)
//
// Facade helpers – call right after the box they decorate:
//   g.floors(x, y, w, d, z0, z1, step)       horizontal lines around the box every `step`
//   g.mullions(x, y, w, d, z0, z1, step)     vertical lines on every side, about `step` apart
//   g.windows(x, y, w, d, z0, z1, step, spacing, opts)  a window per bay and storey
//   All three take opts.skip: sides to leave blank (walls shared when joined).
//
// Site – for structures with `site: true` (parks, squares), g.site is the
// ground they may fill, in local coordinates: { x0, y0, x1, y1 } (bounding
// box) and `outline` (polygon). It reaches the road – following its curves –
// where there is a road, and merges with neighbouring sites.
//
// Detail levels (LOD) – everything drawn gets a detail level, and the
// renderer hides levels above what the current zoom needs:
//   0 always shown · 1 hidden when far · 2 shown only close up
// g.lod sets the default for what follows; opts.lod overrides it. Lines on
// walls (opts.facing), floors and mullions are level 2 automatically.
//
// Free space – g.free(x, y, r) is false where a footpath or road is within r
// (footpaths have priority over lots). Props in kit.js check it themselves.
//
// Joins – g.join = { left, right }: true where this building shares a wall
// with its neighbour on the local -x (left) / +x (right) side. Draw up to
// x = ∓0.5 there (levels opt in with `join`, see structures/index.js).
//
// Spots – g.spot(x, y) marks a parking stall (cars are drawn and simulated
// separately, see src/sim/parking.js).
//
// Variation – seeded per building, so the same building always looks the same:
//   g.random()          0..1
//   g.range(min, max)   number in [min, max)
//   g.int(min, max)     integer in [min, max]
//   g.pick([a, b, c])   one element
//   g.chance(p)         true with probability p
//
// opts: { fill, stroke, width, dash } – colors are palette names from theme.js
// ('fg', 'bg', …) or literal CSS colors. Defaults come from styles.css.

import { rotateQuarter } from './camera.js';
import { color } from '../theme.js';
import { mulberry32 } from '../core/random.js';

const r2 = (n) => Math.round(n * 100) / 100;

function newellNormal(points) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1, z1] = points[i];
    const [x2, y2, z2] = points[(i + 1) % points.length];
    nx += (y1 - y2) * (z1 + z2);
    ny += (z1 - z2) * (x1 + x2);
    nz += (x1 - x2) * (y1 + y2);
  }
  return [nx, ny, nz];
}

function attrs(opts, lod = 0, base = '') {
  let style = '';
  if (opts.fill) style += `fill:${color(opts.fill)};`;
  if (opts.stroke) style += `stroke:${color(opts.stroke)};`;
  if (opts.width) style += `stroke-width:${opts.width};`;
  if (opts.dash) style += `stroke-dasharray:${opts.dash};`;
  const cls = [base, opts.cls, lod > 0 ? `d${lod}` : ''].filter(Boolean).join(' ');
  return (style ? ` style="${style}"` : '') + (cls ? ` class="${cls}"` : '');
}

// The four walls of a box as { n: outward normal, a, b: ends along the wall }.
// skip: side names to leave out ('front', 'right', 'back', 'left').
function boxSides(x, y, w, d, inset, skip = []) {
  return [
    { side: 'front', n: [0, -1, 0], a: [x + inset, y], b: [x + w - inset, y] },
    { side: 'right', n: [1, 0, 0], a: [x + w, y + inset], b: [x + w, y + d - inset] },
    { side: 'back', n: [0, 1, 0], a: [x + w - inset, y + d], b: [x + inset, y + d] },
    { side: 'left', n: [-1, 0, 0], a: [x, y + d - inset], b: [x, y + inset] },
  ].filter((s) => !skip.includes(s.side));
}

export class Painter {
  constructor(camera, origin, rotation = 0, seed = 1) {
    this.camera = camera;
    this.random = mulberry32(seed);
    this.ox = origin.x;
    this.oy = origin.y;
    this.oz = origin.z ?? 0;
    this.rotation = rotation;
    this.solids = [];
    this.ground = [];
    this.site = null;
    this.spots = [];
    this.lod = 0;
    this.free = null;     // set by the renderer: (x, y, r) -> bool, local coords
    this.bounds = null;   // local [x0, y0, x1, y1] of all solids drawn
    this.join = { left: false, right: false }; // set by the renderer, see structures/index.js
    this.current = null;
  }

  // ----- internals -----

  _world(x, y, z) {
    const [lx, ly] = rotateQuarter(x, y, this.rotation);
    return [this.ox + lx, this.oy + ly, this.oz + z];
  }

  _proj(p) {
    const [sx, sy] = this.camera.project(...this._world(p[0], p[1], p[2]));
    return `${r2(sx)},${r2(sy)}`;
  }

  _facing([nx, ny, nz]) {
    const [rx, ry] = rotateQuarter(nx, ny, this.rotation);
    return this.camera.facing([rx, ry, nz]);
  }

  _lod(opts) {
    return opts.lod ?? this.lod;
  }

  _grow(points) {
    for (const [x, y] of points) {
      if (!this.bounds) this.bounds = [x, y, x, y];
      const b = this.bounds;
      b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y);
      b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
    }
  }

  _ensure(x, y, z) {
    if (!this.current) this.solid(x, y, z);
  }

  _walls(base, z0, z1, opts) {
    for (let i = 0; i < base.length; i++) {
      const [ax, ay] = base[i];
      const [bx, by] = base[(i + 1) % base.length];
      this.face([[ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1]], opts);
    }
  }

  // Set g.site from a world outline polygon.
  setSite(worldOutline) {
    const outline = worldOutline.map(([x, y]) => rotateQuarter(x - this.ox, y - this.oy, -this.rotation));
    const xs = outline.map((p) => p[0]);
    const ys = outline.map((p) => p[1]);
    this.site = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), outline };
    return this;
  }

  // Site paths (world.sitePaths) in local coordinates:
  // g.site.paths = { hub: [x, y], exits: [{ pos: [x, y], dir: [dx, dy], road }] }
  setSitePaths({ hubPos, exits }) {
    const local = ([x, y]) => rotateQuarter(x - this.ox, y - this.oy, -this.rotation);
    this.site.paths = {
      hub: local(hubPos),
      exits: exits.map((e) => ({ pos: local(e.pos), dir: rotateQuarter(e.dir[0], e.dir[1], -this.rotation), road: e.road >= 0 })),
    };
    return this;
  }

  // ----- variation -----

  range(min, max) {
    return min + this.random() * (max - min);
  }

  int(min, max) {
    return min + Math.floor(this.random() * (max - min + 1));
  }

  pick(list) {
    return list[Math.floor(this.random() * list.length)];
  }

  chance(p) {
    return this.random() < p;
  }

  // ----- public API -----

  solid(x, y, z) {
    const [wx, wy, wz] = this._world(x, y, z);
    this.current = { depth: this.camera.depth(wx, wy) + wz * 1e-3, parts: [] };
    this.solids.push(this.current);
    return this;
  }

  face(points, opts = {}) {
    this._ensure(...points[0]);
    if (!this._facing(newellNormal(points))) return this;
    this.current.parts.push(`<polygon points="${points.map((p) => this._proj(p)).join(' ')}"${attrs(opts, this._lod(opts))}/>`);
    return this;
  }

  prism(base, z0, z1, opts = {}) {
    this._grow(base);
    const cx = base.reduce((s, p) => s + p[0], 0) / base.length;
    const cy = base.reduce((s, p) => s + p[1], 0) / base.length;
    this.solid(cx, cy, (z0 + z1) / 2);
    this._walls(base, z0, z1, opts);
    this.face(base.map(([x, y]) => [x, y, z1]), opts);
    return this;
  }

  box(x, y, z, w, d, h, opts = {}) {
    return this.prism([[x, y], [x + w, y], [x + w, y + d], [x, y + d]], z, z + h, opts);
  }

  gable(x, y, z, w, d, h, roofH, opts = {}) {
    const x0 = x, x1 = x + w, y0 = y, y1 = y + d, ym = y + d / 2;
    const zt = z + h, zr = zt + roofH;
    this._grow([[x0, y0], [x1, y1]]);
    this.solid(x + w / 2, ym, z + (h + roofH) / 2);
    this._walls([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z, zt, opts);
    this.face([[x0, y0, zt], [x1, y0, zt], [x1, ym, zr], [x0, ym, zr]], opts);
    this.face([[x1, y1, zt], [x0, y1, zt], [x0, ym, zr], [x1, ym, zr]], opts);
    this.face([[x0, y1, zt], [x0, y0, zt], [x0, ym, zr]], opts);
    this.face([[x1, y0, zt], [x1, y1, zt], [x1, ym, zr]], opts);
    return this;
  }

  cylinder(x, y, z, r, h, sides = 8, opts = {}) {
    const base = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      base.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
    return this.prism(base, z, z + h, opts);
  }

  // opts: a number (inset from the corners) or { inset, skip: [side…] };
  // sides are 'front' (-y), 'right' (+x), 'back' (+y), 'left' (-x) – skip
  // the walls shared with a joined neighbour.
  floors(x, y, w, d, z0, z1, step, opts = {}) {
    const { inset = 0.04, skip } = typeof opts === 'number' ? { inset: opts } : opts;
    for (let z = z0 + step; z < z1 - step * 0.3; z += step) {
      for (const { n, a, b } of boxSides(x, y, w, d, inset, skip)) {
        this.line([[a[0], a[1], z], [b[0], b[1], z]], { facing: n });
      }
    }
    return this;
  }

  mullions(x, y, w, d, z0, z1, step, opts = {}) {
    const { inset = 0.03, skip } = typeof opts === 'number' ? { inset: opts } : opts;
    for (const { n, a, b } of boxSides(x, y, w, d, 0, skip)) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const count = Math.max(1, Math.round(len / step));
      for (let k = 1; k < count; k++) {
        const t = k / count;
        const px = a[0] + (b[0] - a[0]) * t;
        const py = a[1] + (b[1] - a[1]) * t;
        this.line([[px, py, z0 + inset], [px, py, z1 - inset]], { facing: n });
      }
    }
    return this;
  }

  // Punched windows: a row per storey (`step` high) between z0 and z1, about
  // `spacing` apart along every wall. opts = {
  //   skip     sides to leave blank (as for floors)
  //   w, h     window size as fractions of spacing / step (0.45, 0.45)
  //   ribbon   true = one long window band per storey instead
  //   from     first storey to draw (0; 1 = leave the ground floor blank)
  // }
  windows(x, y, w, d, z0, z1, step, spacing = 0.09, opts = {}) {
    const { skip, ribbon = false, from = 0 } = opts;
    const ww = spacing * (opts.w ?? 0.45), wh = step * (opts.h ?? 0.45);
    const storeys = Math.round((z1 - z0) / step);
    for (const { n, a, b } of boxSides(x, y, w, d, 0, skip)) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
      const at = (t, z) => [a[0] + ux * t, a[1] + uy * t, z];
      const cols = Math.floor(len / spacing);
      if (cols < 1) continue;
      const pad = (len - cols * spacing) / 2;
      for (let i = from; i < storeys; i++) {
        const zb = z0 + i * step + (step - wh) * 0.55, zt = zb + wh;
        if (ribbon) {
          const t0 = spacing * 0.3, t1 = len - spacing * 0.3;
          this.line([at(t0, zb), at(t1, zb), at(t1, zt), at(t0, zt), at(t0, zb)], { facing: n });
          continue;
        }
        for (let c = 0; c < cols; c++) {
          const t0 = pad + c * spacing + (spacing - ww) / 2, t1 = t0 + ww;
          this.line([at(t0, zb), at(t1, zb), at(t1, zt), at(t0, zt), at(t0, zb)], { facing: n });
        }
      }
    }
    return this;
  }

  gableY(x, y, z, w, d, h, roofH, opts = {}) {
    const x0 = x, x1 = x + w, y0 = y, y1 = y + d, xm = x + w / 2;
    const zt = z + h, zr = zt + roofH;
    this._grow([[x0, y0], [x1, y1]]);
    this.solid(xm, y + d / 2, z + (h + roofH) / 2);
    this._walls([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z, zt, opts);
    this.face([[x0, y1, zt], [x0, y0, zt], [xm, y0, zr], [xm, y1, zr]], opts);
    this.face([[x1, y0, zt], [x1, y1, zt], [xm, y1, zr], [xm, y0, zr]], opts);
    this.face([[x0, y0, zt], [x1, y0, zt], [xm, y0, zr]], opts);
    this.face([[x1, y1, zt], [x0, y1, zt], [xm, y1, zr]], opts);
    return this;
  }

  // Block with any common roof. roof = {
  //   h        roof height (0 = flat)
  //   ridge    'x' (default) or 'y': direction of the ridge
  //   hip      [start, end]: how far the ridge stops short of each end
  //            (0 = gable end; half the length on both = pyramid).
  //            A number sets both. Default 0.
  //   mansard  { h, inset }: a steep lower roof first, the roof above it.
  //            Gable ends (hip 0) stay vertical there.
  // }
  // g.roofed(x, y, 0, w, d, h, { h: 0.15 }) is g.gable(...);
  // { h: 0.1, hip: w / 2, ridge: 'x' } on a square is a pyramid roof.
  roofed(x, y, z, w, d, h, roof = {}, opts = {}) {
    const alongY = roof.ridge === 'y';
    // canonical frame: u along the ridge (0..L), v across (0..D)
    const L = alongY ? d : w, D = alongY ? w : d;
    const P = alongY ? (u, v, zz) => [x + v, y + u, zz] : (u, v, zz) => [x + u, y + v, zz];
    const face = (pts) => {
      const out = pts.map(([u, v, zz]) => P(u, v, zz)).filter((p, i, a) => {
        const q = a[(i + a.length - 1) % a.length];
        return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) > 1e-9;
      });
      if (out.length < 3) return;
      // swapping axes mirrors the frame: keep faces counter-clockwise
      this.face(alongY ? out.reverse() : out, opts);
    };
    const hip = Array.isArray(roof.hip) ? roof.hip : [roof.hip ?? 0, roof.hip ?? 0];
    const rh = roof.h ?? 0, zt = z + h;
    const m = roof.mansard;

    this._grow([[x, y], [x + w, y + d]]);
    this.solid(x + w / 2, y + d / 2, z + (h + rh + (m?.h ?? 0)) / 2);
    this._walls([[x, y], [x + w, y], [x + w, y + d], [x, y + d]], z, zt, opts);

    // mansard: lower roof from the wall tops to an inset rectangle
    let [u0, u1, v0, v1, zb] = [0, L, 0, D, zt];
    if (m) {
      const iv = m.inset ?? 0.05;
      const iu0 = hip[0] > 0 ? iv : 0, iu1 = hip[1] > 0 ? iv : 0;
      const zm = zt + m.h;
      face([[0, 0, zt], [L, 0, zt], [L - iu1, iv, zm], [iu0, iv, zm]]);
      face([[L, D, zt], [0, D, zt], [iu0, D - iv, zm], [L - iu1, D - iv, zm]]);
      face([[0, D, zt], [0, 0, zt], [iu0, iv, zm], [iu0, D - iv, zm]]);
      face([[L, 0, zt], [L, D, zt], [L - iu1, D - iv, zm], [L - iu1, iv, zm]]);
      [u0, u1, v0, v1, zb] = [iu0, L - iu1, iv, D - iv, zm];
    }

    if (rh <= 0) {
      face([[u0, v0, zb], [u1, v0, zb], [u1, v1, zb], [u0, v1, zb]]);
      return this;
    }
    const vm = (v0 + v1) / 2, zr = zb + rh;
    const span = u1 - u0;
    let ra = u0 + Math.min(hip[0], span / 2), rb = u1 - Math.min(hip[1], span / 2);
    if (ra > rb) ra = rb = (ra + rb) / 2;
    face([[u0, v0, zb], [u1, v0, zb], [rb, vm, zr], [ra, vm, zr]]);
    face([[u1, v1, zb], [u0, v1, zb], [ra, vm, zr], [rb, vm, zr]]);
    face([[u0, v1, zb], [u0, v0, zb], [ra, vm, zr]]);
    face([[u1, v0, zb], [u1, v1, zb], [rb, vm, zr]]);
    return this;
  }

  // Solid of revolution around the vertical axis at (x, y): profile is
  // [[radius, height]…] from the bottom up (radius 0 = a point). Domes,
  // spires, cooling towers, water towers, tapered chimneys.
  // opts.phase turns the polygon (in fractions of a side).
  lathe(x, y, z, profile, sides = 12, opts = {}) {
    const rmax = Math.max(...profile.map((p) => p[0]));
    this._grow([[x - rmax, y - rmax], [x + rmax, y + rmax]]);
    const top = profile[profile.length - 1][1];
    this.solid(x, y, z + top / 2);
    const ang = (j) => ((j + (opts.phase ?? 0)) / sides) * Math.PI * 2;
    const at = (r, j, h) => [x + Math.cos(ang(j)) * r, y + Math.sin(ang(j)) * r, z + h];
    for (let i = 0; i < profile.length - 1; i++) {
      const [r0, h0] = profile[i], [r1, h1] = profile[i + 1];
      for (let j = 0; j < sides; j++) {
        const pts = [];
        if (r0 > 0) pts.push(at(r0, j, h0), at(r0, j + 1, h0));
        else pts.push(at(0, 0, h0));
        if (r1 > 0) pts.push(at(r1, j + 1, h1), at(r1, j, h1));
        else pts.push(at(0, 0, h1));
        if (pts.length >= 3) this.face(pts, opts);
      }
    }
    const [rt] = profile[profile.length - 1];
    if (rt > 0) {
      const cap = [];
      for (let j = 0; j < sides; j++) cap.push(at(rt, j, top));
      this.face(cap, opts);
    }
    return this;
  }

  // Block with a barrel-vault roof (arched halls, hangars): the arch spans
  // across the block, rising `rise` above the walls, and runs along x
  // (or along y with opts.alongY). `segs` facets make the curve.
  vault(x, y, z, w, d, h, rise, segs = 6, opts = {}) {
    const alongY = !!opts.alongY;
    const L = alongY ? d : w, D = alongY ? w : d;
    const P = alongY ? (u, v, zz) => [x + v, y + u, zz] : (u, v, zz) => [x + u, y + v, zz];
    const face = (pts) => {
      const out = pts.map(([u, v, zz]) => P(u, v, zz));
      this.face(alongY ? out.reverse() : out, opts);
    };
    const zt = z + h;
    this._grow([[x, y], [x + w, y + d]]);
    this.solid(x + w / 2, y + d / 2, z + (h + rise) / 2);
    this._walls([[x, y], [x + w, y], [x + w, y + d], [x, y + d]], z, zt, opts);
    // arch profile across v: points (v, z) from v = 0 to v = D
    const arch = [];
    for (let i = 0; i <= segs; i++) {
      const a = Math.PI * (i / segs);
      arch.push([D / 2 - Math.cos(a) * (D / 2), zt + Math.sin(a) * rise]);
    }
    for (let i = 0; i < segs; i++) {
      const [va, za] = arch[i], [vb, zb] = arch[i + 1];
      face([[0, va, za], [L, va, za], [L, vb, zb], [0, vb, zb]]);
    }
    face(arch.map(([v, zz]) => [0, v, zz]));           // end at u = 0
    face(arch.map(([v, zz]) => [L, v, zz]).reverse()); // end at u = L
    return this;
  }

  // ----- ground -----

  groundLine(points, opts = {}) {
    this.ground.push(`<polyline points="${points.map(([x, y]) => this._proj([x, y, 0])).join(' ')}"${attrs(opts, this._lod(opts), 'gnd')}/>`);
    return this;
  }

  groundPoly(points, opts = {}) {
    this.ground.push(`<polygon points="${points.map(([x, y]) => this._proj([x, y, 0])).join(' ')}"${attrs(opts, this._lod(opts), 'gnd')}/>`);
    return this;
  }

  groundCircle(x, y, r, opts = {}) {
    const [sx, sy] = this.camera.project(...this._world(x, y, 0));
    const [rx, ry] = this.camera.groundEllipse(r);
    this.ground.push(`<ellipse cx="${r2(sx)}" cy="${r2(sy)}" rx="${r2(rx)}" ry="${r2(ry)}"${attrs(opts, this._lod(opts), 'gnd')}/>`);
    return this;
  }

  groundCurve(p0, c, p1, opts = {}, samples = 10) {
    const pts = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t;
      pts.push([a * p0[0] + b * c[0] + d * p1[0], a * p0[1] + b * c[1] + d * p1[1]]);
    }
    return this.groundLine(pts, opts);
  }

  // Local point -> world (x, y).
  toWorld(x, y) {
    const [wx, wy] = this._world(x, y, 0);
    return [wx, wy];
  }

  // Run fn with a higher detail level for everything it draws.
  detailed(level, fn) {
    const prev = this.lod;
    this.lod = Math.max(prev, level);
    fn();
    this.lod = prev;
    return this;
  }

  isFree(x, y, r = 0) {
    return !this.free || this.free(x, y, r);
  }

  spot(x, y) {
    const [wx, wy] = this._world(x, y, 0);
    this.spots.push([wx, wy]);
    return this;
  }

  // Combine another painter's output (same camera) into this one.
  merge(other) {
    this.solids.push(...other.solids);
    this.ground.push(...other.ground);
    this.spots.push(...other.spots);
    return this;
  }

  line(points, opts = {}) {
    this._ensure(...points[0]);
    if (opts.facing && !this._facing(opts.facing)) return this;
    const lod = opts.lod ?? (opts.facing ? Math.max(2, this.lod) : this.lod);
    this.current.parts.push(`<polyline points="${points.map((p) => this._proj(p)).join(' ')}"${attrs(opts, lod)}/>`);
    return this;
  }

  disc(x, y, z, r, opts = {}) {
    this._ensure(x, y, z);
    const [sx, sy] = this.camera.project(...this._world(x, y, z));
    this.current.parts.push(`<circle cx="${r2(sx)}" cy="${r2(sy)}" r="${r2(r * this.camera.tile)}"${attrs(opts, this._lod(opts))}/>`);
    return this;
  }

  shape(x, y, z, points, opts = {}) {
    this._ensure(x, y, z);
    const [sx, sy] = this.camera.project(...this._world(x, y, z));
    const t = this.camera.tile;
    const p = points.map(([u, v]) => [r2(sx + u * t), r2(sy - v * t)]);
    if (!opts.smooth) {
      this.current.parts.push(`<polygon points="${p.map((q) => q.join(',')).join(' ')}"${attrs(opts, this._lod(opts))}/>`);
      return this;
    }
    // quadratic curves from midpoint to midpoint, each point a control point
    const mid = (a, b) => [r2((a[0] + b[0]) / 2), r2((a[1] + b[1]) / 2)];
    let d = `M${mid(p[p.length - 1], p[0]).join(' ')}`;
    for (let i = 0; i < p.length; i++) d += `Q${p[i].join(' ')} ${mid(p[i], p[(i + 1) % p.length]).join(' ')}`;
    this.current.parts.push(`<path d="${d}Z"${attrs(opts, this._lod(opts), 'filled')}/>`);
    return this;
  }

  strokes(x, y, z, lines, opts = {}) {
    return this.strokeGroups([{ x, y, z, lines }], opts);
  }

  strokeGroups(groups, opts = {}) {
    groups = groups.filter((gr) => gr.lines.length);
    if (!groups.length) return this;
    this._ensure(groups[0].x, groups[0].y, groups[0].z);
    const t = this.camera.tile;
    // one decimal is plenty for these small glyphs, and keeps the markup small
    const r1 = (n) => Math.round(n * 10) / 10;
    let d = '';
    for (const { x, y, z, lines } of groups) {
      const [sx, sy] = this.camera.project(...this._world(x, y, z));
      for (const pts of lines) d += pts.map(([u, v], i) => `${i ? 'L' : 'M'}${r1(sx + u * t)} ${r1(sy - v * t)}`).join('');
    }
    this.current.parts.push(`<path d="${d}"${attrs(opts, this._lod(opts), 'glyph')}/>`);
    return this;
  }

  toGroundSVG() {
    return this.ground.join('');
  }

  toSVG() {
    return this.solids
      .sort((a, b) => a.depth - b.depth)
      .map((s) => s.parts.join(''))
      .join('');
  }
}
