// Small line drawings for the Build menu. Buildings are drawn with their own
// draw() through the same Painter as the map (level 2, fixed seed), so the
// icons always match what gets built; lines and the eraser are hand drawn.

import { Camera } from '../render/camera.js';
import { Painter } from '../render/painter.js';
import { levelOf, drawSeed } from '../../structures/index.js';

const ICON_SEED = 12345;
const PAD = 3;

// Drawn once per structure id, then reused.
const cache = new Map();

// A scratch <svg> for measuring drawings (getBBox needs them in the page).
let measure = null;
function measureSvg() {
  if (!measure) {
    measure = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    measure.setAttribute('class', 'icon-measure');
    measure.style.cssText = 'position:absolute;left:-9999px;top:0;width:10px;height:10px;visibility:hidden';
    document.body.appendChild(measure);
  }
  return measure;
}

export function structureIcon(def, zScale = 0.9) {
  if (cache.has(def.id)) return cache.get(def.id);
  let body = '';
  try {
    const camera = new Camera({ width: 1, height: 1 }, { tile: 32, zScale });
    camera.cx = camera.cy = 0;
    const level = Math.min(2, def.levels.length);
    const instance = { id: -1, type: def.id, node: 0, rotation: 0, level, seed: ICON_SEED, data: {} };
    const g = new Painter(camera, { x: 0, y: 0, z: 0 }, 0, drawSeed(instance));
    if (def.site) {
      // a lot just around the footprint, no roads
      const xs = def.footprint.map((p) => p[0]), ys = def.footprint.map((p) => p[1]);
      const [x0, y0, x1, y1] = [Math.min(...xs) - 0.45, Math.min(...ys) - 0.45, Math.max(...xs) + 0.45, Math.max(...ys) + 0.45];
      g.setSite([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      g.setSitePaths({ hubPos: [(x0 + x1) / 2, (y0 + y1) / 2], exits: [] });
    }
    levelOf(def, instance).draw(g, instance);
    body = g.toGroundSVG() + g.toSVG();
  } catch (err) {
    console.warn(`No icon for ${def.id}`, err);
  }
  const svg = fit(`<g class="icon-art">${body}</g>`);
  cache.set(def.id, svg);
  return svg;
}

// Wrap a drawing in an <svg> whose viewBox hugs it.
function fit(inner) {
  const m = measureSvg();
  m.innerHTML = inner;
  let box = { x: -16, y: -16, width: 32, height: 32 };
  try {
    const b = m.firstChild.getBBox();
    if (b.width && b.height) box = b;
  } catch { /* not measurable: keep the default */ }
  m.innerHTML = '';
  const size = Math.max(box.width, box.height) + PAD * 2;
  const x = box.x + box.width / 2 - size / 2, y = box.y + box.height / 2 - size / 2;
  return `<svg class="icon lod-1" viewBox="${x.toFixed(1)} ${y.toFixed(1)} ${size.toFixed(1)} ${size.toFixed(1)}" aria-hidden="true">${inner}</svg>`;
}

// Hand-drawn icons in isometric directions, on a 32×32 box.
const LINES = {
  road: '<path class="i-road" d="M4 22 L16 15 L28 22"/>',
  path: '<path class="i-path" d="M4 22 L16 15 L28 22"/>',
  // the map symbol: a solid line with dashes of the background inside
  rail: '<path class="i-rail" d="M4 22 L16 15 L28 22"/><path class="i-rail-dash" d="M4 22 L16 15 L28 22"/>',
  // an eraser, tilted, with its rubber tip and the smudge it leaves
  bulldoze: '<path class="i-eraser" d="M6 22 L20.1 7.9 L26.5 14.3 L12.4 28.4 Z M10.9 17.1 L17.3 23.5"/><path class="i-smudge" d="M16 29 H28"/>',
};

export function toolIcon(tool) {
  if (tool.defs) return structureIcon(tool.defs[0]);
  const art = LINES[tool.id];
  return art ? `<svg class="icon" viewBox="0 0 32 32" aria-hidden="true">${art}</svg>` : '<svg class="icon" viewBox="0 0 32 32"></svg>';
}
