// The pen's line, for every line the game draws on the GPU: the buildings,
// trees and lamps (gl/objects.js), the roads, paths, railways and fences
// (gl/lines.js), what moves (gl/movers.js) and the paper's strokes in the
// shadows, the night and the clouds (the hatch tiles: gl/hatching.js,
// gl/objects.js). Set with the user in house-lab.html (docs/pen-sketch.md);
// change it here and the whole map follows.
//
// A line is drawn as strokes, each from corner to corner (a turn sharper
// than `corner` radians starts the next): thinner by `taper` over `fade`
// scene px at its ends, swelling and thinning by `swell` along it every
// `wave` scene px or so, each stroke `weight` heavier or lighter than the
// next, all `width` times its pen. (The lab measures fade and wave on
// screen; these are its values at zoom 2.) `on: false` draws every line
// even, as a ruling pen would.
//
//   brushWidths(pts, count, scale)   a polyline's segments' widths, packed for a shader
//   BRUSH_GLSL                       unpacking them in a shader: brushUnpack(packed)
//   brushPath2D(d, width)            path data as a Path2D of ribbons, to fill on a 2D canvas

import { flattenPath } from './gl/geometry.js';

export const BRUSH = { on: true, width: 1.2, taper: 0.25, fade: 3, swell: 0.2, wave: 4.5, weight: 0.2, corner: 0.7 };

// What makes the line a pencil's rather than a ruling pen's, worked out in
// labs/pencil-lab.html: the paper's tooth (`grain` of it left bare, in specks
// `size` scene px across, drawn out `streak` times along the stroke, as a
// lead does), its edge worn ragged by `rough` (a share of the width), the
// lead laid thinner towards the edges (`soft`), pressed harder where the
// stroke swells and lighter where it thins, wandering every `wave` scene px
// (`press`), and the whole of it `tone` lighter than ink; every pen `width`
// times as wide, and wider as the view zooms in by `grow` (0: the same on
// the screen at any zoom, as the pens are; 1: as wide on the paper, growing
// with the drawing from zoom 2); the paper's strokes of the shadows, the
// clouds' shadows and the night `shade` times as wide as their pen. The specks are
// fixed to the ground, as the paper is, and come back to an even grey
// where they would be smaller than a pixel, so a zoom out doesn't shimmer.
// grain, rough, soft, press and tone 0, width 1, grow 0: the even ink line.
export const GRAPHITE = { grain: 0.71, size: 0.3, streak: 1, rough: 0.55, soft: 0.42, press: 0.83, wave: 12, tone: 0, width: 2.05, grow: 0.7, shade: 2 };

// How many times its pen a line is drawn at `zoom`.
export const penScale = (zoom) => GRAPHITE.width * (zoom / 2) ** GRAPHITE.grow;

// For the shaders' draw keys: changed, drawn again.
export const graphiteKey = () => Object.values(GRAPHITE).join(',') + (BRUSH.on ? '' : '-');

// The uniforms GRAPHITE_GLSL reads, set on a program's `u` (its locations).
export function setGraphite(gl, u) {
  const g = GRAPHITE;
  gl.uniform4f(u.graphiteA, g.grain, Math.max(0.05, g.size), Math.max(0.2, g.streak), g.rough);
  gl.uniform4f(u.graphiteB, g.soft, g.press, Math.max(1, g.wave), g.tone);
  gl.uniform1f(u.graphiteW, BRUSH.on ? BRUSH.width : 1);
}
export const GRAPHITE_UNIFORMS = ['graphiteA', 'graphiteB', 'graphiteW'];

// In a fragment shader, for a stroke's pixel `d` device px from its middle,
// the half width `hw` (device px), at `s` (scene px), the stroke running
// along `dir` (unit, on the screen), `share` its pen's width there (brushW):
//   hw = graphiteEdge(hw, s)              the edge worn ragged
//   cover *= graphite(d, hw, s, dir, share)   how much lead it left
export const GRAPHITE_GLSL = `
uniform vec4 graphiteA;   // grain, speck size (scene px), drawn out along, ragged edge
uniform vec4 graphiteB;   // soft edge, press, its wave (scene px), tone
uniform float graphiteW;  // a stroke's even share of its pen (BRUSH.width)
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float graphiteEdge(float hw, vec2 s) {
  if (graphiteA.w <= 0.0) return hw;
  float n = gNoise(s / (graphiteA.y * 3.0) + 11.7) * 0.6 + gNoise(s / graphiteA.y + 4.2) * 0.4;
  return hw * (1.0 - graphiteA.w * 0.8 * n);
}
float graphite(float d, float hw, vec2 s, vec2 dir, float share) {
  if (graphiteA.x + graphiteB.x + graphiteB.y + graphiteB.w <= 0.0) return 1.0;
  // device px to a scene px here (the drawing is only scaled onto the screen)
  float px = 0.7071 / max(length(fwidth(s)), 1e-5);
  // the lead: thinner towards the edges, heavier where the stroke is pressed
  float t = clamp(d / max(hw, 1e-3), 0.0, 1.0);
  float lead = 1.0 - graphiteB.x * t * t;
  float p = clamp(share / graphiteW, 0.5, 1.5) - 1.0;
  lead *= 1.0 + graphiteB.y * (1.5 * p + gNoise(s / graphiteB.z + 2.7) - 0.5);
  lead = clamp(lead, 0.0, 1.0);
  // the tooth: the lead catches on its peaks, and fills the hollows only
  // where it is pressed hard
  float tooth = 1.0;
  if (graphiteA.x > 0.0) {
    vec2 q = vec2(dot(s, dir) / graphiteA.z, dot(s, vec2(-dir.y, dir.x))) / graphiteA.y;
    float g = gNoise(q) * 0.65 + gNoise(q * 2.3 + 5.1) * 0.35;
    float th = graphiteA.x * (1.05 - 0.55 * lead);
    tooth = smoothstep(th - 0.1, th + 0.1, g);
    // (specks under a pixel, or on a line too thin to hold them: their grey)
    float seen = smoothstep(0.7, 1.8, graphiteA.y * px) * smoothstep(0.8, 2.0, 2.0 * hw);
    tooth = mix(1.0 - 0.5 * graphiteA.x, tooth, seen);
  }
  return lead * tooth * (1.0 - graphiteB.w);
}`;

// A polyline's strokes (segment i from point i - 1 to point i, for
// i = 1 … count - 1, the points taken round again where it closes, `scale`
// scene px to one of its units): each segment's width at its two ends, as
// shares of the pen's (0 … 2.5 in 255 steps), packed as 1 + 256 · a + b.
// 0 for each with the brush off (the shaders read 0 as an even line).
export function brushWidths(pts, count = pts.length, scale = 1) {
  const out = new Float32Array(count);
  if (!BRUSH.on) return out;
  const w = widthsAlong(pts, count, scale, BRUSH);
  const step = (v) => Math.round(Math.min(1, Math.max(0.02, v) / 2.5) * 255);
  for (let i = 1; i < count; i++) out[i] = 1 + step(w[2 * i]) * 256 + step(w[2 * i + 1]);
  return out;
}

// The same widths unpacked, by a brush of its own (`brush`: BRUSH or one
// like it): [a, b] of segment i at 2i, 2i + 1.
function widthsAlong(pts, count, scale, brush) {
  const out = new Float32Array(2 * count);
  const L = pts.length, at = (i) => pts[i % L];
  const len = new Float32Array(count);
  for (let i = 1; i < count; i++) len[i] = Math.hypot(at(i)[0] - at(i - 1)[0], at(i)[1] - at(i - 1)[1]) * scale;
  for (let i = 1; i < count;) {
    // a stroke: segments i … j - 1, up to a sharp turn
    let j = i + 1;
    for (; j < count; j++) {
      const a = at(j - 2), b = at(j - 1), c = at(j);
      const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
      if (Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) > brush.corner) break;
    }
    const f = strokeWidth(at(i - 1), len, i, j, brush);
    for (let k = i, s = 0; k < j; s += len[k], k++) { out[2 * k] = f(s); out[2 * k + 1] = f(s + len[k]); }
    i = j;
  }
  return out;
}

// The width along one stroke (segments i … j - 1, `len` their lengths,
// starting at point p), as a share of the pen's, by how far along it is.
function strokeWidth(p, len, i, j, brush = BRUSH) {
  let total = 0;
  for (let k = i; k < j; k++) total += len[k];
  const seed = p[0] * 12.9898 + p[1] * 78.233;
  const weight = brush.width * (1 + brush.weight * (2 * rnd(seed) - 1)), fade = Math.min(total / 2, brush.fade) || 1e-6;
  return (s) => {
    const e = Math.min(1, Math.min(s, total - s) / fade);
    return weight * (1 - brush.taper * (1 - e * e * (3 - 2 * e))) * (1 + brush.swell * noise1(seed, s / brush.wave));
  };
}

// In a shader: a segment's packed widths (brushWidths) as its widths at a
// and at b, shares of its pen's (1, 1 for 0: an even line).
export const BRUSH_GLSL = `
vec2 brushUnpack(float w) {
  return w < 0.5 ? vec2(1.0) : vec2(floor((w - 1.0) / 256.0), mod(w - 1.0, 256.0)) / 255.0 * 2.5;
}`;

// Path data stroked `width` units wide by the brush, as ribbons to fill (a
// Path2D, nonzero): for 2D canvases, which cannot vary a line's width.
// Units are taken as scene px. With the brush off, null: stroke it as it is.
export function brushPath2D(d, width) {
  if (!BRUSH.on) return null;
  const path = new Path2D();
  for (const { pts, closed } of flattenPath(d, 0.1)) {
    const ring = closed ? [...pts, pts[0]] : pts;
    if (ring.length < 2) continue;
    const w = brushWidths(ring, ring.length);
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1], [bx, by] = ring[i];
      const l = Math.hypot(bx - ax, by - ay);
      if (l < 1e-6) continue;
      const v = w[i] - 1, ha = (Math.floor(v / 256) / 255) * 1.25 * width, hb = ((v % 256) / 255) * 1.25 * width;
      const nx = -(by - ay) / l, ny = (bx - ax) / l;
      // a quad, and a round cap at each end so the strokes meet at joins
      path.moveTo(ax + nx * ha, ay + ny * ha);
      path.lineTo(bx + nx * hb, by + ny * hb);
      path.lineTo(bx - nx * hb, by - ny * hb);
      path.lineTo(ax - nx * ha, ay - ny * ha);
      path.closePath();
      path.moveTo(bx + hb, by);
      path.arc(bx, by, hb, 0, Math.PI * 2);
      if (i === 1) {
        path.moveTo(ax + ha, ay);
        path.arc(ax, ay, ha, 0, Math.PI * 2);
      }
    }
  }
  return path;
}

// The same ribbons as SVG path data (to fill, nonzero), for a photo
// (ui/photoBrush.js): `width` units wide, `scale` scene px to one of its
// units. `brush`: the brush's settings (BRUSH, or a photo's own, heavier
// handed); `fade(x, y)`: a share of the width there (1: as is), for a
// drawing that fades out towards its edges. '' with the brush off.
export function brushPathData(d, width, { scale = 1, brush = BRUSH, fade = null, step = 3 } = {}) {
  if (!BRUSH.on) return '';
  const f = (v) => Math.round(v * 100) / 100;
  let out = '';
  for (const { pts, closed } of flattenPath(d, 0.1)) {
    // (long straight runs cut into pieces `step` long, so the width can
    // swell and thin along them, and fade where they near an edge)
    const ring = [];
    for (const p of closed ? [...pts, pts[0]] : pts) {
      const q = ring[ring.length - 1];
      if (q) {
        const n = Math.floor(Math.hypot(p[0] - q[0], p[1] - q[1]) / step);
        for (let k = 1; k <= n; k++) ring.push([q[0] + ((p[0] - q[0]) * k) / (n + 1), q[1] + ((p[1] - q[1]) * k) / (n + 1)]);
      }
      ring.push(p);
    }
    if (ring.length < 2) continue;
    const w = widthsAlong(ring, ring.length, scale, brush);
    const dot = (x, y, r) => (r > 0.02 ? `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0` : '');
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1], [bx, by] = ring[i];
      const l = Math.hypot(bx - ax, by - ay);
      if (l < 1e-6) continue;
      let ha = (w[2 * i] / 2) * width, hb = (w[2 * i + 1] / 2) * width;
      if (fade) { ha *= fade(ax, ay); hb *= fade(bx, by); }
      if (ha < 0.02 && hb < 0.02) continue;
      const nx = -(by - ay) / l, ny = (bx - ax) / l;
      out += `M${f(ax + nx * ha)} ${f(ay + ny * ha)}L${f(bx + nx * hb)} ${f(by + ny * hb)}L${f(bx - nx * hb)} ${f(by - ny * hb)}L${f(ax - nx * ha)} ${f(ay - ny * ha)}Z`;
      // round at each end, so the pieces meet at the joins
      out += dot(bx, by, hb);
      if (i === 1) out += dot(ax, ay, ha);
    }
  }
  return out;
}

function rnd(x) {
  const s = Math.sin(x) * 43758.5453;
  return s - Math.floor(s);
}

// smooth noise in −1 … 1 along a stroke
function noise1(seed, t) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  const a = rnd(seed + i * 17.17), c = rnd(seed + (i + 1) * 17.17);
  return 2 * (a + (c - a) * u) - 1;
}
