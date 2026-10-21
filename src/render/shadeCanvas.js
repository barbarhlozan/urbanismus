// The shadows on canvases of their own, in #view over the map's linework
// and under the night, the people and the buildings. They are still made
// as before – one mask of every object's shadow and the hills' over a
// sheet of the paper's strokes (Renderer, layer 'shadows') – but the
// browser never paints that mask: it would draw the whole sheet through
// it again whenever any shape in it changed (a building redrawn, a turn's
// step, the lamps), the dearest thing on the map. These canvases read the
// same shapes and have them drawn (shadeWorker.js, off the page's thread),
// only when they or the view change.
//
// Two of them, so that what changes often costs nothing to show or hide:
// the hills' shadows (`part` 'hills'), and the objects' ('objects') over
// them, leaving out where a hill's shadow already lies – the same strokes
// either way, so where a tree stands in a hill's shadow the two are one.
// Both leave out the lamps' pools. Each is drawn for the view the map's
// SVGs were last drawn at, as large as they are (with the overscan,
// Renderer.placeView), and sits in their wrapper, so while the camera
// moves it is moved on the GPU with them; until a new drawing comes back
// the last one is moved to where it belongs (place). While the view turns
// the hills' is drawn again as fast as it can be, at the angle reached;
// the objects' is hidden (both by the Renderer).
//
//   new ShadeCanvas(canvas, veil, part)   veil: the shadows' <g> (its mask)
//   draw({ view, hatch, tier, px, stroke, sheet, hold })   each frame: sent to be drawn when changed
//   place(view, sheet)                    each frame: where the drawing shows
//   current                               the drawing shown is the one last asked for

import { THEME } from '../theme.js';

// Where each part's shapes are in the mask, and what is rubbed out of them.
const PARTS = {
  hills: { draw: ['hill-shapes'], cut: ['lights-cut'] },
  objects: { draw: ['shade-shapes'], cut: ['hill-shapes', 'lights-cut'] },
};

// One worker draws for both, each drawing sent back to its canvas.
let worker = null;
const waiting = new Map(); // part -> ShadeCanvas
function workerFor(part, canvas) {
  waiting.set(part, canvas);
  if (!worker) {
    worker = new Worker(new URL('./shadeWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => waiting.get(data.part)?.shown(data);
  }
  return worker;
}

export class ShadeCanvas {
  constructor(canvas, veil, part) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('bitmaprenderer');
    this.veil = veil;
    this.name = part;
    this.part = PARTS[part];
    this.worker = workerFor(part, this);
    this.dirty = true;
    this.key = null;       // the drawing last asked for…
    this.shownKey = null;  // …and the one shown
    this.views = new Map(); // key -> the view it was asked for at
    this.shownView = null;
    this.placed = '';
    // any change to its shapes (an object's shadow drawn anew, the lamps,
    // a turn moving the hills' and the lamps', a sun sweeping over: the
    // sheet's old copy put beside it)
    const mine = [...this.part.draw, ...this.part.cut];
    const touches = (r) => {
      for (let n = r.target; n && n !== veil; n = n.parentNode) {
        if (n.classList && mine.some((c) => n.classList.contains(c))) return true;
        if (n.tagName === 'mask') return false; // (another part's group)
      }
      return true; // the mask or above it
    };
    new MutationObserver((records) => {
      if (!this.dirty && records.some(touches)) this.dirty = true;
    }).observe(veil, { subtree: true, childList: true, attributes: true });
    new MutationObserver(() => (this.dirty = true)).observe(veil.parentNode, { childList: true });
    // the paper's own: SVG doesn't paint it any more
    for (const rect of veil.querySelectorAll('.shade-veil')) rect.style.display = 'none';
  }

  get current() {
    return !this.dirty && this.shownKey === this.key;
  }

  // `view`: what the SVGs were drawn at ({ zoom, panX, panY } and the
  // wrapper's size and overscan, ox, oy, W, H, in window px); `hatch`,
  // `tier`, `px`, `stroke`: the paper's strokes as the shadows' tile has
  // them (Renderer.renderShadeTiles); `sheet`: mid-turn, the ground's turn
  // as a sheet, in the wrapper's px (Renderer.turnFrame), the shapes
  // turned with it in the mask, the strokes not. Held (`hold`: hidden), it
  // waits.
  draw({ view, hatch, tier, px, stroke, sheet = null, hold = false }) {
    const dpr = devicePixelRatio || 1;
    const w = Math.round((view.W + 2 * view.ox) * dpr), h = Math.round((view.H + 2 * view.oy) * dpr);
    const colour = THEME.palette.detail;
    const key = `${view.zoom}|${view.panX}|${view.panY}|${view.angle}|${w}|${h}|${tier}|${JSON.stringify(hatch)}|${px}|${stroke}|${colour}`;
    if (hold || (!this.dirty && key === this.key)) return;
    // (the same key once its shapes changed: told apart)
    this.key = key === this.key || this.views.has(key) ? `${key}|${(this.n = (this.n ?? 0) + 1)}` : key;
    this.dirty = false;
    this.views.set(this.key, { view, sheet });
    const base = new DOMMatrix([dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * (view.panX + view.ox), dpr * (view.panY + view.oy)]);
    const sheets = [];
    if (hatch) {
      // the sheet, and mid-sweep its copy as the sun was (first: under the new)
      for (const g of this.veil.parentNode.children) {
        if (g !== this.veil && !g.classList.contains('layer-shadows')) continue;
        const mask = g.querySelector('mask');
        if (!mask) continue;
        const shapes = [];
        for (const cls of this.part.draw) for (const el of mask.getElementsByClassName(cls)) collect(el, base, 1, false, shapes);
        for (const cls of this.part.cut) for (const el of mask.getElementsByClassName(cls)) collect(el, base, 1, true, shapes);
        sheets.push({ clip: clipOf(g), shapes });
      }
    }
    const pen = this.pen ??= parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pen-2')) || 0.7;
    this.worker.postMessage({
      part: this.name, key: this.key, w, h, base: [base.a, base.b, base.c, base.d, base.e, base.f], angle: hatch?.angle ?? 0, sheets,
      // the paper's strokes with the shadows' pen (.shade-line in the SVG
      // tile: --pen-2 times --stroke), drawn at a quarter of a doubling's steps
      tile: hatch && { tier, hatch: JSON.stringify(hatch), px, width: pen * stroke, q: 2 ** (Math.round(Math.log2(dpr * view.zoom) * 4) / 4), colour },
    });
  }

  // A drawing back from the worker: shown, and where it belongs (place).
  shown({ key, bitmap }) {
    const asked = this.views.get(key);
    // (older than the one shown: not wanted)
    const order = [...this.views.keys()];
    if (!asked || (this.shownKey && order.indexOf(key) < order.indexOf(this.shownKey))) {
      bitmap.close();
      return;
    }
    for (const k of order) {
      if (k === key) break;
      this.views.delete(k);
    }
    this.ctx.transferFromImageBitmap(bitmap);
    this.shownKey = key;
    this.shownView = asked.view;
    this.shownSheet = asked.sheet;
    if (this.lastPlace) this.place(...this.lastPlace);
  }

  // The drawing where it shows, until the one for now comes back: drawn at
  // `shownView` (and mid-turn turned by `shownSheet`), moved to `view` (the
  // view the SVGs are drawn at now) and turned to `sheet` (the turn now, a
  // DOMMatrix in the wrapper's px) – the last hair of a turn its strokes
  // turn too.
  place(view, sheet = null) {
    this.lastPlace = [view, sheet];
    const s = this.shownView;
    let m = sheet ? DOMMatrix.fromMatrix(sheet) : new DOMMatrix();
    if (s && (s.zoom !== view.zoom || s.panX !== view.panX || s.panY !== view.panY || s.ox !== view.ox || s.oy !== view.oy)) {
      const k = view.zoom / s.zoom;
      m = m.translate(view.panX + view.ox - k * (s.panX + s.ox), view.panY + view.oy - k * (s.panY + s.oy)).scale(k);
    }
    // (turned from the view it was drawn at, unless that is a view gone:
    // the turn rested, and the view it rested at is the sheet as turned)
    if (this.shownSheet && s.angle === view.angle) m = m.multiply(this.shownSheet.inverse());
    const t = m.isIdentity ? '' : m.toString();
    if (t === this.placed) return;
    this.placed = t;
    this.canvas.style.transform = t;
  }
}

// An element's shapes as the worker draws them – each element's transform
// and opacity, those not displayed left out: [kind ('shape', 'line'),
// path data, matrix, alpha, cut, evenodd].
function collect(el, m, alpha, cut, out) {
  if (el.style?.display === 'none') return;
  const t = el.transform?.baseVal;
  if (t?.numberOfItems) {
    const { a, b, c, d, e, f } = t.consolidate().matrix;
    m = m.multiply(new DOMMatrix([a, b, c, d, e, f]));
  }
  if (el.style?.opacity) alpha *= parseFloat(el.style.opacity);
  if (alpha <= 0) return;
  if (el.tagName !== 'path') {
    for (const child of el.children) collect(child, m, alpha, cut, out);
    return;
  }
  const d = el.getAttribute('d');
  if (!d) return;
  out.push([el.classList.contains('shade-line') ? 'line' : 'shape', d, [m.a, m.b, m.c, m.d, m.e, m.f], alpha, cut, el.getAttribute('fill-rule') === 'evenodd']);
}

// A sheet's clip (the sun's front, mid-sweep): its <clipPath>'s path data.
function clipOf(g) {
  const id = g.getAttribute('clip-path')?.match(/url\(#([^)]+)\)/)?.[1];
  return (id && document.getElementById(id)?.querySelector('path')?.getAttribute('d')) || null;
}
