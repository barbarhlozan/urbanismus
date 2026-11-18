// Crop fields as land use (World methods; see world.js): what each square
// between the dense dots grows – nothing, grain or potatoes – painted by
// the crop tools' brush (tools/cropBrush.js) and taken off by the eraser.
// The ground keeps its crop under whatever is built over it: a road, a
// house or a footpath only cuts it out where they stand (sim/fields.js),
// and when they go the crop grows there again.
//
//   world.crops   Uint8Array, one per square of the dense grid (cell =
//                 j * (fine.width - 1) + i, covering x i/2 … (i+1)/2,
//                 y j/2 … (j+1)/2): 0 none, else 1 + CROPS index
//   world.cropVersion  bumped on every change, for caches

import { CROPS } from '../../sim/fields.js';

export class WorldCrops {
  initCrops() {
    this.crops = new Uint8Array((this.fine.width - 1) * (this.fine.height - 1));
    this.cropVersion = 0;
  }

  get cropColumns() {
    return this.fine.width - 1;
  }

  // The square at a world position, or -1 off the grid.
  cropCellAt(x, y) {
    const cw = this.fine.width - 1, ch = this.fine.height - 1;
    const i = Math.floor(2 * x), j = Math.floor(2 * y);
    return i < 0 || j < 0 || i >= cw || j >= ch ? -1 : j * cw + i;
  }

  // The middle of square `cell`, in world units.
  cropCellCenter(cell) {
    const cw = this.fine.width - 1, i = cell % cw, j = (cell - i) / cw;
    return [(i + 0.5) / 2, (j + 0.5) / 2];
  }

  // The crop on square `cell` ('grain', 'potatoes') or null.
  cropOf(cell) {
    return CROPS[(this.crops[cell] ?? 0) - 1] ?? null;
  }

  // Can a crop be sown on this square: on the land, not in water?
  cropGround(cell) {
    const [x, y] = this.cropCellCenter(cell);
    if (!this.land.inside(x, y)) return false;
    const n = this.grid.nodeAt(x, y);
    return n >= 0 && !this.terrain.isWater(n);
  }

  // Paints `crop` (null: takes the crop off) on the squares whose middle
  // lies within r of the stroke through `pts` ([[x, y], …], one point a
  // dab). One history step for the lot. Returns how many squares changed.
  paintCrops(pts, r, crop) {
    const value = crop ? CROPS.indexOf(crop) + 1 : 0;
    if (crop && value <= 0) return 0;
    const cw = this.fine.width - 1, ch = this.fine.height - 1;
    const near = (x, y) => {
      if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= r;
      for (let k = 1; k < pts.length; k++) {
        const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
        if (Math.hypot(x - ax - dx * t, y - ay - dy * t) <= r) return true;
      }
      return false;
    };
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const i0 = Math.max(0, Math.floor(2 * (Math.min(...xs) - r))), i1 = Math.min(cw - 1, Math.ceil(2 * (Math.max(...xs) + r)));
    const j0 = Math.max(0, Math.floor(2 * (Math.min(...ys) - r))), j1 = Math.min(ch - 1, Math.ceil(2 * (Math.max(...ys) + r)));
    const cells = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cell = j * cw + i;
        if (this.crops[cell] === value || !near((i + 0.5) / 2, (j + 0.5) / 2)) continue;
        if (value && !this.cropGround(cell)) continue;
        cells.push(cell);
      }
    }
    if (!cells.length) return 0;
    this.history.touch();
    for (const cell of cells) this.crops[cell] = value;
    this.cropsChanged();
    return cells.length;
  }

  // Sets squares to values as given ([[cell, value], …]) – undo, loading.
  setCrops(changes) {
    for (const [cell, value] of changes) this.crops[cell] = value;
    this.cropsChanged();
  }

  cropsChanged() {
    this.cropVersion++;
    this.events.emit('fields:changed', {});
  }

  // The crops for a save: runs of equal squares, "value×count" joined by
  // commas ('' when nothing is sown).
  cropsToJSON() {
    if (!this.crops.some((v) => v)) return '';
    const out = [];
    for (let k = 0; k < this.crops.length; ) {
      const v = this.crops[k];
      let n = 1;
      while (k + n < this.crops.length && this.crops[k + n] === v) n++;
      out.push(`${v}x${n}`);
      k += n;
    }
    return out.join(',');
  }

  cropsFromJSON(text) {
    if (!text) return;
    let k = 0;
    for (const run of text.split(',')) {
      const [v, n] = run.split('x').map(Number);
      this.crops.fill(v, k, Math.min(this.crops.length, k + n));
      k += n;
    }
    this.cropVersion++;
  }
}
