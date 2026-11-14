// The land: the part of the grid the town's map covers. A new map's land
// is round (`round`): a rounded blob inside the grid with a wavering edge,
// the same for a given seed; past it the paper is left blank, as the edge
// of a drawn sheet. Older maps keep the grid's square (`square`).
//
//   land.depth(x, y)    how far (x, y) lies inside the edge (grid units; < 0 outside)
//   land.inside(x, y, margin = 0)
//   land.outward(x, y)  the unit direction off the land nearest (x, y)
//   land.fray(x, y)     0–1, smooth: how far past the edge a drawn line runs on

import { mulberry32, valueNoise2D } from './random.js';

// round land: as far as it reaches inside the grid's edge (`margin`), how
// square its roundness is (`power`: 2 a circle), how much of its reach the
// edge wavers in by (`wobble`), how far past it the terrain's lines run on
// at most (`fray`, see Land.fray), and its table of radii (`steps`)
export const LAND = { margin: 0.35, power: 2.4, wobble: 0.16, fray: 0.9, steps: 720 };

export class Land {
  constructor(width, height, seed = 1, kind = 'square') {
    this.kind = kind === 'round' ? 'round' : 'square';
    this.width = width;
    this.height = height;
    this.cx = (width - 1) / 2;
    this.cy = (height - 1) / 2;
    this.frayNoise = valueNoise2D((seed ^ 0x1a2d) >>> 0, 2.5);
    if (this.kind === 'round') this.radii = radii(this.cx + 0.5 - LAND.margin, this.cy + 0.5 - LAND.margin, seed);
  }

  // The edge's distance from the middle towards angle `a`.
  radiusAt(a) {
    const n = this.radii.length, f = (((a / (2 * Math.PI)) % 1) + 1) % 1 * n;
    const i = Math.floor(f) % n, t = f - Math.floor(f);
    return this.radii[i] * (1 - t) + this.radii[(i + 1) % n] * t;
  }

  depth(x, y) {
    if (this.kind === 'square') return Math.min(x + 0.5, this.width - 0.5 - x, y + 0.5, this.height - 0.5 - y);
    const dx = x - this.cx, dy = y - this.cy;
    return this.radiusAt(Math.atan2(dy, dx)) - Math.hypot(dx, dy);
  }

  inside(x, y, margin = 0) {
    return this.depth(x, y) >= margin;
  }

  outward(x, y) {
    if (this.kind === 'square') {
      const d = [[x + 0.5, -1, 0], [this.width - 0.5 - x, 1, 0], [y + 0.5, 0, -1], [this.height - 0.5 - y, 0, 1]].sort((p, q) => p[0] - q[0])[0];
      return [d[1], d[2]];
    }
    const e = 0.05;
    const gx = this.depth(x - e, y) - this.depth(x + e, y), gy = this.depth(x, y - e) - this.depth(x, y + e);
    const l = Math.hypot(gx, gy) || 1;
    return [gx / l, gy / l];
  }

  fray(x, y) {
    return this.frayNoise(x, y);
  }

  // Do the terrain's lines (contours, steep strokes, meadow, hill shade)
  // run at (x, y)? On the land, and a little, unevenly, past it.
  drawn(x, y) {
    return this.kind === 'square' || this.depth(x, y) > -LAND.fray * this.fray(x, y);
  }

  // The edge as a closed ring of points.
  outline(step = 0.25) {
    if (this.kind === 'square') {
      const [x0, y0, x1, y1] = [-0.5, -0.5, this.width - 0.5, this.height - 0.5];
      return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    }
    const n = Math.max(32, Math.round((2 * Math.PI * Math.max(this.cx, this.cy)) / step));
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * 2 * Math.PI, r = this.radiusAt(a);
      return [this.cx + Math.cos(a) * r, this.cy + Math.sin(a) * r];
    });
  }
}

// Radii round the middle: a rounded square (superellipse) of half sizes
// hx, hy, its edge pulled in unevenly by a few seeded waves.
function radii(hx, hy, seed) {
  const rnd = mulberry32((seed ^ 0x6c4e) >>> 0);
  const waves = [2, 3, 4, 5, 7].map((k) => ({ k, amp: (0.5 + rnd()) / k, phase: rnd() * 2 * Math.PI }));
  const n = LAND.steps, p = LAND.power;
  const wave = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return waves.reduce((s, w) => s + w.amp * Math.sin(w.k * a + w.phase), 0);
  });
  const lo = Math.min(...wave), hi = Math.max(...wave);
  return wave.map((w, i) => {
    const a = (i / n) * 2 * Math.PI, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const r = 1 / Math.pow(Math.pow(c / hx, p) + Math.pow(s / hy, p), 1 / p);
    return r * (1 - LAND.wobble * (hi - w) / (hi - lo || 1));
  });
}
