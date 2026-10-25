// Test page only (drawn-lab.html), not in the game: the line version of
// hand-drawn buildings.
//
// Hand-drawn buildings: a house's walls and roof drawn by hand on a sheet
// (an SVG started from a template, drawings/README.md) and pinned onto the
// house's faces, so the drawing turns with the map, gets the sun, the night
// and the shadows like any code-drawn house, and goes into photos – every
// stroke is a 3D line on its wall or roof, drawn through whatever camera
// draws the house.
//
// The house itself – its walls, its roof, their fills – is still built in
// code from the sheet's spec; the sheet only draws on it. For now one shape:
// a gabled house with its gable to the street (the ridge along y).
//
//   spec = { file, w, d, h, roof, eave }   sizes in grid steps: width along
//                                           the street, depth, wall height,
//                                           roof height, eaves' overhang
//   templateSVG(spec)        the blank sheet to draw on
//   readSheet(svgText, spec) the sheet's strokes, panel by panel
//   loadSheets(specs)        fetch and read them all (once, at start)
//   drawSheet(g, spec)       the house, with its sheet's strokes if loaded
//
// The sheet lays the house out unfolded, as a cardboard model: the four
// walls in a row as seen from outside, each sharing its edges with the next
// (left side, front, right side, back – left and right as seen from the
// street), and the roof seen from above over the front, its lower edge
// the front's eaves. Strokes drawn in blue are windows: their bounding box
// becomes a window like those the code draws (lit at night, framed in
// photos). Strokes outside every panel are notes and are left out.

import { LOOK } from '../render/painter.js';

// The cottage drawn on drawings/chalupa.svg.
export const CHALUPA = { id: 'chalupa', file: 'drawings/chalupa.svg', w: 0.3, d: 0.44, h: 0.17, roof: 0.24, eave: 0.03 };

const S = 1000;       // sheet px per grid step
const MARGIN = 80;    // around the panels
const GAP = 60;       // between panels
const FLAT = 1.2;     // strokes simplified to within this (sheet px)
const NEAR = 14;      // a point this far outside a panel still counts as in it

// Where each panel is on the sheet, in sheet px. Walls: x0 its left edge,
// `wide` its width, standing on `ground`; their points read as (u, v):
// along from its left edge and up, in grid steps. The roof: its plan,
// `cx` its middle, `front` its front eaves' edge.
export function layout({ w, d, h, roof, eave }) {
  const wallTop = (h + roof) * S, plan = (d + 2 * eave) * S;
  const ground = MARGIN + plan + GAP + wallTop;
  const panels = {};
  let x = MARGIN;
  for (const [id, wide, gable] of [['left', d, false], ['front', w, true], ['right', d, false], ['back', w, true]]) {
    const x1 = x + wide * S, top = ground - h * S;
    const outline = gable
      ? [[x, ground], [x1, ground], [x1, top], [(x + x1) / 2, ground - wallTop], [x, top]]
      : [[x, ground], [x1, ground], [x1, top], [x, top]];
    panels[id] = { x0: x, wide, ground, outline };
    x = x1 + GAP;
  }
  const f = panels.front, cx = f.x0 + (w * S) / 2, half = (w / 2 + eave) * S;
  const front = ground - wallTop - GAP;
  panels.roof = { cx, front, outline: [[cx - half, front], [cx + half, front], [cx + half, front - plan], [cx - half, front - plan]] };
  return { width: x - GAP + MARGIN, height: ground + MARGIN + 40, panels };
}

const LABELS = {
  left: 'left side', front: 'front (to the street)', right: 'right side', back: 'back', roof: 'roof, seen from above',
};

// The blank sheet: the panels' outlines, what they are, the wall tops and
// the ridge, all in a group "template" the game leaves out. Draw anywhere
// in the panels, in any colour but blue; windows in blue.
export function templateSVG(spec) {
  const { width, height, panels } = layout(spec);
  const pts = (o) => o.map(([x, y]) => `${x},${y}`).join(' ');
  const guide = [];
  for (const [id, p] of Object.entries(panels)) {
    guide.push(`<polygon points="${pts(p.outline)}"/>`);
    const [lx, ly] = id === 'roof' ? [p.outline[3][0], p.outline[3][1] - 16] : [p.x0, p.ground + 34];
    guide.push(`<text x="${lx}" y="${ly}">${LABELS[id]}</text>`);
  }
  const r = panels.roof;
  guide.push(`<line class="dash" x1="${r.cx}" y1="${r.front}" x2="${r.cx}" y2="${r.outline[2][1]}"/>`);
  const e = spec.eave * S;
  guide.push(`<polygon class="dash" points="${pts([[r.outline[0][0] + e, r.front - e], [r.outline[1][0] - e, r.front - e], [r.outline[2][0] - e, r.outline[2][1] + e], [r.outline[3][0] + e, r.outline[3][1] + e]])}"/>`);
  const note = `${spec.w} × ${spec.d} grid steps, walls ${spec.h}, roof ${spec.roof}; 1 grid step = ${S} px. Windows in blue.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<g id="template" fill="none" stroke="#b9b2a6" stroke-width="2" font-family="Georgia, serif" font-size="26">
<style>#template text { fill: #9a9184; stroke: none; } #template .dash { stroke-dasharray: 10 10; }</style>
${guide.join('\n')}
<text x="${MARGIN}" y="${height - 20}">${note}</text>
</g>
<g id="drawing" fill="none" stroke="#222" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
</g>
</svg>
`;
}

// ----- reading a sheet -----

// Elements whose contents are never drawn.
const HIDDEN = new Set(['defs', 'clipPath', 'mask', 'symbol', 'marker', 'pattern', 'text', 'title', 'desc', 'metadata', 'style', 'script']);
const TAG = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

function attrsOf(text) {
  const out = {};
  for (const m of text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = m[2] ?? m[3];
  for (const decl of (out.style ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return out;
}

const mul = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function transformOf(text) {
  let m = [1, 0, 0, 1, 0, 0];
  for (const [, fn, args] of (text ?? '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
    let t = null;
    if (fn === 'matrix') t = a;
    else if (fn === 'translate') t = [1, 0, 0, 1, a[0], a[1] ?? 0];
    else if (fn === 'scale') t = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
    else if (fn === 'rotate') {
      const r = (a[0] * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
      t = [c, s, -s, c, 0, 0];
      if (a.length === 3) t = mul(mul([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]]);
    } else if (fn === 'skewX') t = [1, 0, Math.tan((a[0] * Math.PI) / 180), 1, 0, 0];
    else if (fn === 'skewY') t = [1, Math.tan((a[0] * Math.PI) / 180), 0, 1, 0, 0];
    if (t) m = mul(m, t);
  }
  return m;
}

// A colour as [r, g, b] in 0..1, or null (none, or not understood).
function rgbOf(c) {
  if (!c || c === 'none' || c === 'transparent') return null;
  if (c === 'blue') return [0, 0, 1];
  let m = c.match(/^#([0-9a-f]{3})$/i);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16) / 255);
  m = c.match(/^#([0-9a-f]{6})/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  m = c.match(/^rgba?\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?/i);
  if (m) return [m[1], m[2], m[3]].map((v) => Number(v) / (c.includes('%') ? 100 : 255));
  return [0, 0, 0];
}
const isBlue = (rgb) => !!rgb && rgb[2] > 0.45 && rgb[2] - Math.max(rgb[0], rgb[1]) > 0.25;

// Curves are cut into this many straight pieces (simplified afterwards).
const STEPS = 16;

// A path's `d` as polylines (one per subpath), in its own units.
export function pathLines(d) {
  const toks = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  const lines = [];
  let line = null, i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, prev = '';
  const num = () => Number(toks[i++]);
  const to = (px, py) => { line.push([px, py]); x = px; y = py; };
  const curve = (f) => { for (let k = 1; k <= STEPS; k++) line.push(f(k / STEPS)); };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') {
      if (line) { line.push([sx, sy]); x = sx; y = sy; }
      line = null; prev = C; continue;
    }
    if (C === 'M') {
      const px = ox + num(), py = oy + num();
      line = [[px, py]]; lines.push(line);
      x = sx = px; y = sy = py;
      cmd = rel ? 'l' : 'L'; prev = 'M'; continue;
    }
    if (!line) { line = [[x, y]]; lines.push(line); }
    if (C === 'L') to(ox + num(), oy + num());
    else if (C === 'H') to(ox + num(), y);
    else if (C === 'V') to(x, oy + num());
    else if (C === 'C' || C === 'S') {
      let x1, y1;
      if (C === 'C') { x1 = ox + num(); y1 = oy + num(); } else [x1, y1] = prev === 'C' || prev === 'S' ? [2 * x - cx, 2 * y - cy] : [x, y];
      const x2 = ox + num(), y2 = oy + num(), ex = ox + num(), ey = oy + num(), [x0, y0] = [x, y];
      curve((t) => {
        const s = 1 - t;
        return [s * s * s * x0 + 3 * s * s * t * x1 + 3 * s * t * t * x2 + t * t * t * ex, s * s * s * y0 + 3 * s * s * t * y1 + 3 * s * t * t * y2 + t * t * t * ey];
      });
      [cx, cy, x, y] = [x2, y2, ex, ey];
    } else if (C === 'Q' || C === 'T') {
      let x1, y1;
      if (C === 'Q') { x1 = ox + num(); y1 = oy + num(); } else [x1, y1] = prev === 'Q' || prev === 'T' ? [2 * x - cx, 2 * y - cy] : [x, y];
      const ex = ox + num(), ey = oy + num(), [x0, y0] = [x, y];
      curve((t) => {
        const s = 1 - t;
        return [s * s * x0 + 2 * s * t * x1 + t * t * ex, s * s * y0 + 2 * s * t * y1 + t * t * ey];
      });
      [cx, cy, x, y] = [x1, y1, ex, ey];
    } else if (C === 'A') {
      const rx = Math.abs(num()), ry = Math.abs(num()), rot = num(), large = num(), sweep = num();
      const ex = ox + num(), ey = oy + num();
      arc(line, x, y, rx, ry, rot, large, sweep, ex, ey);
      x = ex; y = ey;
    } else i++; // unknown: skip a number
    prev = C;
  }
  return lines.filter((l) => l.length > 1);
}

// An elliptical arc as points (SVG's endpoint form, converted to its centre).
function arc(out, x1, y1, rx, ry, rotDeg, large, sweep, x2, y2) {
  if (!rx || !ry) { out.push([x2, y2]); return; }
  const phi = (rotDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cp * dx + sp * dy, yp = -sp * dx + cp * dy;
  const k = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (k > 1) { rx *= Math.sqrt(k); ry *= Math.sqrt(k); }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const f = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / (rx * rx * yp * yp + ry * ry * xp * xp)));
  const cxp = (f * rx * yp) / ry, cyp = (-f * ry * xp) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  for (let k = 1; k <= STEPS; k++) {
    const t = t1 + (dt * k) / STEPS, ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    out.push([cp * ex - sp * ey + cx, sp * ex + cp * ey + cy]);
  }
}

function shapeLines(name, a) {
  const n = (k) => Number(a[k] ?? 0);
  const ring = (cx, cy, rx, ry) => [Array.from({ length: 33 }, (_, k) => [cx + rx * Math.cos((k / 32) * 2 * Math.PI), cy + ry * Math.sin((k / 32) * 2 * Math.PI)])];
  if (name === 'path') return pathLines(a.d ?? '');
  if (name === 'line') return [[[n('x1'), n('y1')], [n('x2'), n('y2')]]];
  if (name === 'polyline' || name === 'polygon') {
    const v = (a.points ?? '').split(/[\s,]+/).filter(Boolean).map(Number), p = [];
    for (let k = 0; k + 1 < v.length; k += 2) p.push([v[k], v[k + 1]]);
    if (name === 'polygon' && p.length) p.push(p[0]);
    return p.length > 1 ? [p] : [];
  }
  if (name === 'rect') {
    const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')];
    return [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]];
  }
  if (name === 'circle') return ring(n('cx'), n('cy'), n('r'), n('r'));
  if (name === 'ellipse') return ring(n('cx'), n('cy'), n('rx'), n('ry'));
  return [];
}

// Every stroke on a sheet: { pts (sheet px), blue }. The group "template"
// and anything hidden are left out.
export function sheetStrokes(svg) {
  const out = [];
  const stack = [{ m: [1, 0, 0, 1, 0, 0], stroke: null, fill: 'black', skip: false }];
  for (const tag of svg.matchAll(TAG)) {
    const [, close, name, rest, selfClose] = tag;
    if (!name) continue;
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const top = stack[stack.length - 1], a = attrsOf(rest ?? '');
    const local = name.replace(/^svg:/, '');
    const hidden = HIDDEN.has(local) || a.id === 'template' || a['inkscape:label'] === 'template' || a.display === 'none' || a.visibility === 'hidden';
    const st = {
      m: mul(top.m, transformOf(a.transform)),
      stroke: a.stroke ?? top.stroke,
      fill: a.fill ?? top.fill,
      skip: top.skip || hidden,
    };
    if (!st.skip && (rgbOf(st.stroke) || rgbOf(st.fill))) {
      const blue = isBlue(rgbOf(st.stroke) ?? rgbOf(st.fill));
      for (const line of shapeLines(local, a)) out.push({ pts: simplify(line.map((p) => apply(st.m, p)), FLAT), blue });
    }
    if (!selfClose) stack.push(st);
  }
  return out;
}

// Ramer–Douglas–Peucker.
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i], [bx, by] = pts[j], len = Math.hypot(bx - ax, by - ay);
    let far = -1, best = tol;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = pts[k];
      const dist = len < 1e-9 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (dist > best) { best = dist; far = k; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

function inside([x, y], poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

function distToPoly(p, poly) {
  if (inside(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}

// The sheet's strokes, panel by panel, in the panel's own grid steps:
// { left, front, right, back: { lines: [[[u, v]…]…], windows: [[u0, v0, u1, v1]…] },
//   roof: { lines: [[[x, y]…]…] } } – the roof's in the house's plan (x, y
// across and along it, its middle at 0).
export function readSheet(svg, spec) {
  const { panels } = layout(spec);
  const sheet = {};
  for (const id of Object.keys(panels)) sheet[id] = { lines: [], windows: [] };
  for (const { pts, blue } of sheetStrokes(svg)) {
    // the panel holding most of it
    let id = null, most = 0;
    for (const [pid, p] of Object.entries(panels)) {
      const n = pts.filter((q) => distToPoly(q, p.outline) <= NEAR).length;
      if (n > most) { most = n; id = pid; }
    }
    if (!id || most < pts.length * 0.6) continue;
    const p = panels[id];
    const local = id === 'roof'
      ? pts.map(([x, y]) => [(p.cx - x) / S, (p.front - y) / S - (spec.d / 2 + spec.eave)])
      : pts.map(([x, y]) => [(x - p.x0) / S, (p.ground - y) / S]);
    if (blue && id !== 'roof') {
      const us = local.map((q) => q[0]), vs = local.map((q) => q[1]);
      sheet[id].windows.push([Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)]);
    } else sheet[id].lines.push(local);
  }
  return sheet;
}

// ----- in the game -----

const SHEETS = new Map(); // file -> what readSheet made of it

export async function loadSheets(specs) {
  await Promise.all(specs.filter((s) => !SHEETS.has(s.file)).map(async (spec) => {
    try {
      const res = await fetch(spec.file);
      if (res.ok) SHEETS.set(spec.file, readSheet(await res.text(), spec));
    } catch { /* drawn plain until it loads */ }
  }));
}

export const sheetFor = (spec) => SHEETS.get(spec.file) ?? null;

// Where a wall's (u, v) is on the house, and which way the wall faces:
// left and right as seen from the street, which is at -y (a single-dot
// building is turned with its front to its road).
function walls({ w, d }) {
  return {
    front: { at: (u, v) => [w / 2 - u, -d / 2, v], n: [0, -1, 0] },
    right: { at: (u, v) => [-w / 2, -d / 2 + u, v], n: [-1, 0, 0] },
    back: { at: (u, v) => [-w / 2 + u, d / 2, v], n: [0, 1, 0] },
    left: { at: (u, v) => [w / 2, d / 2 - u, v], n: [1, 0, 0] },
  };
}

// The house of a spec, at (0, 0) facing -y, with its sheet drawn on it. A
// sheet not (yet) loaded leaves the walls and roof bare.
export function drawSheet(g, spec) {
  const { w, d, h, roof: rh, eave: e } = spec;
  const sheet = sheetFor(spec);
  const half = w / 2 + e;
  // the roof's height over a point of its plan, and the plane it's on
  const roofAt = (x, y) => [x, y, h + rh * (1 - Math.min(1, Math.abs(x) / half))];
  const onRoof = () => {
    for (const line of sheet?.roof.lines ?? []) {
      for (const run of acrossRidge(line)) {
        const side = Math.sign(run.reduce((s, p) => s + p[0], 0)) || 1;
        g.line(run.map(([x, y]) => roofAt(x, y)), { facing: [side * rh, 0, half], wobble: 0 });
      }
    }
  };
  g.roofed(-w / 2, -d / 2, 0, w, d, h, { h: rh, ridge: 'y', eave: e, hatch: !sheet?.roof.lines.length, on: onRoof });
  if (!sheet) return;
  for (const [id, { at, n }] of Object.entries(walls(spec))) {
    for (const line of sheet[id].lines) g.line(line.map(([u, v]) => at(u, v)), { facing: n, wobble: 0 });
    for (const [u0, v0, u1, v1] of sheet[id].windows) {
      g.line([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1), at(u0, v0)], { facing: n, cls: LOOK.ink ? 'ink' : undefined });
    }
  }
}

// A roof stroke cut where it crosses the ridge (x = 0), each piece on one
// plane, the crossing point in both.
function acrossRidge(line) {
  const runs = [];
  let run = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    if ((a[0] < 0 && b[0] > 0) || (a[0] > 0 && b[0] < 0)) {
      const t = a[0] / (a[0] - b[0]), mid = [0, a[1] + (b[1] - a[1]) * t];
      run.push(mid);
      runs.push(run);
      run = [mid];
    }
    run.push(b);
  }
  runs.push(run);
  return runs.filter((r) => r.length > 1);
}
