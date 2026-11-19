// Small helpers tools use to draw previews / cursors in the overlay layer.
// Each returns an SVG string in scene coordinates. Positions are world
// coordinates (main grid units, fractional allowed).

import { smoothPolyline } from '../roads/geometry.js';
import { Painter } from './painter.js';
import { drawSeed, tiltOf, roadFront, freeTilt, freeAnchor } from '../../structures/index.js';
import { fitSite, siteEdges } from './lots.js';
import { sketchEllipse, sketchLine, sketchHatch, seedOf } from './sketch.js';
import { mulberry32 } from '../core/random.js';
import { controlArt } from '../ui/icons.js';
import { THEME } from '../theme.js';

const r2 = (n) => Math.round(n * 100) / 100;

// Length of a path of straight segments (M/L only, as sketchEllipse draws).
function pathLength(d) {
  const n = d.match(/-?[\d.]+/g).map(Number);
  let len = 0;
  for (let i = 2; i < n.length; i += 2) len += Math.hypot(n[i] - n[i - 2], n[i + 1] - n[i - 1]);
  return len;
}

// the photo arrow: from `from` to `to` grid steps out from the photographer,
// its head's two strokes `head` long, `spread` radians off the shaft
const PHOTO_AIM = { from: 0.35, to: 1.5, head: 0.32, spread: 0.45 };

export class OverlayKit {
  constructor(world, camera, config) {
    this.world = world;
    this.camera = camera;
    this.config = config;
  }

  project(x, y) {
    return this.camera.project(x, y, this.world.terrain.heightAt(x, y));
  }

  // A ring on the ground, circled by pen (sketch.js): the same stroke for
  // the same spot, so it doesn't flicker while the pointer rests there.
  // --len and data-anim are for the pen animation (.hover in styles.css,
  // kept running across redraws by Renderer.keepAnimating), in the
  // ring's own units like its dashes.
  // `seed`: the same stroke wherever it is (a brush following the pointer
  // keeps its shape).
  ringAt(x, y, r, cls = 'hover', seed = seedOf(x, y, cls.length)) {
    const [sx, sy] = this.project(x, y);
    const [rx, ry] = this.camera.groundEllipse(r);
    const d = sketchEllipse(sx, sy, rx, ry, seed);
    const len = Math.ceil(pathLength(d) * 1.05); // a little spare for the round caps
    return `<path class="${cls}" d="${d}" style="--len:${len}px" data-anim="${seed}"/>`;
  }

  ring(node, r, cls = 'hover') {
    return node < 0 ? '' : this.ringAt(...this.world.grid.xy(node), r, cls);
  }

  // An "X" in a quick hand (screen-aligned so it never lines up with roads):
  // two strokes of uneven length, each a little off the diagonal, bowed and
  // running past their ends – with a halo so it stays readable on top of
  // buildings.
  crossAt(x, y, size = 0.16) {
    const [cx, cy] = this.project(x, y);
    const s = size * this.camera.tile;
    const k = 1 / this.camera.zoom, seed = seedOf(x, y), rnd = mulberry32(seed ^ 0x2c05);
    const arm = (a) => {
      const t = a + (rnd() - 0.5) * 0.35, l0 = s * (0.75 + 0.4 * rnd()), l1 = s * (0.75 + 0.4 * rnd());
      const ox = (rnd() - 0.5) * 0.25 * s, oy = (rnd() - 0.5) * 0.25 * s;
      return [[cx + ox - Math.cos(t) * l0, cy + oy - Math.sin(t) * l0], [cx + ox + Math.cos(t) * l1, cy + oy + Math.sin(t) * l1]];
    };
    const d = sketchLine(...arm(Math.PI / 4), seed, { k, over: 2, bow: 2.4 })
      + sketchLine(...arm(-Math.PI / 4), seed + 1, { k, over: 2, bow: 2.4 });
    return `<path class="cross-halo" d="${d}"/><path class="cross" d="${d}"/>`;
  }

  // A short note in the UI font beside a point, haloed like the cross
  // (.tag in styles.css): why a way can't go there. Constant screen size.
  noteAt(x, y, text) {
    if (!text) return '';
    const [sx, sy] = this.project(x, y), z = this.camera.zoom, size = 13;
    const esc = String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    return `<text class="tag" x="${r2(sx)}" y="${r2(sy - 14 / z)}" font-size="${r2(size / z)}" text-anchor="middle">${esc}</text>`;
  }

  cross(node, size) {
    return node < 0 ? '' : this.crossAt(...this.world.grid.xy(node), size);
  }

  // Too steep here: a little warning sign like the "steep hill" road sign –
  // an upright triangle, pen-drawn, with the slope as a filled wedge inside –
  // where other problems get the cross. Same size and halo as the cross.
  steepAt(x, y, size = 0.16) {
    const [cx, cy] = this.project(x, y);
    const s = size * this.camera.tile * 1.25;
    const k = 1 / this.camera.zoom, seed = seedOf(x, y, 7);
    const top = [cx, cy - s * 1.05], left = [cx - s, cy + s * 0.7], right = [cx + s, cy + s * 0.7];
    const sign = sketchLine(top, left, seed, { k, over: 1 }) + sketchLine(left, right, seed + 1, { k, over: 1 })
      + sketchLine(right, top, seed + 2, { k, over: 1 });
    const wedge = `M${r2(cx - s * 0.5)} ${r2(cy + s * 0.42)}L${r2(cx + s * 0.5)} ${r2(cy + s * 0.42)}L${r2(cx + s * 0.5)} ${r2(cy - s * 0.12)}Z`;
    return `<path class="cross-halo" d="${sign}"/><path class="steep-sign" d="${sign}"/><path class="steep-wedge" d="${wedge}"/>`;
  }

  // Something's built here: the "Zákaz vjezdu" road sign (no entry: an ink
  // disc with a paper bar across it) on a short post planted at the dot,
  // where the road tools would otherwise put their ring. Pen-drawn and
  // haloed like the steep-hill sign.
  noEntryAt(x, y, size = 0.16) {
    const [cx, cy] = this.project(x, y);
    const s = size * this.camera.tile;
    const k = 1 / this.camera.zoom, seed = seedOf(x, y, 13);
    const sy = cy - s * 2.1; // the sign's middle, up its post
    const post = sketchLine([cx, cy], [cx, sy + s * 0.9], seed, { k, over: 0.5 });
    const disc = sketchEllipse(cx, sy, s, s, seed + 1, { k, turns: 1.08 });
    const bw = s * 0.62, bh = s * 0.2;
    const bar = `M${r2(cx - bw)} ${r2(sy - bh)}L${r2(cx + bw)} ${r2(sy - bh)}L${r2(cx + bw)} ${r2(sy + bh)}L${r2(cx - bw)} ${r2(sy + bh)}Z`;
    return `<path class="cross-halo" d="${post}${disc}"/><path class="noentry-post" d="${post}"/>`
      + `<path class="noentry-disc" d="${disc}"/><path class="noentry-bar" d="${bar}"/>`;
  }

  // While building, the dots within reach of the pointer, fading out with
  // distance, instead of a sheet of them over the whole map; `fine`: the
  // half steps footpaths, railways and fences take too. With a structure
  // in hand (`building`: its type) only the dots it could have
  // (World.dotBlocked), and where only the slope keeps it off a small
  // warning sign in place of the dot; with a road (`roads`) none under
  // buildings.
  nearDots(point, { fine = false, building = null, roads = false } = {}) {
    if (!point) return '';
    const { world } = this;
    const { grid, terrain } = world;
    const REACH = 4.5, step = fine ? 0.5 : 1;
    const [px, py] = point;
    let dots = '', signs = '';
    for (let y = Math.ceil((py - REACH) / step) * step; y <= py + REACH; y += step) {
      for (let x = Math.ceil((px - REACH) / step) * step; x <= px + REACH; x += step) {
        const d = Math.hypot(x - px, y - py);
        const i = grid.nodeAt(x, y);
        // (half steps round onto the map: -0.5 is a dot on no grid)
        if (d > REACH || i < 0 || x < 0 || y < 0 || terrain.isWater(i)) continue;
        const main = Number.isInteger(x) && Number.isInteger(y);
        const fade = r2(1 - (d / REACH) ** 2);
        if (main && building) {
          const blocked = world.dotBlocked(i, building);
          if (blocked === 'Too steep') signs += `<g class="near-steep" opacity="${fade}">${this.steepAt(x, y, 0.06)}</g>`;
          if (blocked) continue;
        }
        if (main && roads && world.structureAt(i)) continue;
        const [sx, sy] = this.project(x, y);
        dots += `<circle class="${main ? 'grid-dot' : 'fine-dot'}" cx="${r2(sx)}" cy="${r2(sy)}" r="${main ? THEME.gridDotRadius : THEME.fineDotRadius}" opacity="${fade}"/>`;
      }
    }
    return dots + signs;
  }

  // Erase mode, over what would go: the rubber from the Erase tile
  // (icons/ui/tool-erase.svg, without its smudge) – tilted, rounded, drawn
  // by hand, a little differently wherever it lands – filled with the paper
  // so it reads over anything, its rubber tip hatched as a roof is.
  eraserAt(x, y, size = 0.16) {
    const [cx, cy] = this.project(x, y);
    const s = (size * this.camera.tile) / 8.25; // the tile's 24-box, around its middle
    const seed = seedOf(x, y, 11);
    // each point of the drawing nudged a hair, so no two are alike (the
    // same point the same way in the outline, its fill and the tip)
    const q = (px, py) => {
      const rnd = mulberry32(seedOf(px, py, seed));
      const jx = (rnd() - 0.5) * 0.5, jy = (rnd() - 0.5) * 0.5;
      return `${r2(cx + (px + jx - 12.15) * s)} ${r2(cy + (py + jy - 13.65) * s)}`;
    };
    const path = (pts) => pts.map(([c, ...n]) => c + (n.length ? q(...n.slice(0, 2)) + (n.length > 2 ? ' ' + q(...n.slice(2)) : '') : '')).join('');
    const rim = [['M', 4.38, 15.39], ['Q', 9.12, 10.91, 13.51, 6.07], ['Q', 14.61, 5.12, 15.71, 6.31], ['Q', 17.51, 8.25, 19.42, 10.08],
      ['Q', 20.54, 10.89, 19.34, 12.09], ['Q', 14.78, 16.31, 10.49, 20.8], ['Q', 9.39, 22.19, 8.54, 20.83], ['Q', 6.64, 19.04, 4.61, 17.39],
      ['Q', 3.66, 16.23, 4.78, 15.38], ['L', 3.9, 15.1]];
    const outline = path(rim);
    const band = path([['M', 9.17, 10.51], ['Q', 11.95, 13.5, 14.99, 16.23]]);
    const fill = path(rim.slice(0, -1)) + 'Z';
    const tip = path([['M', 9.17, 10.51], ['Q', 11.95, 13.5, 14.99, 16.23], ['L', 10.49, 20.8], ['Q', 9.39, 22.19, 8.54, 20.83],
      ['Q', 6.64, 19.04, 4.61, 17.39], ['Q', 3.66, 16.23, 4.78, 15.38]]) + 'Z';
    // the tip's hatching: strokes across the box round it, cut to its shape
    const [x0, y0] = [cx + (3.4 - 12.15) * s, cy + (10.2 - 13.65) * s];
    const [x1, y1] = [cx + (15.3 - 12.15) * s, cy + (22.4 - 13.65) * s];
    const hatch = sketchHatch(x0, y0, x1 - x0, y1 - y0, seed + 7, { gap: Math.max(3.2, s * 1.6) });
    const clip = `eraser-tip-${seed}`;
    // data-anim: it pops up once where it lands, not again on every redraw
    // of a pan, and shrinks away when it goes (Renderer.keepAnimating, letGo)
    return `<g class="eraser-mark" data-anim="erase-${seed}">`
      + `<clipPath id="${clip}"><path d="${tip}"/></clipPath>`
      + `<path class="cross-halo" d="${outline}"/><path class="eraser-body" d="${fill}"/>`
      + `<path class="eraser-hatch" clip-path="url(#${clip})" d="${hatch}"/><path class="eraser" d="${outline}${band}"/></g>`;
  }

  steep(node, size) {
    return node < 0 ? '' : this.steepAt(...this.world.grid.xy(node), size);
  }

  // points: world coordinates; curve: { cornerRadius, curveSamples } or null for straight
  // A way as it's being drawn: a pencil line along `points` (world), not
  // ruled – it wanders a little either side, slowly, as a hand does, in
  // two passes of the pencil. Seeded by where it starts, so it holds still
  // while the pointer moves on.
  sketchPath(points, cls) {
    if (points.length < 2) return '';
    const k = 1 / this.camera.zoom, seed = seedOf(...points[0]);
    const scr = points.map(([x, y]) => this.project(x, y));
    // evenly along the screen line, a sample every few pixels
    const step = 5 * k, pts = [scr[0]];
    for (let i = 1; i < scr.length; i++) {
      const [ax, ay] = scr[i - 1], [bx, by] = scr[i], len = Math.hypot(bx - ax, by - ay);
      for (let d = step; d < len; d += step) pts.push([ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len]);
      pts.push(scr[i]);
    }
    const pass = (n, amp) => {
      const rnd = mulberry32((seed + n * 7919) >>> 0), f1 = 0.035 + 0.02 * rnd(), f2 = 0.11 + 0.05 * rnd(), p1 = rnd() * 6.3, p2 = rnd() * 6.3;
      let along = 0, d = '';
      pts.forEach(([x, y], i) => {
        const [px, py] = pts[Math.max(0, i - 1)], [qx, qy] = pts[Math.min(pts.length - 1, i + 1)];
        const len = Math.hypot(qx - px, qy - py) || 1, nx = -(qy - py) / len, ny = (qx - px) / len;
        if (i) along += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]) / k;
        const w = amp * k * (0.65 * Math.sin(along * f1 + p1) + 0.35 * Math.sin(along * f2 + p2));
        d += `${i ? 'L' : 'M'}${r2(x + nx * w)} ${r2(y + ny * w)}`;
      });
      return d;
    };
    return `<path class="${cls}" d="${pass(0, 0.9)}"/><path class="${cls} again" d="${pass(1, 1.3)}"/>`;
  }

  path(points, cls, curve = this.config.road) {
    const pts = curve ? smoothPolyline(points, curve.cornerRadius, curve.curveSamples) : points;
    const d = pts.map(([x, y], i) => {
      const [sx, sy] = this.project(x, y);
      return `${i ? 'L' : 'M'}${r2(sx)} ${r2(sy)}`;
    }).join('');
    return `<path class="${cls}" d="${d}"/>`;
  }

  // Preview of a structure at a node, drawn in the detail pen. `blocked`:
  // it can't go there – faded, so what's in the way shows through (the
  // build tool adds crosses). It grows in when it appears and shrinks away
  // when it goes (a new spot, turn or look): the outer group stands at the
  // footprint's middle, so the animated one scales about the building's
  // base; data-anim keeps the animation going across overlay redraws
  // (Renderer.keepAnimating) and plays the exit (Renderer.letGo).
  // A structure as it would stand placed freely (World.freePlacement): its
  // middle at (x, y), its front along `angle`.
  ghostAt(def, x, y, angle, seed = 1, { blocked = false, data = {} } = {}) {
    const [ax, ay] = freeAnchor(def, x, y, angle);
    const node = this.world.grid.nodeAt(ax, ay);
    const rotation = Math.round(angle / (Math.PI / 2)) & 3;
    const instance = { type: def.id, x, y, angle, free: true, node, rotation, seed, data };
    const painter = new Painter(this.camera, { x: ax, y: ay, z: this.world.terrain.heightAt(ax, ay) }, rotation, drawSeed(instance));
    painter.rigid = [x, y];
    if (def.site) {
      painter.follow = true;
      painter.setSite(fitSite(this.world, this.config, this.world.siteAreaOf(instance)));
      painter.setSitePaths(siteEdges(this.world, this.config, this.world.sitePaths({ ...instance, id: -1 })));
    }
    painter.setTilt(freeTilt(instance), true);
    painter.roadGap = 1;
    def.draw(painter, instance);
    const [sx, sy] = this.camera.project(x, y, this.world.terrain.heightAt(x, y)).map(r2);
    // (not keyed by where it stands: following the pointer it's the same
    // ghost, so its entrance plays once – Renderer.keepAnimating – and no
    // faded copy is left behind at every step – Renderer.letGo)
    const key = `ghost:${def.id}:free:${seed}:${data.kind ?? ''}:${blocked ? 1 : 0}`;
    return `<g transform="translate(${sx} ${sy})"><g class="ghost-anim" data-anim="${key}">`
      + `<g class="ghost${blocked ? ' blocked' : ''}" transform="translate(${-sx} ${-sy})">${painter.toGroundSVG()}${painter.toSVG()}</g></g></g>`;
  }

  ghost(def, node, rotation = 0, seed = 1, { blocked = false, data = {} } = {}) {
    const [x, y] = this.world.grid.xy(node);
    const instance = { type: def.id, node, rotation, seed, data };
    const painter = new Painter(this.camera, { x, y, z: this.world.terrain.heightAt(x, y) }, rotation, drawSeed(instance));
    // stays square, like the built one (Renderer.buildStructure)
    const nodes = this.world.footprintNodes(def.id, node, rotation).filter((n) => n >= 0).map((n) => this.world.grid.xy(n));
    painter.rigid = nodes.length ? [nodes.reduce((a, p) => a + p[0], 0) / nodes.length, nodes.reduce((a, p) => a + p[1], 0) / nodes.length] : [x, y];
    if (def.site) {
      painter.setSite(fitSite(this.world, this.config, this.world.siteArea(def.id, node, rotation)));
      const s = { id: -1, type: def.id, node, rotation, seed, data: {} };
      painter.setSitePaths(siteEdges(this.world, this.config, this.world.sitePaths(s)));
    }
    painter.setTilt(tiltOf(def, instance, undefined, this.world));
    painter.roadGap = (def.footprint ?? [[0, 0]]).length === 1 ? roadFront(this.world, instance).gap : 1;
    def.draw(painter, instance);
    const [sx, sy] = this.camera.project(...painter.rigid, this.world.terrain.heightAt(...painter.rigid)).map(r2);
    const key = `ghost:${def.id}:${node}:${rotation}:${seed}:${data.kind ?? ''}:${blocked ? 1 : 0}`;
    return `<g transform="translate(${sx} ${sy})"><g class="ghost-anim" data-anim="${key}">`
      + `<g class="ghost${blocked ? ' blocked' : ''}" transform="translate(${-sx} ${-sy})">${painter.toGroundSVG()}${painter.toSVG()}</g></g></g>`;
  }

  // Photo mode (tools/photo.js): the photographer at (x, y), the camera icon,
  // and, with `yaw`, a small pencil arrow the way they look – only which
  // way: how much of the town the picture takes in is the photo's own
  // business (render/photo.js framePhoto), not a cone to aim. Held level at
  // the photographer's height, so a slope doesn't bend it; its strokes
  // seeded by the spot, so they hold still while aiming.
  photographer(x, y, yaw = null) {
    const k = 1 / this.camera.zoom;
    let out = '';
    if (yaw != null) {
      const z = this.world.terrain.heightAt(x, y) + 0.04;
      const at = (t, a = 0) => this.camera.project(x + Math.cos(yaw + a) * t, y + Math.sin(yaw + a) * t, z, [x, y]);
      const { from, to, head, spread } = PHOTO_AIM;
      const tip = at(to);
      const back = (side) => {
        const c = Math.cos(yaw), s = Math.sin(yaw), b = to - head * Math.cos(spread), w = side * head * Math.sin(spread);
        return this.camera.project(x + c * b - s * w, y + s * b + c * w, z, [x, y]);
      };
      const seed = seedOf(x, y, 7);
      const d = sketchLine(at(from), tip, seed, { k, over: 1, bow: 2 })
        + sketchLine(back(1), tip, seed + 1, { k, over: 0.5, bow: 1 })
        + sketchLine(back(-1), tip, seed + 2, { k, over: 0.5, bow: 1 });
      out += `<path class="photo-aim" d="${d}"/>`;
    }
    const [sx, sy] = this.project(x, y);
    // the camera from the Photo button up top, standing on the spot
    const s = 0.24 * (this.camera.tile / 32);
    return out + `<g class="photo-cam" transform="translate(${r2(sx - 8 * s)} ${r2(sy - 12.6 * s)}) scale(${r2(s)})">${controlArt('photo')}</g>`;
  }
}
