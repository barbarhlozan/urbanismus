// Technical annotations (each switchable in the Style panel):
//   hover tags  a leader line and a label on the building / road / exit under
//               the pointer, e.g. "R-012 · APARTMENTS · L2"
//   event log   a running log of what happens (visitors, residents leaving
//               the city, buildings growing …), with simulation time
//
// Systems report events with annotations.log(text, [x, y]) (the position is
// currently unused, kept so events can be placed on the map later).

import { STRUCTURE_TYPES, levelOf, codeOf } from '../../structures/index.js';

const FEED_LINES = 6;

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const r2 = (n) => Math.round(n * 100) / 100;

export class Annotations {
  constructor(root, { world, camera, clock, style }) {
    this.world = world;
    this.camera = camera;
    this.clock = clock;
    this.style = style;
    this.lines = [];
    this.pixelScale = 0; // set in pixel mode, so tags stay legible in chunky pixels
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
    const show = this.style.get('feed') && this.lines.length > 0;
    this.el.classList.toggle('hidden', !show);
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
    if (this.style.get('hoverTags') && toolId === 'inspect' && point) {
      const info = this.describe(point);
      if (info) out += this.tag(kit, info.pos, info.lines, info.height);
    }
    return out;
  }

  describe([x, y]) {
    const { world } = this;
    const node = world.grid.nodeAt(x, y);
    if (node < 0) return null;
    const s = world.structureAt(node);
    if (s) {
      const def = STRUCTURE_TYPES[s.type];
      const level = levelOf(def, s);
      const stats = Object.entries(level.stats ?? {}).map(([k, v]) => `${k} ${v}`);
      if (level.coverage) stats.push(`area ${level.coverage}`);
      return {
        pos: world.centerOf(s),
        height: 0.5,
        lines: [`${codeOf(s)} · ${level.name} · L${s.level}`, ...(stats.length ? [stats.join(' · ')] : [])],
      };
    }
    const exit = world.roadExits().find((e) => e.node === node);
    if (exit) return { pos: world.grid.xy(node), height: 0.1, lines: [`EXIT ${compass(exit.dir)} · ${world.grid.xy(node).join(',')}`] };
    if (world.hasRoad(node)) {
      return { pos: world.grid.xy(node), height: 0.1, lines: [`RD ${world.grid.xy(node).join(',')} · ${world.roads.degree(node)}-way`] };
    }
    return null;
  }

  // Leader line from a point up and to the right, then a label.
  tag(kit, [x, y], lines, height) {
    const z = this.camera.zoom;
    const k = this.pixelScale ? Math.max(1, (7 * this.pixelScale) / 9) : 1;
    const [sx, sy] = this.camera.project(x, y, height);
    const [ex, ey] = [sx + (16 * k) / z, sy - (22 * k) / z];
    const size = (9 * k) / z;
    const text = lines
      .map((l, i) => `<text class="tag" x="${r2(ex + 5 / z)}" y="${r2(ey + i * size * 1.35)}" font-size="${r2(size)}">${esc(l)}</text>`)
      .join('');
    return `<path class="tag-line" d="M${r2(sx)} ${r2(sy)}L${r2(ex)} ${r2(ey)}L${r2(ex + 4 / z)} ${r2(ey)}"/>` +
      `<circle class="tag-dot" cx="${r2(sx)}" cy="${r2(sy)}" r="${r2(1.6 / z)}"/>${text}`;
  }
}

export function compass([dx, dy]) {
  return dx < 0 ? 'W' : dx > 0 ? 'E' : dy < 0 ? 'N' : 'S';
}
