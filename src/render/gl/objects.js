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
import { hatchTileLines } from '../hatch.js';
import { brushWidths, brushPath2D, BRUSH_GLSL } from '../brush.js';

// Curves flattened to within this of the true line (scene px).
const TOLERANCE = 0.08;
// floats per piece
const STRIDE = 20;
// ms a frame spent reading drawings that changed (the rest the next frames)
const BUILD_BUDGET = 6;
// matrices in the texture: two texels each, a row of this many texels
const ROW = 2048;

const VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 corner;
layout(location = 1) in vec4 ab;      // a fill: its first two points; a stroke: a, b (the object's px)
layout(location = 2) in vec4 cp;      // a fill: its third point; a stroke: the point before a, after b
layout(location = 3) in vec4 kind;    // fill (0) or stroke (1), half width (px), ends at a and b (0 a join, 1 round, 2 butt)
layout(location = 4) in vec4 style;   // its kind of element (the style table), and stroke (1) or fill (0); its pen element; a stroke's widths (brush.js)
layout(location = 5) in vec4 slots;   // the object's matrix, its child's (-1 none); a stroke: how far along its line a and b are
uniform vec3 base;                    // scene px -> device px
uniform vec2 size;
uniform highp sampler2D mats;
uniform highp sampler2D styles;       // per kind: fill, stroke (premultiplied), width, shown, hatched
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
out vec2 scene;                       // where it is (scene px: a hatched fill's strokes)
flat out float shadeF;                // a fill laid on in brush strokes at (n - 10) sixths of a half turn (--fill-hatch 10–15, tone schemes)
flat out vec2 brushW;                 // a stroke's width at a and at b, as shares of its pen's
// (an end before its start: taken back, from all there to none)
float span(float a, float b) { float d = b - a; return abs(d) < 1e-3 ? 1e-3 : d; }
vec2 unit(vec2 v, vec2 or) { float l = length(v); return l > 1e-4 ? v / l : or; }
${BRUSH_GLSL}
mat3 matAt(float s) {
  if (s < 0.0) return mat3(1.0);
  int i = int(s) * 2;
  vec4 p = texelFetch(mats, ivec2(i % ${ROW}, i / ${ROW}), 0);
  vec4 q = texelFetch(mats, ivec2((i + 1) % ${ROW}, (i + 1) / ${ROW}), 0);
  return mat3(p.x, p.y, 0.0, p.z, p.w, 0.0, q.x, q.y, 1.0);
}
void main() {
  mat3 m = matAt(slots.x) * matAt(slots.y);
  brushW = vec2(1.0);
  mat3 M = mat3(base.x, 0.0, 0.0, 0.0, base.x, 0.0, base.y, base.z, 1.0) * m;
  vec2 A = (M * vec3(ab.xy, 1.0)).xy, B = (M * vec3(ab.zw, 1.0)).xy;
  int sid = int(style.x) * 3;
  vec4 look = texelFetch(styles, ivec2(sid + 2, 0), 0);
  colourF = texelFetch(styles, ivec2(sid + int(style.y), 0), 0) * alpha;
  shadeF = look.w;
  float det = sqrt(abs(m[0][0] * m[1][1] - m[0][1] * m[1][0]));
  kindF = vec4(kind.x < 0.5 ? -look.z : kind.x, kind.y * look.x * 0.5 * base.x * det, kind.zw);
  if (look.y < 0.5 || colourF.a <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // the pen: an outline revealed along its length (eased in and out, as the
  // dash slid in), a fill fading in as it closes, a mark without an
  // outline fading in whole (draw.js) – each element's times beside the matrices
  penVis = 1e9;
  if (penOn == 1 && style.z >= 0.0) {
    int e = int(style.z) * 2;
    vec4 t = texelFetch(mats, ivec2(e % ${ROW}, e / ${ROW}), 0);
    vec4 q = texelFetch(mats, ivec2((e + 1) % ${ROW}, (e + 1) / ${ROW}), 0);
    float fade = clamp((penT - t.z) / span(t.z, t.w), 0.0, 1.0);
    if (q.y > 0.5 || kind.x < 0.5) colourF *= fade;
    else {
      float k = clamp((penT - t.x) / span(t.x, t.y), 0.0, 1.0);
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
    brushW = brushUnpack(style.w);
    float r = kindF.y * max(brushW.x, brushW.y) + 1.0;
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
  scene = (p - base.yz) / base.x;
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
in vec2 scene;
uniform sampler2D tile;               // the mist's strokes (setTile)
uniform vec3 tileAt;                  // cos, sin of their angle, the tile's size (scene px)
uniform int wash;                     // the watercolour scheme: paint laid unevenly (washTone)
flat in float shadeF;
flat in vec2 brushW;
out vec4 outColour;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// how much pigment a wash left here (1 as laid): blooms where it pooled
// and dried darker, paler where it ran thin, and the paper's tooth – all
// fixed to the map (scene px), so the paint stays put as the view moves
float washTone(vec2 s) {
  float bloom = noise(s * 0.06) * 0.5 + noise(s * 0.16 + 7.3) * 0.32 + noise(s * 0.45 + 3.1) * 0.18;
  float tooth = noise(s * 1.9) - 0.5;
  return 0.84 + 0.32 * bloom + 0.07 * tooth;
}
void main() {
  if (kindF.x < -0.5) {
    vec2 t = vec2(scene.x * tileAt.x + scene.y * tileAt.y, -scene.x * tileAt.y + scene.y * tileAt.x) / tileAt.z;
    outColour = colourF * texture(tile, t).a;
    return;
  }
  if (kindF.x < 0.5) {
    if (shadeF > 9.5) {
      // (laid on with a flat brush: streaks along the face – down a wall,
      // down a roof's slope –, the paint thinner and thicker across them,
      // the paper's tooth catching it)
      float ang = (shadeF - 10.0) * 0.5236;
      vec2 d = vec2(cos(ang), sin(ang));
      float along = dot(scene, d), across = dot(scene, vec2(-d.y, d.x));
      float n = noise(vec2(along * 0.05, across * 0.7)) * 0.6 + noise(vec2(along * 0.13 + 3.0, across * 1.9)) * 0.4;
      float dry = noise(vec2(along * 0.35, across * 3.5)) - 0.5;
      outColour = colourF;
      outColour.rgb = min(outColour.rgb * (0.86 + 0.24 * n + 0.07 * dry), vec3(outColour.a));
      return;
    }
    outColour = colourF;
    if (wash == 1) outColour.rgb = min(outColour.rgb * washTone(scene), vec3(outColour.a));
    return;
  }
  if (joins.x < 0.0 || joins.y < 0.0 || alongF > penVis) discard;
  float u = local.x, v = local.y;
  float hw = kindF.y * mix(brushW.x, brushW.y, clamp(u / max(len, 1e-4), 0.0, 1.0)), d, edge = 1.0;
  float e = u < 0.0 ? -u : u - len;
  float end = u < 0.0 ? kindF.z : kindF.w;
  if (e > 0.0 && end > 0.5) {
    if (end < 1.5) d = length(vec2(e, v));
    else { d = abs(v); edge = clamp(0.5 - e, 0.0, 1.0); }
  } else d = abs(v);
  float cover = clamp(min(d + 0.5, hw) - max(d - 0.5, -hw), 0.0, 1.0) * edge;
  if (cover <= 0.0) discard;
  outColour = colourF * cover;
  if (wash == 1) outColour.rgb = min(outColour.rgb * washTone(scene + 40.0), vec3(outColour.a));
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
    this.u = Object.fromEntries(['base', 'size', 'mats', 'styles', 'penOn', 'penT', 'alpha', 'tile', 'tileAt', 'wash'].map((n) => [n, gl.getUniformLocation(p, n)]));
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
    this.roots = new Map(); // a layer drawn here -> its probe (copy)
    this.watch(layer);
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
    // (the groups' opacities depend on classes only)
    new MutationObserver(() => this.opacities?.clear()).observe(svg, { attributes: true, attributeFilter: ['class'] });
    if (sunCss) new MutationObserver(restyle).observe(sunCss, { childList: true, characterData: true, subtree: true });
  }

  // A layer whose groups are drawn here (the objects', and `under` them
  // the mist's): anything in a group's drawing changed, its pieces built
  // again; a transform on the group or a child, only that matrix.
  watch(layer, { under = false } = {}) {
    this.roots.set(layer, null);
    if (under) this.under = layer;
    new MutationObserver((records) => {
      for (const r of records) {
        const t = r.target;
        if (t === layer) {
          this.changed = true;
          continue;
        }
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
  }

  // The tile the hatched fills (the mist's paper, `fill: url(…)`) are
  // filled with: the strokes of `hatch` (hatch.js, all tiers) at `px` a
  // grid unit, `width` scene px wide.
  setTile(hatch, px, width) {
    const key = `${JSON.stringify(hatch)}|${px}|${width}`;
    if (key === this.tileKey) return;
    this.tileKey = key;
    this.tileArgs = { hatch, px, width };
    this.tileQ = null;
    this.changed = true;
  }

  // …drawn for `q` device px to a scene px (a quarter of a doubling at a time).
  tileFor(q) {
    if (!this.tileArgs || q === this.tileQ) return;
    this.tileQ = q;
    this.tileTex ??= this.gl.createTexture();
    this.tileSize = this.paintTile(this.tileArgs, q, this.tileTex, gl => gl.TEXTURE2);
  }

  // A tile of hatch.js strokes (all tiers) drawn at q device px per scene
  // px into `tex` (on the texture unit `unit` names); its size, scene px.
  paintTile({ hatch, px, width }, q, tex, unit) {
    const { d, size } = hatchTileLines(3, hatch, px);
    const n = Math.max(1, Math.min(4096, Math.round(size * q)));
    const off = new OffscreenCanvas(n, n), c = off.getContext('2d');
    c.scale(n / size, n / size);
    // (the pen's strokes by the brush, brush.js, else even)
    const brushed = brushPath2D(d, width);
    c.fillStyle = c.strokeStyle = '#fff';
    c.lineWidth = width;
    c.lineCap = c.lineJoin = 'round';
    if (brushed) c.fill(brushed);
    else c.stroke(new Path2D(d));
    const { gl } = this;
    gl.activeTexture(unit(gl));
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, off);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.activeTexture(gl.TEXTURE0);
    return size;
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
    const chain = [];
    let n = el;
    for (; n && !this.roots.has(n); n = n.parentNode) chain.unshift(n);
    const layer = n ?? this.layer; // (a drawing made ready for a turn: an object's)
    let at = this.roots.get(layer);
    if (!at) {
      // (as the layer is: in a scene, in the same <svg>)
      const scene = (this.probeScene ??= document.createElementNS(SVGNS, 'g'));
      if (!scene.parentNode) {
        scene.setAttribute('class', 'scene');
        scene.style.visibility = 'hidden';
        this.layer.closest('svg').append(scene);
      }
      at = scene.appendChild(document.createElementNS(SVGNS, 'g'));
      at.setAttribute('class', layer.getAttribute('class') ?? '');
      this.roots.set(layer, at);
    }
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
    // (filled with a pattern: the mist's paper, in its strokes, setTile)
    s.hatched = cs.fill.startsWith('url(');
    let fill = cs.fill;
    if (s.hatched) {
      s.el.style.fill = 'var(--bg)';
      fill = getComputedStyle(s.el).fill;
      s.el.style.removeProperty('fill');
    }
    s.fill = paint(fill, alpha * (parseFloat(cs.fillOpacity) || 0));
    s.stroke = paint(cs.stroke, alpha * (parseFloat(cs.strokeOpacity) || 0));
    s.width = parseFloat(cs.strokeWidth) || 0;
    s.cap = CAPS[cs.strokeLinecap] ?? 2;
    s.evenodd = cs.fillRule === 'evenodd';
    if (!(s.width > 0)) s.stroke = null;
    s.shade = parseFloat(cs.getPropertyValue('--fill-hatch')) || 0;
    this.styleData.set([...(s.fill ?? [0, 0, 0, 0]), ...(s.stroke ?? [0, 0, 0, 0]), s.width, s.shown ? 1 : 0, s.hatched ? 1 : 0, s.shade], s.id * 12);
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
    rec.opacity = this.opacityOf(g, rec); // (its classes' own: .mist-under)
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
      // (most have only their class and their geometry)
      if (el.attributes.length > 2) {
        for (const a of ATTRS) {
          const v = el.getAttribute(a);
          if (v != null) own += `|${a}:${v}`;
        }
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
        const [ma, mb, mc, md, me, mf] = m ?? [1, 0, 0, 1, 0, 0];
        for (let i = 0; i < I.length; i += 3) {
          const o = n++ * STRIDE;
          for (let k = 0; k < 3; k++) {
            const x = P[I[i + k] * 2], y = P[I[i + k] * 2 + 1];
            D[o + 2 * k] = ma * x + mc * y + me;
            D[o + 2 * k + 1] = mb * x + md * y + mf;
          }
          D[o + 6] = D[o + 7] = 0;
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
          const L = pts.length;
          const [ma, mb, mc, md, me, mf] = m ?? [1, 0, 0, 1, 0, 0];
          const widths = brushWidths(pts, count);
          for (let i = 1; i < count; i++) {
            const ip = i > 1 ? i - 2 : ring ? count - 2 : i - 1;
            const iq = i < count - 1 ? i + 1 : ring ? 1 : i;
            const pa = pts[(i - 1) % L], pb = pts[i % L], pp = pts[ip % L], pq = pts[iq % L];
            // (a sharp turn gets a round join: the angle between the two
            // directions, by their cross and dot products)
            const ux = pa[0] - pp[0], uy = pa[1] - pp[1], vx = pb[0] - pa[0], vy = pb[1] - pa[1];
            const turn = Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
            const o = n++ * STRIDE;
            D[o] = ma * pa[0] + mc * pa[1] + me; D[o + 1] = mb * pa[0] + md * pa[1] + mf;
            D[o + 2] = ma * pb[0] + mc * pb[1] + me; D[o + 3] = mb * pb[0] + md * pb[1] + mf;
            D[o + 4] = ma * pp[0] + mc * pp[1] + me; D[o + 5] = mb * pp[0] + md * pp[1] + mf;
            D[o + 6] = ma * pq[0] + mc * pq[1] + me; D[o + 7] = mb * pq[0] + md * pq[1] + mf;
            D[o + 8] = 1; D[o + 9] = hw;
            D[o + 10] = i === 1 && !ring ? st.cap : ip !== i - 1 && turn > 0.35 ? 1 : 0;
            D[o + 11] = i === count - 1 && !ring ? st.cap : 0;
            const l = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
            D[o + 12] = st.id; D[o + 13] = 1; D[o + 14] = ei; D[o + 15] = widths[i];
            D[o + 16] = rec.slot; D[o + 17] = slot; D[o + 18] = along; D[o + 19] = along + l;
            along += l;
          }
        }
      }
    };
    const up = g.parentNode && g.parentNode !== this.layer ? `${g.parentNode.getAttribute('class')}>` : '';
    const root = `${up}g.${g.getAttribute('class') ?? ''}`;
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
    if (this.opacityPending?.size) {
      this.copy(this.layer); // (the probe made)
      for (const [cls, rec] of this.opacityPending) {
        const c = this.roots.get(this.layer).appendChild(document.createElementNS(SVGNS, 'g'));
        if (cls) c.setAttribute('class', cls);
        let o = parseFloat(getComputedStyle(c).opacity);
        if (!(o >= 0)) o = 1;
        this.opacities.set(cls, o);
        if (o !== 1) {
          rec.opacity = o;
          this.changed = true;
        }
      }
      this.opacityPending.clear();
    }
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

  // A group's opacity as its classes give it, asked of a copy (once per
  // set of classes: asking the group itself would restyle the page).
  // (a set not asked yet: 1 until asked with the new kinds, askPending)
  opacityOf(g, rec) {
    const cls = g.getAttribute('class') ?? '';
    const o = (this.opacities ??= new Map()).get(cls);
    if (o != null) return o;
    (this.opacityPending ??= new Map()).set(cls, rec);
    return 1;
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
  // with g, shown) – after the groups of the layer under them (watch).
  draw(view, order) {
    const { gl, canvas } = this;
    const dpr = devicePixelRatio || 1;
    const w = Math.round((view.W + 2 * view.ox) * dpr), h = Math.round((view.H + 2 * view.oy) * dpr);
    const key = `${view.zoom}|${view.panX}|${view.panY}|${view.ox}|${view.oy}|${w}|${h}`;
    if (order !== this.lastOrder) this.changed = true;
    if (!this.changed && key === this.key) return;
    this.key = key;
    this.lastOrder = order;
    if (this.under?.firstElementChild) order = [...[...this.under.children].map((g) => ({ g })), ...(order ?? [])];
    this.changed = false;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    // the drawings that changed built again; those gone let go
    const seen = new Set(), now0 = performance.now();
    // (within a budget a frame – new ones first; one whose drawing changed
    // shows its last pieces until its turn – unless nothing is built yet)
    const t0 = performance.now(), budget = this.records.size ? BUILD_BUDGET : Infinity;
    const later = [];
    for (const e of order ?? []) {
      if (e.shown === false || !e.g?.isConnected) continue;
      seen.add(e.g);
      const rec = this.records.get(e.g);
      if (!rec) {
        if (performance.now() - t0 < budget) this.build(e.g, rec);
        else this.changed = true;
      } else if (rec.dirty) later.push(e.g);
    }
    for (const g of later) {
      if (performance.now() - t0 >= budget) {
        this.changed = true;
        break;
      }
      this.build(g, this.records.get(g));
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
    gl.uniform1i(this.u.wash, document.documentElement.classList.contains('wc') ? 1 : 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.styleTex);
    gl.uniform1i(this.u.styles, 1);
    this.tileFor(2 ** (Math.round(Math.log2(dpr * view.zoom) * 4) / 4));
    if (this.tileTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
      gl.uniform1i(this.u.tile, 2);
      const a = (this.tileArgs.hatch.angle * Math.PI) / 180;
      gl.uniform3f(this.u.tileAt, Math.cos(a), Math.sin(a), this.tileSize);
    }
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
