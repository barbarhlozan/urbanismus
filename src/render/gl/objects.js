// The buildings, trees and lamps drawn with WebGL2 instead of by the
// browser from their SVG – from that very SVG, so the painters stay as they
// are: each object's drawing (Renderer: entry.g) is read once into pieces –
// filled triangles and pen segments, in the drawing's own order – and kept
// on the GPU until it changes; the objects are drawn in the painter's order
// (Renderer.order), each a draw call, only when something changed.
//
// What the CSS gives each element (its colours, pen, ends, whether the
// level of detail or the sun shows it) is asked of the browser once per
// kind of element – the classes from the object's group down to it, and
// there are only some dozens – and asked again when any of what it depends
// on changes (the map's classes and custom properties, the sun's
// stylesheet).
//
// What moves an object without drawing it anew is a transform on its group
// or on one of the group's children (a slide mid-turn, the sway of a tree,
// the squash of a building pointed at): those are matrices in a texture,
// read again when their attribute changes, so none of that rebuilds any
// pieces.
//
//   const objs = GLObjects.make(canvas, layer, svg, sunCss)   (null without WebGL2)
//   objs.draw(view, order)     each frame: draws when something changed

import { flattenPath, triangulate } from './geometry.js';
import { penWatch, penLength } from '../draw.js';

// Curves flattened to within this of the true line (scene px).
const TOLERANCE = 0.08;
// floats per piece
const STRIDE = 20;
// matrices in the texture: two texels each, a row of this many texels
const ROW = 2048;

const VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 corner;
layout(location = 1) in vec4 ab;      // a fill: its first two points; a stroke: a, b (the object's px)
layout(location = 2) in vec4 cp;      // a fill: its third point; a stroke: the point before a, after b
layout(location = 3) in vec4 kind;    // fill (0) or stroke (1), half width (px), ends at a and b (0 a join, 1 round, 2 butt)
layout(location = 4) in vec4 style;   // its kind of element (the style table), and stroke (1) or fill (0)
layout(location = 5) in vec4 slots;   // the object's matrix, its child's (-1 none); a stroke: how far along its line a and b are
uniform vec3 base;                    // scene px -> device px
uniform vec2 size;
uniform highp sampler2D mats;
uniform highp sampler2D styles;       // per kind: fill, stroke (premultiplied), width and shown
uniform float alpha;                  // the object's whole drawing faded (its group's opacity)
uniform int penOn;                    // the pen drawing this object in or out (draw.js)…
uniform float penT;                   // …this many ms into its drawing (erasing: counted back)
out vec2 local;
out vec2 joins;
out float len;
flat out vec4 kindF;
flat out vec4 colourF;
out float alongF;                     // how far along its line (a stroke)
flat out float penVis;                // the pen has got this far along it
vec2 unit(vec2 v, vec2 or) { float l = length(v); return l > 1e-4 ? v / l : or; }
mat3 matAt(float s) {
  if (s < 0.0) return mat3(1.0);
  int i = int(s) * 2;
  vec4 p = texelFetch(mats, ivec2(i % ${ROW}, i / ${ROW}), 0);
  vec4 q = texelFetch(mats, ivec2((i + 1) % ${ROW}, (i + 1) / ${ROW}), 0);
  return mat3(p.x, p.y, 0.0, p.z, p.w, 0.0, q.x, q.y, 1.0);
}
void main() {
  mat3 m = matAt(slots.x) * matAt(slots.y);
  mat3 M = mat3(base.x, 0.0, 0.0, 0.0, base.x, 0.0, base.y, base.z, 1.0) * m;
  vec2 A = (M * vec3(ab.xy, 1.0)).xy, B = (M * vec3(ab.zw, 1.0)).xy;
  int sid = int(style.x) * 3;
  vec4 look = texelFetch(styles, ivec2(sid + 2, 0), 0);
  colourF = texelFetch(styles, ivec2(sid + int(style.y), 0), 0) * alpha;
  float det = sqrt(abs(m[0][0] * m[1][1] - m[0][1] * m[1][0]));
  kindF = vec4(kind.x, kind.y * look.x * 0.5 * base.x * det, kind.zw);
  if (look.y < 0.5 || colourF.a <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // the pen: an outline revealed along its length (eased in and out, as the
  // dash slid in), a fill fading in as it closes, a mark without an
  // outline fading in whole (draw.js) – each element's times beside the matrices
  penVis = 1e9;
  if (penOn == 1 && style.z >= 0.0) {
    int e = int(style.z) * 2;
    vec4 t = texelFetch(mats, ivec2(e % ${ROW}, e / ${ROW}), 0);
    vec4 q = texelFetch(mats, ivec2((e + 1) % ${ROW}, (e + 1) / ${ROW}), 0);
    float fade = clamp((penT - t.z) / max(t.w - t.z, 1e-3), 0.0, 1.0);
    if (q.y > 0.5 || kind.x < 0.5) colourF *= fade;
    else {
      float k = clamp((penT - t.x) / max(t.y - t.x, 1e-3), 0.0, 1.0);
      k = k * k * (3.0 - 2.0 * k);
      penVis = k * (q.x + 1.0) - 1.0;
    }
    if (colourF.a <= 0.0 || penVis <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  }
  vec2 p;
  if (kind.x < 0.5) {
    int c = int(corner.x + 0.5) + 2 * int(corner.y > 0.0);
    p = c == 0 ? A : c == 1 ? B : (M * vec3(cp.xy, 1.0)).xy;
    local = vec2(0.0); joins = vec2(1e6); len = 0.0; alongF = 0.0;
  } else {
    vec2 pa = A, pb = B, pp = (M * vec3(cp.xy, 1.0)).xy, pn = (M * vec3(cp.zw, 1.0)).xy;
    float r = kindF.y + 1.0;
    len = length(pb - pa);
    vec2 dir = unit(pb - pa, vec2(1.0, 0.0)), nrm = vec2(-dir.y, dir.x);
    vec2 tA = unit(dir + unit(pa - pp, dir), dir), tB = unit(dir + unit(pn - pb, dir), dir);
    if (corner.x < 0.5) {
      if (kind.z < 0.5) { vec2 n = vec2(-tA.y, tA.x); p = pa + n * corner.y * r / max(dot(n, nrm), 0.3); }
      else p = pa + dir * (kind.z > 1.5 ? -1.0 : -r) + nrm * corner.y * r;
    } else {
      if (kind.w < 0.5) { vec2 n = vec2(-tB.y, tB.x); p = pb + n * corner.y * r / max(dot(n, nrm), 0.3); }
      else p = pb + dir * (kind.w > 1.5 ? 1.0 : r) + nrm * corner.y * r;
    }
    local = vec2(dot(p - pa, dir), dot(p - pa, nrm));
    joins = vec2(kind.z < 0.5 ? dot(p - pa, tA) : 1e6, kind.w < 0.5 ? dot(pb - p, tB) : 1e6);
    alongF = slots.z + local.x / max(len, 1e-4) * (slots.w - slots.z);
  }
  gl_Position = vec4(p / size * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}`;

const FS = `#version 300 es
precision highp float;
in vec2 local;
in vec2 joins;
in float len;
flat in vec4 kindF;
flat in vec4 colourF;
in float alongF;
flat in float penVis;
out vec4 outColour;
void main() {
  if (kindF.x < 0.5) { outColour = colourF; return; }
  if (joins.x < 0.0 || joins.y < 0.0 || alongF > penVis) discard;
  float hw = kindF.y, d, edge = 1.0;
  float u = local.x, v = local.y;
  float e = u < 0.0 ? -u : u - len;
  float end = u < 0.0 ? kindF.z : kindF.w;
  if (e > 0.0 && end > 0.5) {
    if (end < 1.5) d = length(vec2(e, v));
    else { d = abs(v); edge = clamp(0.5 - e, 0.0, 1.0); }
  } else d = abs(v);
  float cover = clamp(min(d + 0.5, hw) - max(d - 0.5, -hw), 0.0, 1.0) * edge;
  if (cover <= 0.0) discard;
  outColour = colourF * cover;
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

// A computed colour as premultiplied [r, g, b, a] 0 … 1 (null: none).
function paint(c, alpha) {
  if (!c || c === 'none') return null;
  let v = null;
  let m = /^rgba?\(([^)]+)\)/.exec(c);
  if (m) {
    const n = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    v = [n[0] / 255, n[1] / 255, n[2] / 255, n[3] ?? 1];
  } else if ((m = /^color\(srgb ([^)]+)\)/.exec(c))) {
    const n = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
    v = [n[0], n[1], n[2], n[3] ?? 1];
  }
  if (!v) return null;
  const a = v[3] * alpha;
  return a > 0 ? [v[0] * a, v[1] * a, v[2] * a, a] : null;
}

const CAPS = { round: 1, butt: 2, square: 2 };
const SVGNS = 'http://www.w3.org/2000/svg';
const lengths = new WeakMap(); // element -> { d, len }
const ATTRS = ['style', 'fill', 'stroke', 'stroke-width', 'fill-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-linecap', 'display'];
const SHAPES = new Set(['path', 'polygon', 'polyline', 'line', 'rect', 'circle', 'ellipse']);

// An element's geometry as path data.
function dOf(el) {
  const n = (a) => parseFloat(el.getAttribute(a)) || 0;
  switch (el.tagName) {
    case 'path': return el.getAttribute('d') ?? '';
    case 'polygon': case 'polyline': {
      const p = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
      let d = '';
      for (let i = 0; i + 1 < p.length; i += 2) d += `${i ? 'L' : 'M'}${p[i]} ${p[i + 1]}`;
      return el.tagName === 'polygon' ? `${d}Z` : d;
    }
    case 'line': return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`;
    case 'rect': { const x = n('x'), y = n('y'), w = n('width'), h = n('height'); return `M${x} ${y}h${w}v${h}h${-w}Z`; }
    case 'circle': case 'ellipse': {
      const cx = n('cx'), cy = n('cy'), rx = el.tagName === 'circle' ? n('r') : n('rx'), ry = el.tagName === 'circle' ? n('r') : n('ry');
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
    }
  }
  return '';
}

// An element's own transform as [a, b, c, d, e, f] (null: none).
// (read item by item: consolidate() would rewrite the attribute)
function own(el) {
  const t = el.transform?.baseVal;
  if (!t?.numberOfItems) return null;
  let m = null;
  for (let i = 0; i < t.numberOfItems; i++) {
    const { a, b, c, d, e, f } = t.getItem(i).matrix;
    m = m ? mul(m, [a, b, c, d, e, f]) : [a, b, c, d, e, f];
  }
  return m;
}
const mul = (p, q) => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];

export class GLObjects {
  static make(canvas, layer, svg, sunCss) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true });
    return gl ? new GLObjects(canvas, gl, layer, svg, sunCss) : null;
  }

  constructor(canvas, gl, layer, svg, sunCss) {
    this.canvas = canvas;
    this.gl = gl;
    this.layer = layer;
    const p = (this.program = gl.createProgram());
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.u = Object.fromEntries(['base', 'size', 'mats', 'styles', 'penOn', 'penT', 'alpha'].map((n) => [n, gl.getUniformLocation(p, n)]));
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
    // the matrices
    this.slots = 0;           // in use (bump)…
    this.cap = ROW * 8;       // …of this many
    this.freeSlots = [];      // [slot, n] let go
    this.matData = new Float32Array(this.cap * 8);
    this.matTex = gl.createTexture();
    this.matsDirty = new Set(); // slots to send
    this.allocTex();
    this.records = new Map();   // entry group -> { slot, n, children: Map el -> slot, vao, buf, count, dirty }
    this.styles = new Map();    // chain -> { id, el, fill, stroke, width, cap, evenodd, shown }
    this.styleTex = gl.createTexture();
    this.styleData = new Float32Array(1024 * 12);
    this.stylesDirty = true;
    this.epoch = 0;
    this.changed = true;
    // anything in an object's drawing changed: its pieces built again; a
    // transform on its group or a child: only that matrix
    new MutationObserver((records) => {
      for (const r of records) {
        const t = r.target;
        if (t === layer) continue;
        let g = t, child = null;
        while (g && g.parentNode !== layer) {
          child = g;
          g = g.parentNode;
        }
        const rec = g && this.records.get(g);
        if (!rec) continue;
        this.changed = true;
        if (r.type === 'attributes' && r.attributeName === 'transform' && (t === g || t === child && t.parentNode === g)) {
          if (t === g) this.setMat(rec.slot, own(g));
          else {
            const s = rec.children.get(t);
            if (s != null) this.setMat(s, own(t));
            else rec.dirty = true;
          }
        } else rec.dirty = true;
      }
    }).observe(layer, { subtree: true, childList: true, attributes: true, characterData: true });
    // the pen's plans (draw.js): its times beside the matrices
    penWatch.add((groups) => {
      for (const g of groups) {
        const rec = g && this.records.get(g);
        if (rec && !rec.dirty) this.writePen(g, rec);
      }
      this.changed = true;
    });
    // (the pen's lengths, as the browser would measure them: the layer isn't laid out)
    penLength.of = (el) => {
      const d = dOf(el);
      let l = lengths.get(el);
      if (l?.d === d) return l.len;
      let len = 0;
      for (const { pts, closed } of flattenPath(d, TOLERANCE)) {
        for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (closed && pts.length > 1) len += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
      }
      lengths.set(el, { d, len });
      return len;
    };
    // what the styles depend on: the map's classes and properties, the sun's sheet
    // (asked again of an element of each kind, into the table: nothing is built anew
    // unless a kind gains a fill or a pen it had none of)
    const restyle = () => {
      this.epoch++;
      let rebuild = false;
      for (const [chain, st] of this.styles) {
        const was = [!!st.fill, !!st.stroke];
        this.probe(st);
        if (was[0] !== !!st.fill || was[1] !== !!st.stroke) rebuild = true;
      }
      if (rebuild) for (const rec of this.records.values()) rec.dirty = true;
      this.stylesDirty = this.changed = true;
    };
    new MutationObserver(restyle).observe(svg, { attributes: true, attributeFilter: ['class', 'style'] });
    if (sunCss) new MutationObserver(restyle).observe(sunCss, { childList: true, characterData: true, subtree: true });
  }

  allocTex() {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.matTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ROW, (this.cap * 2) / ROW, 0, gl.RGBA, gl.FLOAT, this.matData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.matsDirty.clear();
  }

  // A matrix slot set (null: none, the identity).
  setMat(s, m) {
    m ??= [1, 0, 0, 1, 0, 0];
    this.matData.set([m[0], m[1], m[2], m[3], m[4], m[5], 0, 0], s * 8);
    this.matsDirty.add(s);
  }

  // `n` matrix slots: freed ones first, else new ones (the texture grown)
  alloc(n) {
    const i = this.freeSlots.findIndex(([, k]) => k >= n);
    if (i >= 0) {
      const [s, k] = this.freeSlots[i];
      if (k > n) this.freeSlots[i] = [s + n, k - n];
      else this.freeSlots.splice(i, 1);
      return s;
    }
    if (this.slots + n > this.cap) {
      let cap = this.cap;
      while (this.slots + n > cap) cap *= 2;
      const more = new Float32Array(cap * 8);
      more.set(this.matData);
      this.cap = cap;
      this.matData = more;
      this.allocTex();
    }
    const s = this.slots;
    this.slots += n;
    return s;
  }

  freeRecord(g, rec) {
    this.freeSlots.push([rec.slot, rec.n]);
    this.gl.deleteBuffer(rec.buf);
    this.gl.deleteVertexArray(rec.vao);
    this.records.delete(g);
  }

  // What the CSS gives an element of this kind (asked of the element itself
  // the first time; `chain` its classes from the object's group down).
  styleOf(el, chain) {
    let s = this.styles.get(chain);
    if (s) return s;
    if (this.styles.size >= 1024) throw new Error('GLObjects: too many kinds of element');
    // (asked later, all new kinds at once – each asking alone would have the
    // browser restyle the drawings changed meanwhile; until then built with
    // both a fill and a pen, the table showing what it has)
    s = { id: this.styles.size, el: this.copy(el), fill: true, stroke: true, cap: 1, evenodd: false, pending: true };
    this.styles.set(chain, s);
    (this.pending ??= []).push(s);
    return s;
  }

  // A copy of an element and its groups up to the object's (no children,
  // no geometry), kept in a probe of its own beside the objects: asked for
  // its style it needs no restyle of anything that changed in the drawings.
  copy(el) {
    if (!this.probeRoot) {
      // (as the objects' layer is: in a scene, in the same <svg>)
      const scene = document.createElementNS(SVGNS, 'g');
      scene.setAttribute('class', 'scene');
      scene.style.visibility = 'hidden';
      this.probeRoot = scene.appendChild(document.createElementNS(SVGNS, 'g'));
      this.probeRoot.setAttribute('class', this.layer.getAttribute('class') ?? '');
      this.layer.closest('svg').append(scene);
    }
    const chain = [];
    for (let n = el; n && n !== this.layer; n = n.parentNode) chain.unshift(n);
    let at = this.probeRoot;
    for (const n of chain) {
      const c = n.cloneNode(false);
      c.removeAttribute('d');
      c.removeAttribute('transform');
      at = at.appendChild(c);
    }
    return at;
  }

  // A kind's style as the browser computes it for its element, into the table.
  probe(s) {
    const cs = getComputedStyle(s.el);
    const alpha = parseFloat(cs.opacity) || 0;
    s.shown = cs.display !== 'none';
    s.fill = paint(cs.fill, alpha * (parseFloat(cs.fillOpacity) || 0));
    s.stroke = paint(cs.stroke, alpha * (parseFloat(cs.strokeOpacity) || 0));
    s.width = parseFloat(cs.strokeWidth) || 0;
    s.cap = CAPS[cs.strokeLinecap] ?? 2;
    s.evenodd = cs.fillRule === 'evenodd';
    if (!(s.width > 0)) s.stroke = null;
    this.styleData.set([...(s.fill ?? [0, 0, 0, 0]), ...(s.stroke ?? [0, 0, 0, 0]), s.width, s.shown ? 1 : 0, 0, 0], s.id * 12);
    this.stylesDirty = true;
  }

  // An object's drawing read into pieces.
  build(g, rec) {
    const { gl } = this;
    const children = [...g.children];
    const marks = g.querySelectorAll('path,polygon,polyline,line,rect,circle,ellipse').length;
    if (!rec || rec.n < children.length + 1 + marks) {
      if (rec) this.freeRecord(g, rec);
      const vao = gl.createVertexArray(), buf = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      for (const [loc, off] of [[1, 0], [2, 4], [3, 8], [4, 12], [5, 16]]) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, STRIDE * 4, off * 4);
        gl.vertexAttribDivisor(loc, 1);
      }
      gl.bindVertexArray(null);
      const n = children.length + 1 + marks + 8;
      rec = { slot: this.alloc(n), n, vao, buf, count: 0 };
      this.records.set(g, rec);
    }
    rec.opacity = parseFloat(getComputedStyle(g).opacity) || 0; // (its classes' own: .mist-under)
    rec.children = new Map();
    rec.boxes = new Map(); // child -> [x0, y0, x1, y1] in the group's px
    rec.els = [];
    rec.elBase = rec.slot + 1 + children.length;
    rec.dirty = false;
    rec.pending = null;
    this.setMat(rec.slot, own(g));
    const out = (this.scratch ??= { data: new Float32Array(STRIDE * 4096) });
    let n = 0;
    const room = (k) => {
      if ((n + k) * STRIDE <= out.data.length) return;
      let len = out.data.length * 2;
      while ((n + k) * STRIDE > len) len *= 2;
      const more = new Float32Array(len);
      more.set(out.data);
      out.data = more;
    };
    let child = null;
    const visit = (el, chain, m, slot) => {
      const tag = el.tagName;
      const cls = el.getAttribute('class') ?? '';
      chain = `${chain}>${tag}.${cls}`;
      if (tag === 'g' || tag === 'a') {
        for (const c of el.children) visit(c, chain, m, slot);
        return;
      }
      if (!SHAPES.has(tag)) return;
      // (an inline style or a presentation attribute makes it a kind of its own)
      let own = '';
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v != null) own += `|${a}:${v}`;
      }
      const st = this.styleOf(el, own ? chain + own : chain);
      if (st.pending) (rec.pending ??= new Set()).add(st);
      if (!st.fill && !st.stroke) return; // (shown or not: the table says)
      const ei = rec.elBase + rec.els.length;
      rec.els.push(el);
      const subs = flattenPath(dOf(el), TOLERANCE);
      if (!subs.length) return;
      const X = (p) => (m ? m[0] * p[0] + m[2] * p[1] + m[4] : p[0]);
      const Y = (p) => (m ? m[1] * p[0] + m[3] * p[1] + m[5] : p[1]);
      // (its child's box: what getBBox would say, the layer not being laid out)
      const box = rec.boxes.get(child);
      for (const { pts } of subs) {
        for (const p of pts) {
          const x = X(p), y = Y(p);
          if (x < box[0]) box[0] = x;
          if (y < box[1]) box[1] = y;
          if (x > box[2]) box[2] = x;
          if (y > box[3]) box[3] = y;
        }
      }
      let D = out.data;
      if (st.fill) {
        const { positions: P, indices: I } = triangulate(subs, st.evenodd ? 'evenodd' : 'nonzero');
        room(I.length / 3);
        D = out.data;
        for (let i = 0; i < I.length; i += 3) {
          const o = n++ * STRIDE;
          const v = (k) => [P[I[i + k] * 2], P[I[i + k] * 2 + 1]];
          const p0 = v(0), p1 = v(1), p2 = v(2);
          D[o] = X(p0); D[o + 1] = Y(p0); D[o + 2] = X(p1); D[o + 3] = Y(p1);
          D[o + 4] = X(p2); D[o + 5] = Y(p2); D[o + 6] = D[o + 7] = 0;
          D[o + 8] = 0; D[o + 9] = D[o + 10] = D[o + 11] = 0;
          D[o + 12] = st.id; D[o + 13] = 0; D[o + 14] = ei; D[o + 15] = 0;
          D[o + 16] = rec.slot; D[o + 17] = slot; D[o + 18] = D[o + 19] = 0;
        }
      }
      if (st.stroke) {
        // (the pen's width from the table, times how much the kept transforms scale it)
        const hw = m ? Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) : 1;
        for (const { pts, closed } of subs) {
          if (pts.length < 2 && !closed) continue;
          let along = 0; // (from each subpath's start, as a dash goes)
          const count = pts.length + (closed ? 1 : 0);
          room(count);
          D = out.data;
          const ring = closed && count > 3;
          const at = (i) => pts[i % pts.length];
          for (let i = 1; i < count; i++) {
            const ip = i > 1 ? i - 2 : ring ? count - 2 : i - 1;
            const iq = i < count - 1 ? i + 1 : ring ? 1 : i;
            const pa = at(i - 1), pb = at(i), pp = at(ip), pq = at(iq);
            const t1 = Math.atan2(pa[1] - pp[1], pa[0] - pp[0]), t2 = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]);
            const turn = Math.abs(Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1)));
            const o = n++ * STRIDE;
            D[o] = X(pa); D[o + 1] = Y(pa); D[o + 2] = X(pb); D[o + 3] = Y(pb);
            D[o + 4] = X(pp); D[o + 5] = Y(pp); D[o + 6] = X(pq); D[o + 7] = Y(pq);
            D[o + 8] = 1; D[o + 9] = hw;
            D[o + 10] = i === 1 && !ring ? st.cap : ip !== i - 1 && turn > 0.35 ? 1 : 0;
            D[o + 11] = i === count - 1 && !ring ? st.cap : 0;
            const l = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
            D[o + 12] = st.id; D[o + 13] = 1; D[o + 14] = ei; D[o + 15] = 0;
            D[o + 16] = rec.slot; D[o + 17] = slot; D[o + 18] = along; D[o + 19] = along + l;
            along += l;
          }
        }
      }
    };
    const root = `g.${g.getAttribute('class') ?? ''}`;
    children.forEach((c, i) => {
      const slot = rec.slot + 1 + i;
      rec.children.set(c, slot);
      child = c;
      rec.boxes.set(c, [Infinity, Infinity, -Infinity, -Infinity]);
      this.setMat(slot, own(c));
      // (transforms below a child are kept in the pieces)
      const inner = (el, chain, m) => {
        const t = own(el);
        const mm = t ? (m ? mul(m, t) : t) : m;
        if (el.tagName === 'g' || el.tagName === 'a') {
          const ch = `${chain}>${el.tagName}.${el.getAttribute('class') ?? ''}`;
          for (const k of el.children) inner(k, ch, mm);
        } else visit(el, chain, mm, slot);
      };
      if (c.tagName === 'g' || c.tagName === 'a') {
        const ch = `${root}>${c.tagName}.${c.getAttribute('class') ?? ''}`;
        for (const k of c.children) inner(k, ch, null);
      } else visit(c, root, null, slot);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, rec.buf);
    gl.bufferData(gl.ARRAY_BUFFER, out.data.subarray(0, n * STRIDE), gl.STATIC_DRAW);
    rec.count = n;
    this.writePen(g, rec);
    return rec;
  }

  // The new kinds asked for their style, all at once; a drawing built with
  // one whose fill goes by even-odd, or whose pen ends aren't round, built again.
  askPending() {
    if (!this.pending?.length) return;
    const asked = new Set(this.pending);
    this.pending = [];
    for (const st of asked) {
      st.pending = false;
      this.probe(st);
    }
    for (const rec of this.records.values()) {
      if (!rec.pending) continue;
      if ([...rec.pending].some((st) => st.evenodd || st.cap !== 1)) {
        rec.dirty = true;
        this.changed = true;
      }
      rec.pending = null;
    }
  }

  // A drawn object's child's box ([x0, y0, x1, y1] in its group's px; null
  // if not drawn here or empty).
  boxOf(el) {
    const b = this.records.get(el.parentNode)?.boxes?.get(el);
    return b && b[2] >= b[0] ? b : null;
  }

  has(g) {
    return this.records.has(g);
  }

  // A drawing not in the page yet (made ready for a turn) built ahead.
  prebuild(g) {
    this.build(g, this.records.get(g));
    this.askPending();
  }

  // An object's elements' times as the pen's plan for it has them (draw.js;
  // none: all drawn).
  writePen(g, rec) {
    const pen = g.pen;
    rec.pen = pen ?? null;
    if (!pen) return;
    rec.els.forEach((el, i) => {
      const it = pen.items.get(el);
      const s = rec.elBase + i;
      if (!it) this.matData.set([-2, -1, -2, -1, 1e9, 0, 0, 0], s * 8);
      else this.matData.set([it.t0, it.t1, it.f0, it.f1, it.px * 1.05 + 4, it.stroke ? 0 : 1, 0, 0], s * 8);
      this.matsDirty.add(s);
    });
  }

  // Each frame. `view`: the SVGs' drawn view and wrapper ({ zoom, panX,
  // panY, ox, oy, W, H }); `order`: the objects from the furthest (entries
  // with g, shown).
  draw(view, order) {
    const { gl, canvas } = this;
    const dpr = devicePixelRatio || 1;
    const w = Math.round((view.W + 2 * view.ox) * dpr), h = Math.round((view.H + 2 * view.oy) * dpr);
    const key = `${view.zoom}|${view.panX}|${view.panY}|${view.ox}|${view.oy}|${w}|${h}`;
    if (order !== this.lastOrder) this.changed = true;
    if (!this.changed && key === this.key) return;
    this.key = key;
    this.lastOrder = order;
    this.changed = false;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    // the drawings that changed built again; those gone let go
    const seen = new Set(), now0 = performance.now();
    for (const e of order ?? []) {
      if (e.shown === false || !e.g?.isConnected) continue;
      seen.add(e.g);
      const rec = this.records.get(e.g);
      if (!rec || rec.dirty) this.build(e.g, rec);
    }
    this.askPending();
    // (now and then: those out of the page and not kept for a turn let go)
    if (!(now0 - (this.sweptAt ?? 0) < 2000)) {
      this.sweptAt = now0;
      const kept = this.kept?.() ?? new Set();
      for (const [g, rec] of this.records) if (!seen.has(g) && !g.isConnected && !kept.has(g)) this.freeRecord(g, rec);
    }
    // the matrices sent
    gl.bindTexture(gl.TEXTURE_2D, this.matTex);
    if (this.matsDirty.size) {
      const rows = new Set([...this.matsDirty].map((s) => Math.floor((s * 2) / ROW)));
      for (const r of rows) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r, ROW, 1, gl.RGBA, gl.FLOAT, this.matData, r * ROW * 4);
      this.matsDirty.clear();
    }
    if (this.stylesDirty) {
      this.stylesDirty = false;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.styleTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 3 * 1024, 1, 0, gl.RGBA, gl.FLOAT, this.styleData);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform3f(this.u.base, dpr * view.zoom, dpr * (view.panX + view.ox), dpr * (view.panY + view.oy));
    gl.uniform2f(this.u.size, w, h);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.styleTex);
    gl.uniform1i(this.u.styles, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.matTex);
    gl.uniform1i(this.u.mats, 0);
    const now = performance.now();
    let penning = false, penWas = false;
    gl.uniform1i(this.u.penOn, 0);
    let alphaWas = -1;
    const one = (g, rec) => {
      // (the pen still at it: drawn again next frame; done drawing in: let go)
      const pen = rec.pen;
      let t = 0;
      if (pen) {
        t = now - pen.origin;
        if (!pen.reverse && t >= pen.T) {
          rec.pen = null;
          if (g.pen === pen) g.pen = null;
        } else {
          if (pen.reverse) t = pen.T - t;
          if (!pen.reverse || t > -100) penning = true;
        }
      }
      if (!!rec.pen !== penWas || rec.pen) {
        gl.uniform1i(this.u.penOn, rec.pen ? 1 : 0);
        gl.uniform1f(this.u.penT, t);
        penWas = !!rec.pen;
      }
      // its opacity: a fade under way (the renderer's group.fade), else its classes'
      let a = rec.opacity ?? 1;
      const f = g.fade;
      if (f) {
        const k = Math.min(1, Math.max(0, (now - f.at) / f.ms));
        const e = f.ease === 'out' ? 1 - (1 - k) ** 2 : k * k * (3 - 2 * k);
        a = f.from + (f.to - f.from) * e;
        if (k < 1) penning = true;
      }
      if (a <= 0) return;
      if (a !== alphaWas) {
        gl.uniform1f(this.u.alpha, a);
        alphaWas = a;
      }
      gl.bindVertexArray(rec.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, rec.count);
    };
    for (const e of order ?? []) {
      const rec = e.shown !== false && this.records.get(e.g);
      if (rec?.count) one(e.g, rec);
      // (a drawing it replaced, fading out after it: Renderer.land)
      for (let n = e.g?.nextElementSibling; n?.fade; n = n.nextElementSibling) {
        const r = this.records.get(n);
        if (r?.count) one(n, r);
      }
    }
    gl.bindVertexArray(null);
    if (penning) this.changed = true;
  }
}
