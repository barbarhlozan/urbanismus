// Small helpers tools use to draw previews / cursors in the overlay layer.
// Each returns an SVG string in scene coordinates. Positions are world
// coordinates (main grid units, fractional allowed).

import { smoothPolyline } from '../roads/geometry.js';
import { Painter } from './painter.js';
import { levelOf, drawSeed, tiltOf, roadFront } from '../../structures/index.js';
import { fitSite } from './lots.js';
import { sketchEllipse, sketchLine, seedOf } from './sketch.js';
import { mulberry32 } from '../core/random.js';
import { controlArt } from '../ui/icons.js';

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
  // kept running across redraws by Renderer.keepAnimating). The stroke
  // doesn't scale (non-scaling-stroke), so its dashes are measured on
  // screen: the length is too.
  ringAt(x, y, r, cls = 'hover') {
    const [sx, sy] = this.project(x, y);
    const [rx, ry] = this.camera.groundEllipse(r);
    const seed = seedOf(x, y, cls.length);
    const d = sketchEllipse(sx, sy, rx, ry, seed);
    const len = Math.ceil(pathLength(d) * this.camera.zoom * 1.05); // a little spare: mid-zoom the scene lags the camera
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
  ghost(def, node, rotation = 0, level = 1, seed = 1, { blocked = false } = {}) {
    const [x, y] = this.world.grid.xy(node);
    const instance = { type: def.id, node, rotation, level, seed, data: {} };
    const painter = new Painter(this.camera, { x, y, z: this.world.terrain.heightAt(x, y) }, rotation, drawSeed(instance));
    // stays square, like the built one (Renderer.buildStructure)
    const nodes = this.world.footprintNodes(def.id, node, rotation).filter((n) => n >= 0).map((n) => this.world.grid.xy(n));
    painter.rigid = nodes.length ? [nodes.reduce((a, p) => a + p[0], 0) / nodes.length, nodes.reduce((a, p) => a + p[1], 0) / nodes.length] : [x, y];
    if (def.site) {
      painter.setSite(fitSite(this.world, this.config, this.world.siteArea(def.id, node, rotation)));
      const s = { id: -1, type: def.id, node, rotation, level, seed, data: {} };
      painter.setSitePaths(this.world.sitePaths(s));
    }
    painter.setTilt(tiltOf(def, instance, undefined, this.world));
    painter.roadGap = (def.footprint ?? [[0, 0]]).length === 1 ? roadFront(this.world, instance).gap : 1;
    levelOf(def, instance).draw(painter, instance);
    const [sx, sy] = this.camera.project(...painter.rigid, this.world.terrain.heightAt(...painter.rigid)).map(r2);
    const key = `ghost:${def.id}:${node}:${rotation}:${level}:${seed}:${blocked ? 1 : 0}`;
    return `<g transform="translate(${sx} ${sy})"><g class="ghost-anim" data-anim="${key}">`
      + `<g class="ghost${blocked ? ' blocked' : ''}" transform="translate(${-sx} ${-sy})">${painter.toGroundSVG()}${painter.toSVG()}</g></g></g>`;
  }

  // Photo mode (tools/photo.js): the photographer at (x, y), the camera icon,
  // and, with `yaw`, the wedge of ground their camera sees, `fov` degrees
  // wide and `len` grid steps long – no outline, only loose pencil strokes
  // across it, irregular in spacing, slant, length and where they start
  // (seeded by the spot, so they hold still while aiming).
  photographer(x, y, yaw = null, fov = 42, len = 3) {
    const k = 1 / this.camera.zoom;
    let out = '';
    if (yaw != null) {
      const rnd = mulberry32(seedOf(x, y, 7));
      const half = (fov * Math.PI) / 360, tan = Math.tan(half);
      const at = (t, w, a) => {
        const c = Math.cos(yaw + a), s = Math.sin(yaw + a);
        return this.project(x + c * t - s * w, y + s * t + c * w);
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

  // Outline of a rectangle on the ground (world coordinates).
  groundRect(x0, y0, x1, y1, cls = 'coverage') {
    const d = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y], i) => {
      const [sx, sy] = this.project(x, y);
      return `${i ? 'L' : 'M'}${r2(sx)} ${r2(sy)}`;
    }).join('') + 'Z';
    return `<path class="${cls}" d="${d}"/>`;
  }
}
