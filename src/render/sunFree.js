// Drawings that hold for any sun, so that the sun moving draws nothing anew
// (Renderer.setSun): the map's painters (SUN_FREE.on, set by the renderer)
// draw every wall's hatching whichever way the wall is turned, and every
// tree's shaded side for a few ways the light can come from; a small
// stylesheet, written again as the sun moves or the view turns (sunStyle),
// shows the ones the light has now.
//
// A wall's strokes (Painter._shade) are tagged with the wall's way on the
// ground, `wd0`…`wd15` (DIRS of them, world axes), and each stroke with the
// share of the wall's strokes from which it shows, `wl0`…: strokeShare
// keeps stroke k when hash(k, …) < share, so a stroke in level b shows
// from a share of (b + ½) / LEVELS on. A tree's shaded side (features/
// trees.js) is drawn for each of SECTORS ways the light can come from on
// screen, `tq0`…, around the glyph from straight above.
//
// Photos, and the dev pages, draw for the sun as it is, as before.

import { strokeShare } from './shadows.js';
import { hash } from './hatch.js';

//   drawn   the sectors a tree's shade is drawn for: the light on a crown
//           is tipped up (trees.js ballLight), so it comes from below
//           (sectors 2–4) only when the sun is nearly across the view;
//           then the nearest drawn one stands in (SHOWN)
export const SUN_FREE = { on: false, dirs: 16, levels: 2, sectors: 6, drawn: [0, 1, 5] };
const SHOWN = [0, 1, 1, 0, 5, 5];

// The bucket of a wall's outward world normal.
export function wallDir(wx, wy) {
  const a = (Math.atan2(wy, wx) + 2 * Math.PI) % (2 * Math.PI);
  return Math.floor((a / (2 * Math.PI)) * SUN_FREE.dirs) % SUN_FREE.dirs;
}

// The level of stroke k of a wall (`seed` as wallStrokes has it).
export function strokeLevel(k, seed) {
  return Math.min(SUN_FREE.levels - 1, Math.floor(hash(k, 0.5 + seed) * SUN_FREE.levels));
}

// The light of sector s, in a glyph's own units (u right, v up), and the
// sector of a light.
export function sectorLight(s) {
  const a = Math.PI / 2 + (s / SUN_FREE.sectors) * 2 * Math.PI;
  return [Math.cos(a), Math.sin(a)];
}

export function lightSector([u, v]) {
  const a = Math.atan2(v, u) - Math.PI / 2, n = SUN_FREE.sectors;
  return ((Math.round((a / (2 * Math.PI)) * n) % n) + n) % n;
}

// The stylesheet for the sun as it is (SUN, `sun` = sunFor's) and the
// tree light's sector now (`sector`): what of the walls' and the trees'
// sun-free drawing shows, as `:not()` rules that hide the rest – so they
// add nothing over what else hides a stroke (a level of detail). Also the
// selectors of what shows, to tell what comes into sight.
export function sunStyle(sun, sector) {
  const shown = [];
  if (sun.on && sun.strokes) {
    const [sx, sy] = sun.cast, l = Math.hypot(sx, sy) || 1;
    for (let d = 0; d < SUN_FREE.dirs; d++) {
      const a = ((d + 0.5) / SUN_FREE.dirs) * 2 * Math.PI;
      const share = strokeShare((Math.cos(a) * sx + Math.sin(a) * sy) / l, sun);
      for (let b = 0; b < SUN_FREE.levels; b++) if (share > (b + 0.5) / SUN_FREE.levels) shown.push(`.wd${d}.wl${b}`);
    }
  }
  const walls = shown.length ? `.wall-shade.sf:not(${shown.join(', ')})` : '.wall-shade.sf';
  const tree = SHOWN[sector] ?? 0;
  return {
    css: `${walls} { display: none; }\n.tq:not(.tq${tree}) { display: none; }`,
    shown: [...shown.map((s) => `.wall-shade.sf${s}`), `.tq${tree}`],
  };
}

