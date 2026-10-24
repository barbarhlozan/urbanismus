// The shadows drawn with WebGL2 (gl/hatching.js) from their shapes: the
// shadows' mask in the map's SVG – the hills' shadows, the objects', the
// lamps' pools left out, and mid-sweep (Renderer.sweepShadows) the sheet as the sun was
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
import { Hatching, Pieces, meshOf, rgb, STRIDE, EDGE } from './hatching.js';
import { SUN } from '../shadows.js';

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
    this.kept = new WeakMap(); // an object's shadow group -> its pieces, kept until it changes
    this.changed = new Set();
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
        if (part === 'objects') for (const r of records) this.changedGroup(r.target);
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

  // The shapes of `classes` in a mask, into the buffers `b` (cuts: `cutB`).
  // Shapes all moved alike (a turn's sheet) are laid in their own px and
  // the matrix given with them – the same shapes again only move it.
  read(mask, classes, group, b, cutB) {
    const shapes = [];
    for (const cls of classes) for (const el of mask.getElementsByClassName(cls)) collect(el, new DOMMatrix(), 1, cls === 'lights-cut', shapes);
    for (const [buf, cut] of [[b, false], [cutB, true]]) {
      if (!buf) continue;
      const mine = shapes.filter((s) => s[4] === cut);
      const m0 = mine[0]?.[2];
      const alike = m0 && mine.every((s) => s[2].every((v, i) => v === m0[i]));
      const sig = mine.map((s) => `${s[0]}|${s[3]}|${s[5]}`);
      if (alike && buf.sig && buf.sig.length === mine.length && mine.every((s, i) => s[1] === buf.ds[i] && sig[i] === buf.sig[i])) {
        buf.pre = m0;
        continue;
      }
      const p = new Pieces();
      for (const [kind, d, m, alpha, , evenodd] of mine) p.shape(meshOf(kind, d, evenodd), alike ? ID : m, alpha, group);
      this.h.load(buf, p);
      buf.pre = alike ? m0 : null;
      buf.sig = alike ? sig : null;
      buf.ds = alike ? mine.map((s) => s[1]) : null;
    }
  }

  // An object's shadow group changed (or, above them, all of them).
  changedGroup(n) {
    for (let c = n; c; c = c.parentNode) {
      const up = c.parentNode;
      if (c.classList?.contains('shade-shapes')) return; // (groups come or go: their pieces hold)
      if (up?.classList?.contains('shade-shapes')) {
        this.changed.add(c);
        return;
      }
      if (c.tagName === 'mask') return; // (another part of the mask: not theirs)
    }
    this.kept = new WeakMap();
  }

  // The objects' shadows: each object's group read alone and kept until it
  // changes, all of them laid end to end.
  readObjects(mask, b) {
    const root = mask.getElementsByClassName('shade-shapes')[0];
    if (!root || root.hasAttribute('transform')) return this.read(mask, PARTS.objects, 1, b, null);
    const p = new Pieces();
    for (const c of root.children) {
      const t = c.getAttribute('transform') ?? '', shown = c.style.display !== 'none';
      let k = this.kept.get(c);
      if (!k || this.changed.has(c) || k.t !== t || k.shown !== shown) {
        const q = new Pieces();
        if ('cast' in c) {
          // (an object's shadow as it is cast: drawn for the sun as it is, castPieces)
          if (c.cast && shown) {
            const m = c.transform?.baseVal?.numberOfItems ? c.transform.baseVal.consolidate().matrix : null;
            castPieces(q, c.cast, m ? [m.a, m.b, m.c, m.d, m.e, m.f] : ID, parseFloat(c.style.opacity || 1));
          }
        } else {
          const shapes = [];
          collect(c, new DOMMatrix(), 1, false, shapes);
          for (const [kind, d, m, alpha, , evenodd] of shapes) q.shape(meshOf(kind, d, evenodd), m, alpha, 1);
        }
        k = { t, shown, data: q.data.slice(0, q.n * STRIDE), n: q.n };
        this.kept.set(c, k);
      }
      p.room(k.n);
      p.data.set(k.data, p.n * STRIDE);
      p.n += k.n;
    }
    this.changed.clear();
    this.h.load(b, p);
    b.sig = b.ds = null;
  }

  // An object's shadow group given what it casts (Renderer: entry.shade),
  // or null for none.
  castInto(g, shade) {
    if (g.firstChild) g.textContent = '';
    g.cast = shade ?? null;
    this.changed.add(g);
    this.dirty.objects = true;
  }

  // Each frame: `view` the SVGs' drawn view and wrapper ({ zoom, panX,
  // panY, ox, oy, W, H }), the paper's strokes (`hatch`, `tier`, `px`,
  // `stroke`), the objects' held (`hold`), faded (`shown` 0 … 1, 0 hidden),
  // the `sun` they are cast by ({ cast, iso }, castPieces).
  draw({ view, hatch, tier, px, stroke, hold = false, shown = 1, sun = null }) {
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
          this.read(mask, PARTS.hills, 0, (s.hills ??= this.buffer()), (s.cuts ??= this.buffer()));
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
        if (readObjects) this.readObjects(mask, (s.objects ??= this.buffer()));
      });
      for (const s of this.sheets.splice(groups.length)) for (const b of Object.values(s)) if (b) this.free.push(b);
      this.dirty.hills = false;
      if (readObjects) this.dirty.objects = false;
      changed = true;
    }
    const pen = (this.pen ??= parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pen-2')) || 0.7);
    const q = 2 ** (Math.round(Math.log2(dpr * view.zoom) * 4) / 4);
    // (watercolour: a cool grey wash, see Hatching.pieces; the tone schemes
    // their shade, flat as a wash or hatched)
    const { palette } = THEME;
    const wash = palette.wash || (palette.tone && !palette.hatch);
    const colour = palette.wash ? '#6f6a8c' : palette.tone ? palette.shade : palette.detail;
    const key = `${view.zoom}|${view.panX}|${view.panY}|${view.ox}|${view.oy}|${w}|${hgt}|${tier}|${JSON.stringify(hatch)}|${px}|${stroke}|${q}|${colour}|${shown}|${sun?.cast}|${sun?.iso}`;
    if (!changed && key === this.drawnKey) return;
    this.drawnKey = key;
    h.size(w, hgt);
    h.clear();
    if (!hatch) return;
    const gl = h.gl;
    const tile = h.tile(tier, hatch, px, pen * stroke, q);
    const base = [dpr * view.zoom, dpr * (view.panX + view.ox), dpr * (view.panY + view.oy)];
    const look = { base, tile, colour: rgb(colour), alphas: [1, shown, 1, 1], wash };
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
      // (the objects' cast for the sun as it is: not swept, out of the lamps' pools)
      if (shown > 0 && sun) h.pieces(s.objects, { ...look, test: { ref: 0, mask: 1 }, sun });
    }
  }
}

// An element's shapes as they are drawn – each element's transform and
// opacity, those not displayed left out: [kind ('shape', 'line'),
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

// What an object casts (Painter: its walls' feet and the shapes it leaves,
// shadows.js castStrips, castShapes), as pieces cast by the sun the
// shader is given: each point where it stands on the ground (`project`,
// then `m`) and its height, shifted along the sun on the GPU – so the sun
// moving draws nothing anew. Each shape's edge dashed (EDGE), as the
// masks' were; a trunk's a pen line.
const HW = EDGE.width / 2, LINE_HW = 1.1, CROWN = 12, CONE = 10;
export function castPieces(p, { feet = [], casts = [], project }, m, alpha) {
  const [a, b, c, d, e, f] = m;
  const P = (x, y) => {
    const [px, py] = project(x, y);
    return [a * px + c * py + e, b * px + d * py + f];
  };
  let phase = 0;
  const next = () => (phase = (phase + 7.3) % 24.5);
  const put = (vals) => {
    p.room(1);
    p.data.set(vals, p.n++ * STRIDE);
  };
  // a filled triangle, each point with its height; `how` 1 cast, 2 a wall's (its normal n)
  const tri = (A, za, B, zb, C, zc, how = 1, n = [0, 0]) =>
    put([A[0], A[1], B[0], B[1], C[0], C[1], 0, 0, 0, 0, 0, 0, alpha, 1, 1, 0, za, zb, zc, 0, n[0], n[1], how, -1]);
  // a dashed edge (or, with `hw` and round ends, a pen line)
  const seg = (A, za, B, zb, how = 1, n = [0, 0], line = false) =>
    put([A[0], A[1], B[0], B[1], A[0], A[1], B[0], B[1], 1, line ? LINE_HW : HW, line ? 1 : 2, line ? 1 : 2, alpha, 1, 1, 0, za, zb, za, zb, n[0], n[1], how, line ? -1 : next()]);
  for (const ft of feet) {
    if (ft.h < SUN.low) continue;
    const z = ft.level ?? ft.h, A = P(...ft.a), B = P(...ft.b);
    tri(A, 0, B, 0, B, z, 2, ft.n);
    tri(A, 0, B, z, A, z, 2, ft.n);
    seg(A, 0, B, 0, 2, ft.n);
    seg(B, 0, B, z, 2, ft.n);
    seg(B, z, A, z, 2, ft.n);
    seg(A, z, A, 0, 2, ft.n);
  }
  for (const s of casts) {
    if (s.kind === 'crown') {
      const M = P(...s.at);
      for (let i = 0; i < CROWN; i++) {
        put([M[0], M[1], s.r, s.rz, i, 0, 0, 0, 0, 0, 0, 0, alpha, 1, 1, 0, s.z, 0, 0, 0, 0, 0, 3, -1]);
        put([M[0], M[1], s.r, s.rz, i, 0, 0, 0, 1, HW, 0, 0, alpha, 1, 1, 0, s.z, 0, 0, 0, 0, 0, 4, next()]);
      }
    } else if (s.kind === 'cone') {
      const M = P(...s.at);
      const ring = Array.from({ length: CONE }, (_, i) => P(s.at[0] + Math.cos((i / CONE) * 2 * Math.PI) * s.r, s.at[1] + Math.sin((i / CONE) * 2 * Math.PI) * s.r));
      ring.forEach((R, i) => {
        const S = ring[(i + 1) % CONE];
        tri(M, s.z0, R, s.z0, S, s.z0);
        tri(M, s.z1, R, s.z0, S, s.z0);
        seg(R, s.z0, S, s.z0);
        seg(M, s.z1, R, s.z0);
      });
    } else if (s.kind === 'face') {
      const pts = s.pts.map(([x, y, z]) => [P(x, y), z]);
      for (let i = 1; i + 1 < pts.length; i++) tri(pts[0][0], pts[0][1], pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      pts.forEach(([A, za], i) => seg(A, za, ...pts[(i + 1) % pts.length]));
    } else if (s.kind === 'stem' && s.z > 0) {
      const A = P(...s.at);
      seg(A, 0, A, s.z, 1, [0, 0], true);
    }
  }
}
