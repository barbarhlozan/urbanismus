// The pen's line, for every line the game draws on the GPU: the buildings,
// trees and lamps (gl/objects.js), the roads, paths, railways and fences
// (gl/lines.js), what moves (gl/movers.js) and the paper's strokes in the
// shadows, the night and the clouds (the hatch tiles: gl/hatching.js,
// gl/objects.js). Set with the user in house-lab.html (pen-sketch.md);
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

export const BRUSH = { on: true, width: 1.2, taper: 0.5, fade: 3, swell: 0.7, wave: 15.5, weight: 0.2, corner: 0.7 };

// A polyline's strokes (segment i from point i - 1 to point i, for
// i = 1 … count - 1, the points taken round again where it closes, `scale`
// scene px to one of its units): each segment's width at its two ends, as
// shares of the pen's (0 … 2.5 in 255 steps), packed as 1 + 256 · a + b.
// 0 for each with the brush off (the shaders read 0 as an even line).
export function brushWidths(pts, count = pts.length, scale = 1) {
  const out = new Float32Array(count);
  if (!BRUSH.on) return out;
  const L = pts.length, at = (i) => pts[i % L];
  const len = new Float32Array(count);
  for (let i = 1; i < count; i++) len[i] = Math.hypot(at(i)[0] - at(i - 1)[0], at(i)[1] - at(i - 1)[1]) * scale;
  const step = (v) => Math.round(Math.min(1, Math.max(0.02, v) / 2.5) * 255);
  for (let i = 1; i < count;) {
    // a stroke: segments i … j - 1, up to a sharp turn
    let j = i + 1;
    for (; j < count; j++) {
      const a = at(j - 2), b = at(j - 1), c = at(j);
      const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
      if (Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) > BRUSH.corner) break;
    }
    const f = strokeWidth(at(i - 1), len, i, j);
    for (let k = i, s = 0; k < j; s += len[k], k++) out[k] = 1 + step(f(s)) * 256 + step(f(s + len[k]));
    i = j;
  }
  return out;
}

// The width along one stroke (segments i … j - 1, `len` their lengths,
// starting at point p), as a share of the pen's, by how far along it is.
function strokeWidth(p, len, i, j) {
  let total = 0;
  for (let k = i; k < j; k++) total += len[k];
  const seed = p[0] * 12.9898 + p[1] * 78.233;
  const weight = BRUSH.width * (1 + BRUSH.weight * (2 * rnd(seed) - 1)), fade = Math.min(total / 2, BRUSH.fade) || 1e-6;
  return (s) => {
    const e = Math.min(1, Math.min(s, total - s) / fade);
    return weight * (1 - BRUSH.taper * (1 - e * e * (3 - 2 * e))) * (1 + BRUSH.swell * noise1(seed, s / BRUSH.wave));
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
