// Crop fields as land use (World methods; see world.js): what each little
// square of the ground grows – nothing, grain or potatoes, and which way
// its rows run – painted by the crop tools' brush (tools/cropBrush.js)
// and taken off a field at a time by the field eraser. The squares are
// small (CROP_RES to a grid step), so a field has the brush's own uneven
// edge, not the grid's. The ground keeps its crop under whatever is built
// over it: a road, a house or a footpath only cuts it out where they
// stand (sim/fields.js), and when they go the crop grows there again.
//
//   world.crops   Uint8Array, one per square (cell = j * cropColumns + i,
//                 covering x i/R … (i+1)/R, y j/R … (j+1)/R): 0 none, else
//                 1 + 2 × CROPS index + (1 where the rows run along y)
//   world.cropVersion  bumped on every change, for caches

import { CROPS } from '../../sim/fields.js';
import { valueNoise2D } from '../random.js';

export const CROP_RES = 8; // squares to a grid step, each way

// The value a square holds for `crop` with its rows `along` ('x' / 'y').
export const cropValue = (crop, along = 'x') => {
  const k = CROPS.indexOf(crop);
  return k < 0 ? 0 : 1 + 2 * k + (along === 'y' ? 1 : 0);
};
// ...and back
export const cropOfValue = (v) => (v ? CROPS[(v - 1) >> 1] ?? null : null);
export const alongOfValue = (v) => ((v - 1) & 1 ? 'y' : 'x');

// The brush's edge wavers in and out by this share of its radius, slowly
// along it (the same waver wherever it's painted, so dabs side by side
// join up without seams).
const EDGE = 0.22, EDGE_SIZE = 0.18;

export class WorldCrops {
  initCrops() {
    this.cropRows = CROP_RES * (this.grid.height - 1);
    this.crops = new Uint8Array(this.cropColumns * this.cropRows);
    this.cropVersion = 0;
    this.cropEdge = valueNoise2D((this.seed ?? 0) ^ 0x63726f70, EDGE_SIZE);
  }

  get cropColumns() {
    return CROP_RES * (this.grid.width - 1);
  }

  // The square at a world position, or -1 off the grid.
  cropCellAt(x, y) {
    const cw = this.cropColumns;
    const i = Math.floor(CROP_RES * x), j = Math.floor(CROP_RES * y);
    return i < 0 || j < 0 || i >= cw || j >= this.cropRows ? -1 : j * cw + i;
  }

  // The middle of square `cell`, in world units.
  cropCellCenter(cell) {
    const cw = this.cropColumns, i = cell % cw, j = (cell - i) / cw;
    return [(i + 0.5) / CROP_RES, (j + 0.5) / CROP_RES];
  }

  // The crop on square `cell` ('grain', 'potatoes') or null.
  cropOf(cell) {
    return cropOfValue(this.crops[cell] ?? 0);
  }

  // Can a crop be sown on this square: on the land, not in water?
  cropGround(cell) {
    const [x, y] = this.cropCellCenter(cell);
    if (!this.land.inside(x, y)) return false;
    const n = this.grid.nodeAt(x, y);
    return n >= 0 && !this.terrain.isWater(n);
  }

  // Paints `crop` (null: takes the crop off) on the squares within r of
  // the stroke through `pts` ([[x, y], …], one point a dab), the edge
  // wavering (EDGE). Sown, its rows run `along`; a square that already
  // grows the crop keeps it as it is (and its rows), the other crop gives
  // way. `into` (optional): a Set the squares sown anew are added to.
  // Returns how many squares changed.
  paintCrops(pts, r, crop, { along = 'x', into = null } = {}) {
    const value = crop ? cropValue(crop, along) : 0;
    if (crop && !value) return 0;
    const R = CROP_RES, cw = this.cropColumns, ch = this.cropRows;
    const reach = (x, y) => r * (1 + EDGE * (2 * this.cropEdge(x, y) - 1));
    const near = (x, y) => {
      const lim = reach(x, y);
      if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= lim;
      for (let k = 1; k < pts.length; k++) {
        const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
        if (Math.hypot(x - ax - dx * t, y - ay - dy * t) <= lim) return true;
      }
      return false;
    };
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), m = r * (1 + EDGE);
    const i0 = Math.max(0, Math.floor(R * (Math.min(...xs) - m))), i1 = Math.min(cw - 1, Math.ceil(R * (Math.max(...xs) + m)));
    const j0 = Math.max(0, Math.floor(R * (Math.min(...ys) - m))), j1 = Math.min(ch - 1, Math.ceil(R * (Math.max(...ys) + m)));
    let cells = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cell = j * cw + i, was = this.crops[cell];
        if (value ? cropOfValue(was) === crop : !was) continue;
        if (!near((i + 0.5) / R, (j + 0.5) / R)) continue;
        if (value && !this.cropGround(cell)) continue;
        cells.push(cell);
      }
    }
    if (!cells.length) return 0;
    // (a square the wavering edge left alone between the painted ones goes
    // with them, so no speck stays behind or a pinhole in the field – and
    // one it sowed on its own, out of touch with the rest, isn't sown)
    let painted = new Set(cells);
    const took = (c) => painted.has(c) || this.crops[c] === value;
    if (value) {
      const alone = (c) => {
        const i = c % cw;
        return !((i > 0 && took(c - 1)) || (i < cw - 1 && took(c + 1)) || (c >= cw && took(c - cw)) || (c + cw < this.crops.length && took(c + cw)));
      };
      cells = cells.filter((c) => !alone(c));
      if (!cells.length) return 0;
      painted = new Set(cells);
    }
    for (let j = Math.max(0, j0 - 1); j <= Math.min(ch - 1, j1 + 1); j++) {
      for (let i = Math.max(0, i0 - 1); i <= Math.min(cw - 1, i1 + 1); i++) {
        const cell = j * cw + i, was = this.crops[cell];
        if (painted.has(cell) || (value ? cropOfValue(was) === crop : !was)) continue;
        const around = (i > 0 && took(cell - 1)) + (i < cw - 1 && took(cell + 1)) + (j > 0 && took(cell - cw)) + (j < ch - 1 && took(cell + cw));
        if (around >= 3 && (!value || this.cropGround(cell))) cells.push(cell);
      }
    }
    this.history.touch();
    for (const cell of cells) this.crops[cell] = value;
    if (into) for (const cell of cells) into.add(cell);
    this.cropsChanged(this.cropBox(cells));
    return cells.length;
  }

  // Sets squares to values as given ([[cell, value], …]) – undo, loading,
  // a field erased, a stroke's rows turned. `from`: where the eraser
  // touched it (the crop sinks from there out, renderer/terrain.js).
  setCrops(changes, { from = null } = {}) {
    if (!changes.length) return;
    this.history.touch();
    for (const [cell, value] of changes) this.crops[cell] = value;
    this.cropsChanged(this.cropBox(changes.map(([cell]) => cell)), from);
  }

  // The world box [x0, y0, x1, y1] round squares.
  cropBox(cells) {
    const cw = this.cropColumns;
    let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    for (const c of cells) {
      const i = c % cw, j = (c - i) / cw;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
    }
    return [i0 / CROP_RES, j0 / CROP_RES, (i1 + 1) / CROP_RES, (j1 + 1) / CROP_RES];
  }

  // `box`: where it changed (world units), or none: anywhere; `from`: see
  // setCrops.
  cropsChanged(box = null, from = null) {
    this.cropVersion++;
    this.events.emit('fields:changed', { box, from });
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

  // (an older save: squares half a step across, 1 grain / 2 potatoes –
  // each spread over the little squares it covered, rows along x)
  cropsFromJSON(text) {
    if (!text) return;
    const runs = text.split(',').map((run) => run.split('x').map(Number));
    const total = runs.reduce((n, [, k]) => n + k, 0);
    if (total === this.crops.length) {
      let k = 0;
      for (const [v, n] of runs) {
        this.crops.fill(v, k, Math.min(this.crops.length, k + n));
        k += n;
      }
    } else {
      const ow = 2 * (this.grid.width - 1), f = CROP_RES / 2, cw = this.cropColumns;
      let k = 0;
      for (const [v, n] of runs) {
        const value = v ? cropValue(CROPS[v - 1]) : 0;
        for (let c = k; value && c < k + n; c++) {
          const oi = c % ow, oj = (c - oi) / ow;
          for (let dj = 0; dj < f; dj++) {
            const row = (oj * f + dj) * cw;
            if (oj * f + dj < this.cropRows) this.crops.fill(value, row + oi * f, Math.min(row + cw, row + oi * f + f));
          }
        }
        k += n;
      }
    }
    this.cropVersion++;
  }
}
