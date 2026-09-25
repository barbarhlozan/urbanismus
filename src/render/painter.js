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
//   g.face([[x,y,z]…], opts)                 single polygon, CCW seen from outside
//   g.line([[x,y,z]…], opts)                 polyline; opts.facing = normal to hide it with its wall
//   g.disc(x, y, z, r, opts)                 screen-facing circle (e.g. tree crowns)
//   g.shape(x, y, z, [[u,v]…], opts)         screen-facing polygon, u right / v up, in grid units
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
function boxSides(x, y, w, d, inset) {
  return [
    { n: [0, -1, 0], a: [x + inset, y], b: [x + w - inset, y] },
    { n: [1, 0, 0], a: [x + w, y + inset], b: [x + w, y + d - inset] },
    { n: [0, 1, 0], a: [x + w - inset, y + d], b: [x + inset, y + d] },
    { n: [-1, 0, 0], a: [x, y + d - inset], b: [x, y + inset] },
  ];
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

  floors(x, y, w, d, z0, z1, step, inset = 0.04) {
    for (let z = z0 + step; z < z1 - step * 0.3; z += step) {
      for (const { n, a, b } of boxSides(x, y, w, d, inset)) {
        this.line([[a[0], a[1], z], [b[0], b[1], z]], { facing: n });
      }
    }
    return this;
  }

  mullions(x, y, w, d, z0, z1, step, inset = 0.03) {
    for (const { n, a, b } of boxSides(x, y, w, d, 0)) {
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
    const pts = points.map(([u, v]) => `${r2(sx + u * t)},${r2(sy - v * t)}`).join(' ');
    this.current.parts.push(`<polygon points="${pts}"${attrs(opts, this._lod(opts))}/>`);
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
