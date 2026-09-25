// Pixel mode: chunky 1-bit pixels.
//
// The scene is still described by the SVG renderer; this shows it through a
// low-resolution canvas instead:
//   1. the static layers (terrain … objects) are rasterised off-screen at
//      1/pixel-size resolution, for the viewport plus a margin (clamped to
//      the map)
//   2. every pixel is forced to pure black or white – the "line weight"
//      setting is where that cut-off sits (lower = bolder lines)
//   3. grid dots, parked cars and moving dots are plotted straight onto the
//      pixel grid (so they never get lost below one pixel)
//   4. the overlay (hover, previews, tags) is rasterised the same way
//   5. the canvas is scaled up without smoothing, positions snapped to whole
//      pixels so nothing shimmers when panning
//
// Settings (Style panel):
//   pixels       pixel size in real screen pixels (1 = off, vector drawing)
//   pixelFollow  pixels scale with zoom: the size applies at ZOOM_REF and
//                below it pixels shrink with the map, so a zoomed-out view
//                keeps the same texture instead of getting coarser
//   pixelWeight  0–1, thin → bold lines
//   pixelDetail  0–1, how much small detail survives at this pixel size
//
// The map raster is redone when the content, zoom, rotation or detail level
// changes, or the view pans past the margin; the overlay when it changes.

import { THEME } from '../theme.js';

const STATIC_LAYERS = ['terrain', 'frame', 'grid', 'subgrid', 'lots', 'markers', 'paths', 'roads', 'objects'];
const MARGIN = 0.5;           // extra raster around the viewport, as a share of its size
const MAX_PIXELS = 6e6;       // cap on raster size (low-res pixels)
const MIN_INTERVAL = 350;     // ms between rasters for plain content changes
// UI font, embedded into rasterised SVG (images can't load the page's fonts)
const ZOOM_REF = 1.5;         // zoom at which `pixels` applies when scaling with zoom
const FONT = { family: 'Bianzhidai', url: 'fonts/bianzhidai_COLR-GRAY.woff', format: 'woff' };

export class PixelRenderer {
  constructor(svg, { world, camera, renderer, agents, parking, config }) {
    this.config = config;
    this.svg = svg;
    this.world = world;
    this.camera = camera;
    this.renderer = renderer;
    this.agents = agents;
    this.parking = parking;
    this.size = 1;         // real screen pixels per pixel
    this.p = 1;            // CSS pixels per pixel
    this.weight = 0.5;
    this.detail = 0.5;
    this.follow = true;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pixel-canvas hidden';
    svg.parentNode.insertBefore(this.canvas, svg);
    this.ctx = this.canvas.getContext('2d');

    this.map = null;       // { canvas, x0, y0, zoom, key, version, region }
    this.over = null;      // overlay raster, same shape
    this.pending = null;
    this.overPending = null;
    this.requestId = 0;
    this.lastRaster = 0;
    this.css = null;
    this.fontCss = '';
    this.loadFont();
  }

  // ----- settings -----

  set({ size, weight, detail, follow }) {
    this.size = size;
    this.weight = weight;
    this.detail = detail;
    this.follow = follow;
    this.p = this.devSize() / (window.devicePixelRatio || 1);
    const on = size > 1;
    this.canvas.classList.toggle('hidden', !on);
    this.svg.classList.toggle('pixel-mode', on);
    document.body.classList.toggle('pixel-ui', on);
    // the UI keeps the chosen size (it doesn't zoom)
    document.body.style.setProperty('--px', `${on ? size / (window.devicePixelRatio || 1) : 1}px`);
    this.map = null;
    this.over = null;
  }

  get enabled() {
    return this.size > 1;
  }

  // Pixel size in real screen pixels right now (whole numbers, so every
  // pixel on screen is the same size).
  devSize() {
    if (!this.follow) return this.size;
    return Math.max(1, Math.round(this.size * Math.min(1, this.camera.zoom / ZOOM_REF)));
  }

  // CSS pixels per pixel while on, else 0 (for things that size themselves to it)
  get scale() {
    return this.enabled ? this.p : 0;
  }

  // brightness cut-off: weight 0 → 210 (thin), 1 → 30 (bold)
  get cutoff() {
    return 210 - this.weight * 180;
  }

  // Everything that changes how the static layers look (besides content).
  stateKey() {
    const c = this.camera;
    return [this.devSize(), this.weight, this.detail, this.follow, c.zoom, c.rotation, this.svg.getAttribute('class')].join('|');
  }

  // ----- per frame -----

  frame() {
    if (!this.enabled) return;
    this.p = this.devSize() / (window.devicePixelRatio || 1);
    const p = this.p;
    const vw = this.svg.clientWidth, vh = this.svg.clientHeight;
    const cw = Math.ceil(vw / p), ch = Math.ceil(vh / p);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.canvas.style.width = `${cw * p}px`;
      this.canvas.style.height = `${ch * p}px`;
    }

    this.maybeRaster(vw, vh);
    this.maybeRasterOverlay(vw, vh);

    const { ctx } = this;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = THEME.palette.bg;
    ctx.fillRect(0, 0, cw, ch);
    this.blit(this.map);
    this.drawDots();
    this.blit(this.over);
  }

  // Draw a raster at its place, snapped to whole pixels (scaled while a new
  // zoom is on its way).
  blit(r) {
    if (!r?.canvas) return; // nothing drawn (e.g. an empty overlay)
    const { camera, p } = this;
    const k = (camera.zoom / r.zoom) * (r.p / p); // raster made at another zoom / pixel size
    const ox = Math.round((r.x0 * camera.zoom + camera.panX) / p);
    const oy = Math.round((r.y0 * camera.zoom + camera.panY) / p);
    this.ctx.drawImage(r.canvas, ox, oy, Math.round(r.canvas.width * k), Math.round(r.canvas.height * k));
  }

  toPixel(x, y, z = 0) {
    const { camera, p } = this;
    const [sx, sy] = camera.project(x, y, this.world.terrain.heightAt(x, y) + z);
    return [Math.floor((sx * camera.zoom + camera.panX) / p), Math.floor((sy * camera.zoom + camera.panY) / p)];
  }

  // Parked cars (hollow squares) and moving dots, plotted on the pixel grid.
  drawDots() {
    const { ctx, camera, world, parking } = this;
    const unit = Math.max(1, Math.round((THEME.agentRadius * 2 * camera.zoom) / this.p));
    const fg = THEME.palette.fg, bg = THEME.palette.bg;
    ctx.fillStyle = fg;
    for (const [id, spots] of parking.spots) {
      const s = world.structures.get(id);
      if (!s) continue;
      for (const [x, y] of spots.slice(0, parking.count(s))) {
        const [px, py] = this.toPixel(x, y, 0.02);
        ctx.fillRect(px - 1, py - 1, unit + 2, unit + 2);
        ctx.fillStyle = bg;
        ctx.fillRect(px, py, unit, unit);
        ctx.fillStyle = fg;
      }
    }
    for (const a of this.agents.visible()) {
      const [px, py] = this.toPixel(a.x, a.y, 0.04);
      const n = a.trip.mode === 'drive' ? unit : Math.max(1, unit - 1);
      ctx.fillRect(px, py, n, n);
    }
  }

  // ----- rasters -----

  view(vw, vh) {
    const { camera } = this;
    return [-camera.panX / camera.zoom, -camera.panY / camera.zoom, vw / camera.zoom, vh / camera.zoom];
  }

  // Scene-space box around the whole map (with room for tall buildings).
  mapBounds() {
    const { grid } = this.world;
    const pts = [[-3, -3], [grid.width + 2, -3], [-3, grid.height + 2], [grid.width + 2, grid.height + 2]]
      .map(([x, y]) => this.camera.project(x, y, 0));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const top = 3 * this.camera.zScale * this.camera.tile;
    return [Math.min(...xs), Math.min(...ys) - top, Math.max(...xs), Math.max(...ys)];
  }

  maybeRaster(vw, vh) {
    const key = this.stateKey();
    const version = this.renderer.version ?? 0;
    const view = this.view(vw, vh);
    const m = this.map;
    const inside = m && view[0] >= m.region[0] && view[1] >= m.region[1] &&
      view[0] + view[2] <= m.region[0] + m.region[2] && view[1] + view[3] <= m.region[1] + m.region[3];
    const clampedInside = m && inside; // (a region clamped to the map may not cover beyond it – fine)
    const stale = !m || m.key !== key || !clampedInside || m.version !== version;
    if (!stale || this.pending) return;
    if (m && m.key === key && inside && performance.now() - this.lastRaster < MIN_INTERVAL) return;

    // viewport plus margin, clamped to the map, capped in size
    const zoom = this.camera.zoom;
    let margin = MARGIN;
    while (margin > 0 && ((view[2] * (1 + 2 * margin) * zoom) / this.p) * ((view[3] * (1 + 2 * margin) * zoom) / this.p) > MAX_PIXELS) margin -= 0.1;
    margin = Math.max(margin, 0);
    const [bx0, by0, bx1, by1] = this.mapBounds();
    const x0 = Math.max(view[0] - view[2] * margin, Math.min(bx0, view[0]));
    const y0 = Math.max(view[1] - view[3] * margin, Math.min(by0, view[1]));
    const x1 = Math.min(view[0] + view[2] * (1 + margin), Math.max(bx1, view[0] + view[2]));
    const y1 = Math.min(view[1] + view[3] * (1 + margin), Math.max(by1, view[1] + view[3]));
    const region = [x0, y0, x1 - x0, y1 - y0];

    this.pending = ++this.requestId;
    this.lastRaster = performance.now();
    const id = this.pending;
    const layers = STATIC_LAYERS.map((l) => this.svg.querySelector(`.layer-${l}`)?.outerHTML ?? '').join('');
    const p = this.p;
    this.rasterize(layers, region, { background: true, dots: true }).then((canvas) => {
      if (this.pending !== id) return;
      this.pending = null;
      if (canvas) this.map = { canvas, x0: region[0], y0: region[1], zoom, p, key, version, region };
    });
  }

  maybeRasterOverlay(vw, vh) {
    const layer = this.svg.querySelector('.layer-overlay');
    const html = layer?.outerHTML ?? '';
    const key = [this.stateKey(), this.camera.panX, this.camera.panY, html].join('|');
    if (this.over?.key === key || this.overPending) return;
    if (!layer || !layer.innerHTML.trim()) {
      this.over = { key, canvas: null };
      return;
    }
    const region = this.view(vw, vh);
    const zoom = this.camera.zoom;
    const p = this.p;
    const id = this.overPending = ++this.requestId;
    this.rasterize(html, region, { background: false }).then((canvas) => {
      if (this.overPending !== id) return;
      this.overPending = null;
      this.over = canvas ? { canvas, x0: region[0], y0: region[1], zoom, p, key } : { key, canvas: null };
    });
  }

  // Rasterise SVG markup (scene coordinates) for `region` at the pixel scale,
  // thresholded to 1-bit. Resolves with a canvas (or null on failure).
  rasterize(markup, region, { background, dots = false }) {
    const { camera, p } = this;
    const zoom = camera.zoom;
    const W = Math.max(1, Math.ceil((region[2] * zoom) / p));
    const H = Math.max(1, Math.ceil((region[3] * zoom) / p));

    // detail: with pixels scaling with zoom it follows the zoom like the
    // vector view (the slider shifts it); with fixed pixels, bigger pixels
    // also show less, as if zoomed further out
    const { medium, far } = this.config.render.lod;
    const k = 0.6 + this.detail * 0.8; // the Detail slider: 0.6× … 1.4×
    const z = this.follow
      ? zoom * k
      : (zoom * (0.6 + this.detail * 2.4) * (window.devicePixelRatio || 1)) / this.size;
    const byZoom = z >= medium ? 0 : z >= far ? 1 : 2;
    // …and never more detail than the pixels can hold: floor lines need
    // about 30 pixels per grid step, small props about 14
    const perStep = ((zoom * camera.tile) / p) * k;
    const byPixels = perStep >= 30 ? 0 : perStep >= 14 ? 1 : 2;
    const lod = Math.max(byZoom, byPixels);
    // no aliasing inside the raster: the grey edges are what the cut-off works on
    const cls = (this.svg.getAttribute('class') ?? '').replace(/\b(pixel-mode|crisp)\b/g, '').replace(/lod-\d/, `lod-${lod}`);
    const defs = this.svg.querySelector('defs')?.outerHTML ?? '';
    const doc =
      `<svg xmlns="http://www.w3.org/2000/svg" id="world" class="${cls}" width="${W}" height="${H}" ` +
      `style="position:static;width:${W}px;height:${H}px" viewBox="${region.join(' ')}">` +
      `<style>${this.stylesheet()}</style>${defs}<g class="scene">${markup}</g></svg>`;

    return new Promise((resolve) => {
      const url = URL.createObjectURL(new Blob([doc], { type: 'image/svg+xml' }));
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (background) {
          ctx.fillStyle = THEME.palette.bg;
          ctx.fillRect(0, 0, W, H);
        }
        ctx.drawImage(img, 0, 0, W, H);
        this.threshold(ctx, W, H, background);
        if (dots) this.plotGridDots(ctx, region, zoom, p);
        resolve(canvas);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  // Force every pixel to pure black or white (keeping transparency for the
  // overlay, so it only covers what it draws).
  threshold(ctx, W, H, opaque) {
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const cut = this.cutoff;
    for (let i = 0; i < d.length; i += 4) {
      if (!opaque && d[i + 3] < 110) {
        d[i + 3] = 0;
        continue;
      }
      const v = Math.max(d[i], d[i + 1], d[i + 2]) > cut ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  // Grid dots are smaller than a pixel: plot each as exactly one.
  plotGridDots(ctx, region, zoom, p) {
    const { world, camera } = this;
    ctx.fillStyle = THEME.palette.fg;
    const plot = (x, y) => {
      const [sx, sy] = camera.project(x, y, world.terrain.heightAt(x, y));
      ctx.fillRect(Math.floor(((sx - region[0]) * zoom) / p), Math.floor(((sy - region[1]) * zoom) / p), 1, 1);
    };
    const { grid, terrain } = world;
    for (let i = 0; i < grid.size; i++) if (!terrain.isWater(i)) plot(...grid.xy(i));
    if (this.svg.classList.contains('show-fine')) {
      for (let f = 0; f < world.fine.size; f++) {
        const [fx, fy] = world.fine.xy(f);
        if ((fx % 2 || fy % 2) && !world.coarseAround(f).some((c) => terrain.isWater(c))) plot(fx / 2, fy / 2);
      }
    }
  }

  // ----- CSS for the rasterised SVG -----

  // The page's CSS inlined (images can't load the page's fonts or sheets),
  // with the UI font embedded so labels keep their typeface.
  stylesheet() {
    if (this.css) return this.css;
    const vars = Object.entries(THEME.palette).map(([k, v]) => `--${k}:${v};`).join('');
    let rules = '';
    for (const sheet of document.styleSheets) {
      try {
        for (const r of sheet.cssRules) if (!(r instanceof CSSFontFaceRule)) rules += r.cssText;
      } catch {
        // cross-origin sheet: skip
      }
    }
    const css = `${this.fontCss}svg{${vars}}${rules}`;
    if (this.fontCss) this.css = css; // cache once the font is in
    return css;
  }

  async loadFont() {
    try {
      const buf = await (await fetch(FONT.url)).arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      this.fontCss = `@font-face{font-family:"${FONT.family}";src:url(data:font/${FONT.format};base64,${btoa(bin)}) format("${FONT.format}");}`;
      this.css = null;
      this.map = null;
    } catch {
      // no font: labels fall back to the default typeface
    }
  }
}
