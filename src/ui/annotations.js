// Annotations (each switchable in render/style.js):
//   hover tags  a leader line and a boxed label naming the building / road /
//               exit under the pointer, e.g. "Clinic"
//   event log   a running log of what happens (visitors, residents leaving
//               the city, buildings growing …), with simulation time
//
// Systems report events with annotations.log(text, [x, y]) (the position is
// currently unused, kept so events can be placed on the map later).

import { STRUCTURE_TYPES, levelOf } from '../../structures/index.js';
import { FEATURE_TYPES } from '../../features/index.js';
import { STYLE } from '../render/style.js';
import { sketchRect, sketchPolyline, seedOf } from '../render/sketch.js';

const FEED_LINES = 6;

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
  constructor(root, { world, camera, clock }) {
    this.world = world;
    this.camera = camera;
    this.clock = clock;
    this.lines = [];
    this.el = document.createElement('div');
    this.el.className = 'feed hidden';
    root.appendChild(this.el);
    this.feedDirty = true;
  }

  log(text, _pos = null) {
    const t = this.clock.elapsed;
    this.lines.unshift({ t, text });
    this.lines.length = Math.min(this.lines.length, FEED_LINES);
    this.feedDirty = true;
  }

  update() {
    const show = STYLE.feed && this.lines.length > 0;
    if (show !== this.shown) this.el.classList.toggle('hidden', !(this.shown = show));
    if (!show || !this.feedDirty) return;
    this.feedDirty = false;
    const clock = (t) => {
      const s = Math.floor(t);
      return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };
    this.el.innerHTML = this.lines.map((l) => `<div><span class="t">${clock(l.t)}</span>${esc(l.text)}</div>`).join('');
  }

  // SVG for the overlay layer (scene coordinates, constant screen size).
  overlay(kit, point, toolId) {
    let out = '';
    if (STYLE.hoverTags && toolId === 'inspect' && point) {
      const info = this.describe(point);
      if (info) out += this.tag(kit, info.pos, info.lines, info.height);
    }
    return out;
  }

  describe([x, y]) {
    const { world } = this;
    const node = world.grid.nodeAt(x, y);
    if (node < 0) return null;
    const at = (height) => ({ pos: world.grid.xy(node), height });
    const s = world.structureAt(node);
    if (s) return { pos: world.centerOf(s), height: 0.5, lines: [levelOf(STRUCTURE_TYPES[s.type], s).name] };
    if (world.roadExits().some((e) => e.node === node)) return { ...at(0.1), lines: ['Road out of town'] };
    if (world.railExits().some((e) => e.node === world.coarseToFine(node))) return { ...at(0.1), lines: ['Railway out of town'] };
    if (world.hasRail(node)) return { ...at(0.1), lines: [world.hasRoad(node) ? 'Level crossing' : 'Railway'] };
    if (world.hasRoad(node)) return { ...at(0.1), lines: [world.laneOnly(node) ? 'Lane' : 'Road'] };
    if (world.paths.hasNode(world.coarseToFine(node))) return { ...at(0.05), lines: ['Footpath'] };
    const f = world.featureAt(node);
    const name = f && FEATURE_TYPES[f.type]?.name;
    if (name) return { ...at(0.5), lines: [name] };
    return null;
  }

  // Leader line from a point up and to the right, then a label in a box,
  // both drawn by pen (sketch.js; all in screen pixels, divided by the zoom).
  tag(kit, [x, y], lines, height) {
    const z = this.camera.zoom;
    const size = 11, lead = 14, padX = 6, padY = 4;
    const [sx, sy] = this.camera.project(x, y, height);
    const [ex, ey] = [sx + 18 / z, sy - 26 / z];
    const texts = lines;
    const widths = texts.map((t) => textWidth(t, size));
    const w = Math.max(...widths) + padX * 2;
    const h = lead * texts.length + padY * 2 - (lead - size);
    const bx = ex + 4 / z, by = ey - h / z / 2;
    const text = texts
      // textLength: scaled text can lay out a little wider than measured
      .map((t, i) => `<text class="tag" x="${r2(bx + padX / z)}" y="${r2(by + (padY + size * 0.82 + i * lead) / z)}" font-size="${r2(size / z)}" textLength="${r2(widths[i] / z)}" lengthAdjust="spacingAndGlyphs">${esc(t)}</text>`)
      .join('');
    const seed = seedOf(x, y, lines.length);
    const k = 1 / z;
    // data-anim: it waits as long as the hover ring (styles.css) and isn't
    // held back again by every redraw of a pan (Renderer.keepAnimating)
    return `<g class="tag-group" data-anim="tag-${seed}-${esc(lines.join('|'))}">` +
      `<path class="tag-line" d="${sketchPolyline([[sx, sy], [ex, ey], [bx, ey]], seed, { k })}"/>` +
      `<circle class="tag-dot" cx="${r2(sx)}" cy="${r2(sy)}" r="${r2(2 / z)}"/>` +
      `<rect class="tag-fill" x="${r2(bx)}" y="${r2(by)}" width="${r2(w / z)}" height="${r2(h / z)}"/>` +
      `<path class="tag-box" d="${sketchRect(bx, by, w / z, h / z, seed + 7, { k, over: 3 })}"/>${text}</g>`;
  }
}

export function compass([dx, dy]) {
  return dx < 0 ? 'W' : dx > 0 ? 'E' : dy < 0 ? 'N' : 'S';
}
