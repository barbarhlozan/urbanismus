// The paper's strokes (hatch.js) drawn with WebGL2 where something lies in
// shade – the shadows, the night, the clouds' shadows – instead of on 2D
// canvases: a 2D canvas is a new picture whenever it changes, which Firefox
// copies to the GPU whole; here the strokes are a small tile kept on the
// GPU and the shapes they show through are drawn over it each frame.
//
// The tile is the same as the 2D canvases' pattern: the strokes of one
// repeat (hatchTileLines) drawn once on a little canvas, at a quarter of a
// doubling's steps of the zoom, and sampled where a shape lies – in scene
// px, turned to the lines' angle, so a shadow anywhere picks out exactly
// the strokes the night has there.
//
// Shapes (path data from the shadows' masks, the lights, the clouds) are
// flattened and filled once (geometry.js, kept per path) and laid each time
// as pieces: a filled triangle, or a segment of a pen stroke – their
// ragged edges, as the masks have them (a dashed line round the shape),
// and the trees' trunks' lines – antialiased as the map's lines are
// (gl/lines.js, gl/movers.js). Where pieces overlap they are one shape
// (the strokes are the same: the most of them is kept, blending MAX). What
// is left out – the lamps' pools, a sweep's other side – goes by the
// stencil, or for the night by a mask drawn in order.
//
//   const h = Hatching.make(canvas)      (null without WebGL2)
//   const pieces = new Pieces(); pieces.shape(kind, d, matrix, alpha, group, evenodd)
//   h.size(w, h); h.clear(); h.load(pieces) -> buffer
//   h.pieces(buffer, { base, tile, colour, alphas, stencil })
//   h.sheet({ base, tile, grey, colour, sets, reveal, mask })   (the night)

import { flattenPath, triangulate } from './geometry.js';
import { hatchTileLines, TILE } from '../hatch.js';

// The ragged edge of a shadow or a light, as the masks have it (styles.css
// .shade-mask .shade): a dashed line round it (its own units); the trunks'
// lines (shadeWorker.js).
export const EDGE = { width: 2.5, dash: [3, 2, 1.5, 3.5, 2.5, 1, 4, 2.5, 1, 3] };
const LINE = 2.2;
// Curves flattened to within this of the true line (scene px).
const TOLERANCE = 0.1;
// floats per piece
const STRIDE = 16;

const VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 corner;  // x 0 at a, 1 at b; y across (±1) – for a triangle the corners are its points
layout(location = 1) in vec4 ab;      // a fill: its first two points; a stroke: a, b (scene px)
layout(location = 2) in vec4 cp;      // a fill: its third point; a stroke: the point before a, after b
layout(location = 3) in vec4 kind;    // fill (0) or stroke (1), the stroke's half width (scene px), its ends at a and b (0 a join, 1 round, 2 butt)
layout(location = 4) in vec4 paint;   // alpha, group (its alpha a uniform), the value it writes to a mask
uniform vec3 base;                    // scene px -> device px: scale, x, y
uniform vec2 size;                    // the canvas, device px
uniform vec4 alphas;                  // per group
out vec2 local;
out vec2 joins;
out float len;
out vec2 scene;
flat out vec4 kindF;
flat out float alpha;
flat out float value;
vec2 unit(vec2 v, vec2 or) { float l = length(v); return l > 1e-4 ? v / l : or; }
vec2 dev(vec2 p) { return p * base.x + base.yz; }
void main() {
  kindF = vec4(kind.x, kind.y * base.x, kind.zw);
  alpha = paint.x * alphas[int(paint.y)];
  value = paint.z;
  vec2 p;
  if (kind.x < 0.5) {
    int c = int(corner.x + 0.5) + 2 * int(corner.y > 0.0);
    p = dev(c == 0 ? ab.xy : c == 1 ? ab.zw : cp.xy);
    local = vec2(0.0); joins = vec2(1e6); len = 0.0;
  } else {
    vec2 pa = dev(ab.xy), pb = dev(ab.zw), pp = dev(cp.xy), pn = dev(cp.zw);
    float r = kindF.y + 1.0;
    len = length(pb - pa);
    vec2 dir = unit(pb - pa, vec2(1.0, 0.0)), nrm = vec2(-dir.y, dir.x);
    vec2 tA = unit(dir + unit(pa - pp, dir), dir), tB = unit(dir + unit(pn - pb, dir), dir);
    if (corner.x < 0.5) {
      if (kind.z < 0.5) { vec2 m = vec2(-tA.y, tA.x); p = pa + m * corner.y * r / max(dot(m, nrm), 0.3); }
      else p = pa + dir * (kind.z > 1.5 ? -1.0 : -r) + nrm * corner.y * r;
    } else {
      if (kind.w < 0.5) { vec2 m = vec2(-tB.y, tB.x); p = pb + m * corner.y * r / max(dot(m, nrm), 0.3); }
      else p = pb + dir * (kind.w > 1.5 ? 1.0 : r) + nrm * corner.y * r;
    }
    local = vec2(dot(p - pa, dir), dot(p - pa, nrm));
    joins = vec2(kind.z < 0.5 ? dot(p - pa, tA) : 1e6, kind.w < 0.5 ? dot(pb - p, tB) : 1e6);
  }
  scene = (p - base.yz) / base.x;
  gl_Position = vec4(p / size * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}`;

// mode 0: the tile's strokes where the piece lies, in `colour`; 1: only
// where it lies (the stencil, a mask: `value`)
const FS = `#version 300 es
precision highp float;
in vec2 local;
in vec2 joins;
in float len;
in vec2 scene;
flat in vec4 kindF;
flat in float alpha;
flat in float value;
uniform int mode;
uniform sampler2D tile;
uniform vec3 tileAt;                  // cos, sin of the lines' angle, the tile's size (scene px)
uniform vec4 colour;
out vec4 outColour;
void main() {
  float cover = 1.0;
  if (kindF.x > 0.5) {
    if (joins.x < 0.0 || joins.y < 0.0) discard;
    float hw = kindF.y, d, edge = 1.0;
    float u = local.x, v = local.y;
    float e = u < 0.0 ? -u : u - len;
    float end = u < 0.0 ? kindF.z : kindF.w;
    if (e > 0.0 && end > 0.5) {
      if (end < 1.5) d = length(vec2(e, v));
      else { d = abs(v); edge = clamp(0.5 - e, 0.0, 1.0); }
    } else d = abs(v);
    cover = clamp(min(d + 0.5, hw) - max(d - 0.5, -hw), 0.0, 1.0) * edge;
  }
  if (mode == 1) {
    if (cover < 0.5) discard;
    outColour = vec4(value);
    return;
  }
  if (cover <= 0.0) discard;
  vec2 t = vec2(scene.x * tileAt.x + scene.y * tileAt.y, -scene.x * tileAt.y + scene.y * tileAt.x) / tileAt.z;
  outColour = colour * (texture(tile, t).a * cover * alpha);
}`;

// The night: a grey and up to three sets of the strokes over the whole
// canvas, each laid in sweeps as a hand hatches (nightCanvas.js sweep), all
// but where the mask leaves out.
const SHEET_VS = `#version 300 es
layout(location = 0) in vec2 corner;
void main() { gl_Position = vec4(corner.x * 2.0 - 1.0, corner.y, 0.0, 1.0); }`;
const SHEET_FS = `#version 300 es
precision highp float;
uniform vec3 base;
uniform vec2 size;
uniform sampler2D tile;
uniform sampler2D mask;
uniform int masked;
uniform float tileSize;
uniform vec4 grey;                    // premultiplied
uniform vec4 colour;
uniform vec4 sets[3];                 // cos, sin of each set's angle, along and across (scene px)
uniform vec3 reveal;
uniform float band;                   // device px
out vec4 outColour;
float hash(float a, float b) { return fract(sin(a * 127.1 + b * 311.7) * 43758.5453); }
// how much of set i is laid here (sweep: bands across its lines, each laid along them so far)
float laid(int i, vec2 d) {
  float r = reveal[i];
  if (r <= 0.0) return 0.0;
  if (r >= 1.0) return 1.0;
  float c = sets[i].x, s = sets[i].y;
  float u = d.x * c + d.y * s, v = -d.x * s + d.y * c;
  vec4 us = vec4(0.0, size.x * c, size.y * s, size.x * c + size.y * s);
  vec4 vs = vec4(0.0, -size.x * s, size.y * c, -size.x * s + size.y * c);
  float u0 = min(min(us.x, us.y), min(us.z, us.w)), u1 = max(max(us.x, us.y), max(us.z, us.w));
  float v0 = min(min(vs.x, vs.y), min(vs.z, vs.w)), v1 = max(max(vs.x, vs.y), max(vs.z, vs.w));
  float n = ceil((v1 - v0) / band), k = floor((v - v0) / band);
  float at = (k / n + (hash(float(i) * 7.3, k) - 0.5) * 0.04) * 0.55;
  float q = clamp((r - at) / 0.45, 0.0, 1.0);
  return u <= u0 + (u1 - u0) * q ? 1.0 : 0.0;
}
void main() {
  vec2 d = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
  if (masked == 1 && texelFetch(mask, ivec2(gl_FragCoord.xy), 0).r < 0.5) discard;
  vec2 p = (d - base.yz) / base.x;
  vec4 o = grey;
  for (int i = 0; i < 3; i++) {
    if (reveal[i] <= 0.0) continue;
    float c = sets[i].x, s = sets[i].y;
    vec2 t = (vec2(p.x * c + p.y * s, -p.x * s + p.y * c) - sets[i].zw) / tileSize;
    float a = texture(tile, t).a * laid(i, d);
    o = colour * a + o * (1.0 - a);
  }
  outColour = o;
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs, names) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return { p, u: Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)])) };
}

// A colour (#rrggbb or rgb()) as [r, g, b] 0 … 1.
export const rgb = (c) => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(c).trim());
  if (m) return [1, 2, 3].map((i) => parseInt(m[i], 16) / 255);
  const n = /rgba?\(([^)]+)\)/.exec(c)?.[1].split(',').map(Number);
  return n ? n.slice(0, 3).map((v) => v / 255) : [0, 0, 0];
};

// ------------------------------------------------------------------ shapes

// A shape's fill (triangles) and its pen lines (polylines, with how their
// ends are drawn), in its own units, kept per path: `kind` 'shape' (filled,
// its edge dashed round it), 'fill' (filled only), 'line' (a pen line,
// round ends). Not kept (`keep` false) for a shape seen once (a beam).
const meshes = new Map();
export function meshOf(kind, d, evenodd = false, keep = true) {
  const key = `${kind}${evenodd ? 'e' : ''}|${d}`;
  let m = keep ? meshes.get(key) : null;
  if (m) {
    // (the most recently used last: the oldest go first)
    meshes.delete(key);
    meshes.set(key, m);
    return m;
  }
  const subs = flattenPath(d, TOLERANCE);
  let tris = new Float32Array(0);
  if (kind !== 'line') {
    const { positions, indices } = triangulate(subs, evenodd ? 'evenodd' : 'nonzero');
    tris = new Float32Array(indices.length * 2);
    for (let i = 0; i < indices.length; i++) {
      tris[i * 2] = positions[indices[i] * 2];
      tris[i * 2 + 1] = positions[indices[i] * 2 + 1];
    }
  }
  let lines = [];
  if (kind === 'line') lines = subs.filter((s) => s.pts.length > 1).map((s) => ({ pts: s.pts, closed: s.closed, cap: 1 }));
  else if (kind === 'shape') lines = dashed(subs, EDGE.dash);
  m = { tris, lines, width: kind === 'line' ? LINE : EDGE.width };
  if (!keep) return m;
  meshes.set(key, m);
  if (meshes.size > 6000) for (const k of [...meshes.keys()].slice(0, 2000)) meshes.delete(k);
  return m;
}

// Subpaths cut into the dashes of `pattern` (on and off by turns, from each
// subpath's start, as a canvas dashes them): polylines with butt ends.
export function dashed(subs, pattern) {
  const out = [], total = pattern.reduce((a, b) => a + b, 0);
  for (const { pts, closed } of subs) {
    const ring = closed && pts.length > 2 ? [...pts, pts[0]] : pts;
    let at = 0, cur = null;
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1], [bx, by] = ring[i];
      const len = Math.hypot(bx - ax, by - ay);
      let s = 0;
      while (s < len) {
        let k = 0, rest = at % total;
        while (k < pattern.length - 1 && rest >= pattern[k]) rest -= pattern[k++];
        const step = Math.max(1e-6, Math.min(pattern[k] - rest, len - s));
        const p = [ax + ((bx - ax) * s) / len, ay + ((by - ay) * s) / len];
        const q = [ax + ((bx - ax) * (s + step)) / len, ay + ((by - ay) * (s + step)) / len];
        if (k % 2 === 0) {
          if (!cur) out.push((cur = { pts: [p], closed: false, cap: 2 }));
          cur.pts.push(q);
        } else cur = null;
        s += step;
        at += step;
      }
    }
    cur = null;
  }
  return out;
}

// The pieces of many shapes, each where it lies (matrix: its own units ->
// scene px), written into one growing array.
export class Pieces {
  constructor() {
    this.data = new Float32Array(STRIDE * 1024);
    this.n = 0;
  }

  room(k) {
    if ((this.n + k) * STRIDE <= this.data.length) return;
    let len = this.data.length * 2;
    while ((this.n + k) * STRIDE > len) len *= 2;
    const more = new Float32Array(len);
    more.set(this.data);
    this.data = more;
  }

  // A shape (meshOf) laid with `m` = [a, b, c, d, e, f]; `alpha`, `group`
  // (whose alpha the draw gives), `value` (what it writes into a mask).
  shape(mesh, m, alpha = 1, group = 0, value = 1) {
    const [a, b, c, d, e, f] = m;
    const t = mesh.tris;
    this.room(t.length / 6);
    let D = this.data;
    for (let i = 0; i < t.length; i += 6) {
      const o = this.n++ * STRIDE;
      D[o] = a * t[i] + c * t[i + 1] + e; D[o + 1] = b * t[i] + d * t[i + 1] + f;
      D[o + 2] = a * t[i + 2] + c * t[i + 3] + e; D[o + 3] = b * t[i + 2] + d * t[i + 3] + f;
      D[o + 4] = a * t[i + 4] + c * t[i + 5] + e; D[o + 5] = b * t[i + 4] + d * t[i + 5] + f;
      D[o + 6] = D[o + 7] = D[o + 8] = D[o + 9] = D[o + 10] = D[o + 11] = 0;
      D[o + 12] = alpha; D[o + 13] = group; D[o + 14] = value; D[o + 15] = 0;
    }
    if (!mesh.lines.length) return;
    // the pen's width as the matrix scales it (on average)
    const hw = (mesh.width / 2) * Math.sqrt(Math.abs(a * d - b * c));
    for (const { pts, closed, cap } of mesh.lines) {
      const count = pts.length + (closed ? 1 : 0);
      this.room(count);
      D = this.data;
      const X = (i) => { const p = pts[i % pts.length]; return a * p[0] + c * p[1] + e; };
      const Y = (i) => { const p = pts[i % pts.length]; return b * p[0] + d * p[1] + f; };
      const ring = closed && count > 3;
      for (let i = 1; i < count; i++) {
        const ip = i > 1 ? i - 2 : ring ? count - 2 : i - 1;
        const iq = i < count - 1 ? i + 1 : ring ? 1 : i;
        const t1 = Math.atan2(Y(i - 1) - Y(ip), X(i - 1) - X(ip)), t2 = Math.atan2(Y(i) - Y(i - 1), X(i) - X(i - 1));
        const turn = Math.abs(Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1)));
        const endA = i === 1 && !ring ? cap : ip !== i - 1 && turn > 0.35 ? 1 : 0;
        const endB = i === count - 1 && !ring ? cap : 0;
        const o = this.n++ * STRIDE;
        D[o] = X(i - 1); D[o + 1] = Y(i - 1); D[o + 2] = X(i); D[o + 3] = Y(i);
        D[o + 4] = X(ip); D[o + 5] = Y(ip); D[o + 6] = X(iq); D[o + 7] = Y(iq);
        D[o + 8] = 1; D[o + 9] = hw; D[o + 10] = endA; D[o + 11] = endB;
        D[o + 12] = alpha; D[o + 13] = group; D[o + 14] = value; D[o + 15] = 0;
      }
    }
  }
}

// ------------------------------------------------------------------- the GPU

export class Hatching {
  static make(canvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true, stencil: true });
    return gl ? new Hatching(canvas, gl) : null;
  }

  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.prog = program(gl, VS, FS, ['base', 'size', 'alphas', 'mode', 'tile', 'tileAt', 'colour']);
    this.sheetProg = program(gl, SHEET_VS, SHEET_FS, ['base', 'size', 'tile', 'mask', 'masked', 'tileSize', 'grey', 'colour', 'sets', 'reveal', 'band']);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.sheetVao = gl.createVertexArray();
    gl.bindVertexArray(this.sheetVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.tiles = new Map(); // key -> { tex, size }
    this.w = this.h = 0;
  }

  // A buffer of pieces to draw (again and again, until loaded anew).
  buffer() {
    const { gl } = this;
    const vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const [loc, off] of [[1, 0], [2, 4], [3, 8], [4, 12]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, STRIDE * 4, off * 4);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    return { vao, buf, n: 0 };
  }

  load(b, pieces) {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
    gl.bufferData(gl.ARRAY_BUFFER, pieces.data.subarray(0, pieces.n * STRIDE), gl.DYNAMIC_DRAW);
    b.n = pieces.n;
    return b;
  }

  // The canvas `w` × `h` device px (its css size set by the caller).
  size(w, h) {
    const { canvas, gl } = this;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      if (this.maskTex) {
        this.gl.deleteTexture(this.maskTex.tex);
        this.gl.deleteFramebuffer(this.maskTex.fb);
        this.maskTex = null;
      }
    }
    this.w = w;
    this.h = h;
    gl.viewport(0, 0, w, h);
  }

  clear() {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.stencilMask(0xff);
    gl.colorMask(true, true, true, true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  }

  // The tile of the paper's strokes up to `tier` (hatch.js), drawn with a
  // pen `width` scene px wide at `q` device px to a scene px – as the 2D
  // canvases' patterns (shadeWorker.js, NightCanvas.tileFor).
  tile(tier, hatch, px, width, q) {
    const key = `${tier}|${JSON.stringify(hatch)}|${px}|${width}|${q}`;
    let t = this.tiles.get(key);
    if (t) return t;
    const { d, size } = hatchTileLines(tier, hatch, px);
    const n = Math.max(1, Math.min(4096, Math.round(size * q)));
    const off = new OffscreenCanvas(n, n), c = off.getContext('2d');
    c.scale(n / size, n / size);
    c.strokeStyle = '#fff';
    c.lineWidth = width;
    c.lineCap = c.lineJoin = 'round';
    c.stroke(new Path2D(d));
    const { gl } = this;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, off);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    t = { tex, size, angle: hatch.angle };
    this.tiles.set(key, t);
    // (a few kept: the shadows', the night's, the clouds' at a zoom or two)
    if (this.tiles.size > 8) {
      const [k0, t0] = this.tiles.entries().next().value;
      gl.deleteTexture(t0.tex);
      this.tiles.delete(k0);
    }
    return t;
  }

  // Pieces drawn: `base` [scale, x, y] scene px -> device px; with the
  // tile's strokes in `colour` ([r, g, b]) where they lie, the groups'
  // `alphas`; or (`stencil`: { ref, write, test }) into the stencil only.
  pieces(b, { base, tile = null, colour = [0, 0, 0], alphas = [1, 1, 1, 1], stencil = null, test = null }) {
    if (!b?.n) return;
    const { gl } = this, { p, u } = this.prog;
    gl.useProgram(p);
    gl.uniform3fv(u.base, base);
    gl.uniform2f(u.size, this.w, this.h);
    gl.uniform4fv(u.alphas, alphas);
    if (stencil) {
      gl.uniform1i(u.mode, 1);
      gl.colorMask(false, false, false, false);
      gl.disable(gl.BLEND);
      gl.enable(gl.STENCIL_TEST);
      gl.stencilMask(stencil.write);
      gl.stencilFunc(gl.ALWAYS, stencil.ref, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    } else {
      gl.uniform1i(u.mode, 0);
      gl.colorMask(true, true, true, true);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      if (test) {
        gl.enable(gl.STENCIL_TEST);
        gl.stencilMask(0);
        gl.stencilFunc(gl.EQUAL, test.ref, test.mask);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      } else gl.disable(gl.STENCIL_TEST);
      const a = (tile.angle * Math.PI) / 180;
      gl.uniform3f(u.tileAt, Math.cos(a), Math.sin(a), tile.size);
      gl.uniform4f(u.colour, colour[0], colour[1], colour[2], 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tile.tex);
      gl.uniform1i(u.tile, 0);
    }
    gl.bindVertexArray(b.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.n);
    gl.bindVertexArray(null);
    gl.colorMask(true, true, true, true);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.STENCIL_TEST);
  }

  // The mask the night's sheet is drawn through (texelFetch by the canvas's
  // px): cleared to `fill` (0 or 1), then the buffers' pieces in order, each writing
  // its value (1 the night, 0 a light) – later ones over earlier.
  mask(bs, base, fill) {
    const { gl } = this;
    if (!this.maskTex) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.w, this.h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindTexture(gl.TEXTURE_2D, null); // (drawn into: not bound)
      this.maskTex = { tex, fb };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskTex.fb);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(fill, fill, fill, fill);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const b of bs) {
      if (!b?.n) continue;
      const { p, u } = this.prog;
      gl.useProgram(p);
      gl.uniform3fv(u.base, base);
      gl.uniform2f(u.size, this.w, this.h);
      gl.uniform4fv(u.alphas, [1, 1, 1, 1]);
      gl.uniform1i(u.mode, 1);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(b.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.n);
      gl.bindVertexArray(null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
  }

  // The night's sheet over the canvas: `grey` (alpha) in `greyColour`, the
  // `tile`'s strokes in `colour` as `sets` ([angle, along, across]…, scene
  // px) laid as far as `reveal` says; through the mask (mask()) if `masked`.
  sheet({ base, tile, grey, greyColour, colour, sets, reveal, band, masked }) {
    const { gl } = this, { p, u } = this.sheetProg;
    gl.useProgram(p);
    gl.uniform3fv(u.base, base);
    gl.uniform2f(u.size, this.w, this.h);
    const g = rgb(greyColour);
    gl.uniform4f(u.grey, g[0] * grey, g[1] * grey, g[2] * grey, grey);
    gl.uniform4f(u.colour, colour[0], colour[1], colour[2], 1);
    const S = new Float32Array(12);
    sets.forEach(([angle, along, across], i) => {
      const a = (angle * Math.PI) / 180;
      S.set([Math.cos(a), Math.sin(a), along, across], i * 4);
    });
    gl.uniform4fv(u.sets, S);
    gl.uniform3f(u.reveal, tile ? reveal[0] : 0, tile ? reveal[1] : 0, tile ? reveal[2] : 0);
    gl.uniform1f(u.band, band);
    gl.uniform1f(u.tileSize, tile?.size ?? TILE);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tile?.tex ?? null);
    gl.uniform1i(u.tile, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, masked && this.maskTex ? this.maskTex.tex : null);
    gl.uniform1i(u.mask, 1);
    gl.uniform1i(u.masked, masked && this.maskTex ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    gl.bindVertexArray(this.sheetVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    // (the mask let go: drawn into next time, it mustn't be bound)
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
  }
}
