// Draws the Build menu's sprites, one SVG file per tool, next to this
// script: each structure kept to what makes it that one (a cube house's
// pyramid roof, the textile mill's sawtooth, the JZD's silo), seen from the
// front, standing on a ground stroke, in the pen of the UI (render/sketch.js):
// lines a little bowed, running past the corners, roofs hatched, windows
// dots of ink. The game reads the files (src/ui/uiIcons.js), so a sprite is
// changed by editing its file, or its lines below and running
//
//   node icons/sprites/make.js
//
// which writes every file again (the same strokes each time: fixed seeds).
// Each drawing is on a 24×24 box, the ground at y = 21.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sketchLine, sketchEllipse } from '../../src/render/sketch.js';

const G = 21;          // the ground
const K = 0.28;        // the pen's wobble, for a 24 px box
const r2 = (n) => Math.round(n * 100) / 100;

// A drawing's strokes, by kind: '' lines, 'h' hatching and fine detail,
// 'ink' filled with the pen's colour, 'p' filled with the paper (hiding
// what's behind, no line of its own).
class Pen {
  constructor(seed) { this.seed = seed * 1000; this.parts = []; }
  add(cls, d) {
    const last = this.parts[this.parts.length - 1];
    if (last && last.cls === cls) last.d += d; else this.parts.push({ cls, d });
    return this;
  }
  line(x1, y1, x2, y2, { over = 1.2, cls = '' } = {}) {
    return this.add(cls, sketchLine([x1, y1], [x2, y2], this.seed++, { k: K, over, bow: 1 }));
  }
  thin(x1, y1, x2, y2) { return this.line(x1, y1, x2, y2, { over: 0.4, cls: 'h' }); }
  // a run of strokes through points (closed: back to the first)
  poly(pts, { closed = false, cls = '', over = 1 } = {}) {
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) this.line(...pts[i], ...pts[(i + 1) % pts.length], { over, cls });
    return this;
  }
  rect(x, y, w, h, o) { return this.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], { closed: true, ...o }); }
  // a curve or anything else, as path data, drawn as it is
  raw(d, cls = '') { return this.add(cls, d); }
  ellipse(cx, cy, rx, ry, cls = '') {
    return this.add(cls, sketchEllipse(cx, cy, rx, ry, this.seed++, { k: K, turns: 1.08, lump: 0.05 }));
  }
  // paper under a shape about to be drawn over something behind it
  paper(pts) { return this.add('p', `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}Z`); }
  paperEllipse(cx, cy, rx, ry) {
    return this.add('p', `M${r2(cx - rx)} ${r2(cy)}a${r2(rx)} ${r2(ry)} 0 1 0 ${r2(2 * rx)} 0a${r2(rx)} ${r2(ry)} 0 1 0 ${r2(-2 * rx)} 0Z`);
  }
  // a window, a dot of ink
  win(x, y, w = 1.4, h = 1.8) {
    const j = ((this.seed++ * 7919) % 13) / 13 * 0.16 - 0.08;
    return this.add('ink', `M${r2(x)} ${r2(y + j)}h${r2(w)}v${r2(h - j)}h${r2(-w)}Z`);
  }
  wins(x, y, cols, rows, dx, dy, w, h) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) this.win(x + c * dx, y + r * dy, w, h);
    return this;
  }
  // hatching across a convex outline, the strokes rising to the right as on
  // the map's roofs, `gap` apart
  hatch(pts, gap = 1.5) {
    const xs = pts.map((p) => p[0] + p[1]);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    for (let c = lo + gap * 0.6; c < hi - 0.2; c += gap) {
      const hits = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        const fa = ax + ay - c, fb = bx + by - c;
        if ((fa <= 0 && fb > 0) || (fa > 0 && fb <= 0)) {
          const t = fa / (fa - fb);
          hits.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
        }
      }
      if (hits.length < 2) continue;
      hits.sort((a, b) => a[0] - b[0]);
      const [a, b] = [hits[0], hits[hits.length - 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.8) continue;
      const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, s = 0.25;
      this.line(a[0] + ux * s, a[1] + uy * s, b[0] - ux * s, b[1] - uy * s, { over: 0.3, cls: 'h' });
    }
    return this;
  }
  ground(x0 = 1.2, x1 = 22.8) { return this.line(x0, G, x1, G, { over: 0.8 }); }

  // ----- the parts most drawings are made of -----

  // walls from the ground up to `top`, x0 to x1 (no line along the ground)
  walls(x0, x1, top) {
    this.line(x0, G, x0, top, { over: 0.6 });
    this.line(x1, G, x1, top, { over: 0.6 });
    return this;
  }
  // a pitched roof seen along its eaves, hipped by `hip` at either end
  roof(x0, x1, eaves, ridge, { hip = 0, over = 0.6, gap = 1.5 } = {}) {
    const pts = [[x0 - over, eaves], [x0 + hip, ridge], [x1 - hip, ridge], [x1 + over, eaves]];
    this.paper(pts).poly(pts, { closed: true }).hatch(pts, gap);
    return this;
  }
  // a gable end facing us: the roof's triangle
  gable(x0, x1, eaves, ridge, { over = 0.6, gap = 1.5 } = {}) {
    const pts = [[x0 - over, eaves], [(x0 + x1) / 2, ridge], [x1 + over, eaves]];
    this.paper(pts).poly(pts, { closed: true }).hatch(pts, gap);
    return this;
  }
  // a flat roof's edge, a little proud of the walls
  flat(x0, x1, top, over = 0.5) { return this.line(x0 - over, top, x1 + over, top, { over: 0.4 }); }
  // a chimney stack from `foot` up to `top`
  chimney(x, w, top, foot = G, { bands = 0 } = {}) {
    this.paper([[x, foot], [x, top], [x + w, top], [x + w, foot]]);
    this.line(x, foot, x, top, { over: 0.3 }).line(x + w, foot, x + w, top, { over: 0.3 }).line(x - 0.2, top, x + w + 0.2, top, { over: 0.2 });
    for (let i = 1; i <= bands; i++) this.thin(x, top + i * 1.4, x + w, top + i * 1.4);
    return this;
  }
  // a leafy tree: trunk and a round crown
  tree(x, h, r) {
    const cy = G - h + r;
    this.line(x, G, x, cy + r * 0.5, { over: 0.2 });
    this.paperEllipse(x, cy, r, r * 0.92).ellipse(x, cy, r, r * 0.92);
    const ring = Array.from({ length: 16 }, (_, i) => [x + Math.cos(i * Math.PI / 8) * r * 0.8, cy + Math.sin(i * Math.PI / 8) * r * 0.74]);
    return this.hatch(ring, 1.7);
  }
  // a spruce: a narrow triangle in two tiers on a short trunk
  spruce(x, h, w) {
    const top = G - h, foot = G - 1.4, mid = top + (foot - top) * 0.5;
    const pts = [[x, top], [x - w * 0.32, mid], [x - w * 0.16, mid], [x - w / 2, foot], [x + w / 2, foot], [x + w * 0.16, mid], [x + w * 0.32, mid]];
    this.paper(pts).poly(pts, { closed: true, over: 0.3 }).line(x, foot, x, G, { over: 0.2 });
    return this.hatch([[x, top + 1.2], [x + w * 0.36, foot - 0.4], [x - w * 0.36, foot - 0.4]], 1.6);
  }
  // a wheel: paper inside, a rim, a hub
  wheel(cx, cy, r) {
    return this.paperEllipse(cx, cy, r, r).ellipse(cx, cy, r, r).ellipse(cx, cy, r * 0.3, r * 0.3, 'h');
  }
  // a few blades of grass
  tuft(x) { return this.thin(x, G, x - 0.5, G - 1.3).thin(x + 0.5, G, x + 0.6, G - 1.6).thin(x + 1, G, x + 1.6, G - 1.1); }
  // a cross on a gable or a tower's tip
  cross(x, y, s = 1.6) { return this.line(x, y, x, y - s * 1.6, { over: 0.2 }).line(x - s * 0.5, y - s * 1.1, x + s * 0.5, y - s * 1.1, { over: 0.2 }); }
  // the red cross of a surgery, outlined
  redCross(cx, cy, s) {
    const a = s / 2, b = s / 6;
    this.paper([[cx - a, cy - a], [cx + a, cy - a], [cx + a, cy + a], [cx - a, cy + a]]);
    return this.poly([[cx - b, cy - a], [cx + b, cy - a], [cx + b, cy - b], [cx + a, cy - b], [cx + a, cy + b], [cx + b, cy + b], [cx + b, cy + a], [cx - b, cy + a], [cx - b, cy + b], [cx - a, cy + b], [cx - a, cy - b], [cx - b, cy - b]], { closed: true, over: 0.2 });
  }
}

// a curve as a run of dashes, every other step of `n` (a footpath)
function dashes(p, pts, n = 14) {
  const at = (t) => {
    const [a, b, c, d] = pts, u = 1 - t;
    return [0, 1].map((i) => u * u * u * a[i] + 3 * u * u * t * b[i] + 3 * u * t * t * c[i] + t * t * t * d[i]);
  };
  for (let i = 0; i < n; i += 2) p.line(...at(i / n), ...at((i + 0.9) / n), { over: 0.1 });
}

// ----- the sprites, by tool (a building's tool id without "build:") -----

const SPRITES = {
  // Doprava
  road: ['Silnice: a road going away, its centre line dashed', (p) => {
    p.line(2.5, G, 9.8, 4.5).line(21.5, G, 14.2, 4.5);
    for (const [a, b] of [[19.8, 17.2], [14.8, 12.8], [10.6, 9.2], [7.6, 6.6]]) p.line(12, a, 12, b, { over: 0.2 });
  }],
  lane: ['Úzká silnice: a narrow road going away', (p) => {
    p.line(6.5, G, 10.8, 4.5).line(17.5, G, 13.2, 4.5).tuft(2.6).tuft(19.6);
  }],
  path: ['Pěšina: a footpath winding off through the grass', (p) => {
    dashes(p, [[9, G], [16, 15], [6, 10], [13.5, 4.5]], 13);
    p.tuft(3).tuft(17.5).tuft(15.2 - 11).thin(19.5, 9.5, 19, 8.2).thin(20, 9.5, 20.4, 8);
  }],
  rail: ['Železnice: two rails going away over their sleepers', (p) => {
    for (const [y, w] of [[19.6, 7.4], [16, 6.2], [13.1, 5.2], [10.7, 4.3], [8.7, 3.6], [7, 3], [5.6, 2.5]]) p.line(12 - w, y, 12 + w, y, { over: 0.3 });
    p.line(7, G, 10.9, 4.5).line(17, G, 13.1, 4.5);
  }],
  station: ['Nádraží: the station house with its clock, the platform roof on posts beside it', (p) => {
    p.walls(2.5, 13.5, 11).roof(2.5, 13.5, 11, 6.5, { hip: 2.2 }).ellipse(8, 9.2, 0.9, 0.9, 'h');
    p.wins(4, 13.2, 3, 1, 3.4, 0, 1.4, 2.4).rect(7.3, 17, 1.6, 4, { over: 0.2, cls: 'h' });
    p.line(13.5, 11.8, 22.6, 12.6).line(13.5, 13, 22.6, 13.8, { over: 0.3 }).line(17, 13.3, 17, G, { over: 0.2 }).line(21.2, 13.7, 21.2, G, { over: 0.2 });
    p.ground();
  }],
  'bus-stop': ['Zastávka ČSAD: the concrete shelter, its bench, the stop sign on its pole', (p) => {
    p.line(2.6, 8.8, 15.6, 8.8, { over: 0.4 }).line(2.6, 10.2, 15.6, 10.2, { over: 0.3 }).line(2.6, 8.8, 2.6, 10.2, { over: 0 }).line(15.6, 8.8, 15.6, 10.2, { over: 0 });
    p.line(4, 10.2, 4, G, { over: 0.2 }).line(14.2, 10.2, 14.2, G, { over: 0.2 }).hatch([[4, 10.2], [14.2, 10.2], [14.2, 12], [4, 12]], 1.2);
    p.line(5.2, 16.6, 13, 16.6, { over: 0.3 }).thin(6, 16.6, 6, G).thin(12.2, 16.6, 12.2, G);
    p.line(19.5, G, 19.5, 8, { over: 0.2 }).rect(17.6, 3.6, 3.8, 4.4, { over: 0.3 }).thin(17.6, 5.8, 21.4, 5.8);
    p.ground();
  }],
  'bus-station': ['Autobusové nádraží ČSAD: a folded concrete roof on posts, a bus standing under it', (p) => {
    p.poly([[1.5, 7.8], [5, 5.6], [8.5, 7.8], [12, 5.6], [15.5, 7.8], [19, 5.6], [22.5, 7.8]], { over: 0.5 }).line(1.5, 7.8, 22.5, 7.8, { over: 0.3, cls: 'h' });
    p.line(4, 7.8, 4, G, { over: 0.1 }).line(20, 7.8, 20, G, { over: 0.1 });
    const bus = [[3, 19.6], [3, 13.4], [3.8, 12.2], [19.8, 12.2], [21, 13.6], [21, 19.6]];
    p.paper(bus).poly(bus, { closed: true, over: 0.3 }).wins(4.4, 13.4, 5, 1, 3, 0, 2, 2).thin(3, 16.6, 21, 16.6);
    p.wheel(7, 19.8, 1.3).wheel(17, 19.8, 1.3).ground();
  }],
  benzina: ['Benzina: the canopy on its one pillar, a pump with its hose, the kiosk', (p) => {
    p.line(1.8, 5.4, 15.6, 5.4, { over: 0.4 }).line(1.8, 7.4, 15.6, 7.4, { over: 0.4 }).line(1.8, 5.4, 1.8, 7.4, { over: 0 }).line(15.6, 5.4, 15.6, 7.4, { over: 0 });
    p.thin(4, 6.4, 9, 6.4).line(10.6, 7.4, 10.6, G, { over: 0.1 }).line(11.8, 7.4, 11.8, G, { over: 0.1 });
    p.rect(4, 13.4, 3.4, 7.6, { over: 0.3 }).win(4.8, 14.6, 1.8, 1.2).raw('M7.4 15.4C9.2 15.6 9 18.4 8.2 19.4', 'h');
    p.walls(15.2, 21.8, 11).flat(15.2, 21.8, 11, 0.8).win(16.6, 13, 3.6, 2.6).rect(19.6, 16.6, 1.5, 4.4, { over: 0.1, cls: 'h' });
    p.ground();
  }],

  // Bydlení
  house: ['Rodinný domek: the cube house, its pyramid roof, the chimney', (p) => {
    p.chimney(14.4, 1.6, 4, 7.5).walls(5, 19, 12).roof(5, 19, 12, 5.6, { hip: 6, over: 1 });
    p.win(6.8, 14, 2.6, 2.6).win(14.6, 14, 2.6, 2.6).rect(10.9, 15.2, 2.2, 5.8, { over: 0.2, cls: 'h' }).ground(2.5, 21.5);
  }],
  apartments: ['Činžovní dům: four storeys under a hipped roof, two chimneys', (p) => {
    p.chimney(7.4, 1.4, 2.2, 5).chimney(15.2, 1.4, 2.2, 5).walls(4, 20, 7.6).roof(4, 20, 7.6, 4.2, { hip: 2.6 });
    p.wins(5.8, 9.2, 4, 4, 3.6, 3, 1.5, 1.9).ground(2, 22);
  }],
  block: ['Panelák: a tall slab of eight storeys, wide panel windows, a flat roof', (p) => {
    p.walls(6, 18, 2.6).flat(6, 18, 2.6, 0.5).thin(6, 3.3, 18, 3.3);
    p.wins(7.1, 4.6, 3, 8, 3.7, 2, 2.4, 0.9).ground(3, 21);
  }],

  // Občanská vybavenost
  jednota: ['Jednota: the village shop, its sign on the roof, the shop window', (p) => {
    p.walls(3, 21, 11.6).line(2.2, 9.8, 21.8, 9.8, { over: 0.3 }).line(2.2, 11.6, 21.8, 11.6, { over: 0.3 }).line(2.2, 9.8, 2.2, 11.6, { over: 0 }).line(21.8, 9.8, 21.8, 11.6, { over: 0 });
    p.rect(8.4, 6.2, 7.2, 3.6, { over: 0.4 }).thin(9.8, 8, 14.2, 8);
    p.rect(4.6, 13.4, 8.4, 5, { over: 0.3 }).thin(8.8, 13.4, 8.8, 18.4).thin(5.6, 17.4, 7.4, 14.6);
    p.rect(15, 13.6, 2.6, 7.4, { over: 0.2 }).win(18.8, 13.6, 1.4, 4.8).ground();
  }],
  hospoda: ['Hospoda: a long low house, the tankard hanging over the door', (p) => {
    p.walls(2.6, 16.4, 12.2).roof(2.6, 16.4, 12.2, 6.6, { over: 0.8 });
    p.wins(4.2, 14.2, 2, 1, 3.2, 0, 1.6, 2.2).raw('M11.4 21V16.6Q12.6 15 13.8 16.6V21', '').win(14.9, 14.2, 1, 2.2);
    p.line(16.4, 12.8, 21.4, 12.8, { over: 0.2 }).thin(18, 12.8, 18, 13.8).thin(20.2, 12.8, 20.2, 13.8);
    p.rect(17.6, 14, 2.8, 3.8, { over: 0.2 }).raw('M20.4 14.8C21.8 14.8 21.8 17 20.4 17', '').raw('M17.6 14.4Q18.3 13.5 19 14.2Q19.7 13.4 20.4 14.3', 'h');
    p.ground();
  }],
  store: ['Obchodní dům: a wide box of three storeys, its front a screen of fins over the shop windows', (p) => {
    p.walls(2.2, 21.8, 5.4).flat(2.2, 21.8, 5.4, 0.4).rect(6.5, 2.4, 11, 3, { over: 0.3 });
    for (let x = 3.4; x < 21.6; x += 1.4) p.thin(x, 6.4, x, 15.4);
    p.line(1.6, 15.8, 22.4, 15.8, { over: 0.2 }).rect(4, 17, 6, 4, { over: 0.2, cls: 'h' }).rect(14, 17, 6, 4, { over: 0.2, cls: 'h' }).ground();
  }],
  office: ['Národní výbor: the council offices, the flag over the door', (p) => {
    p.walls(3.4, 20.6, 9.6).flat(3.4, 20.6, 9.6, 0.6).wins(5, 11.2, 5, 2, 3.2, 3.6, 1.6, 2);
    p.line(9.6, 18, 14.4, 18, { over: 0.2 }).rect(10.6, 18, 2.8, 3, { over: 0.1, cls: 'h' });
    p.line(12, 9.6, 12, 1.8, { over: 0.2 });
    const flag = [[12, 2], [17.4, 2.2], [17.2, 5.6], [12, 5.4]];
    p.poly(flag, { closed: true, over: 0.2 }).thin(12, 3.7, 17.3, 3.9).poly([[12, 2], [14.2, 3.7], [12, 5.4]], { cls: 'h', over: 0 });
    p.ground();
  }],
  'post-office': ['Pošta: the post office, the letter box on its post in front', (p) => {
    p.walls(2.4, 14.6, 10.6).roof(2.4, 14.6, 10.6, 6.2, { hip: 2 }).wins(4.2, 12.6, 3, 1, 3.4, 0, 1.6, 2.4).rect(7.6, 16.4, 2, 4.6, { over: 0.1, cls: 'h' });
    p.line(19, G, 19, 15.6, { over: 0.1 });
    const box = [[16.8, 15.6], [16.8, 11.4], [17.6, 10.2], [20.4, 10.2], [21.2, 11.4], [21.2, 15.6]];
    p.paper(box).poly(box, { closed: true, over: 0.2 }).line(17.8, 12.4, 20.2, 12.4, { over: 0 }).ground();
  }],
  hotel: ['Hotel: a tall block with balconies, its name on a frame on the roof, the restaurant beside', (p) => {
    p.walls(4.6, 15.6, 4.4).flat(4.6, 15.6, 4.4, 0.4).rect(6, 0.9, 8.2, 2.4, { over: 0.3 }).thin(7, 3.3, 7, 4.4).thin(13.2, 3.3, 13.2, 4.4);
    for (let y = 6.4; y < 16; y += 2.4) { p.wins(5.8, y - 1.3, 3, 1, 3.4, 0, 1.6, 1.1); p.thin(4.6, y, 15.6, y); }
    p.line(15.6, 13.6, 21.6, 13.6, { over: 0.4 }).line(21.6, 13.6, 21.6, G, { over: 0.2 }).win(16.6, 15.4, 4, 2.4);
    p.rect(8.6, 17.6, 3, 3.4, { over: 0.2, cls: 'h' }).ground();
  }],
  'fire-house': ['Požární stanice: the engine house with its wide door, the tower for drying hoses', (p) => {
    p.walls(2.4, 14, 11.4).gable(2.4, 14, 11.4, 6.2).rect(4.4, 13.4, 7.6, 7.6, { over: 0.3 });
    for (const y of [15.2, 17.1, 19]) p.thin(4.4, y, 12, y);
    p.walls(15, 19.6, 4.2).gable(15, 19.6, 4.2, 1, { over: 0.4 }).win(16.5, 5.6, 1.6, 2.2).win(16.5, 11, 1.6, 1.6).ground();
  }],
  police: ['Oddělení VB: a plain two-storey station, the patrol car with its lamp in front', (p) => {
    p.walls(2.4, 16, 8.4).roof(2.4, 16, 8.4, 5, { hip: 2 }).wins(4, 10.2, 4, 2, 3.2, 4, 1.4, 2);
    const car = [[11.2, 19.6], [11.4, 16.6], [13.4, 16.2], [14.8, 13.8], [19, 13.8], [20.6, 16.2], [22.2, 16.6], [22.2, 19.6]];
    p.paper(car).poly(car, { closed: true, over: 0.2 }).thin(15.2, 16.2, 20, 16.2).thin(17, 13.8, 17, 16.2);
    p.rect(16.2, 12.4, 1.6, 1.4, { over: 0, cls: 'ink' }).wheel(14.4, 19.8, 1.3).wheel(19.6, 19.8, 1.3).ground();
  }],
  'health-centre': ['Zdravotní středisko: a one-storey surgery, the cross on its wall', (p) => {
    p.walls(2.6, 21.4, 10.6).flat(2.6, 21.4, 10.6, 0.8).redCross(7, 14.4, 4.4);
    p.wins(11.4, 12.6, 3, 1, 3, 0, 1.8, 2.4).rect(12.6, 16.4, 2.8, 4.6, { over: 0.2, cls: 'h' }).ground();
  }],
  clinic: ['Poliklinika: three storeys of long windows, the cross over the entrance', (p) => {
    p.walls(2.4, 21.6, 5.6).flat(2.4, 21.6, 5.6, 0.6);
    for (const y of [7, 10.2, 13.4]) { p.rect(3.6, y, 16.8, 1.6, { over: 0.1, cls: 'h' }); for (let x = 5.6; x < 20; x += 2) p.thin(x, y, x, y + 1.6); }
    p.line(8, 17, 16, 17, { over: 0.3 }).rect(10.4, 17, 3.2, 4, { over: 0.1, cls: 'h' }).redCross(12, 2.9, 3.4);
    p.ground();
  }],
  hospital: ['Nemocnice: a tall ward block between two low wings, the cross on top', (p) => {
    p.walls(1.8, 22.2, 11.6).flat(1.8, 22.2, 11.6, 0.4).wins(2.8, 13.4, 2, 2, 2.2, 3.4, 1.2, 1.6).wins(18.8, 13.4, 2, 2, 2.2, 3.4, 1.2, 1.6);
    p.paper([[7, G], [7, 4.8], [17, 4.8], [17, G]]).walls(7, 17, 4.8).flat(7, 17, 4.8, 0.4).wins(8.4, 6.4, 4, 5, 2.2, 2.6, 1.2, 1.4);
    p.rect(10.6, 18.6, 2.8, 2.4, { over: 0.1, cls: 'h' }).redCross(12, 2.3, 3).ground();
  }],
  school: ['Škola: a long two-storey school, tall windows, the bell turret on the roof', (p) => {
    p.walls(10.6, 13.4, 4.2).gable(10.6, 13.4, 4.2, 1.6, { over: 0.3 }).thin(11.4, 5.4, 12.6, 5.4);
    p.walls(1.8, 22.2, 10).roof(1.8, 22.2, 10, 7, { hip: 2.4, gap: 1.7 });
    p.wins(3.2, 11.4, 6, 2, 3.4, 4.6, 1.4, 3).ground(0.8, 23.2);
  }],
  'culture-house': ['Kulturní dům: the glazed foyer under its canopy, the stage house rising behind', (p) => {
    p.walls(11, 20.6, 3.4).flat(11, 20.6, 3.4, 0.4).hatch([[11, 3.4], [20.6, 3.4], [20.6, 7.8], [11, 7.8]], 2.2);
    p.paper([[2, G], [2, 10.4], [16, 10.4], [16, G]]).walls(2, 16, 10.4).flat(2, 16, 10.4, 0.4);
    for (let x = 3.6; x < 15; x += 1.8) p.thin(x, 11.4, x, 16.2);
    p.line(1, 16.6, 17.6, 16.6, { over: 0.4 }).rect(6.6, 17.6, 4.8, 3.4, { over: 0.2, cls: 'h' }).walls(16, 20.6, 10.4).ground();
  }],
  pool: ['Koupaliště: the diving tower over the water', (p) => {
    p.line(4, G, 5, 6, { over: 0.2 }).line(9.6, G, 8.6, 6, { over: 0.2 }).thin(4.5, 13.6, 9.1, 13.6).thin(4.4, 13.6, 9, 6.2).thin(4.8, 20, 9.4, 13.8);
    p.line(4, 6, 13.4, 6, { over: 0.4 }).line(8.4, 11.4, 15.6, 11.4, { over: 0.4 }).thin(13.2, 6, 13.2, 6.9);
    p.line(4.2, 6, 4.2, 4.4, { over: 0 }).line(8.6, 6, 8.6, 4.4, { over: 0 }).thin(4.2, 4.6, 8.6, 4.6);
    p.raw('M1.4 17.6Q3.6 16.6 5.8 17.6T10.2 17.6T14.6 17.6T19 17.6T23 17.4', '').raw('M3 20.2Q5.2 19.2 7.4 20.2T11.8 20.2T16.2 20.2T20.8 20.2', 'h');
  }],
  cemetery: ['Hřbitov: crosses over the wall, its gate, a thuja', (p) => {
    p.spruce(19.6, 17, 4.4).cross(4.4, 15, 3).cross(8.4, 15, 2.4).cross(15.6, 15, 2.6);
    p.paper([[1.2, G], [1.2, 15], [22.8, 15], [22.8, G]]).line(0.8, 15, 9.6, 15, { over: 0.2 }).line(14.4, 15, 23.2, 15, { over: 0.2 }).thin(1.2, 16.2, 9.6, 16.2).thin(14.4, 16.2, 22.8, 16.2);
    p.walls(9.6, 11, 12.6).walls(13, 14.4, 12.6).thin(9.2, 12.6, 11.4, 12.6).thin(12.6, 12.6, 14.8, 12.6);
    for (const x of [11.6, 12.4]) p.thin(x, 14, x, G);
    p.raw('M11 14Q12 12.8 13 14', 'h');
    p.ground();
  }],

  // Výroba
  autoopravna: ['Autoopravna: the workshop door wide open, a car out in front', (p) => {
    p.walls(1.8, 15, 10).flat(1.8, 15, 10, 0.6).thin(1.8, 11, 15, 11).rect(3.6, 12.6, 8, 8.4, { over: 0.2 }).win(4.6, 13.6, 6, 1.4);
    const car = [[10.4, 19.6], [10.6, 16.6], [13, 16.2], [14.4, 13.8], [18.6, 13.8], [20.2, 16.2], [22.2, 16.6], [22.2, 19.6]];
    p.paper(car).poly(car, { closed: true, over: 0.2 }).thin(14.8, 16.2, 19.6, 16.2).thin(16.6, 13.8, 16.6, 16.2);
    p.wheel(13.8, 19.8, 1.3).wheel(19.2, 19.8, 1.3).ground();
  }],
  kovarna: ['Kovárna: the smithy, its chimney, the door dark with the forge, the anvil outside', (p) => {
    p.chimney(9.2, 1.6, 3.4, 7.6).walls(2, 13.4, 11.6).roof(2, 13.4, 11.6, 7);
    p.raw('M4.6 21V16Q6.6 13.8 8.6 16V21Z', 'ink').win(10.4, 13.4, 1.6, 2);
    const anvil = [[13.2, 15], [21.2, 15], [21.2, 16.4], [19.6, 16.9], [19.3, 18.7], [20.7, 19.4], [20.7, G], [15.6, G], [15.6, 19.4], [17, 18.7], [16.7, 16.9], [15.8, 16.6]];
    p.paper(anvil).poly(anvil, { closed: true, over: 0.2 }).ground();
  }],
  truhlarna: ['Truhlárna: the joiner\'s shop, a stack of boards drying beside it', (p) => {
    p.walls(1.8, 12.6, 11).gable(1.8, 12.6, 11, 5.6).rect(4.6, 14.4, 4.2, 6.6, { over: 0.2 }).thin(6.7, 14.4, 6.7, G);
    for (let y = 14; y < 20.4; y += 1.3) p.line(13.6, y, 22.4, y, { over: 0.3 });
    p.thin(15, 14, 15, G).thin(21, 14, 21, G).ground();
  }],
  'komunalni-podnik': ['Komunální podnik: the depot\'s row of garage doors, a tipper lorry by them', (p) => {
    p.walls(1.6, 22.4, 9.2).flat(1.6, 22.4, 9.2, 0.5).thin(1.6, 10.2, 22.4, 10.2);
    for (const x of [3, 9.4, 15.8]) { p.rect(x, 12, 5.2, 9, { over: 0.1 }); p.thin(x, 14.4, x + 5.2, 14.4); }
    const lorry = [[11.6, 19.4], [11.6, 14], [14.4, 14], [15.2, 16], [22.6, 16], [22.6, 19.4]];
    p.paper(lorry).poly(lorry, { closed: true, over: 0.2 }).thin(15.2, 16, 15.2, 19.4).win(12.4, 14.8, 1.6, 1.2);
    p.wheel(14, 19.8, 1.2).wheel(20.2, 19.8, 1.2).ground();
  }],
  pekarna: ['Pekárna: the bakery, its oven chimney, a pretzel hanging over the door', (p) => {
    p.chimney(10.8, 1.8, 2.2, 6).walls(2.2, 15.4, 11.4).gable(2.2, 15.4, 11.4, 4.8, { gap: 1.6 });
    p.win(4, 13.4, 2, 2.4).rect(8.2, 15, 2.6, 6, { over: 0.2 }).win(12.4, 13.4, 1.6, 2.4);
    p.line(15.4, 11, 21, 11, { over: 0.2 }).thin(18.4, 11, 18.4, 12.2);
    p.raw('M18.4 17.6C14.6 15.8 15.6 11.4 17.6 12.6L19.6 15.6M18.4 17.6C22.2 15.8 21.2 11.4 19.2 12.6L17.2 15.6', '');
    p.ground();
  }],
  pivovar: ['Pivovar: the brewhouse, the malt kiln with its cowled roof, the tall chimney', (p) => {
    p.walls(2, 12.6, 9.4).roof(2, 12.6, 9.4, 5.6, { hip: 1.2 }).wins(3.6, 11.2, 3, 2, 3.2, 4.6, 1.4, 2.4);
    p.walls(12.6, 17.6, 6.4).gable(12.6, 17.6, 6.4, 2.6, { over: 0.5 }).rect(14.3, 1.2, 1.6, 1.6, { over: 0.1, cls: 'h' }).win(14.4, 9, 1.4, 2);
    p.chimney(19.2, 2, 1.2, G, { bands: 1 }).ground();
  }],
  vytopna: ['Výtopna: the boiler house, its tall tapering chimney, a heap of coal', (p) => {
    p.raw('M15.6 21L16.6 1.4M19.4 21L18.4 1.4M16.4 1.4H18.6', '').thin(16.2, 4, 18.8, 4);
    p.walls(6.4, 15.6, 9.6).flat(6.4, 15.6, 9.6, 0.4).rect(8.6, 7.6, 5, 2, { over: 0.2 }).wins(7.8, 11.4, 3, 1, 2.8, 0, 1.6, 3);
    p.paper([[0.8, G], [3, 17], [6, 17], [8.2, G]]).raw('M0.8 21Q2 16.6 4.4 16.6T8.4 21', '').thin(2.6, 19.6, 3.4, 19.4).thin(4.8, 18.4, 5.6, 18.6).ground();
  }],
  vodarna: ['Vodárna: the water tower, its tank on the shaft under a pointed roof', (p) => {
    p.walls(10.4, 13.6, 11).win(11.3, 13.6, 1.4, 2).win(11.3, 17.4, 1.4, 2);
    p.raw('M8.4 11C6.8 9.2 6.4 7.4 6.8 5.2M15.6 11C17.2 9.2 17.6 7.4 17.2 5.2M8.2 11H15.8', '').thin(6.8, 7.6, 17.2, 7.6);
    p.gable(6.8, 17.2, 5.2, 1.4, { over: 0.4 }).ground(5, 19);
  }],
  rozvodna: ['Rozvodna: a lattice pylon with its insulators, the transformer at its foot', (p) => {
    p.line(7.8, G, 11.2, 3.4, { over: 0.2 }).line(16.2, G, 12.8, 3.4, { over: 0.2 }).thin(11.2, 3.4, 12.8, 3.4);
    p.line(4.4, 6.4, 19.6, 6.4, { over: 0.2 }).line(5.8, 10.6, 18.2, 10.6, { over: 0.2 });
    for (const [x, y] of [[5, 6.4], [19, 6.4], [6.4, 10.6], [17.6, 10.6]]) p.line(x, y, x, y + 1.6, { over: 0 });
    p.thin(10.2, 8.6, 13.6, 13.6).thin(13.6, 8.6, 9.8, 13.6).thin(9.4, 13.6, 15, G).thin(14.6, 13.6, 9, G);
    p.paper([[16.6, G], [16.6, 15.6], [22.4, 15.6], [22.4, G]]).rect(16.6, 15.6, 5.8, 5.4, { over: 0.2 });
    for (let x = 17.8; x < 22; x += 1.2) p.thin(x, 16.4, x, 20.2);
    p.ground();
  }],
  pila: ['Pila: the saw shed, a log on the bench, logs stacked end on', (p) => {
    p.line(1.4, 7, 15.8, 8.6, { over: 0.4 }).line(1.4, 8.2, 15.8, 9.8, { over: 0 }).line(2.6, 8.4, 2.6, G, { over: 0.1 }).line(14.6, 9.6, 14.6, G, { over: 0.1 });
    p.rect(3.6, 14.4, 9.8, 2.6, { over: 0.2 }).ellipse(3.6, 15.7, 0.7, 1.3, 'h').thin(5, 17, 5, G).thin(12, 17, 12, G);
    for (const [x, y] of [[17.2, 19.6], [20.4, 19.6], [18.8, 16.8]]) p.paperEllipse(x, y, 1.5, 1.4).ellipse(x, y, 1.5, 1.4).ellipse(x, y, 0.4, 0.4, 'h');
    p.ground();
  }],
  sklarna: ['Sklárna: the glassworks hall with its roof lantern, the glass cone beside it', (p) => {
    p.walls(1.8, 13.6, 10.6).roof(1.8, 13.6, 10.6, 7.4).rect(5.2, 5.6, 5, 1.8, { over: 0.2 }).wins(3.4, 12.6, 3, 1, 3.6, 0, 1.6, 3.4);
    const cone = [[14.4, G], [16.8, 3.6], [19.6, 3.6], [22, G]];
    p.paper(cone).poly(cone, { over: 0.3 }).thin(16.8, 3.6, 19.6, 3.6).raw('M16.6 21V18Q18.2 16 19.8 18V21', 'h').ground();
  }],
  textilka: ['Textilka: the weaving shed\'s sawtooth roof, the mill chimney', (p) => {
    p.chimney(18.8, 2.2, 1.6, G, { bands: 1 });
    p.walls(1.8, 18, 12.4);
    for (let x = 1.8; x < 17; x += 4.05) {
      p.line(x, 12.4, x, 8, { over: 0.2 }).line(x, 8, x + 4.05, 12.4, { over: 0.3 });
      p.hatch([[x, 8], [x + 4.05, 12.4], [x, 12.4]], 1.3);
    }
    p.line(1.4, 12.4, 18.4, 12.4, { over: 0.2 }).wins(3, 14.4, 5, 1, 3.2, 0, 1.6, 2.4).ground();
  }],
  strojirna: ['Strojírna: the tall machine hall, a gantry crane in the yard', (p) => {
    p.walls(1.8, 14.6, 9).gable(1.8, 14.6, 9, 3.8, { gap: 1.7 });
    for (let x = 3.6; x < 14; x += 2.6) p.rect(x, 10.6, 1.2, 7, { over: 0.1, cls: 'h' });
    p.line(16.4, G, 16.4, 8.6, { over: 0.2 }).line(21.8, G, 21.8, 8.6, { over: 0.2 }).line(14.8, 8.6, 22.8, 8.6, { over: 0.3 }).line(14.8, 10, 22.8, 10, { over: 0.3 });
    p.rect(18, 10, 2, 1.2, { over: 0, cls: 'h' }).thin(19, 11.2, 19, 14.2).raw('M19 14.2Q19 15.4 18 15', '').ground();
  }],
  panelarna: ['Panelárna: the gantry crane lifting a wall panel, panels stacked below', (p) => {
    p.line(2.6, G, 2.6, 4.2, { over: 0.2 }).line(21.4, G, 21.4, 4.2, { over: 0.2 }).line(1.4, 4.2, 22.6, 4.2, { over: 0.3 }).line(1.4, 5.8, 22.6, 5.8, { over: 0.3 });
    p.rect(10.4, 5.8, 3.2, 1.6, { over: 0 }).thin(12, 7.4, 12, 10.2).thin(9.2, 10.4, 12, 9.4).thin(14.8, 10.4, 12, 9.4);
    p.rect(8, 10.4, 8, 4.8, { over: 0.2 }).win(10.6, 11.6, 2.4, 1.8);
    p.rect(4.2, 17.6, 5.6, 1.6, { over: 0.1 }).rect(4.2, 19.2, 5.6, 1.8, { over: 0.1 }).rect(14.4, 18.2, 5.6, 2.8, { over: 0.1 }).ground();
  }],
  vapenka: ['Vápenka: two tapering shaft kilns, the conveyor bridge climbing to their tops', (p) => {
    const kiln = (x0, x1, top) => p.paper([[x0, G], [x0 + 1.2, top], [x1 - 1.2, top], [x1, G]]).poly([[x0, G], [x0 + 1.2, top], [x1 - 1.2, top], [x1, G]], { over: 0.3 }).rect(x0 + 1.6, top - 2, x1 - x0 - 3.2, 2, { over: 0.1 });
    kiln(2, 9.6, 5.4); kiln(8.6, 16.2, 4.2);
    p.line(23, 15.4, 14.6, 3.6, { over: 0.2 }).line(23, 17.2, 15.2, 6.2, { over: 0.2 }).thin(20.6, 13.8, 20.6, G).thin(18, 10.4, 18, G);
    p.win(4.8, 10, 1.8, 2.2).win(11.4, 9, 1.8, 2.2).ground();
  }],
  elektrarna: ['Elektrárna: two cooling towers with their steam, the power station\'s chimney', (p) => {
    p.chimney(19.4, 1.6, 1, G, { bands: 2 });
    const tower = (x0, x1, top) => {
      const w = x1 - x0;
      p.paper([[x0, G], [x0 + w * 0.22, top], [x1 - w * 0.22, top], [x1, G]]);
      p.raw(`M${x0} 21C${x0 + w * 0.22} 16 ${x0 + w * 0.26} 12 ${x0 + w * 0.2} ${top}M${x1} 21C${x1 - w * 0.22} 16 ${x1 - w * 0.26} 12 ${x1 - w * 0.2} ${top}`, '');
      p.line(x0 + w * 0.2, top, x1 - w * 0.2, top, { over: 0.2 });
      p.raw(`M${x0 + w * 0.22} ${top - 0.4}Q${x0 + w * 0.15} ${top - 3} ${x0 + w * 0.4} ${top - 3.2}Q${x0 + w * 0.6} ${top - 5.4} ${x1 - w * 0.25} ${top - 3.4}Q${x1 - w * 0.05} ${top - 2.8} ${x1 - w * 0.22} ${top - 0.4}`, 'h');
    };
    tower(9, 18.4, 9.4); tower(1.4, 11.2, 7.6);
    p.ground();
  }],
  pit: ['Šachta: a small wooden headframe and its wheel, the winding shed, a little heap', (p) => {
    p.line(3, G, 7.4, 5.8, { over: 0.2 }).line(11.8, G, 7.6, 5.8, { over: 0.2 }).thin(4.4, 15.6, 10.4, 15.6).thin(5.2, 11, 9.4, 11).thin(4.4, 15.6, 9.4, 11).line(7.6, 6.2, 13.6, 14.6, { over: 0.2 });
    p.wheel(7.5, 4.4, 2);
    p.walls(12.6, 19.4, 14.4).gable(12.6, 19.4, 14.4, 10.6, { over: 0.5 }).rect(14.8, 16.6, 2.2, 4.4, { over: 0.1, cls: 'h' });
    p.raw('M19.4 21Q21 17.6 23 21', '').ground();
  }],
  colliery: ['Uhelný důl: the steel headframe with its two wheels, the spoil heap behind', (p) => {
    const heap = [[11.6, G], [17.4, 8.6], [18.6, 8.6], [23.4, G]];
    p.paper(heap).poly(heap, { over: 0.3 }).hatch(heap, 2.2);
    p.line(7, G, 8, 5.4, { over: 0.2 }).line(11.4, G, 10.6, 5.4, { over: 0.2 });
    for (const [a, b] of [[7.2, 17.6], [7.4, 13.8], [7.7, 10]]) p.thin(a, b, 18.6 - a, b - 3.6), p.thin(a, b - 3.6, 18.4 - a, b);
    p.line(10.8, 6.4, 16.4, G, { over: 0.2 }).wheel(8, 4, 1.7).wheel(11, 4, 1.7);
    p.paper([[1.2, G], [1.2, 14.4], [6.4, 14.4], [6.4, G]]).walls(1.2, 6.4, 14.4).flat(1.2, 6.4, 14.4).win(2.8, 16, 2, 2).ground();
  }],
  'deep-mine': ['Hlubinný důl: the concrete winding tower, its wheel house on top, the plant beside', (p) => {
    p.walls(8.6, 14.2, 5.4).rect(7.6, 1.6, 7.6, 3.8, { over: 0.3 }).wins(8.8, 2.6, 3, 1, 2.1, 0, 1.2, 1.4);
    for (let y = 7.4; y < 18; y += 3) p.win(10.6, y, 1.6, 1.6);
    p.walls(14.2, 22.4, 11.4).roof(14.2, 22.4, 11.4, 8.6, { over: 0.4 }).wins(15.6, 13.4, 3, 1, 2.4, 0, 1.4, 2.4);
    p.walls(2, 8.6, 14).flat(2, 8.6, 14, 0.4).win(3.6, 15.6, 3.2, 2).ground();
  }],

  // Zemědělství
  smallholding: ['Hospodářství: a cottage, its barn with the wide door, a haystack', (p) => {
    p.walls(2, 9.8, 13).gable(2, 9.8, 13, 7.4).win(3.6, 15, 1.6, 2).win(6.6, 15, 1.6, 2);
    p.walls(9.8, 17.4, 13.8).roof(9.8, 17.4, 13.8, 9.8, { over: 0.4 }).rect(11.4, 15.4, 4.4, 5.6, { over: 0.1 }).thin(11.4, 15.4, 15.8, G);
    p.paper([[17.6, G], [18, 15], [22.4, 15], [22.8, G]]).raw('M17.6 21Q17.2 14.4 20.2 14.2Q23.2 14.4 22.8 21', '').thin(18.8, 17.6, 21.6, 17.2).ground();
  }],
  farmstead: ['Statek: the farmhouse gable, the gateway in the yard wall, the barn roof behind', (p) => {
    p.roof(11, 22.4, 10.6, 5.8, { over: 0.3, gap: 1.8 });
    p.paper([[10, G], [10, 10.6], [22.4, 10.6], [22.4, G]]).line(10, 10.6, 22.4, 10.6, { over: 0.2 }).line(22.4, 10.6, 22.4, G, { over: 0.2 });
    p.raw('M12.6 21V15.4Q16.4 10.6 20.2 15.4V21', '').thin(16.4, 12.4, 16.4, G);
    p.walls(1.6, 10, 11.4).gable(1.6, 10, 11.4, 4.2).win(3.4, 13.8, 1.6, 2.2).win(6.8, 13.8, 1.6, 2.2).win(5.3, 7.8, 0.8, 1.4).ground();
  }],
  jzd: ['JZD: the long cowshed with its roof vents, the tower silo', (p) => {
    p.walls(1.8, 16, 13.4).roof(1.8, 16, 13.4, 9.6, { over: 0.4 });
    for (const x of [5.4, 11]) p.rect(x, 8, 1.8, 1.6, { over: 0.1 }).gable(x, x + 1.8, 8, 6.8, { over: 0.3, gap: 9 });
    p.wins(3.2, 15.2, 5, 1, 2.6, 0, 1.4, 1.4);
    p.walls(16.6, 21.8, 5.2).raw('M16.6 5.2Q19.2 1.2 21.8 5.2', '').thin(16.6, 5.4, 21.8, 5.4).thin(18.4, 6.4, 18.4, G).thin(19.6, 6.4, 19.6, G);
    for (let y = 7.6; y < 20; y += 1.6) p.thin(18.4, y, 19.6, y);
    p.ground();
  }],
  'state-farm': ['Státní statek: the vaulted machine hall, two tower silos', (p) => {
    p.walls(13.4, 17.4, 4.2).raw('M13.4 4.2Q15.4 1.2 17.4 4.2', '').walls(18, 22, 4.8).raw('M18 4.8Q20 1.8 22 4.8', '');
    p.paper([[1.4, G], [1.4, 12.2], [14.6, 12.2], [14.6, G]]).walls(1.4, 14.6, 12.2).raw('M1 12.2Q8 4.8 15 12.2', '').raw('M3.2 10.6Q8 6.4 12.8 10.6', 'h');
    p.rect(5, 14.6, 6, 6.4, { over: 0.2 }).thin(8, 14.6, 8, G).ground();
  }],
  mlekarna: ['Mlékárna: the dairy and its loading ramp, milk churns waiting', (p) => {
    p.walls(1.8, 15, 9).flat(1.8, 15, 9, 0.6).wins(3.4, 10.8, 4, 1, 3, 0, 1.8, 2.2).line(1.2, 16.4, 15.6, 16.4, { over: 0.3 }).rect(7, 13.2, 3, 3.2, { over: 0.1, cls: 'h' });
    const churn = (x) => {
      const pts = [[x, G], [x, 16.4], [x + 0.8, 15.6], [x + 0.8, 14.2], [x + 2.6, 14.2], [x + 2.6, 15.6], [x + 3.4, 16.4], [x + 3.4, G]];
      p.paper(pts).poly(pts, { over: 0.1 }).thin(x + 0.6, 13.8, x + 2.8, 13.8).thin(x, 18.4, x + 3.4, 18.4);
    };
    churn(15.6); churn(19.4); p.ground();
  }],
  zzn: ['ZZN: the grain elevator\'s tall tower, the row of concrete silos', (p) => {
    p.walls(3.8, 10.4, 3.4).rect(5, 1, 4.2, 2.4, { over: 0.2 }).win(6.4, 5.4, 1.4, 1.8).win(6.4, 9.6, 1.4, 1.8);
    for (let x = 10.4; x < 21; x += 3.6) p.raw(`M${x} 21V8Q${x + 1.8} 5.8 ${x + 3.6} 8V21`, '');
    p.line(10, 8.2, 22.4, 8.2, { over: 0.2, cls: 'h' }).rect(5.6, 16.4, 3, 4.6, { over: 0.1, cls: 'h' }).ground();
  }],
  sts: ['STS: a tractor out in front of the machine station\'s shed', (p) => {
    p.walls(1.4, 22.6, 9.6).roof(1.4, 22.6, 9.6, 6.4, { over: 0.3, gap: 1.8 }).rect(3, 11.6, 5.4, 9.4, { over: 0.1, cls: 'h' });
    const body = [[8.6, 18.6], [8.8, 15.4], [14.4, 15], [14.4, 10.6], [19.2, 10.6], [19.4, 15]];
    p.paper([...body, [19.4, 18.6]]).poly(body, { over: 0.2 }).line(11, 15.2, 11, 12.4, { over: 0.1 });
    p.wheel(17.6, 17.6, 3.4).wheel(10.6, 19.4, 1.6).ground();
  }],
  cukrovar: ['Cukrovar: the big sugar works with its rows of tall windows, two chimneys', (p) => {
    p.chimney(17, 1.6, 1.4, G, { bands: 1 }).chimney(20.4, 1.6, 3.2, G, { bands: 1 });
    p.walls(1.6, 16.6, 8.4).roof(1.6, 16.6, 8.4, 5, { hip: 1.4 }).wins(3, 10, 5, 2, 2.9, 5, 1.4, 3.2).ground();
  }],
  fence: ['Ohrada: a pasture fence, posts and two rails', (p) => {
    for (const x of [3, 9, 15, 21]) p.line(x, G, x, 10.4, { over: 0.4 });
    p.line(1.6, 13, 22.4, 12.6, { over: 0.4 }).line(1.6, 17, 22.4, 16.8, { over: 0.4 }).tuft(5.6).tuft(17.4);
  }],

  // Prostranství
  green: ['Zeleň: a tree, a bush, grass', (p) => {
    p.tree(10, 17, 6).paperEllipse(18.8, 18.8, 3, 2.3).ellipse(18.8, 18.8, 3, 2.3).tuft(3).ground(1.6, 22.4);
  }],
  playground: ['Dětské hřiště: the swing, the rocket climbing frame', (p) => {
    p.line(1.6, G, 3, 8, { over: 0.2 }).line(4.6, G, 3.2, 8, { over: 0.2 }).line(10.6, G, 10.2, 8, { over: 0.2 }).line(2.6, 8, 11, 8, { over: 0.3 });
    p.thin(5.6, 8, 5.8, 15.6).thin(8.2, 8, 8, 15.6).line(5.2, 15.6, 8.6, 15.6, { over: 0.1 });
    const rocket = [[15, 17.4], [15, 7.6], [17.4, 2.6], [19.8, 7.6], [19.8, 17.4]];
    p.poly(rocket, { over: 0.2 }).line(15, 14.4, 12.8, G, { over: 0.2 }).line(19.8, 14.4, 22, G, { over: 0.2 }).thin(17.4, 17.4, 17.4, G);
    p.thin(15, 9.4, 19.8, 9.4).thin(15, 12.6, 19.8, 12.6).thin(15, 15.8, 19.8, 15.8).ellipse(17.4, 7.6, 0.8, 0.8, 'h').ground();
  }],
  pitch: ['Hřiště: the goal and its net, a ball', (p) => {
    p.line(3, G, 3, 7.4, { over: 0.2 }).line(21, G, 21, 7.4, { over: 0.2 }).line(3, 7.4, 21, 7.4, { over: 0.4 });
    for (let x = 5; x < 20; x += 2) p.thin(x, 7.4, x, 18.4);
    for (let y = 9.6; y < 18; y += 2.2) p.thin(3, y, 21, y);
    p.wheel(15.8, 19.4, 1.6).ground();
  }],
  'garden-park': ['Sady: two fruit trees, a bench between them', (p) => {
    p.tree(5.4, 13.6, 3.8).tree(18.6, 14.6, 4);
    p.line(8.6, 17.6, 15.4, 17.6, { over: 0.2 }).line(8.8, 15.2, 15.2, 15.2, { over: 0.2 }).thin(9.6, 15.2, 9.6, G).thin(14.4, 15.2, 14.4, G).ground();
  }],
  'forest-park': ['Lesopark: spruces of three heights', (p) => {
    p.spruce(18.4, 14, 6).spruce(5.6, 16, 6.6).spruce(12, 19.4, 7.4).tuft(20.6).ground();
  }],
  'pond-park': ['Park u rybníka: the pond with its ripples, a willow, reeds', (p) => {
    p.ellipse(13, 18.4, 9.2, 2.3).thin(9, 18.2, 12, 18.2).thin(14.4, 19.2, 17, 19.2);
    p.line(5.6, 16.8, 5.8, 8, { over: 0.2 }).raw('M1.6 13.4C1 6.8 3.4 3.6 6.2 3.6S11.2 6.6 10.6 13', '');
    p.raw('M3 6.4C2.4 9 2.6 11.6 3 14M4.6 4.6C4 8 4.2 11 4.4 14.4M7.6 4.6C8.2 8 8 11 7.6 14.4M9.4 6C10 8.6 9.8 11.4 9.4 13.6', 'h');
    for (const [x, h] of [[20.4, 6.2], [21.6, 7.2], [22.6, 5.4]]) p.thin(x, 17.2, x, 17.2 - h).rect(x - 0.35, 17.2 - h + 0.2, 0.7, 1.6, { over: 0, cls: 'ink' });
  }],
  'summer-cinema': ['Letní kino: the big screen on its frame, rows of benches before it', (p) => {
    p.rect(2.6, 2.6, 18.8, 9.6, { over: 0.5 }).line(4.6, 12.2, 4.6, G, { over: 0.1 }).line(19.4, 12.2, 19.4, G, { over: 0.1 });
    for (const [y, x0, x1] of [[16.6, 3.2, 20.8], [19.4, 1.8, 22.2]]) {
      p.paper([[x0, y - 0.2], [x1, y - 0.2], [x1, y + 1.2], [x0, y + 1.2]]).line(x0, y, x1, y, { over: 0.2 });
      for (let x = x0 + 1; x < x1; x += 3.4) p.thin(x, y, x, y + 1.6);
    }
    p.ground();
  }],
  plaza: ['Plácek: a lime tree, a bench under it, a street lamp', (p) => {
    p.tree(8, 18.6, 6.2);
    p.line(5.4, 17.4, 14, 17.4, { over: 0.2 }).thin(6.4, 17.4, 6.4, G).thin(13, 17.4, 13, G).line(5.6, 15.2, 13.8, 15.2, { over: 0.2 });
    p.line(19.2, G, 19.2, 6, { over: 0.2 }).raw('M19.2 6.4Q19.2 4.2 21 4.4', '').rect(20.2, 4.4, 1.8, 2, { over: 0.1 }).ground();
  }],
  'fountain-square': ['Náměstí s kašnou: the fountain, its basin, water falling from the bowl', (p) => {
    p.line(11.2, 16.6, 11.2, 8.8, { over: 0.1 }).line(12.8, 16.6, 12.8, 8.8, { over: 0.1 }).raw('M8 8.4Q12 11.2 16 8.4', '').line(8, 8.4, 16, 8.4, { over: 0.2 }).line(12, 8.4, 12, 6.2, { over: 0.1 });
    p.raw('M8 8.6Q5.4 9.4 5.4 15.6M16 8.6Q18.6 9.4 18.6 15.6M12 6.2Q9.2 4.6 8.2 8.2M12 6.2Q14.8 4.6 15.8 8.2', 'h');
    p.paper([[2.6, 16.6], [21.4, 16.6], [21.4, 20.6], [2.6, 20.6]]).raw('M2.6 16.6V20.4Q12 21.8 21.4 20.4V16.6', '').ellipse(12, 16.6, 9.4, 1.5).ground(0.8, 23.2);
  }],
  'monument-square': ['Náměstí s pomníkem: a figure on its plinth, a tree either side', (p) => {
    p.tree(3.6, 11.6, 2.8).tree(20.4, 11.6, 2.8);
    p.rect(8, 14.6, 8, 6.4, { over: 0.3 }).line(7.2, 14.6, 16.8, 14.6, { over: 0.2 }).thin(8, 15.8, 16, 15.8);
    p.ellipse(12, 4, 1.1, 1.2).raw('M10.6 14.4L10.8 6.6Q12 5.6 13.2 6.6L13.4 14.4M12 10.4V14.4M13.2 7L15.2 4.2', '');
  }],
  'market-square': ['Tržiště: two market stalls under striped awnings, goods on the counters', (p) => {
    const stall = (x0, x1) => {
      const aw = [[x0 + 0.8, 6.6], [x1 - 0.8, 6.6], [x1 + 0.6, 10], [x0 - 0.6, 10]];
      p.paper(aw).poly(aw, { closed: true, over: 0.2 });
      for (let x = x0 + 1.4; x < x1 - 0.2; x += 1.4) p.thin(x + 0.4 * (x - (x0 + x1) / 2) / ((x1 - x0) / 2) * -1, 6.8, x, 9.8);
      p.line(x0, 10, x0, G, { over: 0.1 }).line(x1, 10, x1, G, { over: 0.1 }).line(x0 - 0.4, 15.4, x1 + 0.4, 15.4, { over: 0.2 }).thin(x0, 17, x1, 17);
      for (let x = x0 + 1.4; x < x1 - 0.6; x += 1.8) p.ellipse(x, 14.6, 0.7, 0.7, 'h');
    };
    stall(2, 10.6); stall(13.4, 22); p.ground();
  }],
  precinct: ['Pěší zóna: the concrete flower bowl, a lamp with two globes, the paving', (p) => {
    p.raw('M3.2 14.8C3 12.4 5.2 11 6.4 12.4C7.2 10.4 10.2 10.8 10.4 13.2C12 12.8 12.6 14.2 12.2 14.8', '');
    p.poly([[2.2, 14.8], [13.2, 14.8], [11.6, 19.2], [3.8, 19.2]], { closed: true, over: 0.2 }).line(5.4, 19.2, 5.4, G, { over: 0 }).line(10, 19.2, 10, G, { over: 0 });
    p.line(17.6, G, 17.6, 6.4, { over: 0.2 }).line(14.6, 6.4, 20.6, 6.4, { over: 0.2 }).wheel(14.6, 4.6, 1.5).wheel(20.6, 4.6, 1.5);
    p.ground();
    for (const x of [3, 8, 13, 19]) p.thin(x, G + 0.4, x - 1, 22.8);
  }],
  'parade-square': ['Náměstí s tribunou: the tribune draped with a banner, three flags behind', (p) => {
    for (const x of [5, 12, 19]) {
      p.line(x, 12.6, x, 2.2, { over: 0.1 });
      const f = [[x, 2.4], [x + 3.2, 2.6], [x + 3, 5.8], [x, 5.6]];
      p.poly(f, { over: 0.1 }).hatch(f, 1.2);
    }
    p.paper([[2, G], [2, 12.6], [22, 12.6], [22, G]]).rect(2, 12.6, 20, 8.4, { over: 0.4 }).rect(4, 14.2, 16, 2.4, { over: 0.1, cls: 'h' });
    p.thin(10, 12.6, 10.4, 10.6).thin(10.4, 10.6, 13.6, 10.6).thin(13.6, 10.6, 14, 12.6).ground(0.8, 23.2);
  }],

  // Památky
  chapel: ['Kaple: the little chapel, its bell turret and cross, a lime tree beside it', (p) => {
    p.tree(19.4, 14, 3.6);
    p.walls(10.8, 13.2, 6.6).gable(10.8, 13.2, 6.6, 3.8, { over: 0.2, gap: 9 }).cross(12, 3.8, 1.2);
    p.paper([[5.4, G], [5.4, 12.6], [12, 7.2], [18.6, 12.6], [18.6, G]]).walls(6, 18, 12.6).gable(6, 18, 12.6, 7.2);
    p.raw('M10.4 21V17.4Q12 15 13.6 17.4V21', '').ellipse(12, 11, 0.8, 0.8, 'h').ground(2, 22.4);
  }],
  church: ['Kostel: the tower with its spire and cross, the nave with tall arched windows', (p) => {
    p.walls(8.8, 22, 11.6).roof(8.8, 22, 11.6, 7.4, { over: 0.4 });
    for (const x of [11.4, 15, 18.6]) p.raw(`M${x} 18.4V14.6Q${x + 0.8} 13.4 ${x + 1.6} 14.6V18.4Z`, 'ink');
    p.paper([[2.4, G], [2.4, 8.4], [8.8, 8.4], [8.8, G]]).walls(2.4, 8.8, 8.4).gable(2.4, 8.8, 8.4, 2.4, { over: 0.4, gap: 1.3 }).cross(5.6, 2.4, 1.1);
    p.raw('M4.8 12.8V10.6Q5.6 9.6 6.4 10.6V12.8Z', 'ink').raw('M4.4 21V17.6Q5.6 15.8 6.8 17.6V21', '').ground();
  }],
  'town-hall': ['Radnice: the town hall, its arcade, the clock tower in the middle', (p) => {
    p.walls(1.6, 22.4, 11).roof(1.6, 22.4, 11, 7.8, { hip: 1.6 }).wins(3, 12.4, 2, 1, 3, 0, 1.4, 1.8).wins(17, 12.4, 2, 1, 3, 0, 1.4, 1.8);
    for (let x = 2.6; x < 21; x += 3.9) p.raw(`M${x} 21V17.4Q${x + 1.5} 15.2 ${x + 3} 17.4V21`, '');
    p.paper([[10, 15.4], [10, 4.4], [14, 4.4], [14, 15.4]]).line(10, 15.4, 10, 4.4, { over: 0.2 }).line(14, 15.4, 14, 4.4, { over: 0.2 }).gable(10, 14, 4.4, 0.8, { over: 0.4, gap: 1.2 });
    p.ellipse(12, 7.2, 1.3, 1.3).thin(12, 7.2, 12, 6.3).thin(12, 7.2, 12.7, 7.4).win(11.4, 10.6, 1.2, 2.2);
  }],
  memorial: ['Pomník padlým: the obelisk on its steps, a wreath laid on it', (p) => {
    p.rect(5.4, 19, 13.2, 2, { over: 0.3 }).rect(7, 17, 10, 2, { over: 0.2 });
    p.poly([[9.6, 17], [10.4, 4.4], [12, 2.2], [13.6, 4.4], [14.4, 17]], { over: 0.2 }).thin(10.4, 4.4, 13.6, 4.4);
    p.ellipse(12, 11.6, 1.9, 1.9).raw('M10.6 13L9.6 15M13.4 13L14.4 15', 'h');
  }],
  castle: ['Hrad: the castle on its hill, battlements, the round tower with its cone roof', (p) => {
    p.raw('M0.8 21C4 16.6 6.6 15.4 12 15.4S20 16.6 23.2 21', '');
    p.walls(8.4, 20, 9.4).line(8.4, 15.4, 8.4, 9.4, { over: 0 });
    p.raw('M8.4 9.4V8H9.8V9.4H11.6V8H13V9.4H14.8V8H16.2V9.4H18V8H19.4V9.4H20', '').raw('M12.8 15.4V13Q14 11.4 15.2 13V15.4', 'ink');
    p.paper([[3.6, 15.6], [3.6, 6.2], [8.6, 6.2], [8.6, 15.6]]).line(3.6, 15.6, 3.6, 6.2, { over: 0.1 }).line(8.6, 15.6, 8.6, 6.2, { over: 0.1 });
    p.gable(3.6, 8.6, 6.2, 1.2, { over: 0.5, gap: 1.2 }).win(5.5, 8.4, 1.2, 2);
    p.raw('M0.8 21H23.2', 'h');
  }],
  'tv-tower': ['Televizní vysílač: the slender tower on its hill, the cabin, the aerial', (p) => {
    p.raw('M0.8 21Q12 14.4 23.2 21', '');
    p.raw('M11 17.2L11.5 8.4M13 17.2L12.5 8.4', '');
    const pod = [[9.2, 8.4], [14.8, 8.4], [13.8, 6], [10.2, 6]];
    p.paper(pod).poly(pod, { closed: true, over: 0.2 }).thin(9.8, 7.2, 14.2, 7.2).line(12, 6, 12, 0.8, { over: 0.1 }).thin(11.2, 3.6, 12.8, 3.6);
  }],
  stadium: ['Stadion: the grandstand under its roof, two floodlight masts', (p) => {
    p.line(3, G, 3, 4.6, { over: 0.1 }).line(21, G, 21, 4.6, { over: 0.1 });
    for (const x of [3, 21]) { p.rect(x - 1.8, 1.4, 3.6, 3.2, { over: 0.2 }); p.thin(x - 1.8, 3, x + 1.8, 3).thin(x, 1.4, x, 4.6); }
    p.line(5.4, 8.6, 18.6, 7.4, { over: 0.3 }).line(6.2, 8.6, 6.2, 12.6, { over: 0.1 }).line(17.8, 7.6, 17.8, 12.6, { over: 0.1 });
    const stand = [[5.6, G], [5.6, 12.6], [18.4, 12.6], [18.4, G]];
    p.paper(stand).poly(stand, { over: 0.2 });
    for (let y = 14.4; y < 20.6; y += 1.6) p.thin(5.6, y, 18.4, y);
    p.ground();
  }],
};

// ----- writing the files -----

const here = dirname(fileURLToPath(import.meta.url));
const ATTRS = { '': '', h: ' class="h" stroke-width="0.8"', ink: ' class="ink" fill="currentColor" stroke-width="0.6"', p: ' class="p" fill="#fff" stroke="none"' };

let seed = 1;
for (const [name, [about, draw]] of Object.entries(SPRITES)) {
  const p = new Pen(seed++);
  draw(p);
  const body = p.parts.map(({ cls, d }) => `  <path${ATTRS[cls]} d="${d}"/>`).join('\n');
  writeFileSync(join(here, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
  <!-- ${about} -->
${body}
</svg>
`);
}
writeFileSync(join(here, 'list.json'), JSON.stringify(Object.keys(SPRITES)) + '\n');
console.log(`${Object.keys(SPRITES).length} sprites written`);
