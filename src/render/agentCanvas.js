// The moving things – people, cyclists, cars, trucks, trains – are drawn on
// a <canvas> (#agents) between the map and the buildings, not as SVG
// elements: hundreds of them move every frame, and moving an SVG element
// restyles it and repaints the map's whole layer under it.
//
// They are drawn from the same SVG snippets as before (vehicles.js,
// people.js), parsed once into Path2D shapes, and styled here to match
// styles.css: the colours from the scheme, and the line widths times the
// map's --stroke (Renderer.updateStroke), so a car's outline is as heavy as
// the road line beside it on any screen and at any zoom.

import { THEME } from '../theme.js';

// The map's pens (--pen-1…5 in styles.css), px of line width.
export const PEN = [0, 0.5, 0.7, 1, 1.4, 2];

// Per class (the snippets' classes, and the plain marks further out): fill
// and stroke as palette names, stroke width as in styles.css (before --stroke).
const STYLES = {
  vb: { fill: 'bg', stroke: 'main', width: PEN[3] },
  vi: { fill: 'main', stroke: 'main', width: PEN[1] },
  'fig-body': { fill: 'bg', stroke: 'main', width: PEN[3] },
  'fig-head': { stroke: 'main', width: PEN[2] },
  'fig-wheel': { stroke: 'main', width: PEN[2] },
  'fig-line': { stroke: 'main', width: PEN[2] },
  'fig-ink': { fill: 'main', stroke: 'main', width: PEN[1] },
  car: { fill: 'main' },
  walker: { fill: 'main' },
  cyclist: { fill: 'main', stroke: 'main', width: PEN[1] },
  truck: { fill: 'main', stroke: 'main', width: PEN[3] },
  train: { fill: 'main', stroke: 'main', width: PEN[3] },
  sgl: { stroke: 'main', width: PEN[3] },   // a crossing sign's pole (crossings.js)
  flash: { stroke: 'main', width: PEN[3] }, // its lights flashing
};

// How far (css px) past the window edge something may stand and still show.
const MARGIN = 60;

const parsed = new Map();

// An SVG snippet (<path class="…" d="…"/>…) as [{ style, path }]. Cached:
// the snippets come from caches themselves, so there are only so many.
export function shapesOf(svg) {
  let shapes = parsed.get(svg);
  if (!shapes) {
    shapes = [...svg.matchAll(/<path class="([^"]*)" d="([^"]*)"\s*\/>/g)].map((m) => shape(m[1], m[2]));
    parsed.set(svg, shapes);
  }
  return shapes;
}

// One shape: a path `d` in style `cls`.
export function shape(cls, d) {
  return { style: STYLES[cls] ?? STYLES.car, path: new Path2D(d) };
}

export class AgentCanvas {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.empty = false;
  }

  // Start a frame at the camera's current view: clear, size to the window.
  // `stroke`: the map's --stroke, scene px per px of line width.
  begin(camera, stroke) {
    const { canvas, ctx } = this;
    const dpr = devicePixelRatio || 1;
    const W = innerWidth, H = innerHeight;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    } else if (!this.empty) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
    }
    ctx.lineJoin = 'round';
    ctx.miterLimit = 4;
    ctx.globalAlpha = 1;
    this.dpr = dpr;
    this.strokeK = stroke ?? 1 / camera.zoom;
    this.zoom = camera.zoom;
    this.panX = camera.panX;
    this.panY = camera.panY;
    this.W = W;
    this.H = H;
    this.pal = THEME.palette;
    this.fill = this.stroke = this.width = null;
    this.empty = true;
  }

  // Leave the canvas blank (agents switched off).
  clear() {
    if (this.empty) return;
    const { canvas, ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.empty = true;
  }

  // Is the scene point (sx, sy) near enough to the window to draw?
  onScreen(sx, sy) {
    const x = this.panX + this.zoom * sx, y = this.panY + this.zoom * sy;
    return x > -MARGIN && y > -MARGIN && x < this.W + MARGIN && y < this.H + MARGIN;
  }

  // Shapes drawn around the scene point (sx, sy), at size k, mirrored.
  // `shear`: y += shear · x in the shapes (a vehicle leaning up or down a
  // slope, see Renderer.slopeShear). `squash`: height scaled about the foot
  // (a walker's step).
  draw(shapes, sx, sy, k = 1, mirror = false, shear = 0, squash = 1) {
    if (!(k > 0.001) || !this.onScreen(sx, sy)) return;
    const { ctx, dpr, zoom } = this;
    const m = dpr * zoom * k;
    ctx.setTransform(mirror ? -m : m, m * shear, 0, m * squash, dpr * (this.panX + zoom * sx), dpr * (this.panY + zoom * sy));
    const unit = this.strokeK / k; // one px of line width in the shapes' units
    for (const s of shapes) this.paint(s.style, s.path, unit);
  }

  // Shapes already in scene coordinates (a truck or train far out), faded to `alpha`.
  drawScene(style, path, alpha = 1) {
    const { ctx, dpr, zoom } = this;
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * this.panX, dpr * this.panY);
    ctx.globalAlpha = alpha;
    this.paint(style, path, this.strokeK);
    ctx.globalAlpha = 1;
  }

  paint(style, path, unit) {
    const { ctx, pal } = this;
    this.empty = false;
    if (style.fill) {
      const c = pal[style.fill];
      if (c !== this.fill) ctx.fillStyle = this.fill = c;
      ctx.fill(path);
    }
    if (style.stroke) {
      const c = pal[style.stroke];
      if (c !== this.stroke) ctx.strokeStyle = this.stroke = c;
      const w = style.width * unit;
      if (w !== this.width) ctx.lineWidth = this.width = w;
      ctx.stroke(path);
    }
  }
}

export { STYLES as AGENT_STYLES };
