// Night – two ways tried, chosen in the Debug panel or with cmd.night:
//
//   lines   the whole sheet hatched over, the buildings too, like ink laid
//           over the drawing: straight lines across the screen, at the
//           angle of the shadows' hatching (SUN.hatch), as one tile of
//           pen lines repeated (an SVG pattern – however dense, it costs
//           the same), each line straying a little as it runs and broken
//           now and then. Zoomed out, a sparser tile.
//   invert  the scheme's colours turned to their negatives, lightness
//           flipped and hue kept (theme.js nightPalette): pale ink on dark
//           paper.
//
// Settings:
//   on      night at all
//   style   'lines' or 'invert'
//   every   lines: every so many of the shadows' line spacing apart
//   far     lines: zoomed out (lod-1, lod-2), this many times sparser
//   tone    invert: how far towards the negative, 0 (day) … 1
//   cool    invert: how much the night's colours lean to blue, 0 … 1
//
//   showNight(renderer)        after a change to NIGHT: shows it
//   nightTile(id, gap, h, px)  -> an SVG <pattern> of pen lines

import { hash } from './shadows.js';
import { setNightTone } from '../theme.js';

export const NIGHT = {
  on: false,
  style: 'lines',
  every: 2,
  far: 2,
  tone: 1,
  cool: 0.4,
};

// NIGHT as it is now, on the map: the lines drawn (Renderer.renderNight)
// or the colours turned.
export function showNight(renderer) {
  setNightTone(NIGHT.on && NIGHT.style === 'invert' ? NIGHT.tone : 0, NIGHT.cool);
  renderer?.dirty.add('night');
}

// The tile of the pattern, in grid units: the lines' waves go round in it
// whole, so the tiles meet without a seam.
const TILE = 8;
const r2 = (n) => Math.round(n * 100) / 100;

// A <pattern> of pen lines `gap` grid units apart (rounded so a whole
// number fit the tile), along the pattern's x, turned to `h.angle` on
// screen; `px` scene pixels to a grid unit. Each line waves by h.wave, two
// waves over the tile of its own phase.
export function nightTile(id, gap, h, px) {
  const n = Math.max(1, Math.round(TILE / gap)), g = TILE / n, step = 0.25, m = TILE / step;
  let d = '';
  for (let k = -1; k <= n; k++) {
    const j = ((k % n) + n) % n; // (the line over the edge is the first one again)
    const p1 = hash(j, 1.7) * 6.283, p2 = hash(j, 4.1) * 6.283;
    for (let i = 0; i <= m; i++) {
      const x = i * step;
      const y = k * g + h.wave * (0.6 * Math.sin((x / TILE) * 6.283 * 3 + p1) + 0.4 * Math.sin((x / TILE) * 6.283 * 8 + p2));
      d += `${i ? 'L' : 'M'}${r2(x * px)} ${r2(y * px)}`;
    }
  }
  const s = TILE * px;
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${r2(s)}" height="${r2(s)}" patternTransform="rotate(${h.angle})"><path class="night-line" d="${d}"/></pattern>`;
}
