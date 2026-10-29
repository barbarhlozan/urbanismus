// Test page only (drawn-lab.html): the blueprint to paint a building's
// faces on (src/lab/faces.js), and a painting of them for trying the page
// out without one of your own. Both draw on a 2D canvas the blueprint's size.

import { BP, WINDOW } from './faces.js';

const INK = '#8f877a', FAINT = '#cfc8bc', GRID = '#ece8e1', GRID2 = '#ddd7cc', MARK = '#3b6fd8';
const MAGENTA = `rgb(${WINDOW.join(',')})`;

// What each kind of panel is, under its name.
const HOW = (p) => (/roof/.test(p.side) ? 'laid flat · eaves at the bottom, ridge at the top'
  : /eave/.test(p.side) ? 'the board under the roof edge, seen from outside'
  : p.side === 'top' ? 'seen from above · the street down'
    : 'as seen from outside · ground at the bottom');

// The blueprint: every panel's outline at its true shape, a grid in it
// every 0.05 grid step (stronger every 0.1), over it a little house with
// that panel marked, its name and how it is laid out. On white, to be the
// bottom layer in Procreate (hide it for the export).
export function drawBlueprint(ctx, model) {
  const { S, KEY } = BP;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, model.width, model.height);
  for (const p of model.panels) {
    ctx.save();
    ctx.translate(p.x, p.y);
    // the grid, inside the outline
    ctx.save();
    outlinePath(ctx, p);
    ctx.clip();
    grid(ctx, p.w, p.h, S / 20);
    ctx.restore();
    // the outline: only the edges no two faces share
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const [a, b] of edgesOf(p)) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.stroke();
    ctx.restore();
    key(ctx, model, p);
    const [piece, side] = p.label.split(' · ');
    ctx.fillStyle = INK;
    ctx.textBaseline = 'alphabetic';
    ctx.font = '38px Georgia, serif';
    ctx.fillText(`${piece}, ${side}`, p.x + KEY + 30, p.y - 62);
    ctx.font = 'italic 26px Georgia, serif';
    ctx.fillText(HOW(p), p.x + KEY + 30, p.y - 22);
  }
  // the windows' colour, and the rules
  const y = model.height - 46;
  ctx.fillStyle = MAGENTA;
  ctx.fillRect(BP.M, y - 30, 60, 36);
  ctx.fillStyle = INK;
  ctx.font = '30px Georgia, serif';
  ctx.fillText(`windows: square them in this magenta (#FF00FF) · 1 grid step = ${S} px · grid every 0.05 · keep this canvas size · hide this layer, export a PNG`,
    BP.M + 80, y);
}

function outlinePath(ctx, p) {
  ctx.beginPath();
  for (const f of p.flat) f.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

// A panel's outer edges: those of its faces that no other of its faces has.
function edgesOf(p) {
  const key = ([a, b]) => [a, b].map((q) => q.map((v) => Math.round(v)).join(',')).sort().join('|');
  const all = p.flat.flatMap((f) => f.map((q, i) => [q, f[(i + 1) % f.length]]));
  const count = new Map();
  for (const e of all) count.set(key(e), (count.get(key(e)) ?? 0) + 1);
  return all.filter((e) => count.get(key(e)) === 1);
}

// Squares `step` px from the bottom left, every other line stronger.
function grid(ctx, w, h, step) {
  ctx.lineWidth = 2;
  for (const strong of [false, true]) {
    ctx.strokeStyle = strong ? GRID2 : GRID;
    ctx.beginPath();
    for (let k = 1; k * step < w; k++) if ((k % 2 === 0) === strong) { ctx.moveTo(k * step, 0); ctx.lineTo(k * step, h); }
    for (let k = 1; k * step < h; k++) if ((k % 2 === 0) === strong) { ctx.moveTo(0, h - k * step); ctx.lineTo(w, h - k * step); }
    ctx.stroke();
  }
}

// ----- the little house over each panel -----

// The building as the map draws it (x' = (rx − ry)·cos30, y' = (rx + ry)/2
// − z·0.9), its street in front (at −y), the panel's faces filled in blue;
// turned to look at them, a little aside so the house reads as one.
function key(ctx, model, p) {
  const { KEY } = BP;
  const angle = p.side === 'top' ? 1.12 * Math.PI : Math.PI / 4 - Math.atan2(p.n[1], p.n[0]) + 0.11 * Math.PI;
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const proj = ([x, y, z]) => {
    const rx = x * cs - y * sn, ry = x * sn + y * cs;
    return [(rx - ry) * 0.866, (rx + ry) / 2 - z * 0.9, rx + ry];
  };
  const faces = model.faces.map((f) => f.pts);
  const street = [[-0.17, -0.27, 0], [0.17, -0.27, 0], [0.17, -0.32, 0], [-0.17, -0.32, 0]];
  // fit it in its square, over the panel's left end
  const all = [...faces.flat(), ...street].map(proj);
  const x0 = Math.min(...all.map((q) => q[0])), x1 = Math.max(...all.map((q) => q[0]));
  const y0 = Math.min(...all.map((q) => q[1])), y1 = Math.max(...all.map((q) => q[1]));
  const k = (KEY - 20) / Math.max(x1 - x0, y1 - y0);
  const ox = p.x + KEY / 2 - ((x0 + x1) / 2) * k, oy = p.y - 30 - KEY / 2 - ((y0 + y1) / 2) * k;
  const screen = (q) => { const [x, y] = proj(q); return [ox + x * k, oy + y * k]; };
  const mine = new Set(p.faces);
  poly(ctx, street.map(screen), '#efebe3', FAINT);
  // faces turned to the viewer, far to near, higher ones later
  const shown = model.faces.filter(({ pts }) => {
    const n = normal(pts);
    return (n[0] * cs - n[1] * sn) + (n[0] * sn + n[1] * cs) + n[2] / 0.9 > 1e-6;
  }).map(({ pts }) => ({ pts, d: pts.reduce((s, q) => s + proj(q)[2] + q[2] * 0.6, 0) / pts.length }))
    .sort((a, b) => a.d - b.d);
  for (const { pts } of shown) {
    const on = mine.has(pts);
    poly(ctx, pts.map(screen), on ? '#c9d8f5' : '#fff', on ? MARK : INK);
  }
}

function normal(pts) {
  const n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

function poly(ctx, pts, fill, stroke) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// ----- the sample painting -----

// A village house painted face by face, pixel by pixel, from where each
// pixel is on the house: whitewashed walls on a grey plinth, a boarded
// gable, tiled roof, a brick chimney; windows with their magenta squares.
export function paintSample(ctx, model) {
  const { S } = BP;
  const img = ctx.createImageData(model.width, model.height), d = img.data;
  const house = model.panels.filter((p) => p.piece === 'house');
  const wallTop = Math.max(...house.filter((p) => p.side === 'left side').flatMap((p) => p.faces.flat().map((q) => q[2])));
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const put = (x, y, hex) => {
    const i = (y * model.width + x) * 4, g = (rnd() - 0.5) * 18 + Math.sin(x * 0.05 + y * 0.013) * 5;
    d[i] = parseInt(hex.slice(1, 3), 16) + g; d[i + 1] = parseInt(hex.slice(3, 5), 16) + g; d[i + 2] = parseInt(hex.slice(5, 7), 16) + g; d[i + 3] = 255;
  };
  const squares = [];
  for (const p of model.panels) {
    // the panel's windows, in its px: [x0, y0, x1, y1]
    const wins = [];
    const wall = p.piece === 'house' && !/roof|eave|top/.test(p.side);
    if (wall) {
      const ww = 0.044 * S, wh = 0.068 * S, zb = 0.06 * S;
      const gable = p.side === 'front' || p.side === 'back';
      const n = gable ? (p.side === 'front' ? 2 : 1) : Math.max(1, Math.floor(p.w / (0.12 * S)));
      for (let i = 0; i < n; i++) {
        const cx = (p.w * (i + 0.5)) / n;
        wins.push([cx - ww / 2, p.h - zb - wh, cx + ww / 2, p.h - zb]);
      }
      if (gable) wins.push([p.w / 2 - 0.018 * S, p.h - (wallTop + 0.11) * S, p.w / 2 + 0.018 * S, p.h - (wallTop + 0.06) * S]);
    }
    const inWin = (x, y) => wins.find(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
    const flat = p.flat;
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      if (!flat.some((f) => inside([x + 0.5, y + 0.5], f))) continue;
      const [, , z] = p.to3D(x, y);
      let c;
      const w = inWin(x, y);
      if (w) {
        const [x0, y0, x1, y1] = w, f = 7;
        c = x - x0 < f || x1 - x < f || y - y0 < f || y1 - y < f || Math.abs(x - (x0 + x1) / 2) < 3 || Math.abs(y - (y0 + (y1 - y0) * 0.38)) < 3 ? '#f4efe3' : '#2e4752';
      } else if (p.piece === 'chimney') c = p.side === 'top' ? '#3a2f2a' : Math.floor(y / 14) % 2 === Math.floor((x + (Math.floor(y / 14) % 2) * 9) / 18) % 2 ? '#a3563d' : '#8e4630';
      else if (/eave/.test(p.side)) c = '#5f3c24';
      else if (/roof/.test(p.side)) c = (y % 34) < 5 ? '#7a3b28' : ((x + (Math.floor(y / 34) % 2) * 17) % 34) < 3 ? '#86412c' : '#a4553a';
      else if (p.piece === 'annex') c = x % 26 < 3 ? '#5f3c24' : '#8b5a35';
      else if (z > wallTop + 0.004) c = x % 26 < 4 ? '#5f3c24' : '#8b5a35';
      else c = z < 0.028 ? '#8b847a' : z > wallTop - 0.012 ? '#6e4b31' : '#ede3cd';
      put(p.x + x, p.y + y, c);
    }
    for (const [x0, y0, x1, y1] of wins) squares.push([p.x + x0 - 9, p.y + y0 - 9, x1 - x0 + 18, y1 - y0 + 18]);
  }
  ctx.putImageData(img, 0, 0);
  // the windows squared in magenta
  ctx.strokeStyle = MAGENTA;
  ctx.lineWidth = 10;
  for (const r of squares) ctx.strokeRect(...r);
}

function inside([x, y], poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
