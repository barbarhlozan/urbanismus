// What moves on the map – people, cyclists, cars, trucks, trains, boats,
// animals, the crossing signs – drawn with WebGL2 instead of a 2D canvas
// (agentCanvas.js, whose place it takes, the same calls): a 2D canvas is a
// new picture each frame, which Firefox copies to the GPU whole; this one
// is drawn on the GPU and stays there.
//
// The drawings are the same SVG snippets (vehicles.js, people.js…), their
// paths flattened and filled once (geometry.js) and kept per shape. Each
// frame what is drawn is noted in order (draw, drawScene) and laid out at
// its end (end) as one stream of pieces, each a filled triangle or a pen
// stroke's segment, already where it shows on the screen – so the
// painter's order is kept exactly, in a single draw call. The strokes'
// edges are antialiased as the map's lines are (gl/lines.js); the fills by
// the canvas's multisampling.
//
//   const pen = GLMovers.make(canvas)   (null without WebGL2)
//   pen.begin(camera, stroke); pen.draw(shapes, sx, sy, k, mirror, shear, squash); … pen.end()

import { THEME } from '../../theme.js';
import { flattenPath, triangulate } from './geometry.js';

// How far (css px) past the window edge something may stand and still show
// (as agentCanvas.js).
const MARGIN = 60;
// Curves flattened to within this of the true line, in a shape's own units
// (drawn up to a few device px per unit close up).
const TOLERANCE = 0.03;
// floats per piece
const STRIDE = 16;

const VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 corner;  // x 0 at a, 1 at b; y across (±1) – for a triangle the corners are its points
layout(location = 1) in vec4 ab;      // a fill: its first two points; a stroke: a, b (device px)
layout(location = 2) in vec4 cp;      // a fill: its third point; a stroke: the point before a, after b
layout(location = 3) in vec4 kind;    // fill (0) or stroke (1), the stroke's half width (px), its ends at a and b (0 a join, 1 round, 2 butt)
layout(location = 4) in vec4 paint;   // colour index, alpha
uniform vec2 size;
uniform vec4 colours[8];
out vec2 local;
out vec2 joins;
out float len;
flat out vec4 kindF;
flat out vec4 colour;
vec2 unit(vec2 v, vec2 or) { float l = length(v); return l > 1e-4 ? v / l : or; }
void main() {
  kindF = kind;
  colour = colours[int(paint.x)] * paint.y;
  vec2 p;
  if (kind.x < 0.5) {
    // a triangle: corners 0, 1, 2 its points, 3 the last again
    int c = int(corner.x + 0.5) + 2 * int(corner.y > 0.0);
    p = c == 0 ? ab.xy : c == 1 ? ab.zw : cp.xy;
    local = vec2(0.0); joins = vec2(1e6); len = 0.0;
  } else {
    vec2 pa = ab.xy, pb = ab.zw;
    float r = kind.y + 1.0;
    len = length(pb - pa);
    vec2 dir = unit(pb - pa, vec2(1.0, 0.0)), nrm = vec2(-dir.y, dir.x);
    vec2 tA = unit(dir + unit(pa - cp.xy, dir), dir), tB = unit(dir + unit(cp.zw - pb, dir), dir);
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
  gl_Position = vec4(p / size * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}`;

const FS = `#version 300 es
precision highp float;
in vec2 local;
in vec2 joins;
in float len;
flat in vec4 kindF;
flat in vec4 colour;
out vec4 outColour;
void main() {
  if (kindF.x < 0.5) { outColour = colour; return; }
  if (joins.x < 0.0 || joins.y < 0.0) discard;
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
  outColour = colour * cover;
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

const rgb = (c) => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(c.trim());
  if (m) return [1, 2, 3].map((i) => parseInt(m[i], 16) / 255);
  const n = /rgba?\(([^)]+)\)/.exec(c)?.[1].split(',').map(Number);
  return n ? n.slice(0, 3).map((v) => v / 255) : [0, 0, 0];
};
const COLOURS = ['bg', 'main', 'detail'];

// A shape's fill (triangles) and stroke (polylines) in its own units, kept.
const meshes = new WeakMap();
function meshOf(shape) {
  let m = meshes.get(shape);
  if (m) return m;
  const d = shape.d ?? '';
  const subs = flattenPath(d, TOLERANCE);
  let tris = new Float32Array(0);
  if (shape.style.fill) {
    const { positions, indices } = triangulate(subs, 'nonzero');
    tris = new Float32Array(indices.length * 2);
    for (let i = 0; i < indices.length; i++) {
      tris[i * 2] = positions[indices[i] * 2];
      tris[i * 2 + 1] = positions[indices[i] * 2 + 1];
    }
  }
  const lines = shape.style.stroke ? subs.filter((s) => s.pts.length > 1).map((s) => ({ pts: s.pts, closed: s.closed })) : [];
  m = { tris, lines };
  meshes.set(shape, m);
  return m;
}

export class GLMovers {
  static make(canvas, { antialias = true } = {}) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias, alpha: true });
    return gl ? new GLMovers(canvas, gl) : null;
  }

  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.empty = true;
    this.notes = [];
    const p = (this.program = gl.createProgram());
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.u = { size: gl.getUniformLocation(p, 'size'), colours: gl.getUniformLocation(p, 'colours') };
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    for (const [loc, off] of [[1, 0], [2, 4], [3, 8], [4, 12]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, STRIDE * 4, off * 4);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    this.data = new Float32Array(STRIDE * 4096);
  }

  // Start a frame at the camera's current view (agentCanvas.js).
  begin(camera, stroke) {
    const dpr = devicePixelRatio || 1;
    this.dpr = dpr;
    this.W = innerWidth;
    this.H = innerHeight;
    this.strokeK = stroke ?? 1 / camera.zoom;
    this.zoom = camera.zoom;
    this.panX = camera.panX;
    this.panY = camera.panY;
    this.pal = THEME.palette;
    this.notes.length = 0;
  }

  clear() {
    this.notes.length = 0;
    this.end();
  }

  onScreen(sx, sy) {
    const x = this.panX + this.zoom * sx, y = this.panY + this.zoom * sy;
    return x > -MARGIN && y > -MARGIN && x < this.W + MARGIN && y < this.H + MARGIN;
  }

  draw(shapes, sx, sy, k = 1, mirror = false, shear = 0, squash = 1) {
    if (!(k > 0.001) || !this.onScreen(sx, sy)) return;
    const { dpr, zoom } = this;
    const m = dpr * zoom * k;
    this.notes.push({ shapes, a: mirror ? -m : m, b: m * shear, d: m * squash, e: dpr * (this.panX + zoom * sx), f: dpr * (this.panY + zoom * sy), alpha: 1 });
  }

  // Shapes already in scene coordinates (a truck or train far out), faded
  // to `alpha`: the outline's points, kept on the 2D canvas path
  // (Renderer outline).
  drawScene(style, path, alpha = 1) {
    const pts = path.pts;
    if (!pts) return;
    const { dpr, zoom } = this;
    const shape = { style, d: `M${pts.map((p) => p.join(' ')).join('L')}Z` };
    this.notes.push({ shapes: [shape], a: dpr * zoom, b: 0, d: dpr * zoom, e: dpr * this.panX, f: dpr * this.panY, alpha, own: true });
  }

  // Straight pen strokes with round ends, `segs` [x0, y0, x1, y1, …] in
  // window px, `width` device px wide, in the palette's `colour`, `alpha`
  // (the rain).
  segments(segs, width, colour = 'detail', alpha = 1) {
    this.notes.push({ segs, width, colour, alpha });
  }

  // The frame drawn: every note's shapes as pieces where they show, in order.
  end() {
    const { gl, canvas, dpr } = this;
    const w = Math.round((this.W ?? innerWidth) * dpr), h = Math.round((this.H ?? innerHeight) * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${this.W}px`;
      canvas.style.height = `${this.H}px`;
    }
    // (written straight into the buffer: tens of thousands of pieces a frame)
    let n = 0, D = this.data;
    const room = () => {
      if ((n + 1) * STRIDE <= D.length) return;
      const more = new Float32Array(D.length * 2);
      more.set(D);
      this.data = D = more;
    };
    // the pens (agentCanvas.js paint): a stroke's width on the screen is its
    // style's times --stroke, the zoom and the pixel ratio, at any size
    const colourIndex = { bg: 0, main: 1, detail: 2 };
    const px = this.strokeK * this.zoom * dpr;
    const P = new Float32Array(2 * 1024);
    for (const note of this.notes) {
      if (note.segs) {
        const { segs, width, alpha } = note, c = colourIndex[note.colour] ?? 2, hw = width / 2;
        for (let i = 0; i + 3 < segs.length; i += 4) {
          room();
          const o = n++ * STRIDE;
          const x0 = segs[i] * dpr, y0 = segs[i + 1] * dpr, x1 = segs[i + 2] * dpr, y1 = segs[i + 3] * dpr;
          D[o] = x0; D[o + 1] = y0; D[o + 2] = x1; D[o + 3] = y1;
          D[o + 4] = x0; D[o + 5] = y0; D[o + 6] = x1; D[o + 7] = y1;
          D[o + 8] = 1; D[o + 9] = hw; D[o + 10] = 1; D[o + 11] = 1;
          D[o + 12] = c; D[o + 13] = alpha; D[o + 14] = D[o + 15] = 0;
        }
        continue;
      }
      const { a, b, d, e, f, alpha } = note;
      for (const shape of note.shapes) {
        const mesh = meshOf(shape);
        const { style } = shape;
        if (style.fill) {
          const t = mesh.tris, c = colourIndex[style.fill] ?? 1;
          for (let i = 0; i < t.length; i += 6) {
            room();
            const o = n++ * STRIDE;
            D[o] = a * t[i] + e; D[o + 1] = b * t[i] + d * t[i + 1] + f;
            D[o + 2] = a * t[i + 2] + e; D[o + 3] = b * t[i + 2] + d * t[i + 3] + f;
            D[o + 4] = a * t[i + 4] + e; D[o + 5] = b * t[i + 4] + d * t[i + 5] + f;
            D[o + 6] = D[o + 7] = D[o + 8] = D[o + 9] = D[o + 10] = D[o + 11] = 0;
            D[o + 12] = c; D[o + 13] = alpha; D[o + 14] = D[o + 15] = 0;
          }
        }
        if (style.stroke) {
          const hw = (style.width * px) / 2, c = colourIndex[style.stroke] ?? 1;
          for (const { pts, closed } of mesh.lines) {
            // the line where it shows (closed: its first point again at the end)
            let k = 0;
            const count = pts.length + (closed ? 1 : 0);
            if (count * 2 > P.length) continue;
            for (let i = 0; i < count; i++) {
              const [x, y] = pts[i % pts.length];
              P[k++] = a * x + e;
              P[k++] = b * x + d * y + f;
            }
            const ring = closed && count > 3;
            for (let i = 1; i < count; i++) {
              const ia = (i - 1) * 2, ib = i * 2;
              const ip = i > 1 ? ia - 2 : ring ? (count - 2) * 2 : ia;
              const iq = i < count - 1 ? ib + 2 : ring ? 2 : ib;
              // joins round where they turn sharply (the 2D canvas joins
              // round everywhere), butt ends (its default)
              const t1 = Math.atan2(P[ia + 1] - P[ip + 1], P[ia] - P[ip]), t2 = Math.atan2(P[ib + 1] - P[ia + 1], P[ib] - P[ia]);
              const turn = Math.abs(Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1)));
              const endA = i === 1 && !ring ? 2 : ip !== ia && turn > 0.35 ? 1 : 0;
              const endB = i === count - 1 && !ring ? 2 : 0;
              room();
              const o = n++ * STRIDE;
              D[o] = P[ia]; D[o + 1] = P[ia + 1]; D[o + 2] = P[ib]; D[o + 3] = P[ib + 1];
              D[o + 4] = P[ip]; D[o + 5] = P[ip + 1]; D[o + 6] = P[iq]; D[o + 7] = P[iq + 1];
              D[o + 8] = 1; D[o + 9] = hw; D[o + 10] = endA; D[o + 11] = endB;
              D[o + 12] = c; D[o + 13] = alpha; D[o + 14] = D[o + 15] = 0;
            }
          }
        }
      }
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.empty = n === 0;
    if (!n) return;
    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(this.u.size, w, h);
    const pal = this.pal ?? THEME.palette;
    const cols = new Float32Array(8 * 4);
    COLOURS.forEach((name, i) => cols.set([...rgb(pal[name]), 1], i * 4));
    gl.uniform4fv(this.u.colours, cols);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, D.subarray(0, n * STRIDE), gl.STREAM_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.bindVertexArray(null);
  }
}
