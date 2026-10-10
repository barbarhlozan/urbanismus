// Small line drawings for the Build menu. Buildings are drawn with their own
// draw() through the same Painter as the map (with a fixed seed), so the
// icons always match what gets built; lines and the eraser are hand drawn.

import { Camera } from '../render/camera.js';
import { Painter } from '../render/painter.js';
import { vehicleSVG } from '../render/vehicles.js';
import { drawSeed, footprintOffsets } from '../../structures/index.js';
import { sampleSitePaths } from '../roads/siteWalks.js';

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

// How many ways into a park or square drawn on its own: two (a walkway
// across) for the icons, a mix on the Assets page.
const ways = (seed) => (seed === ICON_SEED ? 2 : [2, 1, 3, 4, 0][seed % 5]);

// The structure's drawing (ground + solids) as SVG markup, on its own.
function paint(def, seed, camera) {
  try {
    camera.cx = camera.cy = 0;
    // facing the viewer, as they come when picked up (tools/build.js)
    const rotation = camera.facingViewer();
    const instance = { id: -1, type: def.id, node: 0, rotation, seed, data: {} };
    const g = new Painter(camera, { x: 0, y: 0, z: 0 }, rotation, drawSeed(instance));
    if (def.site) {
      // a lot just around the footprint, no roads
      const offs = footprintOffsets(def, rotation);
      const xs = offs.map((p) => p[0]), ys = offs.map((p) => p[1]);
      const [x0, y0, x1, y1] = [Math.min(...xs) - 0.45, Math.min(...ys) - 0.45, Math.max(...xs) + 0.45, Math.max(...ys) + 0.45];
      g.setSite([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      g.setSitePaths(sampleSitePaths([x0, y0, x1, y1], ways(seed), { bend: seed !== ICON_SEED && seed % 2 === 1 }));
    }
    def.draw(g, instance);
    return g.toGroundSVG() + g.toSVG();
  } catch (err) {
    console.warn(`Can't draw ${def.id}`, err);
    return '';
  }
}

export function structureIcon(def, { seed = ICON_SEED } = {}) {
  const key = `${def.id}:${seed}`;
  if (cache.has(key)) return cache.get(key);
  const body = paint(def, seed, new Camera({ width: 1, height: 1 }, { tile: 32, zScale: 0.9 }));
  const svg = fit(`<g class="icon-art">${body}</g>`, 'icon lod-1', PAD);
  cache.set(key, svg);
  return svg;
}

// The same drawing close up in the map's own style (as gallery.html), not
// the simplified icon line style.
export function structureDrawing(def, { seed = ICON_SEED } = {}) {
  const body = paint(def, seed, new Camera({ width: 1, height: 1 }, { tile: 64 }));
  return fit(`<g class="scene layer-objects lod-0">${body}</g>`, 'drawing', 8);
}

// Vehicle models (src/render/vehicles.js) close up. `parts`: [{ name,
// heading, hand, at: [x, y] }] – one model, or coupled ones such as a cab and
// its trailer – placed in grid units and drawn back to front.
export function vehicleDrawing(parts) {
  const camera = new Camera({ width: 1, height: 1 }, { tile: 64 });
  camera.cx = camera.cy = 0;
  const body = [...parts]
    .sort((a, b) => camera.depth(...a.at) - camera.depth(...b.at))
    .map(({ name, heading, hand, at }) => {
      const [sx, sy] = camera.project(...at);
      return `<g transform="translate(${sx.toFixed(2)} ${sy.toFixed(2)})">${vehicleSVG(camera, name, heading, hand)}</g>`;
    })
    .join('');
  return fit(`<g class="scene"><g class="agent car">${body}</g></g>`, 'drawing', 4);
}

// Wrap a drawing in an <svg> whose viewBox hugs it.
function fit(inner, cls, pad) {
  const m = measureSvg();
  m.innerHTML = inner;
  let box = { x: -16, y: -16, width: 32, height: 32 };
  try {
    const b = m.firstChild.getBBox();
    if (b.width && b.height) box = b;
  } catch { /* not measurable: keep the default */ }
  m.innerHTML = '';
  const size = Math.max(box.width, box.height) + pad * 2;
  const x = box.x + box.width / 2 - size / 2, y = box.y + box.height / 2 - size / 2;
  return `<svg class="${cls}" viewBox="${x.toFixed(1)} ${y.toFixed(1)} ${size.toFixed(1)} ${size.toFixed(1)}" aria-hidden="true">${inner}</svg>`;
}

// Hand-drawn icons in isometric directions, on a 32×32 box.
const LINES = {
  road: '<path class="i-road" d="M4 22 L16 15 L28 22"/>',
  lane: '<path class="i-lane" d="M4 22 L16 15 L28 22"/>',
  path: '<path class="i-path" d="M4 22 L16 15 L28 22"/>',
  // the map symbol: a solid line with dashes of the background inside
  rail: '<path class="i-rail" d="M4 22 L16 15 L28 22"/><path class="i-rail-dash" d="M4 22 L16 15 L28 22"/>',
  fence: '<path class="i-fence" d="M4 17 L16 10 L28 17 M4 17 V23 M7 15.2 V21.2 M10 13.5 V19.5 M13 11.8 V17.8 M16 10 V16 M19 11.8 V17.8 M22 13.5 V19.5 M25 15.2 V21.2 M28 17 V23"/>',
  // an eraser, tilted, with its rubber tip and the smudge it leaves
  bulldoze: '<path class="i-eraser" d="M6 22 L20.1 7.9 L26.5 14.3 L12.4 28.4 Z M10.9 17.1 L17.3 23.5"/><path class="i-smudge" d="M16 29 H28"/>',
};

export function toolIcon(tool) {
  if (tool.defs) return structureIcon(tool.defs[0]);
  const art = LINES[tool.id];
  return art ? `<svg class="icon" viewBox="0 0 32 32" aria-hidden="true">${art}</svg>` : '<svg class="icon" viewBox="0 0 32 32"></svg>';
}

// Little pen drawings for the HUD's numbers, on a 16×16 box.
const STATS = {
  residents: '<circle cx="6" cy="5" r="2"/><path d="M2.5 13 C2.5 9 9.5 9 9.5 13"/><circle cx="11.2" cy="5.8" r="1.6"/><path d="M10.4 9.3 C12.6 8.9 14 10.4 14 13"/>',
  jobs: '<path d="M2 6.2 H14 V13.2 H2 Z M6 6.2 V4 H10 V6.2 M2 9.2 H14"/>',
  buildings: '<path d="M2.5 8 L8 3 L13.5 8 M4 6.7 V13 H12 V6.7 M7 13 V10 H9 V13"/>',
  cutoff: '<path d="M1.5 12.5 L5.5 8.5 M10.5 7.5 L14.5 3.5 M7 5.5 L7.6 3.2 M9 10.5 L8.4 12.8 M5.4 5.6 L3.6 4.6 M10.6 10.4 L12.4 11.4"/>',
  walk: '<circle cx="9" cy="2.8" r="1.4"/><path d="M8.6 5 L7.6 9.4 L5.2 13.2 M7.6 9.4 L10.2 13.2 M8.3 6.4 L5.8 8.2 M8.3 6.4 L10.9 8.4"/>',
  cycle: '<circle cx="4" cy="11" r="2.7"/><circle cx="12" cy="11" r="2.7"/><path d="M4 11 L6.8 6.6 L11 6.6 L12 11 M6.8 6.6 L8.4 11 L11 6.6 M5.8 5.4 H7.8 M11 6.6 L10.6 4.6 H12"/>',
  drive: '<path d="M1.5 11.5 V9 L3.6 8.4 L5.6 5.5 H10.4 L12.4 8.4 L14.5 9 V11.5 Z M5.6 8.4 H12.4"/><circle cx="4.6" cy="11.6" r="1.4"/><circle cx="11.4" cy="11.6" r="1.4"/>',
  truck: '<path d="M1.5 11.5 V4.5 H9.5 V11.5 Z M9.5 7 H12.5 L14.5 9.4 V11.5 H9.5"/><circle cx="4.4" cy="11.6" r="1.4"/><circle cx="11.8" cy="11.6" r="1.4"/>',
  bus: '<path d="M1.5 11.5 V4 H14.5 V11.5 Z M1.5 7.5 H14.5 M5 4 V7.5 M8.5 4 V7.5 M12 4 V7.5"/><circle cx="4.6" cy="11.6" r="1.4"/><circle cx="11.4" cy="11.6" r="1.4"/>',
  // a service area: a dotted ring round a dot
  area: '<circle cx="8" cy="8" r="1.2"/><path d="M8 2.5 A5.5 5.5 0 0 1 8 13.5 A5.5 5.5 0 0 1 8 2.5" stroke-dasharray="1.6 1.9"/>',
  book: '<path d="M8 4.2 C6.2 3 4 2.8 1.8 3.2 V12.8 C4 12.4 6.2 12.6 8 13.8 C9.8 12.6 12 12.4 14.2 12.8 V3.2 C12 2.8 9.8 3 8 4.2 Z M8 4.2 V13.8 M3.6 6 C4.8 5.8 5.8 6 6.6 6.4 M3.6 8.4 C4.8 8.2 5.8 8.4 6.6 8.8"/>',
  pen: '<path d="M3 13 L3.6 10.4 L10.8 3.2 L12.8 5.2 L5.6 12.4 Z M9.6 4.4 L11.6 6.4"/>',
  fair: '<circle cx="8" cy="8" r="2.6"/><path d="M8 2 V3.6 M8 12.4 V14 M2 8 H3.6 M12.4 8 H14 M3.8 3.8 L4.9 4.9 M11.1 11.1 L12.2 12.2 M12.2 3.8 L11.1 4.9 M4.9 11.1 L3.8 12.2"/>',
  cloudy: '<circle cx="5.2" cy="5.2" r="1.8"/><path d="M5.2 1.4 V2.4 M1.4 5.2 H2.4 M2.5 2.5 L3.2 3.2 M7.9 2.5 L7.2 3.2 M5 13.5 H12 A2.4 2.4 0 0 0 12 8.7 A3.4 3.4 0 0 0 6 9.6 A2 2 0 0 0 5 13.5 Z"/>',
  rain: '<path d="M4 9.5 H12 A2.4 2.4 0 0 0 12 4.8 A3.6 3.6 0 0 0 5.2 5.7 A1.9 1.9 0 0 0 4 9.5 Z M5.5 11.5 L4.7 13.8 M8.5 11.5 L7.7 13.8 M11.5 11.5 L10.7 13.8"/>',
  storm: '<path d="M4 9.5 H12 A2.4 2.4 0 0 0 12 4.8 A3.6 3.6 0 0 0 5.2 5.7 A1.9 1.9 0 0 0 4 9.5 Z M8.6 9.5 L7 12 H9 L7.6 14.6 M4.9 11.2 L4.1 13.6 M12 11.2 L11.2 13.6"/>',
};

export function statIcon(id) {
  return `<svg class="icon stat-icon" viewBox="0 0 16 16" aria-hidden="true">${STATS[id] ?? ''}</svg>`;
}

// Pen drawings for the buttons in the top-right bar, on a 16×16 box.
const CONTROLS = {
  photo: '<path d="M2 5.5 H5 L6.2 3.6 H9.8 L11 5.5 H14 V12.6 H2 Z"/><circle cx="8" cy="9" r="2.3"/>',
  // little hills: a tall one behind, a low one in front, on the ground line
  terrain: '<path d="M5 12.5 C7 5.5 10.5 4 13.8 12.5 M1.8 12.5 C3.4 8.6 6.4 8.2 8.6 12.5 M1 12.5 H15"/>',
  assets: '<path d="M2.5 2.5 H7 V7 H2.5 Z M9 2.5 H13.5 V7 H9 Z M2.5 9 H7 V13.5 H2.5 Z M9 9 H13.5 V13.5 H9 Z"/>',
  debug: '<path d="M5.5 6.6 C5.5 3.8 10.5 3.8 10.5 6.6 V10 C10.5 13.6 5.5 13.6 5.5 10 Z M8 6.6 V13.2 M5.5 8.2 H2.6 M10.5 8.2 H13.4 M5.5 10.8 L3.2 12.6 M10.5 10.8 L12.8 12.6 M6.4 4.8 L4.6 2.8 M9.6 4.8 L11.4 2.8"/>',
  export: '<path d="M8 2.5 V10 M5 7 L8 10 L11 7 M2.5 10.5 V13.5 H13.5 V10.5"/>',
  import: '<path d="M8 10 V2.5 M5 5.5 L8 2.5 L11 5.5 M2.5 10.5 V13.5 H13.5 V10.5"/>',
  // for the New map settings: a pond with ripples, a pine, a river's two banks
  lakes: '<path d="M1.8 9.6 C1.8 6.2 14.2 6.2 14.2 9.6 C14.2 13 1.8 13 1.8 9.6 Z M5.2 9.4 H7.8 M9.4 10.6 H11.2"/>',
  forest: '<path d="M8 1.8 L4.4 7 H6.4 L3.4 11.2 H12.6 L9.6 7 H11.6 Z M8 11.2 V14.2"/>',
  river: '<path d="M1.5 5.2 C4 3.6 6 6.8 8.5 5.2 C11 3.6 12.5 6.4 14.5 5.2 M1.5 10.2 C4 8.6 6 11.8 8.5 10.2 C11 8.6 12.5 11.4 14.5 10.2"/>',
  // four corners pointing out (go full screen), or in (come back); the
  // button shows one or the other (styles.css)
  fullscreen: '<path class="fs-enter" d="M2.5 6 V2.5 H6 M10 2.5 H13.5 V6 M13.5 10 V13.5 H10 M6 13.5 H2.5 V10"/><path class="fs-exit" d="M6 2.5 V6 H2.5 M13.5 6 H10 V2.5 M10 13.5 V10 H13.5 M2.5 10 H6 V13.5"/>',
  // a folded map, and a plus: a new one
  // a speech bubble: the language
  language: '<path d="M2.5 3 H13.5 V10.5 H7.2 L4.4 13.2 V10.5 H2.5 Z M5 6.8 H11"/>',
  newMap: '<path d="M1.5 4 L5 2.5 L8.5 4 L12 2.5 V8 M1.5 4 V12.5 L5 11 L8.5 12.5 M5 2.5 V11 M8.5 4 V12.5 M12.5 10 V15 M10 12.5 H15"/>',
};

// A top-bar icon's drawing on its 16×16 box, without the <svg> (e.g. the
// photographer's camera on the map, render/overlay.js).
export function controlArt(id) {
  return CONTROLS[id] ?? '';
}

export function controlIcon(id) {
  return `<svg class="icon ctl-icon" viewBox="0 0 16 16" aria-hidden="true">${CONTROLS[id] ?? ''}</svg>`;
}
