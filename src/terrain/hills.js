// The map's hills: the tops that clearly stand above the land around them,
// each with a name in the way old Czech walking maps name them (Kamenný
// vrch, Hůrka, Na Vyhlídce). Their tops are marked with the contour lines,
// in place of height numbers (Renderer.renderContours); hovering a mark
// tells the hill's name and height (ui/annotations.js).
//
//   findHills(elevation, grid, seed, { isWater })  -> [{ x, y, height, name }]
//                                  highest first

import { mulberry32 } from '../core/random.js';

// How many there are is up to the land: every top that stands out clearly
// gets one, so a flat map has none and hilly country plenty (on test maps:
// flat 0, gentle 1–5, hilly 7–12, steep 9–14).
export const HILLS = {
  count: 16,     // a ceiling, so the steepest maps don't fill up with them
  step: 0.5,     // sampling step in grid units
  around: 1.5,   // a top is the highest point this far round (grid units)
  apart: 4,      // tops at least this far from each other
  ring: 3,       // how far out to look for the ground it rises from
  rise: 15,      // metres it must stand above that ground (three contour lines)
  edge: 2,       // tops this near the map's edge are slopes running off it
  hover: 0.7,    // the pointer this near a top (grid units) shows its name
};

const NAMES = [
  'Kamenný vrch', 'Hůrka', 'Na Vyhlídce', 'Lysá hora', 'Černý kopec', 'Strážný vrch',
  'Homole', 'Kozí hřbet', 'Na Skalce', 'Spálený vrch', 'Holý vrch', 'Dubový vrch',
  'Vysoký kopec', 'Malý vrch', 'Kalvárie', 'Bílá skála', 'Šibeník', 'Na Vinici',
  'Liščí kopec', 'Hradiště', 'Větrník', 'Na Pláni',
];

export function findHills(elevation, grid, seed, { isWater = () => false } = {}) {
  const { step, around, apart, ring, rise, edge, count } = HILLS;
  const w = Math.floor((grid.width - 1) / step) + 1, h = Math.floor((grid.height - 1) / step) + 1;
  const z = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) z[j * w + i] = elevation(i * step, j * step);
  const at = (i, j) => z[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))];

  const r = Math.round(around / step), R = Math.round(ring / step), e = Math.round(edge / step);
  const tops = [];
  for (let j = e; j < h - e; j++) {
    for (let i = e; i < w - e; i++) {
      const v = z[j * w + i];
      let top = true;
      for (let dj = -r; dj <= r && top; dj++) for (let di = -r; di <= r; di++) {
        if ((di || dj) && at(i + di, j + dj) > v) { top = false; break; }
      }
      if (!top) continue;
      // how far it stands above the lowest ground on a ring around it
      let low = Infinity;
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        low = Math.min(low, at(Math.round(i + Math.cos(a) * R), Math.round(j + Math.sin(a) * R)));
      }
      const [x, y] = [i * step, j * step];
      if (v - low < rise || isWater(x, y)) continue;
      tops.push({ x, y, height: v });
    }
  }

  // the highest first, each far enough from the ones already named
  tops.sort((a, b) => b.height - a.height);
  const hills = [];
  for (const t of tops) {
    if (hills.length >= count) break;
    if (hills.some((o) => Math.hypot(o.x - t.x, o.y - t.y) < apart)) continue;
    hills.push(t);
  }
  const rand = mulberry32(seed ^ 0x51e1);
  const names = [...NAMES];
  for (const hl of hills) hl.name = names.splice(Math.floor(rand() * names.length), 1)[0];
  return hills;
}
