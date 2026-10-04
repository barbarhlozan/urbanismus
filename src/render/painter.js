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
//   g.lathe(x, y, z, [[r, h]…], sides, opts) solid of revolution (domes, spires, towers;
//                                            opts.smooth: outline only, no facet edges)
//   g.vault(x, y, z, w, d, h, rise, segs, opts) block with a barrel-vault roof (opts.alongY)
//   g.face([[x,y,z]…], opts)                 single polygon, CCW seen from outside
//   g.line([[x,y,z]…], opts)                 polyline; opts.facing = normal to hide it with its wall,
//                                            opts.wobble scales the hand-drawn wobble (1 = normal)
//   g.disc(x, y, z, r, opts)                 screen-facing circle (e.g. tree crowns)
//   g.shape(x, y, z, [[u,v]…], opts)         screen-facing polygon, u right / v up, in grid units
//                                            (opts.smooth: a rounded outline through the points' midpoints)
//   g.strokes(x, y, z, [[[u,v]…]…], opts)    screen-facing polylines (one <path>), e.g. tree glyphs
//   g.strokeGroups([{x, y, z, lines}…], opts) the same for several anchors, still one <path>
//   g.solid(x, y, z)                         start a new depth-sorted group manually
//   g.cylinder(x, y, z, r, h, sides, opts)   upright polygonal cylinder (chimneys, silos)
//
// Shadows – every face casts one on the ground by itself, and a wall turned
// away from the sun is shaded with upright strokes (render/shadows.js;
// opts.shadow = false: neither for this face). Things not made of faces
// cast with:
//   g.cast([[x,y,z]…])                       the shadow of these points (their convex hull)
//   g.castShape(x, y, z, [[u,v]…])           of a screen-facing outline (as g.shape), turned
//                                            about its upright axis into a round lump (trees)
//   g.castFoot([[x,y]…], h)                  stand an outline (CCW) h high on the ground, for
//                                            the contact shadows at its foot (trees)
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
// Facing – g.facing([nx, ny, nz]) is true when a surface with that local
// normal is turned towards the viewer.
//
// Free space – g.free(x, y, r) is false where a footpath or road is within r
// (footpaths have priority over lots). Props in kit.js check it themselves.
//
// Joins – g.join = { left, right }: true where this building shares a wall
// with its neighbour on the local -x (left) / +x (right) side. Draw up to
// x = ∓0.5 there (structures opt in with `join`, see structures/index.js).
//
// Spots – g.spot(x, y, dir) marks a parking stall (cars are drawn and simulated
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
import { MinHeap } from '../core/heap.js';
import { siteWalks } from '../roads/siteWalks.js';
import { SUN, sunFor, tierClass, wallHatch, awayFrom, shadeShare } from './shadows.js';

const r2 = (n) => Math.round(n * 100) / 100;

// Global look knobs (gallery.html toggles them to compare):
//   eave    how far pitched roofs overhang the walls (0 = flush)
//   fascia  depth of the eave board under the roof edge
//   sill    window sills
//   tall    windows proportioned upright (about 2:3) instead of square
//   sketch  hand-drawn wobble, in scene px at tile 32 (0 = ruler straight)
//   overshoot  with sketch: edges run on past corners by about this much (scene px at tile 32)
//   ink     windows as solid blocks of ink instead of outlines
//   thin    with ink: this many times fewer windows along a wall (1 = every bay)
//   hatch   pencil strokes down pitched roofs, this far apart (0 = none)
//   ground  a stroke along the foot of each building, running past its corners by about this much
//   floors  draw g.floors() lines (storey bands); off for the sparer sketch look
//   roads   how far roads, paths and what moves on them stray from the ruler
//           line, in grid units (0 = straight; see wobble())
//   tilt    houses stand askew by up to this many degrees either way (types
//           with `tilt: true`, see tiltOf in structures/index.js; 0 = square)
export const LOOK = {
  eave: 0.03, fascia: 0, sill: false, tall: true, sketch: 5,
  overshoot: 1.5, ink: true, thin: 1.4, hatch: 0.03, ground: 0.04, floors: false, roads: 0.035,
  tilt: 10,
};

// The hand-drawn sway of roads: a smooth shift [dx, dy] of the map at
// (x, y), made of a few long slow waves. Everything on the road network
// (roads, kerbs, footpaths, driveways, people and cars) is shifted by it,
// so junctions still meet and traffic stays on its line.
export function wobble(x, y) {
  const a = LOOK.roads;
  if (!a) return [0, 0];
  return [
    a * (0.6 * Math.sin(1.9 * x + 0.7 * y + 1.3) + 0.4 * Math.sin(0.6 * x - 2.3 * y + 4.1)),
    a * (0.6 * Math.sin(1.7 * y - 0.9 * x + 2.7) + 0.4 * Math.sin(0.5 * y + 2.1 * x + 0.4)),
  ];
}

// Deterministic noise in [-1, 1] from a point (and a salt), so a vertex or
// an edge shared by two faces wobbles the same way in both.
function hash2(x, y, k = 0) {
  let h = Math.imul(Math.round(x * 4) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(y * 4) | 0, 0x165667b1) ^ Math.imul(k, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1;
}

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

// Back-to-front order of solids. Mostly by depth (the centre), but where two
// solids stand clear of each other along a view axis – one entirely on the
// far side of the other – and overlap on screen, the far one goes first. The
// centre alone gets that wrong beside long solids: a shed by the end of a
// long barn can have its centre nearer than the barn's and be drawn over it.
// Everything else keeps its depth order: each step draws the farthest solid
// whose solids behind are all drawn (so a roof stays after its walls, a
// chimney after its roof). Pairs are found like isoSort in renderer.js, by a
// sweep over the screen extents.
function orderSolids(solids) {
  const items = solids.map((s) => {
    const [x0, y0, x1, y1] = s.box ?? [0, 0, 0, 0];
    return { s, x0, y0, x1, y1, left: x0 - y1, right: x1 - y0, behind: [], ahead: [], wait: 0 };
  }).sort((a, b) => a.s.depth - b.s.depth);
  items.forEach((it, i) => { it.i = i; });
  // a is entirely on the far side of b along x or y (a single point that
  // coincides with the other is not "clear" of it)
  const clear = (a, b) => (a.x1 <= b.x0 && a.x0 < b.x1) || (a.y1 <= b.y0 && a.y0 < b.y1);
  const byLeft = items.slice().sort((a, b) => a.left - b.left);
  for (let i = 0; i < byLeft.length; i++) {
    const a = byLeft[i];
    for (let j = i + 1; j < byLeft.length && byLeft[j].left < a.right; j++) {
      const b = byLeft[j];
      if (clear(a, b)) { a.ahead.push(b); b.wait++; }
      else if (clear(b, a)) { b.ahead.push(a); a.wait++; }
    }
  }
  const out = [], ready = new MinHeap();
  for (const it of items) if (!it.wait) ready.push(it, it.i);
  let next = 0; // for breaking a cycle: the farthest solid not yet drawn
  while (out.length < items.length) {
    let it;
    if (ready.size) it = ready.pop();
    else {
      while (items[next].done) next++;
      it = items[next];
    }
    if (it.done) continue;
    it.done = true;
    out.push(it.s);
    for (const b of it.ahead) if (--b.wait === 0 && !b.done) ready.push(b, b.i);
  }
  return out;
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
    this.groundAt = [];   // world [x, y] of each ground entry, for photo.js (its nearest point to a perspective camera)
    this.site = null;
    this.spots = [];
    this.lod = 0;
    this.free = null;     // set by the renderer: (x, y, r) -> bool, local coords
    this.bounds = null;   // local [x0, y0, x1, y1] of all solids drawn
    this.join = { left: false, right: false }; // set by the renderer, see structures/index.js
    this.current = null;
    this.rigid = null;    // world [x, y]: move as one piece, see _project()
    this.follow = false;  // with rigid: still rise and fall with the ground, see _liftAt()
    this._onGround = false;
    this.top = 0;         // highest z drawn at (local), for the renderer's screen box
    this.detail = 0;      // how plain to draw, for drawings that care (0 = full; trees, see features/trees.js)
    this.tilt = 0;        // extra turn in radians on top of `rotation`, see setTilt()
    this._tc = 1;
    this._ts = 0;
    this.casts = [];      // shadow casters: lists of world [x, y, height], see render/shadows.js
    this.feet = [];       // walls' feet on the ground: { a, b, h, n } world, see render/shadows.js
    this.casting = true;  // false: draw no shadows (icons)
  }

  // Turn the whole drawing by a small angle (radians, counter-clockwise
  // seen from above) on top of its quarter-turn rotation – houses standing a
  // little askew (tiltOf in structures/index.js). Call before drawing.
  setTilt(angle) {
    this.tilt = angle;
    this._tc = Math.cos(angle);
    this._ts = Math.sin(angle);
    return this;
  }

  // ----- internals -----

  // Project a world point; with `rigid` set, relief and warp are taken at
  // that one point, so the whole drawing moves without bending (see
  // Camera.project).
  _project(x, y, z) {
    return this.camera.project(x, y, z, this.rigid, this._liftAt());
  }

  // Where the relief is taken for what is being drawn (null: at each point).
  // Normally at `rigid`. With `follow` (yards, plots) only the warp stays
  // rigid: ground drawing and bending solids (fences, hedges – solid(…,
  // { bend: true })) follow the ground point by point, other solids stand
  // upright where they start.
  _liftAt() {
    if (!this.follow) return this.rigid;
    if (this._onGround || !this.current || this.current.bend) return null;
    return this.current.at;
  }

  // A local direction or offset turned into world axes (tilt, then rotation).
  _turn(x, y) {
    if (this.tilt) [x, y] = [x * this._tc - y * this._ts, x * this._ts + y * this._tc];
    return rotateQuarter(x, y, this.rotation);
  }

  _world(x, y, z) {
    if (z > this.top) this.top = z;
    const [lx, ly] = this._turn(x, y);
    return [this.ox + lx, this.oy + ly, this.oz + z];
  }

  _proj(p) {
    const [sx, sy] = this._project(...this._world(p[0], p[1], p[2]));
    return `${r2(sx)},${r2(sy)}`;
  }

  // Outline through 3D points: a straight <polygon> / <polyline>, or with
  // LOOK.sketch a <path> whose corners are nudged and whose edges bow a
  // little, like a line drawn by hand. Closed outlines big enough also get
  // LOOK.overshoot: their edges run on a little past the corners.
  _outline(points, closed, opts, lod) {
    if (!LOOK.sketch) {
      return this._screenRuns(points, closed)
        .map((run) => `<${closed ? 'polygon' : 'polyline'} points="${run.map(([x, y]) => `${r2(x)},${r2(y)}`).join(' ')}"${attrs(opts, lod)}/>`)
        .join('');
    }
    const { d, pts, size } = this._sketch(points, closed, opts.wobble ?? 1);
    if (!d) return '';
    // the overshoots go in the same path: open strokes have no area, so the
    // fill ignores them, and it saves an element per face
    let ticks = '';
    const os = LOOK.overshoot * this.camera.tile / 32;
    if (closed && os && size > os * 5) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < os * 2) continue;
        const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
        const k = Math.min(os, len * 0.1);
        const kb = k * (0.2 + 0.8 * Math.abs(hash2(b[2], b[3], 4))), ka = k * (0.2 + 0.8 * Math.abs(hash2(a[2], a[3], 5)));
        ticks += `M${r2(b[0])} ${r2(b[1])}l${r2(ux * kb)} ${r2(uy * kb)}M${r2(a[0])} ${r2(a[1])}l${r2(-ux * ka)} ${r2(-uy * ka)}`;
      }
    }
    return `<path d="${d}${ticks}"${attrs(opts, lod, closed ? 'sk filled' : 'sk ln')}/>`;
  }

  // Sketchy path data through 3D points: { d, pts (jittered screen points,
  // each [x, y, x0, y0]), size (longest edge on screen) }.
  // With a perspective camera an open line may come apart into several
  // runs where it passes behind the eye; `pts` then holds the last one.
  _sketch(points, closed, wobble = 1) {
    const runs = this._screenRuns(points, closed);
    if (runs.length > 1) {
      const parts = runs.map((run) => this._sketchScreen(run, false, wobble));
      return { d: parts.map((p) => p.d).join(''), pts: parts[parts.length - 1].pts, size: Math.max(...parts.map((p) => p.size)) };
    }
    if (!runs.length) return { d: '', pts: [], size: 0 };
    return this._sketchScreen(runs[0], closed, wobble);
  }

  // World points -> lists of screen points: one list, or with a perspective
  // camera the parts in front of the eye (none when all is behind it).
  _screenRuns(points, closed) {
    const w = points.map((p) => this._world(p[0], p[1], p[2]));
    if (!this.camera.clip) return [w.map((p) => this._project(...p))];
    const c = this.camera.clip(w, closed);
    const runs = closed ? (c ? [c] : []) : c;
    return runs.map((run) => run.map((p) => this._project(...p)));
  }

  _sketchScreen(scr, closed, wobble) {
    const amp = LOOK.sketch * this.camera.tile / 32 * wobble;
    // small shapes (windows) wobble less than walls and roofs
    let size = 0;
    for (let i = 1; i < scr.length; i++) size = Math.max(size, Math.hypot(scr[i][0] - scr[i - 1][0], scr[i][1] - scr[i - 1][1]));
    const jit = Math.min(amp * 0.4, size * 0.05);
    // each corner strays at most a fraction of its shorter edge: a finely
    // sampled line (a lot's edge following a road, a curve) would otherwise
    // have every point thrown about by the same amount – a zigzag
    const n = scr.length;
    const gap = (i, j) => (j < 0 || j >= n ? Infinity : Math.hypot(scr[j][0] - scr[i][0], scr[j][1] - scr[i][1]));
    const near = (i) => Math.min(gap(i, closed ? (i - 1 + n) % n : i - 1), gap(i, closed ? (i + 1) % n : i + 1));
    const pts = scr.map(([x, y], i) => {
      const k = Math.min(jit, near(i) * 0.15);
      return [x + hash2(x, y, 1) * k, y + hash2(x, y, 2) * k, x, y];
    });
    if (closed) pts.push(pts[0]);
    let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      // key the bow on the edge regardless of direction
      const [p, q] = a[2] < b[2] || (a[2] === b[2] && a[3] < b[3]) ? [a, b] : [b, a];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const bow = hash2(p[2] + q[2], p[3] + q[3], 3) * Math.min(amp, len * 0.04);
      const cx = (a[0] + b[0]) / 2 - ((q[1] - p[1]) / len) * bow;
      const cy = (a[1] + b[1]) / 2 + ((q[0] - p[0]) / len) * bow;
      d += `Q${r2(cx)} ${r2(cy)} ${r2(b[0])} ${r2(b[1])}`;
    }
    return { d: closed ? d + 'Z' : d, pts, size };
  }

  // Pencil hatching on a roof plane (a convex polygon whose first edge is
  // the eave): parallel strokes straight down the slope, LOOK.hatch apart,
  // all in one <path>. Each stroke stops a little short of the edges, by a
  // seeded amount.
  _hatch(pts, normal) {
    if (!LOOK.hatch || !this._facing(normal, pts[0])) return;
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const unit = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    // plane axes: e along the eave, s up the slope (both in the plane)
    const o = pts[0], e = unit(sub(pts[1], o));
    const far = pts.reduce((best, p) => (dot(sub(p, o), sub(p, o)) - dot(sub(p, o), e) ** 2 > dot(sub(best, o), sub(best, o)) - dot(sub(best, o), e) ** 2 ? p : best), pts[1]);
    const rel = sub(far, o), along = dot(rel, e);
    const sv = unit([rel[0] - e[0] * along, rel[1] - e[1] * along, rel[2] - e[2] * along]);
    const flat = pts.map((p) => [dot(sub(p, o), e), dot(sub(p, o), sv)]);
    const back = (u, w) => [o[0] + e[0] * u + sv[0] * w, o[1] + e[1] * u + sv[1] * w, o[2] + e[2] * u + sv[2] * w];
    const us = flat.map((f) => f[0]);
    const [u0, u1] = [Math.min(...us), Math.max(...us)];
    let d = '';
    for (let u = u0 + LOOK.hatch / 2; u < u1; u += LOOK.hatch) {
      // where the line at u crosses the outline
      const ws = [];
      for (let i = 0; i < flat.length; i++) {
        const [a, b] = [flat[i], flat[(i + 1) % flat.length]];
        if ((a[0] - u) * (b[0] - u) > 0 || a[0] === b[0]) continue;
        ws.push(a[1] + ((u - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
      }
      if (ws.length < 2) continue;
      const [w0, w1] = [Math.min(...ws), Math.max(...ws)];
      const len = w1 - w0;
      if (len < LOOK.hatch * 0.8) continue;
      const lo = w0 + len * (0.03 + 0.06 * Math.abs(hash2(u * 97, o[0] + o[1], 6)));
      const hi = w1 - len * (0.05 + 0.12 * Math.abs(hash2(u * 97, o[2], 7)));
      const line = [back(u, hi), back(u, lo)];
      d += LOOK.sketch ? this._sketch(line, false).d : `M${this._proj(line[0]).replace(',', ' ')}L${this._proj(line[1]).replace(',', ' ')}`;
    }
    if (d) this.current.parts.push(`<path d="${d}"${attrs({}, Math.max(1, this.lod), 'ln roof-hatch')}/>`);
  }

  // A stroke along the foot of each wall of a footprint standing on the
  // ground, running on past the corners (LOOK.ground) – not into a
  // neighbour it shares a wall with.
  _foot(base, z0, h) {
    if (!LOOK.ground || z0 !== 0 || h <= 0.1) return;
    const joined = ([px]) => (this.join.left && px <= -0.5 + 1e-6) || (this.join.right && px >= 0.5 - 1e-6);
    for (let i = 0; i < base.length; i++) {
      const a = base[i], b = base[(i + 1) % base.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6 || (joined(a) && joined(b))) continue;
      const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
      const ka = joined(a) ? 0 : LOOK.ground * (0.3 + 0.7 * Math.abs(hash2(a[0] * 50, a[1] * 50, 8)));
      const kb = joined(b) ? 0 : LOOK.ground * (0.3 + 0.7 * Math.abs(hash2(b[0] * 50, b[1] * 50, 9)));
      this.line([[a[0] - ux * ka, a[1] - uy * ka, 0], [b[0] + ux * kb, b[1] + uy * kb, 0]], { facing: [uy, -ux, 0], cls: 'foot', lod: Math.max(1, this.lod) });
    }
  }

  // How squarely a local normal faces the viewer (the camera's linear
  // facing test, before its sign is taken).
  _view([nx, ny, nz]) {
    const [wx, wy] = this._turn(nx, ny);
    if (this.camera.perspective && this.current?.at) {
      const [vx, vy, vz] = this.camera.toEye(...this.current.at, this._liftAt());
      return (wx * vx + wy * vy + nz * vz) / (Math.hypot(vx, vy, vz) || 1);
    }
    const [rx, ry] = rotateQuarter(wx, wy, this.camera.rotation);
    return rx + ry + nz / this.camera.zScale;
  }

  // `p` (local, optional): a point on the surface. A perspective camera
  // needs it – what faces the eye depends on where the surface is – and
  // falls back to the middle of the current solid.
  _facing([nx, ny, nz], p = null) {
    const [rx, ry] = this._turn(nx, ny);
    if (this.camera.perspective) {
      const at = p ? this._world(p[0], p[1], p[2]) : this.current?.at;
      if (at) return this.camera.facingAt([rx, ry, nz], at, this._liftAt());
    }
    return this.camera.facing([rx, ry, nz]);
  }

  // Screen position and pixels per world unit at a local point, for
  // screen-facing shapes; null when it is behind a perspective camera.
  _anchor(x, y, z) {
    const w = this._world(x, y, z);
    const cam = this.camera;
    if (cam.perspective && !cam.isAhead(w[0], w[1])) return null;
    const [sx, sy] = this._project(...w);
    return [sx, sy, cam.scaleAt ? cam.scaleAt(w[0], w[1]) : cam.tile];
  }

  _lod(opts) {
    return opts.lod ?? this.lod;
  }

  // Every primitive calls this with its footprint just before starting its
  // solid, which takes it as its ground area for sorting (see solid()).
  _grow(points) {
    this._footprint = points;
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

  // Site paths (world.sitePaths) and the walkways they make
  // (roads/siteWalks.js) in local coordinates:
  // g.site.paths = { hub: [x, y], exits: [{ pos: [x, y], dir: [dx, dy], road, site }],
  //                  lines: [[[x, y]…]…], plaza, loop, centre: [x, y] }
  // road / site: the exit leads onto a street / into a neighbouring site.
  setSitePaths(paths) {
    const { hubPos, exits } = paths;
    const local = ([x, y]) => rotateQuarter(x - this.ox, y - this.oy, -this.rotation);
    const walks = siteWalks({ half: 0.5, ...paths });
    this.site.paths = {
      hub: local(hubPos),
      exits: exits.map((e) => ({ pos: local(e.pos), dir: rotateQuarter(e.dir[0], e.dir[1], -this.rotation), road: e.road >= 0, site: (e.site ?? -1) >= 0 })),
      lines: walks.lines.map((line) => line.map(local)),
      plaza: walks.plaza,
      loop: walks.loop,
      centre: local(walks.centre),
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

  // A solid's `box` is its ground area in view axes ([x0, y0, x1, y1], both
  // growing towards the viewer), used by toSVG() to sort: a primitive's
  // footprint (`fixed`), or else the point it starts at, grown by the faces
  // and lines drawn into it.
  solid(x, y, z, { bend = false } = {}) {
    const [wx, wy, wz] = this._world(x, y, z);
    const foot = this._footprint;
    this._footprint = null;
    const box = foot ? this._viewBox(foot.length === 2 ? [foot[0], [foot[1][0], foot[0][1]], foot[1], [foot[0][0], foot[1][1]]] : foot)
      : this._viewBox([[x, y]]);
    this.current = { depth: this.camera.depth(wx, wy) + wz * 1e-3, parts: [], at: [wx, wy, wz], box, fixed: !!foot, bend };
    this.solids.push(this.current);
    return this;
  }

  // View-axis bounding box of local ground points (null for a camera
  // without view axes: the photo's perspective one sorts by its own depth).
  _viewBox(points) {
    if (!this.camera.rotated) return null;
    let b = null;
    for (const [x, y] of points) {
      const [wx, wy] = this._world(x, y, 0);
      const [rx, ry] = this.camera.rotated(wx, wy);
      if (!b) b = [rx, ry, rx, ry];
      else { b[0] = Math.min(b[0], rx); b[1] = Math.min(b[1], ry); b[2] = Math.max(b[2], rx); b[3] = Math.max(b[3], ry); }
    }
    return b;
  }

  // Grow the current solid's box by what is drawn into it (solids without a
  // primitive's footprint: plates, props made of faces and lines).
  _spread(points) {
    const c = this.current;
    if (c.fixed || !c.box) return;
    const b = this._viewBox(points);
    c.box = [Math.min(c.box[0], b[0]), Math.min(c.box[1], b[1]), Math.max(c.box[2], b[2]), Math.max(c.box[3], b[3])];
  }

  face(points, opts = {}) {
    this._ensure(...points[0]);
    this._spread(points);
    const n = newellNormal(points);
    if (opts.shadow !== false) {
      this.cast(points);
      this._footOf(points, n);
    }
    if (!this._facing(n, points[0])) return this;
    // SUN.walls 'tone': a wall turned away from the sun is just a shade
    // darker (styles.css .shade-1 / .shade-2), no strokes of its own
    const tone = opts.shadow !== false && SUN.walls === 'tone' ? this._shadeShare(n) : 0;
    if (tone > 0) opts = { ...opts, cls: [opts.cls, tone < 1 ? 'shade-1' : 'shade-2'].filter(Boolean).join(' ') };
    this.current.parts.push(this._outline(points, true, opts, this._lod(opts)));
    if (opts.shadow !== false && SUN.walls !== 'tone') this._shade(points, n);
    return this;
  }

  // Shade a wall turned away from the sun (SUN.walls): strokes on parallel
  // screen lines leaning their own way (SUN.wallAngle, apart from the
  // ground's), stopping short of the wall's edges by a seeded amount. A
  // wall only a little turned away gets only some of them. Drawn right after
  // the wall, so what is drawn on it later (ink windows) covers them.
  // How much a face with local normal n is turned away from the sun (0 =
  // not at all, or not a wall, 1 = fully shaded; see shadows.js shadeShare).
  _shadeShare(n) {
    if (!SUN.on || !SUN.walls) return 0;
    const w = this._wallNormal(n);
    if (!w) return 0;
    this._sun ??= sunFor(this.camera);
    return shadeShare(awayFrom(w, this._sun), this._sun);
  }

  _shade(points, n) {
    if (!SUN.on || !SUN.walls) return;
    const w = this._wallNormal(n);
    if (!w) return;
    this._sun ??= sunFor(this.camera);
    const share = shadeShare(awayFrom(w, this._sun), this._sun);
    if (share > 0) this._wallStrokes(points, { share, trim: SUN.wallTrim, loose: SUN.wallLoose });
  }

  // The outward world normal (unit, horizontal) of a wall with local normal
  // n; null for what is not a wall (roofs, floors).
  _wallNormal([nx, ny, nz]) {
    const h = Math.hypot(nx, ny);
    if (h < 1e-9 || Math.abs(nz) > h * 0.2) return null;
    return this._turn(nx / h, ny / h);
  }

  // Wall-shading strokes over a face (local 3D points), drawn as
  // render/shadows.js wallHatch does (opts: share, trim, loose, fade),
  // seeded by where the face stands. Thinned out by density tiers like the
  // ground shadows, and hidden with the facade detail when far.
  _wallStrokes(points, opts) {
    const [poly] = this._screenRuns(points, true);
    if (!poly) return;
    const [wx, wy] = this.toWorld(points[0][0], points[0][1]);
    const d = wallHatch(poly, this._sun.wall, { ...opts, seed: (wx * 13.1 + wy * 7.7) % 97 });
    d.forEach((path, n) => {
      if (path) this.current.parts.push(`<path d="${path}"${attrs({}, Math.max(1, this.lod), `ln wall-shade${tierClass(n, 'w')}`)}/>`);
    });
  }

  // The shade under the eaves of a pitched roof (SUN.eaveBand): a band of
  // wall strokes just under the wall top from a to b (local [x, y], the
  // wall's outward normal on the right going a -> b, as faces are
  // counter-clockwise), on a wall that is lit – a shaded one is hatched all
  // over already.
  _eaveBand(a, b, zt) {
    if (!SUN.on || !SUN.walls || SUN.walls === 'tone' || !SUN.eaveBand) return;
    const pts = [[a[0], a[1], zt - SUN.eaveBand], [b[0], b[1], zt - SUN.eaveBand], [b[0], b[1], zt], [a[0], a[1], zt]];
    const n = newellNormal(pts);
    if (!this._facing(n, pts[0])) return;
    this._sun ??= sunFor(this.camera);
    if (shadeShare(awayFrom(this._wallNormal(n), this._sun), this._sun) > 0) return;
    this._wallStrokes(pts, { trim: 0.1, loose: SUN.wallLoose * 0.5, fade: 0, hang: true });
  }

  // Record where a wall stands on the ground (its foot: world ends, height,
  // outward normal), for the contact shadows (render/shadows.js).
  _footOf(points, n) {
    if (!this.casting) return;
    const w = this._wallNormal(n);
    if (!w) return;
    const low = points.filter((p) => p[2] <= SUN.low);
    if (low.length !== 2) return;
    const h = Math.max(...points.map((p) => p[2]));
    this.feet.push({ a: this.toWorld(low[0][0], low[0][1]), b: this.toWorld(low[1][0], low[1][1]), h, n: w });
  }

  // A pitched roof plane: a face whose first edge is the eave, hatched with
  // LOOK.hatch.
  _plane(pts, opts = {}) {
    this.face(pts, opts);
    this._hatch(pts, newellNormal(pts));
    return this;
  }

  prism(base, z0, z1, opts = {}) {
    this._grow(base);
    const cx = base.reduce((s, p) => s + p[0], 0) / base.length;
    const cy = base.reduce((s, p) => s + p[1], 0) / base.length;
    this.solid(cx, cy, (z0 + z1) / 2);
    this._walls(base, z0, z1, opts);
    this._foot(base, z0, z1 - z0);
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
    this._foot([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z, h);
    this.face([[x0, y1, zt], [x0, y0, zt], [x0, ym, zr]], opts);
    this.face([[x1, y0, zt], [x1, y1, zt], [x1, ym, zr]], opts);
    this._plane([[x0, y0, zt], [x1, y0, zt], [x1, ym, zr], [x0, ym, zr]], opts);
    this._plane([[x1, y1, zt], [x0, y1, zt], [x0, ym, zr], [x1, ym, zr]], opts);
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
    if (!LOOK.floors) return this;
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
    let ww = spacing * (opts.w ?? 0.45), wh = step * (opts.h ?? 0.45);
    if (LOOK.tall && !ribbon) {
      // about 2:3 upright, as big as the bay allows
      wh = step * Math.max(opts.h ?? 0.45, 0.5);
      ww = Math.min(spacing * 0.55, wh * 0.66);
    }
    const sill = LOOK.sill && !LOOK.ink && !ribbon ? Math.min(0.012, ww * 0.25) : 0;
    // ink: solid windows, and fewer of them (wider bays, same window size)
    const cls = LOOK.ink ? 'ink' : undefined;
    if (LOOK.ink && !ribbon) spacing *= LOOK.thin;
    const storeys = Math.round((z1 - z0) / step);
    for (const { n, a, b } of boxSides(x, y, w, d, 0, skip)) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
      const at = (t, z) => [a[0] + ux * t, a[1] + uy * t, z];
      const cols = Math.floor(len / spacing);
      if (cols < 1) continue;
      const pad = (len - cols * spacing) / 2;
      for (let i = from; i < storeys; i++) {
        const zb = z0 + i * step + (step - wh) * (LOOK.tall ? 0.4 : 0.55), zt = zb + wh;
        if (ribbon) {
          const t0 = spacing * 0.3, t1 = len - spacing * 0.3;
          this.line([at(t0, zb), at(t1, zb), at(t1, zt), at(t0, zt), at(t0, zb)], { facing: n, cls });
          continue;
        }
        for (let c = 0; c < cols; c++) {
          const t0 = pad + c * spacing + (spacing - ww) / 2, t1 = t0 + ww;
          this.line([at(t0, zb), at(t1, zb), at(t1, zt), at(t0, zt), at(t0, zb)], { facing: n, cls });
          if (sill) this.line([at(t0 - sill, zb - sill * 0.6), at(t1 + sill, zb - sill * 0.6)], { facing: n });
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
    this._foot([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z, h);
    this.face([[x0, y0, zt], [x1, y0, zt], [xm, y0, zr]], opts);
    this.face([[x1, y1, zt], [x0, y1, zt], [xm, y1, zr]], opts);
    this._plane([[x0, y1, zt], [x0, y0, zt], [xm, y0, zr], [xm, y1, zr]], opts);
    this._plane([[x1, y0, zt], [x1, y1, zt], [xm, y1, zr], [xm, y0, zr]], opts);
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
    // a hatched roof plane: eave corners first, then the top edge
    const plane = (pts) => {
      face(pts);
      const q = pts.map(([u, v, zz]) => P(u, v, zz));
      this._hatch(q, newellNormal(alongY ? [...q].reverse() : q));
    };
    const hip = Array.isArray(roof.hip) ? roof.hip : [roof.hip ?? 0, roof.hip ?? 0];
    const rh = roof.h ?? 0, zt = z + h;
    const m = roof.mansard;

    this._grow([[x, y], [x + w, y + d]]);
    this.solid(x + w / 2, y + d / 2, z + (h + rh + (m?.h ?? 0)) / 2);
    this._walls([[x, y], [x + w, y], [x + w, y + d], [x, y + d]], z, zt, opts);
    this._foot([[x, y], [x + w, y], [x + w, y + d], [x, y + d]], z, h);
    // The roof is its own solid just in front of the walls, so window lines
    // drawn on the walls afterwards stay under the eaves.
    const walls = this.current;
    this.current = { depth: walls.depth + 1e-6, parts: [], at: walls.at, box: walls.box, fixed: true };
    this.solids.push(this.current);
    const onWalls = (fn) => { const roofSolid = this.current; this.current = walls; fn(); this.current = roofSolid; };

    // mansard: lower roof from the wall tops to an inset rectangle
    let [u0, u1, v0, v1, zb] = [0, L, 0, D, zt];
    if (m) {
      const iv = m.inset ?? 0.05;
      const iu0 = hip[0] > 0 ? iv : 0, iu1 = hip[1] > 0 ? iv : 0;
      const zm = zt + m.h;
      plane([[0, 0, zt], [L, 0, zt], [L - iu1, iv, zm], [iu0, iv, zm]]);
      plane([[L, D, zt], [0, D, zt], [iu0, D - iv, zm], [L - iu1, D - iv, zm]]);
      plane([[0, D, zt], [0, 0, zt], [iu0, iv, zm], [iu0, D - iv, zm]]);
      plane([[L, 0, zt], [L, D, zt], [L - iu1, D - iv, zm], [L - iu1, iv, zm]]);
      [u0, u1, v0, v1, zb] = [iu0, L - iu1, iv, D - iv, zm];
    }

    if (rh <= 0) {
      face([[u0, v0, zb], [u1, v0, zb], [u1, v1, zb], [u0, v1, zb]]);
      this.current = walls;
      return this;
    }
    const vm = (v0 + v1) / 2, zr = zb + rh;
    const span = u1 - u0;
    let ra = u0 + Math.min(hip[0], span / 2), rb = u1 - Math.min(hip[1], span / 2);
    if (ra > rb) ra = rb = (ra + rb) / 2;

    // Eaves: the roof planes run on past the walls, their edge level with the
    // wall tops (a touch flatter there, so the top-floor windows stay clear),
    // with a thin board under the edge. Not over a wall shared with a
    // neighbour, and not on mansards.
    const e = m ? 0 : (roof.eave ?? LOOK.eave);
    const shared = (u, v) => {
      const [px] = P(u, v, 0);
      return (this.join.left && px <= -0.5 + 1e-6) || (this.join.right && px >= 0.5 - 1e-6);
    };
    const ev0 = shared(L / 2, v0) ? 0 : e, ev1 = shared(L / 2, v1) ? 0 : e;
    const eu0 = shared(u0, D / 2) ? 0 : e, eu1 = shared(u1, D / 2) ? 0 : e;
    const [U0, U1, V0, V1] = [u0 - eu0, u1 + eu1, v0 - ev0, v1 + ev1];
    const RA = ra > u0 ? ra : U0, RB = rb < u1 ? rb : U1;

    // gable walls belong to the walls, so the verges overlap them
    onWalls(() => {
      if (ra <= u0) face([[u0, v1, zb], [u0, v0, zb], [u0, vm, zr]]);
      if (rb >= u1) face([[u1, v0, zb], [u1, v1, zb], [u1, vm, zr]]);
    });
    const f = e ? LOOK.fascia : 0;
    if (f) {
      if (ev0) face([[U0, V0, zb - f], [U1, V0, zb - f], [U1, V0, zb], [U0, V0, zb]]);
      if (ev1) face([[U1, V1, zb - f], [U0, V1, zb - f], [U0, V1, zb], [U1, V1, zb]]);
      if (ra > u0 && eu0) face([[U0, V1, zb - f], [U0, V0, zb - f], [U0, V0, zb], [U0, V1, zb]]);
      if (rb < u1 && eu1) face([[U1, V0, zb - f], [U1, V1, zb - f], [U1, V1, zb], [U1, V0, zb]]);
    }
    plane([[U0, V0, zb], [U1, V0, zb], [RB, vm, zr], [RA, vm, zr]]);
    plane([[U1, V1, zb], [U0, V1, zb], [RA, vm, zr], [RB, vm, zr]]);
    if (ra > u0) plane([[U0, V1, zb], [U0, V0, zb], [RA, vm, zr]]);
    if (rb < u1) plane([[U1, V0, zb], [U1, V1, zb], [RB, vm, zr]]);
    // shade under the eaves, on the walls the eaves overhang (in the frame's
    // order, so the band's ends run counter-clockwise like the walls)
    if (e && !m) {
      onWalls(() => {
        const band = (p, q) => {
          const [a, b] = [P(...p, 0), P(...q, 0)];
          if (alongY) this._eaveBand(b, a, zb); else this._eaveBand(a, b, zb);
        };
        if (ev0) band([u0, v0], [u1, v0]);
        if (ev1) band([u1, v1], [u0, v1]);
        if (ra > u0 && eu0) band([u0, v1], [u0, v0]);
        if (rb < u1 && eu1) band([u1, v0], [u1, v1]);
      });
    }
    this.current = walls;
    return this;
  }

  // Solid of revolution around the vertical axis at (x, y): profile is
  // [[radius, height]…] from the bottom up (radius 0 = a point). Domes,
  // spires, cooling towers, water towers, tapered chimneys.
  // opts.phase turns the polygon (in fractions of a side).
  // opts.smooth: a smooth round body – no facet edges, only its outline
  // (the silhouette and the near half of the bottom rim), plus the near
  // half of the profile rings listed in opts.rings (indices into profile).
  // opts.hatch (with smooth): pencil strokes down the segments listed
  // (indices into profile, segment i runs from point i to i + 1), LOOK.hatch
  // apart round the rim – a conical or domed roof drawn like the others.
  lathe(x, y, z, profile, sides = 12, opts = {}) {
    const rmax = Math.max(...profile.map((p) => p[0]));
    this._grow([[x - rmax, y - rmax], [x + rmax, y + rmax]]);
    const top = profile[profile.length - 1][1];
    this.solid(x, y, z + top / 2);
    const ang = (j) => ((j + (opts.phase ?? 0)) / sides) * Math.PI * 2;
    const at = (r, j, h) => [x + Math.cos(ang(j)) * r, y + Math.sin(ang(j)) * r, z + h];
    const { smooth, rings = [], hatch = [], ...faceOpts } = opts;
    const side = smooth ? { ...faceOpts, stroke: 'none' } : faceOpts;
    const seen = []; // seen[i][j]: side face j of segment i faces the viewer
    for (let i = 0; i < profile.length - 1; i++) {
      const [r0, h0] = profile[i], [r1, h1] = profile[i + 1];
      seen.push([]);
      for (let j = 0; j < sides; j++) {
        const pts = [];
        if (r0 > 0) pts.push(at(r0, j, h0), at(r0, j + 1, h0));
        else pts.push(at(0, 0, h0));
        if (r1 > 0) pts.push(at(r1, j + 1, h1), at(r1, j, h1));
        else pts.push(at(0, 0, h1));
        seen[i].push(pts.length >= 3 && this._facing(newellNormal(pts), pts[0]));
        if (pts.length >= 3) this.face(pts, side);
      }
    }
    if (smooth) {
      const n = profile.length - 1;
      // the outline, like a face's edge, drawn with a steadier hand (a
      // long curve with the usual jitter at every point would look wavy)
      const pen = { stroke: 'main', width: 1.2, wobble: 0.12, ...faceOpts };
      // The outline is worked out exactly rather than from the facets: the
      // view is a linear test on normals (Camera.facing), so on each ring
      // the surface turns away from the viewer at th ± d, where the normal
      // (cos φ, sin φ, m) with m = -dr/dh is edge-on.
      const va = this._view([1, 0, 0]), vb = this._view([0, 1, 0]), vc = this._view([0, 0, 1]);
      const R = Math.hypot(va, vb), th = Math.atan2(vb, va);
      const slope = (k) => {
        const ms = [];
        for (const [p, q] of [[k - 1, k], [k, k + 1]]) {
          if (p < 0 || q > n) continue;
          const dh = profile[q][1] - profile[p][1];
          if (Math.abs(dh) > 1e-9) ms.push(-(profile[q][0] - profile[p][0]) / dh);
        }
        return ms.length ? ms.reduce((t, m) => t + m, 0) / ms.length : null;
      };
      // half-width of the near side of ring k (angle), 'full', or null (none)
      const half = (k) => {
        const m = slope(k);
        if (m === null || R < 1e-9) return null;
        const q = (-m * vc) / R;
        return q >= 1 ? null : q <= -1 ? 'full' : Math.acos(q);
      };
      const P = (r, h, phi) => [x + Math.cos(phi) * r, y + Math.sin(phi) * r, z + h];
      for (const sgn of [-1, 1]) {
        let run = [];
        const flush = () => { if (run.length > 1) this.line(run, pen); run = []; };
        for (let k = 0; k <= n; k++) {
          const [r, h] = profile[k];
          if (r <= 0) { if (run.length) run.push([x, y, z + h]); flush(); continue; }
          const d = half(k);
          if (typeof d !== 'number') { flush(); continue; }
          run.push(P(r, h, th + sgn * d));
        }
        flush();
      }
      // near halves of the rim and the chosen rings
      for (const k of [0, ...rings]) {
        const [r, h] = profile[k], d = half(k);
        if (r <= 0 || d === null) continue;
        const span = d === 'full' ? Math.PI : d, steps = Math.max(4, Math.round((span / Math.PI) * 24));
        const arc = Array.from({ length: steps + 1 }, (_, i) => P(r, h, th - span + (2 * span * i) / steps));
        this.line(arc, k === 0 ? pen : faceOpts);
      }
      // roof hatching: strokes down the chosen segments on the near side
      if (LOOK.hatch) {
        for (const i of hatch) {
          const [r0, h0] = profile[i], [r1, h1] = profile[i + 1];
          const count = Math.max(sides, Math.round((2 * Math.PI * Math.max(r0, r1)) / LOOK.hatch));
          const lod = Math.max(1, this.lod);
          for (let k = 0; k < count; k++) {
            const j = (k * sides) / count; // angle in sides
            const face = Math.floor(j) % sides;
            if (!seen[i][face] || !seen[i][(face + sides - 1) % sides] || !seen[i][(face + 1) % sides]) continue;
            const a = 0.04 + 0.08 * Math.abs(hash2(k, i, 6)), b = 0.08 + 0.2 * Math.abs(hash2(k, i, 7));
            const lerp = (t) => [r0 + (r1 - r0) * t, h0 + (h1 - h0) * t];
            const [ra, ha] = lerp(a), [rb, hb] = lerp(1 - b);
            this.line([at(ra, j, ha), at(rb, j, hb)], { cls: 'roof-hatch', lod });
          }
        }
      }
    }
    const [rt] = profile[profile.length - 1];
    if (rt > 0) {
      const cap = [];
      for (let j = 0; j < sides; j++) cap.push(at(rt, j, top));
      this.face(cap, faceOpts);
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

  // Ground lines wobble like everything else with LOOK.sketch.
  groundLine(points, opts = {}) {
    return this._groundOutline(points, false, opts);
  }

  groundPoly(points, opts = {}) {
    return this._groundOutline(points, true, opts);
  }

  _groundOutline(points, closed, opts) {
    const pts = points.map(([x, y]) => [x, y, 0]);
    const n = this.ground.length;
    this._onGround = true;
    if (LOOK.sketch) {
      const { d } = this._sketch(pts, closed);
      if (d) this.ground.push(`<path d="${d}"${attrs(opts, this._lod(opts), 'gnd')}/>`);
    } else {
      for (const run of this._screenRuns(pts, closed)) {
        this.ground.push(`<${closed ? 'polygon' : 'polyline'} points="${run.map(([sx, sy]) => `${r2(sx)},${r2(sy)}`).join(' ')}"${attrs(opts, this._lod(opts), 'gnd')}/>`);
      }
    }
    this._onGround = false;
    if (this.ground.length > n) {
      const cam = this.camera;
      let at;
      if (cam.perspective) {
        // the nearest point in front, so the photo's nearer ground bands
        // don't cover part of it
        for (const [px, py] of points) {
          const w = this.toWorld(px, py), a = cam.ahead(...w);
          if (a >= cam.near && (!at || a < cam.ahead(...at))) at = w;
        }
      }
      if (!at) at = this.toWorld(points.reduce((a, p) => a + p[0], 0) / points.length, points.reduce((a, p) => a + p[1], 0) / points.length);
      while (this.groundAt.length < this.ground.length) this.groundAt.push(at);
    }
    return this;
  }

  groundCircle(x, y, r, opts = {}) {
    if (this.camera.perspective) {
      const ring = Array.from({ length: 16 }, (_, i) => [x + Math.cos((i / 16) * Math.PI * 2) * r, y + Math.sin((i / 16) * Math.PI * 2) * r]);
      return this.groundPoly(ring, opts);
    }
    this._onGround = true;
    const [sx, sy] = this._project(...this._world(x, y, 0));
    this._onGround = false;
    const [rx, ry] = this.camera.groundEllipse(r);
    this.groundAt.push(this.toWorld(x, y));
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

  // Does a surface with local normal n face the viewer? (For drawings that
  // outline curved or broken shapes themselves.)
  facing(n) {
    return this._facing(n);
  }

  isFree(x, y, r = 0) {
    return !this.free || this.free(x, y, r);
  }

  // `dir`: the way a car parked there faces (local; default nose to +y).
  spot(x, y, dir = [0, 1]) {
    const [wx, wy] = this._world(x, y, 0);
    const [dx, dy] = this._turn(dir[0], dir[1]);
    this.spots.push([wx, wy, Math.atan2(dy, dx)]);
    return this;
  }

  // Cast a shadow from local 3D points (their convex hull, see
  // render/shadows.js). Faces do this by themselves.
  cast(points) {
    if (!this.casting) return this;
    this.casts.push(points.map(([x, y, z]) => {
      const [lx, ly] = this._turn(x, y);
      return [this.ox + lx, this.oy + ly, z];
    }));
    return this;
  }

  // The shadow of a screen-facing outline (u right, v up, grid units, as
  // g.shape) taken as a solid of revolution about its upright axis: a tree
  // crown drawn as a flat glyph still casts a round shadow. A few of the
  // outline's points are enough for the hull.
  castShape(x, y, z, points) {
    const step = Math.max(1, Math.floor(points.length / 10));
    const pts = [];
    for (let i = 0; i < points.length; i += step) {
      const r = Math.abs(points[i][0]), h = z + points[i][1] / this.camera.zScale;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r, h]);
      }
    }
    return this.cast(pts);
  }

  // A contact shadow's footing (render/shadows.js): the edges of a
  // counter-clockwise outline on the ground, standing h high.
  castFoot(base, h) {
    if (!this.casting) return this;
    for (let i = 0; i < base.length; i++) {
      const p = base[i], q = base[(i + 1) % base.length];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (l < 1e-9) continue;
      this.feet.push({ a: this.toWorld(p[0], p[1]), b: this.toWorld(q[0], q[1]), h, n: this._turn((q[1] - p[1]) / l, -(q[0] - p[0]) / l) });
    }
    return this;
  }

  // Ground point (world x, y) -> scene px, as this painter draws its ground:
  // for drawing its shadows (render/shadows.js).
  groundProjector() {
    const at = this.rigid, lift = this.follow ? null : this.rigid;
    return (x, y) => this.camera.project(x, y, this.oz, at, lift);
  }

  // Combine another painter's output (same camera) into this one.
  merge(other) {
    this.casts.push(...other.casts);
    this.feet.push(...other.feet);
    this.top = Math.max(this.top, other.top + other.oz - this.oz);
    this.solids.push(...other.solids);
    this.ground.push(...other.ground);
    this.groundAt.push(...other.groundAt);
    this.spots.push(...other.spots);
    return this;
  }

  line(points, opts = {}) {
    this._ensure(...points[0]);
    this._spread(points);
    if (opts.facing && !this._facing(opts.facing, points[0])) return this;
    const lod = opts.lod ?? (opts.facing ? Math.max(2, this.lod) : this.lod);
    this.current.parts.push(this._outline(points, false, opts, lod));
    return this;
  }

  disc(x, y, z, r, opts = {}) {
    this._ensure(x, y, z);
    const a = this._anchor(x, y, z);
    if (!a) return this;
    const [sx, sy, t] = a;
    this.current.parts.push(`<circle cx="${r2(sx)}" cy="${r2(sy)}" r="${r2(r * t)}"${attrs(opts, this._lod(opts))}/>`);
    return this;
  }

  shape(x, y, z, points, opts = {}) {
    this._ensure(x, y, z);
    const a = this._anchor(x, y, z);
    if (!a) return this;
    const [sx, sy, t] = a;
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
    // one decimal is plenty for these small glyphs, and keeps the markup small
    const r1 = (n) => Math.round(n * 10) / 10;
    let d = '';
    for (const { x, y, z, lines } of groups) {
      const a = this._anchor(x, y, z);
      if (!a) continue;
      const [sx, sy, t] = a;
      for (const pts of lines) d += pts.map(([u, v], i) => `${i ? 'L' : 'M'}${r1(sx + u * t)} ${r1(sy - v * t)}`).join('');
    }
    this.current.parts.push(`<path d="${d}"${attrs(opts, this._lod(opts), 'glyph')}/>`);
    return this;
  }

  toGroundSVG() {
    return this.ground.join('');
  }

  toSVG() {
    return orderSolids(this.solids).map((s) => s.parts.join('')).join('');
  }
}
