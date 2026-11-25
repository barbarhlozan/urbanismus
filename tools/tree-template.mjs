// Writes the blank sheet for hand-drawn trees, drawings/trees/sablona.svg
// (and .png):  node tools/tree-template.mjs
// Ten cells at one scale, 1–5 broadleaf and 6–10 conifers, each with only a
// dot where the trunk stands; beside them a village house as the game draws
// it, for the scale, and the map's ordinary line as it looks at the game's
// opening zoom. Draw on a layer of your own over it and export that layer
// alone (a PNG with the sheet left out): its ink inside a cell is the tree.
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { Camera } from '../src/render/camera.js';
import { Painter, LOOK } from '../src/render/painter.js';
import { STRUCTURE_TYPES, drawSeed } from '../structures/index.js';
import { CONFIG } from '../src/config.js';

// sheet px per grid unit of height (a glyph's unit, features/trees.js)
const S = 1000;
// a line's width on the sheet: its width on screen at the opening zoom
// (styles.css --pen-*, times CONFIG.render.lineWeight and the brush's 1.2)
const onSheet = (px) => Math.round((px * CONFIG.render.lineWeight * 1.2 * S) / (CONFIG.camera.tile * CONFIG.camera.zoom));

const GUIDE = '#b4b4b4', M = 40, CW = 720, CH = 1200, COLS = 6;
// cell i (0–9) of the trees; column 5 holds the house and the pens
export const CELL = { x0: M, y0: M, w: CW, h: CH, cols: 5, foot: 130 };
const W = M * 2 + CW * COLS, H = M * 2 + CH * 2;
const out = [];
const text = (x, y, s, size = 30, anchor = 'start') => out.push(`<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}">${s}</text>`);

out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
out.push(`<style>text { font-family: "Helvetica Neue", Helvetica, sans-serif; letter-spacing: 0.08em; fill: ${GUIDE}; } .g { fill: none; stroke: ${GUIDE}; stroke-width: 2; } .house * { fill: #fff !important; stroke: ${GUIDE} !important; stroke-width: 0.06; } .house circle, .house ellipse { display: none; }</style>`);
out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
// the frame and the grid, as on a drawing sheet
out.push(`<rect class="g" x="${M}" y="${M}" width="${CW * COLS}" height="${CH * 2}" style="stroke-width:4"/>`);
for (let c = 1; c < COLS; c++) out.push(`<line class="g" x1="${M + c * CW}" y1="${M}" x2="${M + c * CW}" y2="${M + CH * 2}"/>`);
out.push(`<line class="g" x1="${M}" y1="${M + CH}" x2="${M + CW * COLS}" y2="${M + CH}"/>`);

for (let i = 0; i < 10; i++) {
  const x = M + (i % 5) * CW, y = M + Math.floor(i / 5) * CH;
  text(x + 24, y + 48, `${i + 1} ${i < 5 ? 'listnatý' : 'jehličnatý'}`, 28);
  out.push(`<circle cx="${x + CW / 2}" cy="${y + CH - CELL.foot}" r="7" fill="${GUIDE}"/>`);
}

// the house, as the game draws it but with a ruler's straight lines, as on
// a technical drawing (glyph units: the camera's tile)
Object.assign(LOOK, { sketch: 0, overshoot: 0, tilt: 0, round: { walls: 0, roofs: 0, windows: 0 } });
const cam = new Camera({ width: 1, height: 1 }, { tile: 32 });
const s = { type: 'house', seed: 2654435761, id: 1, node: 0, rotation: 0, data: { kind: 'street' } };
const g = new Painter(cam, { x: 0, y: 0, z: 0 }, 0, drawSeed(s));
g.keep = 0;
g.keepTier = 0;
STRUCTURE_TYPES.house.draw(g, s);
const hx = M + CW * 5 + CW / 2, hy = M + CH - CELL.foot;
out.push(`<g class="house" transform="translate(${hx + 15} ${hy - 160}) scale(${S / 32})">${g.toSVG()}</g>`);

// the pen, bottom right: the map's ordinary line
const px = M + CW * 5 + 60;
let py = M + CH * 2 - 110;
for (const pen of [1]) {
  const w = onSheet(pen);
  out.push(`<line x1="${px}" y1="${py}" x2="${px + 380}" y2="${py}" stroke="#111" stroke-width="${w}" stroke-linecap="round"/>`);
  text(px + CW - 120, py + 10, `${w} px`, 26, 'end');
  py += 110;
}
out.push('</svg>');

const dir = new URL('../drawings/trees/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('sablona.svg', dir), out.join('\n'));
// the PNG, through Playwright's headless Chrome if it's there
try {
  const base = `${homedir()}/Library/Caches/ms-playwright`;
  const shell = readdirSync(base).find((d) => d.startsWith('chromium_headless_shell'));
  const sub = readdirSync(`${base}/${shell}`).find((d) => d.startsWith('chrome-headless-shell'));
  const svg = new URL('sablona.svg', dir).pathname, png = new URL('sablona.png', dir).pathname;
  execFileSync(`${base}/${shell}/${sub}/chrome-headless-shell`, ['--headless', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${W},${H}`, `--screenshot=${png}`, `file://${svg}`], { stdio: 'ignore' });
} catch { console.log('(no headless Chrome: the PNG was not made)'); }
console.log(`drawings/trees/sablona.svg ${W}×${H}`);
