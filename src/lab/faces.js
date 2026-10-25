// Test page only (drawn-lab.html), not in the game: a building's own faces
// painted by hand. The shape is the game's – the building's draw code is
// run once and every face it makes is kept (Painter.face, local units) –
// and the blueprint lays those faces out flat, each as it is seen from
// outside, so a painting on it colours them: walls and gables, the roof's
// slopes, the chimney's sides and top.
//
// Faces in one plane of one solid (a wall and the gable over it) are one
// panel. Each panel is laid out from its own axes: across (to the right as
// seen from outside – the game's right, render/perspective.js) and up (up
// the wall, up the slope; for a flat top, away from the street).
//
// Windows are squared in magenta (WINDOW) on the painting: each magenta
// outline is a window like the game's own (lit at night, framed in
// photos), and the magenta itself is painted over from around it.
//
//   const model = facesOf(BUILDING)        faces, panels, layout (blueprint px)
//   const sheet = readSheet(image, model)  { painted, windows } per panel
//   const mesh = meshOf(model, sheet)      triangles for render/paintedGL.js

import { Painter } from '../render/painter.js';
import { Camera } from '../render/camera.js';
import { STRUCTURE_TYPES } from '../../structures/index.js';

// The building tried out: a village house with its gable to the street.
// (seed 1: the house and its chimney; some seeds add a lean-to barn)
export const BUILDING = { type: 'house', kind: 'street', seed: 1 };

// Blueprint: px per grid step, the room over each panel for its name and
// its little house, the gaps, how wide a row may get.
export const BP = { S: 1600, M: 110, GAP: 110, LABEL: 260, KEY: 220, ROW: 3500, MIN_W: 620 };

// The windows' colour, and how near a pixel's has to be to count.
export const WINDOW = [255, 0, 255];
export const isWindow = (r, g, b) => r > 170 && b > 170 && g < 110 && r - g > 110 && b - g > 110;
// near enough to be a magenta square's soft edge, painted over from around it
export const nearWindow = (r, g, b) => r > 120 && b > 120 && (r + b) / 2 - g > 22;

// Faces smaller than this (grid steps²) are left plain.
const TINY = 1e-4;
const SOLID = 128;

// Run a building's draw code and keep what it draws: { def, faces: [{ pts,
// n, solid }], g (the painter, for its lines) }.
export function drawBuilding(spec, cam = new Camera({ width: 1, height: 1 }), keep = null) {
  const def = STRUCTURE_TYPES[spec.type];
  const g = new Painter(cam, { x: 0, y: 0 }, 0, spec.seed);
  g.near = true;
  const faces = [];
  const face = g.face;
  g.face = function (pts, opts) {
    faces.push({ pts: pts.map((p) => [...p]), solid: this.solids.length });
    return face.call(this, pts, opts);
  };
  keep?.(g);
  def.draw(g, { type: spec.type, seed: spec.seed, id: 0, node: 0, rotation: 0, data: { kind: spec.kind } });
  return { def, faces, g };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

// Newell's normal and area of a polygon.
function normalOf(pts) {
  const n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const area = Math.hypot(...n) / 2;
  return { n: unit(n), area };
}

// A panel's axes: across (the right as seen from outside) and up.
function axesOf(n) {
  if (n[2] > 0.98) return { u: [-1, 0, 0], v: [0, 1, 0] };
  if (n[2] < -0.98) return { u: [-1, 0, 0], v: [0, -1, 0] };
  const u = unit([n[1], -n[0], 0]);
  return { u, v: unit(cross(n, u).map((x) => -x)) };
}

// Where a face is turned, in words: as the street sees the house.
function sideOf(n) {
  if (n[2] > 0.98) return 'top';
  if (n[2] < -0.98) return 'underside';
  const word = Math.abs(n[1]) >= Math.abs(n[0]) ? (n[1] < 0 ? 'front' : 'back') : n[0] > 0 ? 'left side' : 'right side';
  return n[2] > 0.15 ? `roof, ${word === 'front' || word === 'back' ? word : word.replace(' side', '')} slope` : word;
}

// The model: the building's faces grouped into panels, laid out on the
// blueprint. Each panel: { id, label, n, faces (3D polygons), flat (the
// same in panel px), w, h (px), x, y (on the blueprint), to3D(u, v) }.
export function facesOf(spec = BUILDING) {
  const { def, faces } = drawBuilding(spec);
  // the pieces: solids as big as the biggest are the house, small ones
  // standing up out of it chimneys, the rest annexes
  const foot = new Map();
  for (const f of faces) {
    const b = foot.get(f.solid) ?? [Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const [x, y, z] of f.pts) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); b[4] = Math.max(b[4], z); }
    foot.set(f.solid, b);
  }
  const areaOf = (b) => (b[2] - b[0]) * (b[3] - b[1]);
  const biggest = Math.max(...[...foot.values()].map(areaOf));
  const pieceOf = (solid) => {
    const b = foot.get(solid), a = areaOf(b);
    return a >= biggest * 0.5 ? 'house' : a < 0.012 ? 'chimney' : 'annex';
  };

  // panels: faces of one piece in one plane
  const panels = new Map();
  for (const f of faces) {
    const { n, area } = normalOf(f.pts);
    if (area < TINY) continue;
    const piece = pieceOf(f.solid), d = dot(n, f.pts[0]);
    const key = `${piece}|${f.solid}|${n.map((v) => v.toFixed(3))}|${d.toFixed(4)}`;
    // walls and roof of one roofed() are two solids next to each other: one piece
    const merged = piece === 'house' ? `house|${n.map((v) => v.toFixed(3))}|${d.toFixed(4)}` : key;
    if (!panels.has(merged)) panels.set(merged, { piece, n, faces: [], solids: [] });
    panels.get(merged).faces.push(f.pts);
    panels.get(merged).solids.push(f.solid);
  }
  // in order: the house's walls round from the left side, its roof, then
  // the rest, each piece in the same order
  const ORDER = ['left side', 'front', 'right side', 'back', 'roof, left slope', 'roof, front slope', 'roof, right slope', 'roof, back slope', 'top', 'underside'];
  const PIECES = ['house', 'annex', 'chimney'];
  const list = [...panels.values()].map((p) => ({ ...p, side: sideOf(p.n) }))
    .sort((a, b) => PIECES.indexOf(a.piece) - PIECES.indexOf(b.piece) || ORDER.indexOf(a.side) - ORDER.indexOf(b.side));
  const count = {};
  for (const p of list) count[`${p.piece}|${p.side}`] = (count[`${p.piece}|${p.side}`] ?? 0) + 1;
  const seen = {};
  list.forEach((p, i) => {
    const k = `${p.piece}|${p.side}`;
    seen[k] = (seen[k] ?? 0) + 1;
    p.id = `p${i}`;
    p.label = `${p.piece[0].toUpperCase()}${p.piece.slice(1)}${count[k] > 1 ? ` ${seen[k]}` : ''} · ${p.side}`;
    flatten(p);
  });
  const layout = place(list);
  return { spec, def, faces, panels: list, ...layout };
}

// A panel's faces in its own px (u to the right, v down from its top), and
// the way back.
function flatten(p) {
  const { u, v } = axesOf(p.n), o = p.faces[0][0], { S } = BP;
  const uv = p.faces.map((f) => f.map((q) => [dot(sub(q, o), u), dot(sub(q, o), v)]));
  const all = uv.flat();
  const u0 = Math.min(...all.map((q) => q[0])), v1 = Math.max(...all.map((q) => q[1]));
  const u1 = Math.max(...all.map((q) => q[0])), v0 = Math.min(...all.map((q) => q[1]));
  p.w = Math.round((u1 - u0) * S); p.h = Math.round((v1 - v0) * S);
  const px = (q) => [(q[0] - u0) * S, (v1 - q[1]) * S];
  p.flat = uv.map((f) => f.map(px));
  p.to3D = (x, y) => {
    const a = x / S + u0, b = v1 - y / S;
    return [o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b, o[2] + u[2] * a + v[2] * b];
  };
  p.axes = { u, v };
}

// Rows of panels, each with its strip for the name over it.
function place(list) {
  const { M, GAP, LABEL, ROW, MIN_W } = BP;
  let x = M, y = M + LABEL, rowH = 0, width = 0, row = null;
  for (const p of list) {
    const cell = Math.max(p.w, MIN_W);
    // a row for the house's walls, one for its roof, one for each other
    // piece; and a new one when it's full
    const group = p.piece === 'house' ? (/roof|top/.test(p.side) ? 'roof' : 'walls') : p.piece;
    if (x > M && (x + cell > ROW || group !== row)) {
      x = M; y += rowH + GAP + LABEL; rowH = 0;
    }
    row = group;
    p.x = x; p.y = y;
    x += cell + GAP;
    rowH = Math.max(rowH, p.h);
    width = Math.max(width, x - GAP + M);
  }
  return { width: Math.round(width), height: Math.round(y + rowH + M + 40) };
}

// ----- reading a painting -----

function inPoly([x, y], poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
const inPanel = (p, q) => p.flat.some((f) => inPoly(q, f));

// What a painting says, panel by panel: whether it is painted at all, and
// its windows ([x0, y0, x1, y1] in panel px). `image` is { width, height,
// data }: the blueprint's size, or the same shape scaled.
export function readSheet(image, model) {
  const k = image.width / model.width;
  if (Math.abs(image.height / model.height - k) > 0.01) {
    throw new Error(`The image is ${image.width} × ${image.height}; this blueprint is ${model.width} × ${model.height} (or the same shape, scaled). Was it painted on another building's blueprint?`);
  }
  const { data, width, height } = image;
  const at = (x, y) => {
    const px = Math.floor(x * k), py = Math.floor(y * k);
    return px < 0 || py < 0 || px >= width || py >= height ? -1 : (py * width + px) * 4;
  };
  const out = { k, panels: {} };
  for (const p of model.panels) {
    // every 3rd px: painted at all, and which are magenta
    const step = 3, cols = Math.ceil(p.w / step) + 1, rows = Math.ceil(p.h / step) + 1;
    const magenta = new Uint8Array(cols * rows);
    let painted = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const i4 = at(p.x + i * step, p.y + j * step);
      if (i4 < 0 || data[i4 + 3] < SOLID) continue;
      if (isWindow(data[i4], data[i4 + 1], data[i4 + 2])) magenta[j * cols + i] = 1;
      else if (inPanel(p, [i * step, j * step])) painted++;
    }
    out.panels[p.id] = { painted: painted > 0, windows: windowsIn(magenta, cols, rows, step) };
  }
  return out;
}

// Magenta outlines: each run of touching magenta is one window, its
// bounds the window (specks under 12 px across left out).
function windowsIn(mask, cols, rows, step) {
  const seen = new Uint8Array(mask.length), found = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const c = stack.pop(), i = c % cols, j = (c - i) / cols;
      b = [Math.min(b[0], i), Math.min(b[1], j), Math.max(b[2], i), Math.max(b[3], j)];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const ni = i + di, nj = j + dj, nc = nj * cols + ni;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows || seen[nc] || !mask[nc]) continue;
        seen[nc] = 1;
        stack.push(nc);
      }
    }
    if ((b[2] - b[0]) * step >= 12 && (b[3] - b[1]) * step >= 12) found.push(b.map((v) => v * step));
  }
  return found;
}

// ----- the model to draw -----

// Triangles with their paint: uv across the image (0–1), tex 0 where the
// panel is unpainted (drawn plain). Also each window as four corners in 3D
// and the way its wall faces, for the game's window lines.
export function meshOf(model, sheet) {
  const positions = [], normals = [], uvs = [], tex = [], windows = [];
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of model.panels) {
    const s = sheet?.panels[p.id];
    p.faces.forEach((f, fi) => {
      const flat = p.flat[fi];
      for (let i = 1; i + 1 < f.length; i++) {
        for (const c of [0, i, i + 1]) {
          positions.push(...f[c]);
          normals.push(...p.n);
          uvs.push((p.x + flat[c][0]) / model.width, (p.y + flat[c][1]) / model.height);
          tex.push(s?.painted ? 1 : 0);
          for (let a = 0; a < 3; a++) { bounds[a] = Math.min(bounds[a], f[c][a]); bounds[a + 3] = Math.max(bounds[a + 3], f[c][a]); }
        }
      }
    });
    for (const [x0, y0, x1, y1] of s?.windows ?? []) {
      // bottom left, bottom right, top right, top left, as g.windows draws them
      windows.push({ n: p.n, pts: [p.to3D(x0, y1), p.to3D(x1, y1), p.to3D(x1, y0), p.to3D(x0, y0)] });
    }
  }
  return {
    positions: new Float32Array(positions), normals: new Float32Array(normals),
    uvs: new Float32Array(uvs), tex: new Float32Array(tex), count: positions.length / 9, bounds, windows,
  };
}
