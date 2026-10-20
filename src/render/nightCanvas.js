// The night, on two canvases of its own: on the ground, over the map's drawing
// (#view), under the people, vehicles and trains (#agents) and the
// buildings (#view-top). A grey and the paper's strokes (hatch.js, the
// same as every shadow's and the night's over the objects) laid over the
// whole window, and the lights rubbed out of both – the street lamps'
// pools and the light lit windows throw on the ground (Renderer.renderLights),
// the beams ahead of what moves (Renderer.headlights) – so the drawing
// under them shows as it is; and over the objects (#night-top, over
// #view-top), only where they stand, their lit windows rubbed out. Redrawn every frame while it is dark
// or grey, as the beams move and the view does; a canvas, as the lights
// that move every frame would otherwise have every frame repaint the
// map's SVG.
//
//   new NightCanvas(canvas)
//   draw(camera, { grey, colour, tier, hatch, px, stroke, lights, sheet, beams })

import { THEME } from '../theme.js';
import { hatchFrame, hatchTileLines } from './hatch.js';

// The ragged edge of a light, as the night's masks have it (styles.css
// mask .light): a dashed line round it, rubbing a little further out in
// places (scene px).
const EDGE = { width: 2.5, dash: [3, 2, 1.5, 3.5, 2.5, 1, 4, 2.5, 1, 3] };

// How far the third set of the night's strokes is turned from the first
// (degrees), at its deepest.
const CROSS = -68;

export class NightCanvas {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.empty = true;
    this.tile = null; // { key, pattern, scale }
  }

  // One frame. `grey`: how much of the grey (0 … 1), in `colour`; `tier`:
  // the densest of the paper's lines kept (-1: none, it is not night);
  // `hatch`, `px`: SUN.hatch and scene px to a grid unit; `stroke`: the
  // map's --stroke; `lights`: a Path2D in scene px, turned by `sheet` (a
  // DOMMatrix, while the view turns) or not; `beams`: polygons in scene px.
  // The whole window is drawn again only when any of that but the beams
  // changes (or the view moves); otherwise only about the beams, where they
  // were and where they are – a full-window pattern each frame costs the
  // browser far more to paint than to draw.
  //
  // Over the objects (`cover` given) the night lies only where they stand:
  // `cover` is [[light?, Path2D]…] in scene px, in order, from the
  // furthest object to the nearest – an object's outline, where the night
  // goes, then its lights, rubbed out of it (Renderer.renderLights); with
  // `all`, the night over everything (while the view turns). It is drawn
  // again only when something changes.
  // `depth` (1–3): the strokes laid once, twice (the second time between
  // the first's lines, and along them a way, so their breaks don't line
  // up) or three times (the third across them, CROSS).
  draw(camera, { grey = 0, colour, tier = -1, depth = 1, hatch, px, stroke, lights = null, sheet = null, beams = [], cover = null, all = false }) {
    const { canvas, ctx } = this;
    const dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    let resized = false;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      this.empty = true;
      resized = true;
    }
    const on = grey > 0.002 || tier >= 0;
    if (!on) {
      if (!this.empty) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        this.empty = true;
      }
      this.last = null;
      return;
    }
    const view = new DOMMatrix([dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * camera.panX, dpr * camera.panY]);
    const lightsAt = lights ? (sheet ? view.multiply(sheet) : view) : null;
    const state = { grey: Math.round(grey * 1000), colour, tier, depth, hatch, px, stroke, lights, view: view.toString(), lightsAt: lightsAt?.toString(), cover };
    // the beams as window boxes, padded for their ragged edges
    const boxes = beams.map((poly) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [sx, sy] of poly) {
        const p = view.transformPoint({ x: sx, y: sy });
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      const pad = (EDGE.width + 2) * dpr * camera.zoom;
      return [Math.floor(x0 - pad), Math.floor(y0 - pad), Math.ceil(x1 + pad), Math.ceil(y1 + pad)];
    });
    const same = !resized && this.last && Object.keys(state).every((k) => state[k] === this.last.state[k]);
    if (same && cover) return;
    const regions = same ? [...this.last.boxes, ...boxes] : null;
    this.last = { state, boxes };
    this.empty = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    if (regions) {
      if (!regions.length) return;
      ctx.save();
      ctx.beginPath();
      for (const [x0, y0, x1, y1] of regions) ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
    }
    ctx.clearRect(0, 0, w, h);
    if (grey > 0.002) {
      ctx.globalAlpha = grey;
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    if (tier >= 0 && hatch) {
      const t = this.tileFor(tier, hatch, px, stroke, dpr * camera.zoom);
      // the pattern's own px -> scene px (turned to the lines' angle) -> the window
      const gap = hatchFrame(hatch).gap * px;
      const lay = (angle, along, across) => {
        t.pattern.setTransform(view.rotate(angle).translate(along, across).scale(1 / t.scale));
        ctx.fillStyle = t.pattern;
        ctx.fillRect(0, 0, w, h);
      };
      lay(hatch.angle, 0, 0);
      if (depth >= 2) lay(hatch.angle, 3.7 * px, gap / 2);
      if (depth >= 3) lay(hatch.angle + CROSS, 1.3 * px, gap / 3);
    }
    // the lights rubbed out of it, edges ragged
    const cut = (path, m, c = ctx) => {
      c.setTransform(m);
      c.fill(path);
      c.lineWidth = EDGE.width;
      c.setLineDash(EDGE.dash);
      c.lineJoin = 'round';
      c.stroke(path);
      c.setLineDash([]);
    };
    if (cover) {
      // over the objects: kept only where the mask has it
      const m = this.mask?.width === w && this.mask?.height === h ? this.mask : (this.mask = new OffscreenCanvas(w, h));
      const mc = m.getContext('2d');
      mc.setTransform(1, 0, 0, 1, 0, 0);
      mc.globalCompositeOperation = 'source-over';
      mc.clearRect(0, 0, w, h);
      mc.fillStyle = mc.strokeStyle = '#000';
      for (const [light, path] of cover) {
        mc.globalCompositeOperation = light ? 'destination-out' : 'source-over';
        if (light) cut(path, view, mc);
        else {
          mc.setTransform(view);
          mc.fill(path);
        }
      }
      mc.globalCompositeOperation = 'source-over';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(m, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      return;
    }
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = ctx.strokeStyle = '#000';
    if (lights) cut(lights, lightsAt);
    if (beams.length) {
      const path = new Path2D();
      for (const poly of beams) {
        poly.forEach(([sx, sy], i) => (i ? path.lineTo(sx, sy) : path.moveTo(sx, sy)));
        path.closePath();
      }
      cut(path, view);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (regions) ctx.restore();
  }

  // The paper's strokes as a pattern, drawn at `scale` window px to a scene
  // px (in steps of a quarter of a doubling, so zooming redraws it only now
  // and then), with the pen the night's lines have (--pen-1 times --stroke,
  // as every hatch line's).
  tileFor(tier, hatch, px, stroke, scale) {
    const q = 2 ** (Math.round(Math.log2(scale) * 4) / 4);
    const pen = this.pen ??= parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pen-1')) || 0.5;
    const key = `${tier}|${JSON.stringify(hatch)}|${px}|${stroke}|${q}|${THEME.palette.detail}`;
    if (this.tile?.key === key) return this.tile;
    const { d, size } = hatchTileLines(tier, hatch, px);
    const n = Math.max(1, Math.round(size * q));
    const off = new OffscreenCanvas(n, n), c = off.getContext('2d');
    c.scale(n / size, n / size);
    c.strokeStyle = THEME.palette.detail;
    c.lineWidth = pen * stroke;
    c.lineCap = c.lineJoin = 'round';
    c.stroke(new Path2D(d));
    this.tile = { key, pattern: this.ctx.createPattern(off, 'repeat'), scale: n / size };
    return this.tile;
  }
}

// Two colours (#rrggbb) mixed, `t` of the second.
export function mixColour(a, b, t) {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}
