// Draws a few buildings and trees with the game's own Painter and writes them
// as standalone SVG files next to this script (for icons and such).
//
//   node icons/make.js            Blue color scheme
//   node icons/make.js 2          another scheme from src/theme.js (2 = Paper)
//
// The files need no stylesheet: the classes the game styles in styles.css
// are turned into plain fill / stroke attributes, in the scheme's colors.
// To add an icon, add an entry to ICONS: a name and a draw(g) function
// (the painter API in src/render/painter.js).

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMES } from '../src/theme.js';
import { Camera } from '../src/render/camera.js';
import { Painter, LOOK } from '../src/render/painter.js';
import { mulberry32 } from '../src/core/random.js';
import { STRUCTURE_TYPES } from '../structures/index.js';
import * as heritage from '../structures/heritage.js';
import { drawTree } from '../features/trees.js';

const TILE = 64;     // scene px per grid step (the gallery's close-up scale)
const PAD = 4;       // px around the drawing
const ROTATION = 2;  // turn the fronts (local -y) towards the viewer
const FAVICON_TILE = 64;   // bigger tile = thinner lines relative to the house
const FAVICON_SKETCH = 2;  // less wobble than the map's LOOK.sketch

// A seed whose first g.pick() out of `n` choices lands on `index`, so a
// drawing that starts by picking its kind draws the one we want.
function seedFor(n, index, from = 1) {
  for (let s = from; ; s++) if (Math.floor(mulberry32(s)() * n) === index) return s;
}

const level = (type, i) => (g) => STRUCTURE_TYPES[type].levels[i].draw(g, {});
const HOUSE_KINDS = ['cube', 'cube', 'street', 'street', 'farm', 'villa', 'mansard'];
const house = (kind, from) => ({ seed: seedFor(HOUSE_KINDS.length, HOUSE_KINDS.indexOf(kind), from), draw: level('residential', 0) });

const ICONS = {
  'house-street': house('street', 3),
  'house-cube': house('cube'),
  'house-villa': house('villa'),
  'house-farm': house('farm'),
  'house-mansard': house('mansard'),
  'apartments': { seed: seedFor(4, 0), draw: level('residential', 1) },
  'panel-block': { seed: seedFor(3, 0), draw: level('residential', 2) },
  'church': { seed: 7, draw: (g) => heritage.church.levels[0].draw(g, {}) },
  'tree-spruce': { seed: 1, draw: (g) => drawTree(g, 0, 0, 'spruce', 0.56) },
  'tree-leafy': { seed: 3, draw: (g) => drawTree(g, 0, 0, 'spreading', 0.5) },
};

// ----- styles.css, as attributes -----

function styleFor(tag, cls, palette) {
  const has = (c) => cls.includes(c);
  let s;
  if (tag === 'polyline' || has('ln')) s = { fill: 'none', stroke: 'detail', 'stroke-width': 1, 'stroke-linecap': 'round' };
  else s = { fill: 'bg', stroke: 'main', 'stroke-width': 1.2, 'stroke-linejoin': 'round' };
  if (has('glyph')) {
    s = { fill: 'none', stroke: 'detail', 'stroke-width': 0.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    if (has('trunk')) s['stroke-width'] = has('thick') ? 2.4 : 1.4;
    if (has('limb')) s['stroke-width'] = 1.15;
    if (has('twig')) s['stroke-width'] = 0.6;
    if (has('leaf')) s['stroke-width'] = 0.7;
  }
  if (has('tree') && has('filled')) Object.assign(s, { stroke: 'detail', 'stroke-width': 1 });
  if (has('foot')) Object.assign(s, { stroke: 'main', 'stroke-width': 1.2 });
  if (has('roof-hatch')) Object.assign(s, { stroke: 'main', 'stroke-width': 0.7 });
  if (has('ink')) Object.assign(s, { fill: 'main', stroke: 'main', 'stroke-width': 0.8, 'stroke-linejoin': 'round' });
  for (const k of ['fill', 'stroke']) if (palette[s[k]]) s[k] = palette[s[k]];
  return s;
}

function inline(svg, palette) {
  const vars = (v) => v.replace(/var\(--(\w+)\)/g, (_, n) => palette[n === 'fg' ? 'main' : n] ?? n);
  return svg.replace(/<(polygon|polyline|path|circle)\b([^>]*?)\/>/g, (_, tag, rest) => {
    const cls = (rest.match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/);
    const s = styleFor(tag, cls, palette);
    for (const decl of (rest.match(/style="([^"]*)"/)?.[1] ?? '').split(';')) {
      const [k, v] = decl.split(':');
      if (k && v) s[k.trim()] = vars(v.trim());
    }
    const attrs = rest.replace(/\s(class|style)="[^"]*"/g, '');
    return `<${tag}${attrs} ${Object.entries(s).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`;
  });
}

// ----- bounding box from the markup (no DOM here) -----

function bbox(svg) {
  const xs = [], ys = [];
  const add = (x, y) => { xs.push(x); ys.push(y); };
  for (const [, d] of svg.matchAll(/\sd="([^"]*)"/g)) {
    // absolute commands only; the relative `l` overshoot ticks are tiny
    for (const [, cmd, args] of d.matchAll(/([MLQlZ])([^MLQlZ]*)/g)) {
      if (cmd === 'l' || cmd === 'Z') continue;
      const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
      for (let i = 0; i + 1 < n.length; i += 2) add(n[i], n[i + 1]);
    }
  }
  for (const [, pts] of svg.matchAll(/points="([^"]*)"/g)) {
    const n = pts.trim().split(/[\s,]+/).map(Number);
    for (let i = 0; i + 1 < n.length; i += 2) add(n[i], n[i + 1]);
  }
  for (const [, cx, cy, r] of svg.matchAll(/cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/g)) {
    add(+cx - +r, +cy - +r); add(+cx + +r, +cy + +r);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// ----- main -----

const palette = SCHEMES[Number(process.argv[2] ?? 0)] ?? SCHEMES[0];
const dir = dirname(fileURLToPath(import.meta.url));
const cam = new Camera({ width: 1, height: 1 }, { tile: TILE });

// square: centre the drawing in a square viewBox (browser tab icons)
function render(camera, { seed, draw }, pad, square = false) {
  const g = new Painter(camera, { x: 0, y: 0 }, ROTATION, seed);
  draw(g);
  const body = inline(g.toGroundSVG() + g.toSVG(), palette);
  const [x0, y0, x1, y1] = bbox(body);
  let [x, y, w, h] = [x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2];
  if (square) {
    const s = Math.max(w, h);
    [x, y, w, h] = [x - (s - w) / 2, y - (s - h) / 2, s, s];
  }
  [x, y, w, h] = [x, y, w, h].map((n) => Math.round(n * 10) / 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${Math.round(w * 4)}" height="${Math.round(h * 4)}">${body}</svg>\n`;
}

for (const [name, icon] of Object.entries(ICONS)) {
  writeFileSync(join(dir, `${name}.svg`), render(cam, icon, PAD));
  console.log(`${name}.svg`);
}

// The browser tab icon (linked from index.html): the street house with the
// fine pen marks left out – at 16 px roof hatching, corner overshoots and the
// stroke along the foot are under a pixel apart and blur into one blob.
const TAB_LOOK = { hatch: 0, overshoot: 0, ground: 0, sketch: FAVICON_SKETCH };
const saved = { ...LOOK };
Object.assign(LOOK, TAB_LOOK);
writeFileSync(join(dir, 'favicon.svg'), render(new Camera({ width: 1, height: 1 }, { tile: FAVICON_TILE }), ICONS['house-street'], 1, true));
Object.assign(LOOK, saved);
console.log('favicon.svg');
