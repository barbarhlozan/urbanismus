// Small helpers tools use to draw previews / cursors in the overlay layer.
// Each returns an SVG string in scene coordinates. Positions are world
// coordinates (main grid units, fractional allowed).

import { smoothPolyline } from '../roads/geometry.js';
import { Painter } from './painter.js';
import { drawSeed, tiltOf, roadFront } from '../../structures/index.js';
import { fitSite } from './lots.js';
import { sketchEllipse, sketchLine, seedOf } from './sketch.js';
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
  ringAt(x, y, r, cls = 'hover') {
    const [sx, sy] = this.project(x, y);
    const [rx, ry] = this.camera.groundEllipse(r);
    const seed = seedOf(x, y, cls.length);
    const d = sketchEllipse(sx, sy, rx, ry, seed);
    const len = Math.ceil(pathLength(d) * 1.05); // a little spare for the round caps
    return `<path class="${cls}" d="${d}" style="--len:${len}px" data-anim="${seed}"/>`;
  }

  ring(node, r, cls = 'hover') {
    return node < 0 ? '' : this.ringAt(...this.world.grid.xy(node), r, cls);
  }

  // Upright "X" (screen-aligned so it never lines up with roads), with a halo
  // so it stays readable on top of buildings.
  crossAt(x, y, size = 0.16) {
    const [cx, cy] = this.project(x, y);
    const s = size * this.camera.tile;
    const k = 1 / this.camera.zoom, seed = seedOf(x, y);
    const d = sketchLine([cx - s, cy - s], [cx + s, cy + s], seed, { k, over: 1.5 })
      + sketchLine([cx - s, cy + s], [cx + s, cy - s], seed + 1, { k, over: 1.5 });
    return `<path class="cross-halo" d="${d}"/><path class="cross" d="${d}"/>`;
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

  // While building, the dots within reach of the pointer, fading out with
  // distance, instead of a sheet of them over the whole map; `fine`: the
  // half steps footpaths, railways and fences take too. With a building in
  // hand (`building`) none where something stands or runs, and where it
  // can't stand for the slope a small warning sign in place of the dot;
  // with a road (`roads`) none under buildings.
  nearDots(point, { fine = false, building = false, roads = false } = {}) {
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
        if (d > REACH || i < 0 || terrain.isWater(i)) continue;
        const main = Number.isInteger(x) && Number.isInteger(y);
        const fade = r2(1 - (d / REACH) ** 2);
        if (main && building) {
          if (world.tooSteepToBuild(i)) {
            signs += `<g class="near-steep" opacity="${fade}">${this.steepAt(x, y, 0.06)}</g>`;
            continue;
          }
          if (world.structureAt(i) || world.hasRoad(i) || world.hasRail(i)) continue;
        }
        if (main && roads && world.structureAt(i)) continue;
        const [sx, sy] = this.project(x, y);
        dots += `<circle class="${main ? 'grid-dot' : 'fine-dot'}" cx="${r2(sx)}" cy="${r2(sy)}" r="${main ? THEME.gridDotRadius : THEME.fineDotRadius}" opacity="${fade}"/>`;
      }
    }
    return dots + signs;
  }

  // Erase mode, over what would go: the eraser from the Erase icon
  // (icons.js, without its smudge), tilted, pen-drawn, filled with the
  // paper so it reads over anything.
  eraserAt(x, y, size = 0.16) {
    const [cx, cy] = this.project(x, y);
    const s = (size * this.camera.tile) / 11; // the icon's 32-box, around its middle
    const k = 1 / this.camera.zoom, seed = seedOf(x, y, 11);
    const p = ([px, py]) => [cx + (px - 16.2) * s, cy + (py - 18.2) * s];
    const body = [[6, 22], [20.1, 7.9], [26.5, 14.3], [12.4, 28.4]].map(p);
    const [a, b] = [p([10.9, 17.1]), p([17.3, 23.5])]; // where the rubber tip starts
    const outline = body.map((q, i) => sketchLine(q, body[(i + 1) % 4], seed + i, { k, over: 1 })).join('')
      + sketchLine(a, b, seed + 5, { k, over: 0.5 });
    const fill = `M${body.map(([qx, qy]) => `${r2(qx)} ${r2(qy)}`).join('L')}Z`;
    const tip = `M${[body[0], a, b, body[3]].map(([qx, qy]) => `${r2(qx)} ${r2(qy)}`).join('L')}Z`;
    // data-anim: it pops up once where it lands, not again on every redraw
    // of a pan, and shrinks away when it goes (Renderer.keepAnimating, letGo)
    return `<g class="eraser-mark" data-anim="erase-${seed}">`
      + `<path class="cross-halo" d="${outline}"/><path class="eraser-body" d="${fill}"/>`
      + `<path class="eraser-tip" d="${tip}"/><path class="eraser" d="${outline}"/></g>`;
  }

  steep(node, size) {
    return node < 0 ? '' : this.steepAt(...this.world.grid.xy(node), size);
  }

  // points: world coordinates; curve: { cornerRadius, curveSamples } or null for straight
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
      painter.setSitePaths(this.world.sitePaths(s));
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
  // and, with `yaw`, the wedge of ground their camera sees, `fov` degrees
  // wide and `len` grid steps long, held level at the photographer's height
  // (not laid on the ground, so a slope doesn't stretch it out of shape) –
  // no outline, only loose pencil strokes
  // across it, irregular in spacing, slant, length and where they start
  // (seeded by the spot, so they hold still while aiming).
  photographer(x, y, yaw = null, fov = 42, len = 3) {
    const k = 1 / this.camera.zoom;
    let out = '';
    if (yaw != null) {
      const rnd = mulberry32(seedOf(x, y, 7));
      const half = (fov * Math.PI) / 360, tan = Math.tan(half);
      const z = this.world.terrain.heightAt(x, y) + 0.04;
      const at = (t, w, a) => {
        const c = Math.cos(yaw + a), s = Math.sin(yaw + a);
        return this.camera.project(x + c * t - s * w, y + s * t + c * w, z, [x, y]);
      };
      let d = '';
      for (let t = 0.1 + rnd() * 0.05; t < len; t += 0.05 + rnd() * 0.1) {
        const w = Math.min(t * tan, Math.sqrt(Math.max(0, len * len - t * t)));
        if (w < 0.02 || rnd() < 0.12) continue;
        // a stroke need not cross the whole wedge: it starts and stops at
        // random, now and then two short ones instead of one
        const slant = (rnd() - 0.5) * 0.35;
        const parts = rnd() < 0.2 ? [[-1, -0.1 + rnd() * 0.3], [0.1 + rnd() * 0.3, 1]] : [[-1, 1]];
        for (const [p, q] of parts) {
          const a = w * (p + rnd() * 0.3), b = w * (q - rnd() * 0.35);
          if (b - a < w * 0.15) continue;
          d += sketchLine(at(t, a, slant * 0.2), at(t + (b - a) * slant * 0.5, b, slant * 0.2), seedOf(x, y, t * 100), { k, over: 0.6 + rnd() * 1.5, bow: 2.5 });
        }
      }
      out += `<path class="photo-cone-hatch" d="${d}"/>`;
    }
    const [sx, sy] = this.project(x, y);
    // the camera from the Photo button up top, standing on the spot
    const s = 0.24 * (this.camera.tile / 32);
    return out + `<g class="photo-cam" transform="translate(${r2(sx - 8 * s)} ${r2(sy - 12.6 * s)}) scale(${r2(s)})">${controlArt('photo')}</g>`;
  }
}
