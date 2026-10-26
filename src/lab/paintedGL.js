// Test page only (drawn-lab.html): a painted house (src/lab/faces.js)
// drawn with WebGL2, as the map shows a building – the game's isometric
// camera (render/camera.js: x' = (rx − ry)·cos30, y' = (rx + ry)/2 − z·0.9,
// turned freely) – and as a photo does: standing on the ground at a
// person's eye height (render/photo.js, PHOTO.eye), looking level.
// Lit by the game's sun (render/shadows.js, SUN), with its shadow on the
// ground.
//
//   const view = new PaintedView(canvas)        (throws without WebGL2)
//   view.setHouse(mesh, textureCanvas)           textureCanvas: bleed(sheet image)
//   view.draw({ mode: 'map', angle, zoom }) or ({ mode: 'photo', yaw, dist })

import { SUN } from '../render/shadows.js';

const COS30 = Math.cos(Math.PI / 6);
const Z_SCALE = 0.9;   // as Camera's zScale
const EYE = 0.12;      // as PHOTO.eye
const FOV = 55;        // the 28mm lens, horizontal
const PAPER = [0.925, 0.906, 0.871];
const SHADOW = [0.8, 0.775, 0.735];

const VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec2 aUv; in float aTex;
uniform mat4 uMat; uniform vec3 uLight; uniform int uMode;
out vec3 vN; out vec2 vUv; out float vTex;
void main() {
  vec3 p = aPos;
  // the shadow: the house pressed onto the ground along the light
  if (uMode == 2) p = vec3(p.xy - uLight.xy * (p.z / uLight.z), 0.0006);
  gl_Position = uMat * vec4(p, 1.0);
  vN = aNrm; vUv = aUv; vTex = aTex;
}`;

const FS = `#version 300 es
precision highp float;
precision highp int;
in vec3 vN; in vec2 vUv; in float vTex;
uniform sampler2D uTex; uniform vec3 uLight; uniform int uMode;
uniform vec3 uPaper; uniform vec3 uShadow;
out vec4 o;
void main() {
  if (uMode == 1) { o = vec4(uPaper, 1.0); return; }
  if (uMode == 2) { o = vec4(uShadow, 1.0); return; }
  vec4 t = texture(uTex, vUv);
  vec3 c = vTex > 0.5 && t.a > 0.5 ? t.rgb : uPaper * 0.86;
  float d = max(dot(normalize(vN), uLight), 0.0);
  o = vec4(c * (0.7 + 0.3 * d), 1.0);
}`;

export class PaintedView {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) throw new Error('This page needs WebGL 2.');
    this.gl = gl;
    this.canvas = canvas;
    this.prog = program(gl, VS, FS);
    this.loc = Object.fromEntries(['uMat', 'uLight', 'uMode', 'uTex', 'uPaper', 'uShadow'].map((n) => [n, gl.getUniformLocation(this.prog, n)]));
    this.house = null;
    this.ground = this._mesh({ positions: quad(8), normals: new Float32Array(18).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), uvs: new Float32Array(12), tex: new Float32Array(6) });
    this.tex = gl.createTexture();
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.aniso = aniso ? [aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT))] : null;
  }

  setHouse(house, image) {
    const { gl } = this;
    if (this.house) gl.deleteVertexArray(this.house.vao);
    this.house = { ...this._mesh(house), bounds: house.bounds };
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso[0], this.aniso[1]);
  }

  _mesh({ positions, normals, uvs, tex }) {
    const { gl } = this;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const attr = (name, data, size) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const l = gl.getAttribLocation(this.prog, name);
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0);
    };
    attr('aPos', positions, 3);
    attr('aNrm', normals, 3);
    attr('aUv', uvs, 2);
    attr('aTex', tex, 1);
    gl.bindVertexArray(null);
    return { vao, count: positions.length / 3 };
  }

  draw(view) {
    const { gl, canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(...PAPER, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.house) return;
    const b = this.house.bounds, c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    const mat = view.mode === 'photo' ? photoMatrix(c, view, w / h) : mapMatrix(c, view, w, h, dpr);
    gl.useProgram(this.prog);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.uniformMatrix4fv(this.loc.uMat, false, mat);
    gl.uniform3fv(this.loc.uLight, sunLight());
    gl.uniform3fv(this.loc.uPaper, PAPER);
    gl.uniform3fv(this.loc.uShadow, SHADOW);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.loc.uTex, 0);
    const pass = (mesh, mode) => {
      gl.uniform1i(this.loc.uMode, mode);
      gl.bindVertexArray(mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    };
    pass(this.ground, 1);
    pass(this.house, 2);
    pass(this.house, 0);
  }
}

// Towards the sun: SUN.azimuth is the way shadows fall, SUN.length how long
// they are per unit of height.
function sunLight() {
  const a = (SUN.azimuth * Math.PI) / 180;
  const v = [-Math.cos(a) * SUN.length, -Math.sin(a) * SUN.length, 1];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
}

// The map: the iso projection turned by `angle` (radians, as Camera.angle),
// `zoom` px per grid step (CSS px), the house's middle in the middle.
function mapMatrix(c, { angle, zoom }, w, h, dpr) {
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const kx = (2 * zoom * dpr) / w, ky = (2 * zoom * dpr) / h;
  // rows: clip x, y, z as a·(p − c)
  const rows = [
    [kx * COS30 * (cs - sn), -kx * COS30 * (sn + cs), 0],
    [-ky * 0.5 * (cs + sn), -ky * 0.5 * (cs - sn), ky * Z_SCALE],
    [-0.15 * (cs + sn), -0.15 * (cs - sn), -0.0015],
  ];
  const m = new Float32Array(16);
  rows.forEach((r, i) => {
    m[i] = r[0]; m[4 + i] = r[1]; m[8 + i] = r[2];
    m[12 + i] = -(r[0] * c[0] + r[1] * c[1] + r[2] * c[2]);
  });
  m[15] = 1;
  return m;
}

// The photo: standing `dist` from the house's middle in direction `yaw`
// (radians, from the house), eyes EYE above the ground, looking level at it.
function photoMatrix(c, { yaw, dist }, aspect) {
  const eye = [c[0] + Math.cos(yaw) * dist, c[1] + Math.sin(yaw) * dist, EYE];
  const f = unit([c[0] - eye[0], c[1] - eye[1], 0]);
  const r = unit(cross(f, [0, 0, 1])), u = cross(r, f);
  const view = [
    r[0], u[0], -f[0], 0,
    r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0,
    -dot(r, eye), -dot(u, eye), dot(f, eye), 1,
  ];
  const near = 0.02, far = 30;
  const t = Math.tan((FOV * Math.PI) / 360), sx = 1 / t, sy = aspect / t;
  const proj = [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, -(far + near) / (far - near), -1, 0, 0, (-2 * far * near) / (far - near), 0];
  return mul4(proj, view);
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

function mul4(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
    o[i * 4 + j] = s;
  }
  return o;
}

function quad(r) {
  return new Float32Array([-r, -r, 0, r, -r, 0, r, r, 0, -r, -r, 0, r, r, 0, -r, r, 0]);
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// The sheet's image with its paint run on a few px into the empty around
// it, so a face sampled at its very edge (or a smaller mip) takes the
// house's colour, not the transparent's black. Pixels `drop` picks (the
// windows' magenta) are emptied first, so they are painted over from
// around them. Returns a new canvas.
export function bleed(source, passes = 8, drop = null) {
  const w = source.width, h = source.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3] >= 128 && !drop?.(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) ? 1 : 0;
  if (drop) for (let i = 0; i < w * h; i++) if (!solid[i]) d[i * 4 + 3] = 0;
  const near = (i, f) => {
    const x = i % w;
    if (x > 0) f(i - 1);
    if (x < w - 1) f(i + 1);
    if (i >= w) f(i - w);
    if (i < w * (h - 1)) f(i + w);
  };
  let front = [];
  for (let i = 0; i < w * h; i++) if (!solid[i]) { let s = false; near(i, (j) => { s ||= !!solid[j]; }); if (s) front.push(i); }
  for (let p = 0; p < passes && front.length; p++) {
    const done = [];
    for (const i of front) {
      if (solid[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      near(i, (j) => { if (solid[j]) { r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; n++; } });
      if (!n) continue;
      d[i * 4] = r / n; d[i * 4 + 1] = g / n; d[i * 4 + 2] = b / n; d[i * 4 + 3] = 255;
      done.push(i);
    }
    for (const i of done) solid[i] = 1;
    const next = [];
    for (const i of done) near(i, (j) => { if (!solid[j]) next.push(j); });
    front = next;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}
