// Annotations (switchable in render/style.js):
//   hover tags  with the Terrain lines on, a hill's top mark tells its
//               name and height under the pointer, set on it like a label
//               on a map, underlined by pen ("Holý vrch · 570 m",
//               terrain/hills.js). Buildings get no name on pointing: they
//               give a little squash instead (Renderer.markHovered), and
//               their name is on the card a click opens.
//
// Systems also report what happens with annotations.log(text, [x, y])
// (visitors, residents leaving, buildings growing…). The player doesn't
// see it – the chronicle (sim/chronicle.js) is their record – but the last
// LOG_LINES are kept in annotations.lines, newest first, for debugging from
// the console (cmd.log()).

import { ELEVATION } from '../terrain/elevation.js';
import { HILLS } from '../terrain/hills.js';
import { STYLE } from '../render/style.js';
import { sketchLine, seedOf } from '../render/sketch.js';

const LOG_LINES = 200;

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const r2 = (n) => Math.round(n * 100) / 100;

// Label widths, measured in the tag font (the UI font, see .tag in styles.css).
let measureCtx = null;
function textWidth(text, size) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = `${size}px ${getComputedStyle(document.documentElement).getPropertyValue('--ui-font')}`;
  return measureCtx.measureText(text).width;
}

export class Annotations {
  // heights(): whether open ground tells its height (the Terrain lines are on)
  constructor({ world, camera, clock, heights = () => false }) {
    this.heights = heights;
    this.world = world;
    this.camera = camera;
    this.clock = clock;
    this.lines = [];
  }

  log(text, pos = null) {
    this.lines.unshift({ t: Math.round(this.clock.elapsed), text, pos });
    this.lines.length = Math.min(this.lines.length, LOG_LINES);
  }

  // SVG for the overlay layer (scene coordinates, constant screen size).
  overlay(kit, point, toolId) {
    let out = '';
    if (STYLE.hoverTags && toolId === 'inspect' && point) {
      const info = this.describe(point);
      if (info) out += this.tag(info);
    }
    return out;
  }

  describe([x, y]) {
    const { world } = this;
    const node = world.grid.nodeAt(x, y);
    if (node < 0) return null;
    // a hill's top mark (with the Terrain lines showing): its name and height
    if (!this.heights()) return null;
    const hill = world.hills.find((hl) => Math.hypot(hl.x - x, hl.y - y) <= HILLS.hover);
    return hill ? { pos: [hill.x, hill.y], height: 0.15, name: `${hill.name} · ${Math.round(ELEVATION.base + hill.height)} m` } : null;
  }

  // The name centred on the point and underlined by pen; a halo of the
  // background colour keeps the letters clear of the drawing behind (.tag
  // in styles.css). All in screen pixels, divided by the zoom.
  tag({ pos: [x, y], height, name }) {
    const z = this.camera.zoom;
    const size = 14;
    const [sx, sy] = this.camera.project(x, y, height);
    const w = textWidth(name, size);
    const nameY = sy + (size * 0.3) / z, lineY = nameY + 4 / z;
    const seed = seedOf(x, y, name.length);
    const half = (w / 2 + 3) / z;
    // data-anim: it waits a moment (styles.css) and isn't held back again by
    // every redraw of a pan (Renderer.keepAnimating); textLength: scaled text
    // can lay out a little wider than measured
    return `<g class="tag-group" data-anim="tag-${seed}-${esc(name)}">` +
      `<text class="tag" x="${r2(sx)}" y="${r2(nameY)}" font-size="${r2(size / z)}" text-anchor="middle" textLength="${r2(w / z)}" lengthAdjust="spacingAndGlyphs">${esc(name)}</text>` +
      `<path class="tag-line" d="${sketchLine([sx - half, lineY], [sx + half, lineY], seed, { k: 1 / z, bow: 2 })}"/></g>`;
  }
}

export function compass([dx, dy]) {
  return dx < 0 ? 'W' : dx > 0 ? 'E' : dy < 0 ? 'N' : 'S';
}
