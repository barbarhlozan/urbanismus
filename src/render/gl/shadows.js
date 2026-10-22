// The shadows drawn with WebGL2 (gl/hatching.js) instead of on the two 2D
// canvases (shadeCanvas.js), from the same shapes: the shadows' mask in
// the map's SVG – the hills' shadows, the objects', the lamps' pools left
// out, and mid-sweep (Renderer.sweepShadows) the sheet as the sun was
// beside it, each clipped to its side of the front. One canvas in the
// map's wrapper, drawn for the view the SVGs were last drawn at (as
// gl/lines.js), at once: no worker, nothing copied to the GPU but the
// shapes when they change.
//
// The objects' shadows can be held (not read again while the view turns),
// faded (`shown`, as they are hatched in again once the view rests) or
// hidden; the hills' are read again whenever their shapes change – every
// frame of a turn.
//
//   const s = GLShadows.make(canvas, veil)     (null without WebGL2)
//   s.draw({ view, hatch, tier, px, stroke, hold, shown })   each frame
//   s.current                                   drawn as last asked

import { THEME } from '../../theme.js';
import { collect, clipOf } from '../shadeCanvas.js';
import { Hatching, Pieces, meshOf, rgb } from './hatching.js';

// Where each part's shapes are in the mask (and the lamps' pools, cut out
// of both, read with the hills').
const PARTS = { hills: ['hill-shapes', 'lights-cut'], objects: ['shade-shapes'] };
const ID = [1, 0, 0, 1, 0, 0];

export class GLShadows {
  static make(canvas, veil) {
    const h = Hatching.make(canvas);
    return h ? new GLShadows(h, veil) : null;
  }

  constructor(h, veil) {
    this.h = h;
    this.canvas = h.canvas;
    this.veil = veil;
    this.dirty = { hills: true, objects: true };
    this.sheets = []; // [{ clip, cuts, hills, objects }] buffers
    this.free = [];   // buffers no longer used
    this.drawnKey = null;
    for (const part of Object.keys(PARTS)) {
      const mine = PARTS[part];
      const touches = (r) => {
        for (let n = r.target; n && n !== veil; n = n.parentNode) {
          if (n.classList && mine.some((c) => n.classList.contains(c))) return true;
          if (n.tagName === 'mask') return false;
        }
        return true;
      };
      new MutationObserver((records) => {
        if (!this.dirty[part] && records.some(touches)) this.dirty[part] = true;
      }).observe(veil, { subtree: true, childList: true, attributes: true });
    }
    // (a sweep's copy put beside the sheet or taken away)
    new MutationObserver(() => (this.dirty.hills = this.dirty.objects = true)).observe(veil.parentNode, { childList: true });
  }

  get current() {
    return !this.dirty.hills && !this.dirty.objects && this.drawnKey != null;
  }

  // The masks' groups: the sheet, and mid-sweep its copy as the sun was
  // (first: under the new).
  groups() {
    const out = [];
    for (const g of this.veil.parentNode.children) {
      if (g !== this.veil && !g.classList.contains('layer-shadows')) continue;
      const mask = g.querySelector('mask');
      if (mask) out.push({ g, mask });
    }
    return out;
  }

  buffer() {
    return this.free.pop() ?? this.h.buffer();
  }

  // The shapes of `cls` in a mask as pieces (in scene px), into `b`.
  read(mask, classes, b, group) {
    const shapes = [];
    for (const cls of classes) for (const el of mask.getElementsByClassName(cls)) collect(el, new DOMMatrix(), 1, cls === 'lights-cut', shapes);
    const p = new Pieces(), cuts = new Pieces();
    for (const [kind, d, m, alpha, cut, evenodd] of shapes) (cut ? cuts : p).shape(meshOf(kind, d, evenodd), m, alpha, group);
    return { p, cuts };
  }

  // Each frame: `view` the SVGs' drawn view and wrapper ({ zoom, panX,
  // panY, ox, oy, W, H }), the paper's strokes (`hatch`, `tier`, `px`,
  // `stroke`), the objects' held (`hold`), faded (`shown` 0 … 1, 0 hidden).
  draw({ view, hatch, tier, px, stroke, hold = false, shown = 1 }) {
    const { h } = this;
    const dpr = devicePixelRatio || 1;
    const w = Math.round((view.W + 2 * view.ox) * dpr), hgt = Math.round((view.H + 2 * view.oy) * dpr);
    let changed = false;
    if (this.dirty.hills || (this.dirty.objects && !hold)) {
      const groups = this.groups();
      const readObjects = this.dirty.objects && !hold;
      groups.forEach(({ g, mask }, i) => {
        const s = (this.sheets[i] ??= {});
        if (this.dirty.hills) {
          const { p, cuts } = this.read(mask, PARTS.hills, null, 0);
          h.load((s.hills ??= this.buffer()), p);
          h.load((s.cuts ??= this.buffer()), cuts);
          const clip = clipOf(g);
          if (clip) {
            const c = new Pieces();
            c.shape(meshOf('fill', clip), ID);
            h.load((s.clip ??= this.buffer()), c);
          } else if (s.clip) {
            this.free.push(s.clip);
            s.clip = null;
          }
        }
        if (readObjects) h.load((s.objects ??= this.buffer()), this.read(mask, PARTS.objects, null, 1).p);
      });
      for (const s of this.sheets.splice(groups.length)) for (const b of Object.values(s)) if (b) this.free.push(b);
      this.dirty.hills = false;
      if (readObjects) this.dirty.objects = false;
      changed = true;
    }
    const pen = (this.pen ??= parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pen-2')) || 0.7);
    const q = 2 ** (Math.round(Math.log2(dpr * view.zoom) * 4) / 4);
    const colour = THEME.palette.detail;
    const key = `${view.zoom}|${view.panX}|${view.panY}|${view.ox}|${view.oy}|${w}|${hgt}|${tier}|${JSON.stringify(hatch)}|${px}|${stroke}|${q}|${colour}|${shown}`;
    if (!changed && key === this.drawnKey) return;
    this.drawnKey = key;
    h.size(w, hgt);
    h.clear();
    if (!hatch) return;
    const gl = h.gl;
    const tile = h.tile(tier, hatch, px, pen * stroke, q);
    const base = [dpr * view.zoom, dpr * (view.panX + view.ox), dpr * (view.panY + view.oy)];
    const look = { base, tile, colour: rgb(colour), alphas: [1, shown, 1, 1] };
    for (const s of this.sheets) {
      gl.stencilMask(0xff);
      gl.clear(gl.STENCIL_BUFFER_BIT);
      let ref = 0;
      if (s.clip) {
        h.pieces(s.clip, { base, stencil: { ref: 2, write: 2 } });
        ref = 2;
      }
      h.pieces(s.cuts, { base, stencil: { ref: 1, write: 1 } });
      const test = { ref, mask: 3 };
      h.pieces(s.hills, { ...look, test });
      if (shown > 0) h.pieces(s.objects, { ...look, test });
    }
  }
}
