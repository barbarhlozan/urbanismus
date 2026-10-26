// The map's pen lines drawn with WebGL2: the roads, footpaths, railways and
// fences (so far), from the same items the SVG ink layers draw (ink.js),
// kept on the GPU in world space – the relief and the map's warp and wobble
// already in each point – so that a pan, a zoom or a turn only changes the
// camera, and nothing is laid out, restyled or rasterised by the browser.
//
// A line is drawn a segment at a time, each a quad around it whose pixels
// are kept by their distance from it (the pen's edge antialiased as the
// SVG's is): line widths in the map's pens times --stroke (Renderer.
// updateStroke), round or butt or square ends as styles.css has them, a
// round join only where a line turns sharply (on the many little bends of
// a densified curve the segments simply meet), dashes along the line as it
// shows on the screen, and the pen's draw-in and erase (ink.js) as how much
// of each item is shown.
//
//   const gl = new GLLines(canvas)        (null-safe: GLLines.make returns null without WebGL2)
//   gl.setLayer(name, items, classes)     items: [{ key, cls, pts|runs: [[x, y, z]…] }] in world space
//   gl.draw(view, look)                   each frame; draws only when something changed

import { brushWidths, BRUSH_GLSL } from '../brush.js';

// Line styles: the classes the ink layers draw (styles.css), their pen
// (css px before --stroke), colour, ends and dashes (css px before --stroke).
// `wash`: a road's or a path's whole width laid in one flat band of colour
// along its centre line, its edge as crisp as the painted houses' and
// shadows', only in the painted schemes (look.wash: its width in world
// units and its colour), which leave out the pen lines in WASHED.
const STYLES = {
  'road-wash': { colour: 'wash', width: 0, cap: 'round', wash: 'road' },
  // (at a map exit carried on off the map, fading out as the pen's road does)
  'road-wash-exit': { colour: 'wash', width: 0, cap: 'butt', wash: 'road', fade: [0.8, 1.9] },
  'path-wash': { colour: 'wash', width: 0, cap: 'round', wash: 'path' },
  driveway: { colour: 'detail', width: 1, cap: 'butt' },
  road: { colour: 'fg', width: 1.4, cap: 'round' },
  kerb: { colour: 'fg', width: 1, cap: 'round' },
  zebra: { colour: 'detail', width: 2, cap: 'butt' },
  'road-exit': { colour: 'fg', width: 1.4, cap: 'butt', dash: [3, 4] },
  footpath: { colour: 'fg', width: 0.7, cap: 'round' },
  bridge: { colour: 'fg', width: 1, cap: 'round' },
  'bridge-post': { colour: 'fg', width: 0.7, cap: 'round' },
  'rail-exit': { colour: 'fg', width: 3.6, cap: 'butt', dash: [3, 5], far: true },
  'rail-buffer': { colour: 'fg', width: 2, cap: 'square' },
  rail: { colour: 'fg', width: 3.6, cap: 'butt', far: true },
  'rail-dash': { colour: 'bg', width: 1.4, cap: 'butt', dash: [7, 7], far: true },
  'track-bed': { colour: 'main', width: 0.7, cap: 'round', near: true },
  'track-sleeper': { colour: 'detail', width: 0.7, cap: 'butt', near: true },
  'track-rail': { colour: 'main', width: 1, cap: 'round', near: true },
  'track-exit': { colour: 'main', width: 1, cap: 'butt', dash: [3, 4], near: true },
  'fence-post': { colour: 'detail', width: 1, cap: 'round' },
  'fence-pillar': { colour: 'detail', width: 2, cap: 'butt' },
  fence: { colour: 'detail', width: 1, cap: 'round' },
};
// the far-out level of detail leaves these out (styles.css #world.lod-2)
const FAR_HIDDEN = new Set(['driveway', 'zebra']);
// the painted schemes leave these out: the washes stand for them
const WASHED = new Set(['road', 'kerb', 'zebra', 'road-exit', 'footpath', 'driveway']);
const CAPS = { butt: 1, round: 0, square: 2 };
const STRIDE = 19; // floats per segment
// scene px to a world unit (the map's tile), for the brush's lengths
const TILE_PX = 32;
// A join turning more than this (radians) gets a round one.
const SHARP = 0.35;

const VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 corner;   // the quad: x 0 at a, 1 at b; y across (±1)
layout(location = 1) in vec3 a;
layout(location = 2) in vec3 b;
layout(location = 3) in vec4 meta;     // style, item, along at a, along at b (world units)
layout(location = 4) in vec2 ends;     // at a, at b: 0 a join, 1 round, 2 butt, 3 square, 4 cut square
layout(location = 5) in vec2 dash;     // along at a, at b, on the screen (scene px), for dashes
layout(location = 6) in vec3 prev;     // the point before a (a join at a)
layout(location = 7) in vec3 next;     // the point after b (a join at b)
layout(location = 8) in float brush;   // its widths at a and b (brush.js)
uniform vec2 rot;                      // cos, sin of the view's turn
uniform vec2 centre;                   // the map's middle (Camera.cx, cy)
uniform vec3 iso;                      // tile·cos30, tile·sin30, tile·zScale
uniform vec3 place;                    // zoom, pan x, pan y (wrapper px, the overscan in)
uniform vec2 size;                     // the canvas in device px
uniform float dpr;
uniform vec4 width[32];                // per style: half width in device px, a wash (1)?, fading from, to (world units along)
out vec2 local;                        // px from a: along, across
out vec2 joins;                        // px inside the joins' lines at a and at b (< 0: the neighbour's)
out float len;                         // the segment's length in px
flat out int styleId;
flat out int itemId;
flat out vec2 endsF;
flat out vec2 brushW;                  // its width at a and at b, shares of its pen's
out float along;                       // world units along the item
out float dashAt;                      // scene px along it on the screen
${BRUSH_GLSL}
vec2 project(vec3 p) {
  vec2 d = p.xy - centre;
  vec2 r = vec2(d.x * rot.x - d.y * rot.y, d.x * rot.y + d.y * rot.x);
  vec2 scene = vec2((r.x - r.y) * iso.x, (r.x + r.y) * iso.y - p.z * iso.z);
  return (place.yz + place.x * scene) * dpr;
}
vec2 unit(vec2 v, vec2 or) { float l = length(v); return l > 1e-4 ? v / l : or; }
void main() {
  styleId = int(meta.x);
  itemId = int(meta.y);
  endsF = ends;
  brushW = brushUnpack(brush);
  float hw = width[styleId].x, r = hw * max(brushW.x, brushW.y) + 1.0;
  vec2 pa = project(a), pb = project(b);
  len = length(pb - pa);
  vec2 dir = unit(pb - pa, vec2(1.0, 0.0)), nrm = vec2(-dir.y, dir.x);
  // a join: the two segments cut along the line halfway between them
  vec2 tA = unit(dir + unit(pa - project(prev), dir), dir);
  vec2 tB = unit(dir + unit(project(next) - pb, dir), dir);
  vec2 p;
  if (corner.x < 0.5) {
    if (ends.x < 0.5) { vec2 m = vec2(-tA.y, tA.x); p = pa + m * corner.y * r / max(dot(m, nrm), 0.3); }
    else p = pa + dir * (ends.x > 1.5 && ends.x < 2.5 ? -1.0 : ends.x > 3.5 ? 0.0 : -r) + nrm * corner.y * r;
  } else {
    if (ends.y < 0.5) { vec2 m = vec2(-tB.y, tB.x); p = pb + m * corner.y * r / max(dot(m, nrm), 0.3); }
    else p = pb + dir * (ends.y > 1.5 && ends.y < 2.5 ? 1.0 : ends.y > 3.5 ? 0.0 : r) + nrm * corner.y * r;
  }
  local = vec2(dot(p - pa, dir), dot(p - pa, nrm));
  joins = vec2(ends.x < 0.5 ? dot(p - pa, tA) : 1e6, ends.y < 0.5 ? dot(pb - p, tB) : 1e6);
  float t = len > 1e-4 ? clamp(local.x / len, 0.0, 1.0) : corner.x;
  along = mix(meta.z, meta.w, t);
  dashAt = mix(dash.x, dash.y, t);
  gl_Position = vec4(p / size * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}`;

const FS = `#version 300 es
precision highp float;
in vec2 local;
in vec2 joins;
in float len;
flat in int styleId;
flat in int itemId;
flat in vec2 endsF;
flat in vec2 brushW;
in float along;
in float dashAt;
uniform vec4 width[32];
uniform vec4 colour[32];               // premultiplied
uniform vec4 dashes[32];               // on, off (scene px), dashed?, shown?
uniform sampler2D items;               // per item: shown up to (world units), from the end?, its length, shown at all
uniform int washPass;                  // drawing the washes (1, under the lines) or the lines (0)
out vec4 outColour;
void main() {
  vec4 ds = dashes[styleId];
  if (ds.w < 0.5) discard;
  if ((width[styleId].y > 0.5) != (washPass == 1)) discard;
  vec4 it = texelFetch(items, ivec2(itemId % 1024, itemId / 1024), 0);
  if (it.w < 0.5) discard;
  float at = it.y > 0.5 ? it.z - along : along;
  if (at > it.x) discard;
  // (past a join the next segment draws it)
  if (joins.x < 0.0 || joins.y < 0.0) discard;
  vec4 w = width[styleId];
  float u = local.x, v = local.y;
  float hw = w.x * mix(brushW.x, brushW.y, clamp(u / max(len, 1e-4), 0.0, 1.0)), d, edge = 1.0;
  float e = u < 0.0 ? -u : u - len;
  float kind = u < 0.0 ? endsF.x : endsF.y;
  if (e > 0.0 && kind > 0.5) {
    if (kind < 1.5) d = length(vec2(e, v));                                 // round
    else if (kind < 2.5) { d = abs(v); edge = clamp(0.5 - e, 0.0, 1.0); }   // butt
    else if (kind < 3.5) d = max(e, abs(v));                                // square
    else discard;                                                           // cut
  } else d = abs(v);
  // how much of the pixel (a box about its middle, d from the line) the
  // pen's width covers: exact across a straight edge, at any width – a
  // pen thinner than a pixel spreads faintly over one or two
  float cover = clamp(min(d + 0.5, hw) - max(d - 0.5, -hw), 0.0, 1.0) * edge;
  if (w.w > 0.0) cover *= 1.0 - smoothstep(w.z, w.w, along);
  if (ds.z > 0.5 && mod(dashAt, ds.x + ds.y) > ds.x) discard;
  if (cover <= 0.0) discard;
  outColour = colour[styleId] * cover;
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

const rgb = (hex) => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  if (m) return [1, 2, 3].map((i) => parseInt(m[i], 16) / 255);
  const n = /rgba?\(([^)]+)\)/.exec(hex)?.[1].split(',').map(Number);
  return n ? n.slice(0, 3).map((v) => v / 255) : [0, 0, 0];
};

export class GLLines {
  static make(canvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true, preserveDrawingBuffer: false });
    return gl ? new GLLines(canvas, gl) : null;
  }

  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.names = Object.keys(STYLES);
    this.styleOf = new Map(this.names.map((n, i) => [n, i]));
    this.layers = new Map(); // name -> { items, classes }
    this.order = [];         // layer names, back to front
    this.dirty = true;       // the geometry to build again
    const p = (this.program = gl.createProgram());
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.u = Object.fromEntries(['rot', 'centre', 'iso', 'place', 'size', 'dpr', 'width', 'colour', 'dashes', 'items', 'washPass'].map((n) => [n, gl.getUniformLocation(p, n)]));
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.segs = gl.createBuffer();   // a, b, meta, ends, prev, next, brush: 3 + 3 + 4 + 2 + 3 + 3 + 1 floats
    this.dashBuf = gl.createBuffer(); // dash along at a, b
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segs);
    const stride = STRIDE * 4;
    for (const [loc, n, off] of [[1, 3, 0], [2, 3, 3], [3, 4, 6], [4, 2, 10], [6, 3, 12], [7, 3, 15], [8, 1, 18]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, off * 4);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dashBuf);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(5, 1);
    gl.bindVertexArray(null);
    this.itemTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.itemTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.count = 0;
    this.drawnKey = null;
  }

  // A layer's items (world space), its classes back to front (ink.js);
  // `reveal(key)` -> null (all of it) or { f, flip } while the pen draws it
  // in or out, and `leaving()` -> [{ item, f, flip }], items being erased.
  setLayer(name, items, classes, ink = null) {
    if (!this.layers.has(name)) this.order.push(name);
    const was = this.layers.get(name);
    if (was?.items === items) return;
    this.layers.set(name, { items, classes, ink });
    this.dirty = true;
  }

  // The geometry of every layer, back to front, a class at a time (the SVG
  // ink layers' order), each item's lines in its own runs.
  build() {
    const segs = [], items = [];
    this.itemIndex = new Map(); // ink -> Map key -> index
    this.leavingIndex = new Map();
    this.dashed = [];             // [segment index, item pts, i] for the screen lengths
    for (const name of this.order) {
      const { items: list, classes, ink } = this.layers.get(name);
      const leaving = ink ? [...ink.moving.values()].filter((m) => m.out) : [];
      const keyIndex = new Map(), outIndex = new Map();
      this.itemIndex.set(name, keyIndex);
      this.leavingIndex.set(name, outIndex);
      for (const cls of classes) {
        const style = this.styleOf.get(cls);
        if (style == null) continue;
        const add = (item, index) => {
          const runs = item.runs ?? [item.pts];
          let along = 0;
          for (const pts of runs) {
            // (a road's wash is laid even)
            const brushed = STYLES[cls].wash ? null : brushWidths(pts, pts.length, TILE_PX);
            for (let i = 1; i < pts.length; i++) {
              const [ax, ay, az] = pts[i - 1], [bx, by, bz] = pts[i];
              const l = Math.hypot(bx - ax, by - ay, bz - az);
              // a round join at a sharp turn (and the line's own ends)
              let sharpA = false;
              if (i > 1) {
                const [px, py] = pts[i - 2];
                const t1 = Math.atan2(ay - py, ax - px), t2 = Math.atan2(by - ay, bx - ax);
                sharpA = Math.abs(Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1))) > SHARP;
              }
              const first = i === 1, last = i === pts.length - 1;
              // a sharp turn at b: cut there, the next segment's round end over it
              let sharpB = false;
              if (!last) {
                const [nx, ny] = pts[i + 1];
                const t1 = Math.atan2(by - ay, bx - ax), t2 = Math.atan2(ny - by, nx - bx);
                sharpB = Math.abs(Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1))) > SHARP;
              }
              // the ends: 0 a join, 1 round, 2 butt, 3 square, 4 cut square
              const own = CAPS[STYLES[cls].cap] + 1;
              const [px, py, pz] = first ? pts[i - 1] : pts[i - 2], [qx, qy, qz] = last ? pts[i] : pts[i + 1];
              segs.push(ax, ay, az, bx, by, bz, style, index, along, along + l, first ? own : sharpA ? 1 : 0, last ? own : sharpB ? 4 : 0, px, py, pz, qx, qy, qz, brushed ? brushed[i] : 0);
              if (STYLES[cls].dash) this.dashed.push([segs.length / STRIDE - 1, pts, i, style]);
              along += l;
            }
          }
          return along;
        };
        for (const item of list) {
          if (item.cls !== cls) continue;
          const index = items.length;
          items.push({ length: 0 });
          keyIndex.set(item.key, index);
          items[index].length = add(item, index);
        }
        for (const m of leaving) {
          if (m.item.cls !== cls) continue;
          const index = items.length;
          items.push({ length: 0, m });
          outIndex.set(m, index);
          items[index].length = add(m.item, index);
        }
      }
    }
    const data = new Float32Array(segs);
    this.leavingCount = this.countLeaving();
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segs);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.count = data.length / STRIDE;
    this.items = items;
    this.dashData = new Float32Array(this.count * 2);
    this.dashAngle = null;
    this.dirty = false;
  }

  // Where along each dashed segment it is on the screen (scene px), for the
  // view's turn: dashes run on as the SVG's do (ink.js), from a line's
  // start, carrying on into the next of its kind where that one starts at
  // its end.
  dashesFor(view) {
    if (this.dashAngle === view.angle) return;
    this.dashAngle = view.angle;
    const { cos, sin, cx, cy, iso } = view;
    const scene = ([x, y, z]) => {
      const dx = x - cx, dy = y - cy, rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
      return [(rx - ry) * iso[0], (rx + ry) * iso[1] - (z ?? 0) * iso[2]];
    };
    let at = 0, lastPts = null, lastI = 0, lastStyle = -1;
    const meets = (p, q) => p && q && Math.abs(p[0] - q[0]) < 1e-3 && Math.abs(p[1] - q[1]) < 1e-3;
    for (const [seg, pts, i, style] of this.dashed) {
      const goesOn = pts === lastPts && i === lastI + 1;
      const carriesOn = i === 1 && style === lastStyle && meets(lastPts?.[lastPts.length - 1], pts[0]);
      if (!goesOn && !carriesOn) at = 0;
      lastStyle = style;
      const [ax, ay] = scene(pts[i - 1]), [bx, by] = scene(pts[i]);
      const l = Math.hypot(bx - ax, by - ay);
      this.dashData[seg * 2] = at;
      this.dashData[seg * 2 + 1] = at + l;
      at += l;
      lastPts = pts;
      lastI = i;
    }
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dashBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.dashData, gl.DYNAMIC_DRAW);
  }

  // Each item's shown share (the pen's draw-in and erase, ink.js) into the
  // items texture; true while any is moving.
  revealItems(now) {
    const n = Math.max(1, this.items.length), w = Math.min(1024, n), h = Math.ceil(n / 1024);
    const data = new Float32Array(w * h * 4);
    let moving = false;
    for (let i = 0; i < this.items.length; i++) {
      data[i * 4 + 2] = this.items[i].length;
      data[i * 4] = 1e9;
      data[i * 4 + 3] = 1;
    }
    for (const name of this.order) {
      const { ink } = this.layers.get(name);
      if (!ink) continue;
      const index = this.itemIndex.get(name), out = this.leavingIndex.get(name);
      for (const [k, m] of ink.moving) {
        const i = m.out ? out.get(m) : index.get(k);
        if (i == null) continue;
        moving = true;
        const f = ink.frac(m, now);
        // (runs are shown by count, as ink.js does: near enough by length)
        data[i * 4] = f * this.items[i].length;
        data[i * 4 + 1] = m.flip ? 1 : 0;
        data[i * 4 + 3] = f > 0 ? 1 : 0;
      }
      // erased ones the pen is done with: no longer shown
      const live = new Set(ink.moving.values());
      for (const [m, i] of out) if (!live.has(m)) data[i * 4 + 3] = 0;
    }
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.itemTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    return moving;
  }

  // One frame. `view`: { zoom, panX, panY (wrapper px, the overscan in),
  // cos, sin, angle, cx, cy, iso: [tile·cos30, tile·sin30, tile·zScale],
  // W, H (wrapper css px) }; `look`: { stroke, lineWeight, palette, near,
  // far, fg, wash } – the map's --stroke and the colours; wash (painted
  // schemes): { road, path (widths, world units), colour, alpha } or null.
  draw(view, look, now = performance.now()) {
    const { gl, canvas } = this;
    // (lines being erased come and go with the pen: built again with them)
    if (this.dirty || this.countLeaving() !== this.leavingCount) this.build();
    const dpr = devicePixelRatio || 1;
    const w = Math.round(view.W * dpr), h = Math.round(view.H * dpr);
    const animating = [...this.layers.values()].some((l) => l.ink?.busy);
    const key = `${w}|${h}|${view.zoom}|${view.panX}|${view.panY}|${view.angle}|${look.stroke}|${look.near}|${look.far}|${look.fg}|${look.palette.detail}|${look.palette.bg}|${JSON.stringify(look.wash ?? null)}|${this.count}`;
    if (!animating && !this.wasAnimating && key === this.drawnKey) return;
    this.drawnKey = key;
    this.wasAnimating = animating;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.dashesFor(view);
    this.revealItems(now);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.count) return;
    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const u = this.u;
    gl.uniform2f(u.rot, view.cos, view.sin);
    gl.uniform2f(u.centre, view.cx, view.cy);
    gl.uniform3f(u.iso, ...view.iso);
    gl.uniform3f(u.place, view.zoom, view.panX, view.panY);
    gl.uniform2f(u.size, w, h);
    gl.uniform1f(u.dpr, dpr);
    // the pens: a width in scene px (pen · --stroke, the line weight in it),
    // on the screen times the zoom, in device px times the pixel ratio
    const widths = new Float32Array(32 * 4), colours = new Float32Array(32 * 4), dashes = new Float32Array(32 * 4);
    const { wash } = look;
    const colourOf = { fg: rgb(look.fg), main: rgb(look.fg), detail: rgb(look.palette.detail), bg: rgb(look.palette.bg), wash: rgb(wash?.colour ?? '#000') };
    const tile = view.iso[1] * 2;
    this.names.forEach((n, i) => {
      const s = STYLES[n];
      const px = s.wash ? (wash?.[s.wash] ?? 0) * 2 * tile * view.zoom * dpr : s.width * look.stroke * view.zoom * dpr;
      widths[i * 4] = px / 2;
      widths[i * 4 + 1] = s.wash ? 1 : 0;
      if (s.fade) widths.set(s.fade, i * 4 + 2);
      const [r, g, b] = colourOf[s.colour];
      const a = s.wash ? wash?.alpha ?? 1 : 1;
      colours.set([r * a, g * a, b * a, a], i * 4);
      const shown = (s.far && look.near) || (s.near && !look.near) || (look.far && FAR_HIDDEN.has(n))
        || (s.wash && !wash) || (wash && WASHED.has(n)) ? 0 : 1;
      if (s.dash) dashes.set([s.dash[0] * look.stroke, s.dash[1] * look.stroke, 1, shown], i * 4);
      else dashes.set([0, 0, 0, shown], i * 4);
    });
    gl.uniform4fv(u.width, widths);
    gl.uniform4fv(u.colour, colours);
    gl.uniform4fv(u.dashes, dashes);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.itemTex);
    gl.uniform1i(u.items, 0);
    gl.bindVertexArray(this.vao);
    // the washes first, blending to the most of them, so where two
    // overlap (at a bend, a junction) the paint is no thicker
    if (wash) {
      gl.blendEquation(gl.MAX);
      gl.uniform1i(u.washPass, 1);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
      gl.blendEquation(gl.FUNC_ADD);
    }
    gl.uniform1i(u.washPass, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.bindVertexArray(null);
  }

  countLeaving() {
    let n = 0;
    for (const { ink } of this.layers.values()) if (ink) for (const m of ink.moving.values()) if (m.out) n++;
    return n;
  }

  clear() {
    const { gl } = this;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.drawnKey = null;
  }
}
