// Small helpers tools use to draw previews / cursors in the overlay layer.
// Each returns an SVG string in scene coordinates. Positions are world
// coordinates (main grid units, fractional allowed).

import { smoothPolyline } from '../roads/geometry.js';
import { Painter } from './painter.js';
import { levelOf, drawSeed } from '../../structures/index.js';
import { fitSite } from './lots.js';
import { sketchEllipse, sketchLine, seedOf } from './sketch.js';

const r2 = (n) => Math.round(n * 100) / 100;

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
  ringAt(x, y, r, cls = 'hover') {
    const [sx, sy] = this.project(x, y);
    const [rx, ry] = this.camera.groundEllipse(r);
    const d = sketchEllipse(sx, sy, rx, ry, seedOf(x, y, cls.length));
    return `<path class="${cls}" d="${d}"/>`;
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

  // Dashed preview of a structure at a node.
  ghost(def, node, rotation = 0, level = 1, seed = 1) {
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
    levelOf(def, instance).draw(painter, instance);
    return `<g class="ghost">${painter.toGroundSVG()}${painter.toSVG()}</g>`;
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
