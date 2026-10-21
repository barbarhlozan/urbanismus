// A window-sized drawing shown on tiles, each a <canvas> of its own (TILE
// css px a side), so that what changed in a frame is all the browser takes
// in anew: every new picture of a canvas is copied to the GPU again –
// Firefox copies the whole of it – and a full-window canvas is a lot to
// copy every frame for a few cars or headlights. People and vehicles
// (agentCanvas.js) draw on the tiles themselves; the night (nightCanvas.js)
// is drawn on one canvas off the page and copied onto the tiles it changed.
//
//   const tiles = new Tiles(el)     el: a <canvas> (replaced by a <div> with its id) or a <div>
//   tiles.fit(W, H, dpr)            the window's size: true if laid out anew
//   tiles.list                      [{ canvas, ctx, x, y, w, h }] css px
//   tiles.show(source, rects)       source's device px onto the tiles under rects (null: all)

export const TILE = 96;

export class Tiles {
  constructor(el) {
    if (el.tagName === 'CANVAS') {
      const host = document.createElement('div');
      host.id = el.id;
      host.className = el.className;
      el.replaceWith(host);
      el = host;
    }
    this.host = el;
    this.list = [];
  }

  fit(W, H, dpr) {
    if (W === this.W && H === this.H && dpr === this.dpr) return false;
    for (const t of this.list) t.canvas.remove();
    this.list = [];
    [this.W, this.H, this.dpr] = [W, H, dpr];
    for (let y = 0; y < H; y += TILE) {
      for (let x = 0; x < W; x += TILE) {
        const w = Math.min(TILE, W - x), h = Math.min(TILE, H - y);
        const canvas = this.host.appendChild(document.createElement('canvas'));
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        Object.assign(canvas.style, { position: 'absolute', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
        this.list.push({ canvas, ctx: canvas.getContext('2d'), x, y, w, h, sig: '' });
      }
    }
    return true;
  }

  // The tiles under `rects` ([x0, y0, x1, y1] in the source's device px;
  // null: every tile) copied from `source` (null: cleared).
  show(source, rects = null) {
    const { dpr } = this;
    for (const t of this.list) {
      const x0 = Math.round(t.x * dpr), y0 = Math.round(t.y * dpr), w = t.canvas.width, h = t.canvas.height;
      if (rects && !rects.some((r) => r[2] > x0 && r[0] < x0 + w && r[3] > y0 && r[1] < y0 + h)) continue;
      t.ctx.clearRect(0, 0, w, h);
      if (source) t.ctx.drawImage(source, x0, y0, w, h, 0, 0, w, h);
    }
  }
}
