// The moving things – people, cyclists, cars, trucks, trains – are drawn on
// canvases (#agents, in tiles) between the map and the buildings, not as SVG
// elements: hundreds of them move every frame, and moving an SVG element
// restyles it and repaints the map's whole layer under it.
//
// They are drawn from the same SVG snippets as before (vehicles.js,
// people.js), parsed once into Path2D shapes, and styled here to match
// styles.css: the colours from the scheme, and the line widths times the
// map's --stroke (Renderer.updateStroke), so a car's outline is as heavy as
// the road line beside it on any screen and at any zoom.

import { Tiles } from './tiles.js';
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
  let reach = 0;
  for (const n of d.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []) reach = Math.max(reach, Math.abs(Number(n)));
  return { style: STYLES[cls] ?? STYLES.car, path: new Path2D(d), reach };
}

// Drawn on tiles (tiles.js): what moves is noted as it is drawn (draw,
// drawScene) and laid on the tiles at the frame's end (end), and a tile
// whose drawing is the same as the last frame's is left alone – the
// meadow, the woods and the streets where nobody is going cost nothing.

// How far (scene units of a shape, before its size k) a set of shapes
// reaches from its foot: the furthest point of their path data, a little
// more for the pen (kept per set).
const reach = new WeakMap();
function reachOf(shapes) {
  let r = reach.get(shapes);
  if (r == null) {
    r = 0;
    for (const s of shapes) r = Math.max(r, s.reach ?? 0);
    reach.set(shapes, r);
  }
  return r;
}
let ids = 0;
const idOf = new WeakMap();
const id = (o) => {
  let n = idOf.get(o);
  if (n == null) idOf.set(o, (n = ++ids));
  return n;
};
const r1 = (n) => Math.round(n * 10) / 10;

export class AgentCanvas {
  // `el`: the element the tiles go in (tiles.js).
  constructor(el) {
    this.grid = new Tiles(el);
    this.tiles = this.grid.list; // [{ canvas, ctx, x, y, w, h, sig }]
    this.notes = [];  // what this frame draws, in order
    this.empty = true;
  }

  // Start a frame at the camera's current view.
  // `stroke`: the map's --stroke, scene px per px of line width.
  begin(camera, stroke) {
    const dpr = devicePixelRatio || 1;
    const W = innerWidth, H = innerHeight;
    if (this.grid.fit(W, H, dpr)) this.tiles = this.grid.list;
    [this.W, this.H, this.dpr] = [W, H, dpr];
    this.strokeK = stroke ?? 1 / camera.zoom;
    this.zoom = camera.zoom;
    this.panX = camera.panX;
    this.panY = camera.panY;
    this.pal = THEME.palette;
    this.notes = [];
  }

  // Leave it blank (agents switched off).
  clear() {
    this.notes = [];
    if (this.tiles.length) this.end();
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
    const { zoom } = this;
    const m = zoom * k;
    const x = this.panX + zoom * sx, y = this.panY + zoom * sy;
    const r = reachOf(shapes) * m * (1 + Math.abs(shear)) + 3; // css px, with the pen
    this.notes.push({
      shapes, matrix: [mirror ? -m : m, m * shear, 0, m * squash, x, y], unit: this.strokeK / k, alpha: 1,
      box: [x - r, y - r, x + r, y + r],
      sig: `${id(shapes)}:${r1(x)},${r1(y)},${r1(m * 100)},${mirror ? 1 : 0},${r1(shear * 100)},${r1(squash * 100)}`,
    });
  }

  // Shapes already in scene coordinates (a truck or train far out), faded
  // to `alpha`; `box`: what of the scene they cover, [x0, y0, x1, y1].
  drawScene(style, path, alpha = 1, box = null) {
    const { zoom, panX, panY } = this;
    const b = box ? [panX + zoom * box[0] - 3, panY + zoom * box[1] - 3, panX + zoom * box[2] + 3, panY + zoom * box[3] + 3] : [0, 0, this.W, this.H];
    this.notes.push({
      shapes: [{ style, path }], matrix: [zoom, 0, 0, zoom, panX, panY], unit: this.strokeK, alpha, box: b,
      sig: `s${id(style)}:${b.map(r1).join(',')},${r1(alpha * 100)}`,
    });
  }

  // The frame's drawing laid on the tiles: those whose drawing changed
  // are drawn again, the rest left as they are.
  end() {
    const { dpr, notes } = this;
    const look = `${this.pal.main}|${this.pal.bg}|${r1(this.strokeK * 1000)}`;
    let empty = true;
    for (const t of this.tiles) {
      const x0 = t.x, y0 = t.y, x1 = t.x + t.w, y1 = t.y + t.h;
      const mine = notes.filter(({ box }) => box[2] > x0 && box[0] < x1 && box[3] > y0 && box[1] < y1);
      const sig = mine.length ? `${look}|${mine.map((n) => n.sig).join('|')}` : '';
      if (sig) empty = false;
      if (sig === t.sig) continue;
      t.sig = sig;
      const { ctx, canvas } = t;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!mine.length) continue;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 4;
      this.ctx = ctx;
      this.fill = this.stroke = this.width = null;
      for (const n of mine) {
        const [a, b, c, d, e, f] = n.matrix;
        ctx.setTransform(dpr * a, dpr * b, dpr * c, dpr * d, dpr * (e - x0), dpr * (f - y0));
        ctx.globalAlpha = n.alpha;
        for (const s of n.shapes) this.paint(s.style, s.path, n.unit);
      }
      ctx.globalAlpha = 1;
    }
    this.empty = empty;
    this.notes = [];
  }

  paint(style, path, unit) {
    const { ctx, pal } = this;
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
