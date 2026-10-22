// The night drawn with WebGL2 (gl/hatching.js): a grey and up to three sets
// of the paper's strokes, each hatched in band by band as it comes, and
// the lights left out of it. On the ground (under what moves) the lamps'
// pools, the windows' light spilt on the ground and the beams ahead of
// what moves are left out; over the objects the night lies only on them –
// their outlines from the furthest to the nearest, each with its own lit
// windows and lamp heads left out after it, so a house hides the windows
// behind it. Which is which goes into a mask, drawn in that order, and the
// night is drawn through it.
//
// A canvas in the map's wrapper (as gl/shadows.js), drawn for the view the
// SVGs were last drawn at, every frame something changes – the beams move
// every frame – which costs the GPU a full-canvas pass and nothing more.
//
//   const n = GLNight.make(canvas)          (null without WebGL2)
//   n.draw(view, { grey, colour, tier, reveal, hatch, px, stroke, lights, sheet, beams })   on the ground
//   n.draw(view, { …, cover })              over the objects

import { THEME } from '../../theme.js';
import { hatchFrame } from '../hatch.js';
import { Hatching, Pieces, meshOf, rgb } from './hatching.js';

// The night's grey in steps (each a new picture); how far the third set of
// strokes is turned from the first (degrees); the sweep's bands (css px).
const GREY_STEP = 0.02;
const CROSS = -68;
const BAND = 22;
const ID = [1, 0, 0, 1, 0, 0];

export class GLNight {
  static make(canvas) {
    const h = Hatching.make(canvas);
    return h ? new GLNight(h) : null;
  }

  constructor(h) {
    this.h = h;
    this.canvas = h.canvas;
    this.maskBuf = h.buffer();
        this.drawnKey = null;
    this.empty = true;
  }

  // One frame. `view`: the SVGs' drawn view and wrapper ({ zoom, panX,
  // panY, ox, oy, W, H }); `grey` how much of it in `colour`; `tier` the
  // densest of the paper's lines (-1: none); `reveal` how much of each set
  // is laid; `hatch`, `px`, `stroke` the paper's strokes. On the ground:
  // `lights` path data in scene px ([d…]), turned by `sheet` (a DOMMatrix,
  // mid-turn); `beams` polygons in scene px. Over the objects: `cover`,
  // [[light?, d]…] from the furthest to the nearest.
  draw(view, { grey = 0, colour, tier = -1, reveal = [1, 0, 0], hatch, px, stroke, lights = null, sheet = null, beams = [], cover = null }) {
    const { h } = this;
    const dpr = devicePixelRatio || 1;
    const w = Math.round((view.W + 2 * view.ox) * dpr), hgt = Math.round((view.H + 2 * view.oy) * dpr);
    const on = grey > 0.002 || (tier >= 0 && reveal.some((r) => r > 0));
    if (!on) {
      if (!this.empty) {
        h.size(w, hgt);
        h.clear();
        this.empty = true;
      }
      this.drawnKey = null;
      return;
    }
    grey = Math.round(grey / GREY_STEP) * GREY_STEP;
    const base = [dpr * view.zoom, dpr * (view.panX + view.ox), dpr * (view.panY + view.oy)];
    // the mask: what is left out, in order
    const sheetM = sheet ? [sheet.a, sheet.b, sheet.c, sheet.d, sheet.e, sheet.f] : ID;
    const beamsKey = cover ? '' : JSON.stringify(beams);
    const resized = this.h.canvas.width !== w || this.h.canvas.height !== hgt;
    h.size(w, hgt);
    const was = this.masked ?? {};
    const shapesChanged = resized || cover !== was.cover || lights !== was.lights || `${sheetM}` !== was.sheet;
    const maskChanged = shapesChanged || beamsKey !== was.beams || `${base}` !== was.base;
    if (maskChanged) {
      this.masked = { cover, lights, sheet: `${sheetM}`, beams: beamsKey, base: `${base}` };
      // (the lights kept until they change, the beams laid every time)
      if (shapesChanged) {
        const p = new Pieces();
        if (cover) for (const [light, d] of cover) p.shape(meshOf(light ? 'shape' : 'fill', d), ID, 1, 0, light ? 0 : 1);
        else for (const d of lights ?? []) p.shape(meshOf('shape', d), sheetM, 1, 0, 0);
        h.load(this.maskBuf, p);
      }
      const b = new Pieces();
      for (const poly of cover ? [] : beams) b.shape(meshOf('shape', `M${poly.map(([x, y]) => `${x} ${y}`).join('L')}Z`, false, false), ID, 1, 0, 0);
      h.load((this.beamBuf ??= h.buffer()), b);
      h.mask([this.maskBuf, this.beamBuf], base, cover ? 0 : 1);
    }
    const pen = (this.pen ??= parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pen-1')) || 0.5);
    const q = 2 ** (Math.round(Math.log2(dpr * view.zoom) * 4) / 4);
    const ink = THEME.palette.detail;
    const look = `${base}|${w}|${hgt}|${grey}|${colour}|${ink}|${tier}|${reveal}|${JSON.stringify(hatch)}|${px}|${stroke}|${q}`;
    if (!maskChanged && look === this.drawnKey) return;
    this.drawnKey = look;
    this.empty = false;
    h.clear();
    const tile = tier >= 0 && hatch ? h.tile(tier, hatch, px, pen * stroke, q) : null;
    const gap = hatch ? hatchFrame(hatch).gap * px : 0;
    const a = hatch?.angle ?? 0;
    h.sheet({
      base, tile, grey, greyColour: colour, colour: rgb(ink),
      sets: [[a, 0, 0], [a, 3.7 * px, gap / 2], [a + CROSS, 1.3 * px, gap / 3]],
      reveal, band: BAND * dpr, masked: true,
    });
  }
}
