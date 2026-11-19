// Crop fields: the ground painted with a crop (world.crops, world/crops.js
// – the Grain and Potatoes tools' brush), in pieces. What's built on it
// cuts it: a road, railway, footpath or fence and the squares it runs
// over, water. A building in a field leaves it whole, the crop kept off a
// clearing round it – an uneven ring, not the squares it stands on
// (clearing()). Each piece of one crop left
// whole is a field – a road across a field makes two, and when the road
// goes they are one again (the crop was under it all along). Fields are
// drawn only as their crop (render/meadow.js grows it), its rows each way
// the brush sowed them.
//
// fieldsOf(world) -> { list: [{ id, cells, area, crop, along }], at(x, y) }
// (`cells`: its squares; `area` in grid squares; `along`: 'x' or 'y', the
// way most of its rows run – each square keeps the way it was sown; at(x,
// y) the field's index there, -1 outside or where something cuts it),
// found again only when the crops or what cuts them changed.

import { findEnclosures } from './pastures.js';
import { kindsWhere } from '../roads/rules.js';
import { CROP_RES, cropOfValue, alongOfValue, cropValue } from '../core/world/crops.js';

// (a meadow is sown and cut as a field is, and grows grass and flowers)
export const CROPS = ['grain', 'potatoes', 'meadow'];

// The ways that cut a field (roads/rules.js), each with the ground it
// keeps (World.wayClear).
const CUTS = kindsWhere('cutsFields');

export function fieldsOf(world) {
  const nw = world.networks;
  const stamp = `${world.cropVersion}|${nw.road.version}|${nw.rail.version}|${nw.path.version}|${nw.fence.version}|${world.ways.version}|${world.structureVersion ?? 0}`;
  if (world._fields?.stamp === stamp) return world._fields.found;
  const found = findFields(world);
  world._fields = { stamp, found };
  return found;
}

function findFields(world) {
  const cw = world.cropColumns, crops = world.crops;
  const region = new Int32Array(crops.length).fill(-1);
  const empty = { list: [], at: () => -1, region, cut: null };
  if (!crops.some((v) => v)) return empty;
  const cut = cutCells(world);
  const list = [];
  const crop = (c) => cropOfValue(crops[c]);
  for (let start = 0; start < crops.length; start++) {
    if (!crops[start] || cut[start] || region[start] >= 0) continue;
    const id = list.length, kind = crop(start), cells = [start];
    region[start] = id;
    let alongY = 0;
    for (let q = 0; q < cells.length; q++) {
      const c = cells[q], i = c % cw;
      if (alongOfValue(crops[c]) === 'y') alongY++;
      for (const m of [i > 0 ? c - 1 : -1, i < cw - 1 ? c + 1 : -1, c - cw, c + cw]) {
        if (m < 0 || m >= crops.length || region[m] >= 0 || !crops[m] || cut[m] || crop(m) !== kind) continue;
        region[m] = id;
        cells.push(m);
      }
    }
    list.push({ id, cells, area: cells.length / (CROP_RES * CROP_RES), crop: kind, along: 2 * alongY > cells.length ? 'y' : 'x' });
  }
  if (!list.length) return empty;
  // (a building's clearing by the middle of each little square, worked
  // out once: 1 in it, 2 not)
  const cleared = new Uint8Array(crops.length), anyBuilt = world.structures.size > 0;
  const at = (x, y) => {
    const cell = world.cropCellAt(x, y);
    if (cell < 0 || region[cell] < 0) return -1;
    if (anyBuilt && !cleared[cell]) cleared[cell] = clearing(world, ...world.cropCellCenter(cell)) ? 1 : 2;
    return cleared[cell] === 1 ? -1 : region[cell];
  };
  return { list, at, region, cut };
}

// The squares the field eraser takes at (x, y): the whole field there, and
// the crop under what cuts it along its edge (a road's width of it), so
// the field doesn't come back as a strip when the road goes. [] outside.
export function fieldCellsAt(world, x, y) {
  const found = fieldsOf(world), f = found.at(x, y);
  if (f < 0) return [];
  const { region, cut } = found, crops = world.crops, cw = world.cropColumns;
  const kind = found.list[f].crop, out = [...found.list[f].cells], taken = new Set(out);
  for (let q = 0; q < out.length; q++) {
    const c = out[q], i = c % cw;
    for (const m of [i > 0 ? c - 1 : -1, i < cw - 1 ? c + 1 : -1, c - cw, c + cw]) {
      if (m < 0 || m >= crops.length || taken.has(m) || !cut[m] || region[m] >= 0 || cropOfValue(crops[m]) !== kind) continue;
      taken.add(m);
      out.push(m);
    }
  }
  return out;
}

// The outline of squares `cells` (a field), as closed loops of world
// points, rounded off – the little squares' steps smoothed away, so it
// follows the field as it looks. [[[x, y], …], …]
export function cellsOutline(world, cells) {
  const cw = world.cropColumns, vw = cw + 1, R = CROP_RES, inside = new Set(cells);
  const has = (i, j) => i >= 0 && i < cw && inside.has(j * cw + i);
  const next = new Map(); // vertex -> the vertices its edges run on to
  const edge = (ai, aj, bi, bj) => {
    const a = aj * vw + ai;
    if (!next.has(a)) next.set(a, []);
    next.get(a).push(bj * vw + bi);
  };
  for (const c of cells) {
    const i = c % cw, j = (c - i) / cw;
    if (!has(i, j - 1)) edge(i, j, i + 1, j);
    if (!has(i + 1, j)) edge(i + 1, j, i + 1, j + 1);
    if (!has(i, j + 1)) edge(i + 1, j + 1, i, j + 1);
    if (!has(i - 1, j)) edge(i, j + 1, i, j);
  }
  const loops = [];
  for (const startV of next.keys()) {
    while (next.get(startV).length) {
      const loop = [];
      let v = startV;
      do {
        loop.push(v);
        v = next.get(v).pop();
      } while (v !== startV && next.get(v)?.length);
      // the corners only, then cut round (Chaikin) twice
      let pts = loop.map((u) => [(u % vw) / R, Math.floor(u / vw) / R]);
      pts = pts.filter((p, k) => {
        const a = pts[(k + pts.length - 1) % pts.length], b = pts[(k + 1) % pts.length];
        return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
      });
      for (let n = 0; n < 2 && pts.length > 2; n++) {
        pts = pts.flatMap((p, k) => {
          const q = pts[(k + 1) % pts.length];
          return [[0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]], [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]];
        });
      }
      if (pts.length > 2) loops.push([...pts, pts[0]]);
    }
  }
  return loops;
}

// Which sown squares something cuts: water or off the land, a way's width
// over them, a building on them. Uint8Array by cell.
function cutCells(world) {
  const cw = world.cropColumns, crops = world.crops, R = CROP_RES;
  const cut = new Uint8Array(crops.length);
  for (let c = 0; c < crops.length; c++) if (crops[c] && !world.cropGround(c)) cut[c] = 1;
  const square = (c) => {
    const i = c % cw, j = (c - i) / cw;
    return [i / R, j / R, (i + 1) / R, (j + 1) / R];
  };
  // the ways, each along its line
  for (const e of world.ways.edges.values()) {
    if (!CUTS.includes(e.kind)) continue;
    const r = world.wayClear(e.kind, e);
    for (let k = 1; k < e.pts.length; k++) {
      const a = e.pts[k - 1], b = e.pts[k];
      const i0 = Math.max(0, Math.floor(R * (Math.min(a[0], b[0]) - r))), i1 = Math.min(cw - 1, Math.floor(R * (Math.max(a[0], b[0]) + r)));
      const j0 = Math.max(0, Math.floor(R * (Math.min(a[1], b[1]) - r))), j1 = Math.floor(R * (Math.max(a[1], b[1]) + r));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const c = j * cw + i;
          if (c >= crops.length || !crops[c] || cut[c]) continue;
          if (segmentSquareDistance(a, b, square(c)) < r) cut[c] = 1;
        }
      }
    }
  }
  return cut;
}

// The clearing a building keeps in a field round it: an uneven ring, its
// radius the body's reach plus CLEAR, wavering by a few slow waves round
// it (seeded by the building, so it keeps its shape).
const CLEAR = 0.3;
export function clearing(world, x, y) {
  for (const id of world.structureIndex.near(x, y, 3)) {
    const s = world.structures.get(id), poly = world.structureIndex.outline(id);
    if (!s || !poly) continue;
    const reach = Math.max(...poly.map(([px, py]) => Math.hypot(px - s.x, py - s.y)));
    const d = Math.hypot(x - s.x, y - s.y);
    if (d > (reach + CLEAR) * 1.3) continue;
    const a = Math.atan2(y - s.y, x - s.x), k = (s.seed ?? s.id) >>> 0;
    const wave = 0.13 * Math.sin(3 * a + (k % 628) / 100) + 0.08 * Math.sin(5 * a + ((k >>> 10) % 628) / 100) + 0.05 * Math.sin(7 * a + ((k >>> 20) % 628) / 100);
    if (d < (reach + CLEAR) * (1 + wave)) return true;
  }
  return false;
}

// How near segment a–b comes to the square [x0, y0, x1, y1]: 0 where it
// enters it.
export function segmentSquareDistance(a, b, [x0, y0, x1, y1]) {
  const inside = ([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  if (inside(a) || inside(b)) return 0;
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  let best = Infinity;
  for (let k = 0; k < 4; k++) {
    const p = corners[k], q = corners[(k + 1) % 4];
    if (Math.sign(cross(a, b, p)) !== Math.sign(cross(a, b, q)) && Math.sign(cross(p, q, a)) !== Math.sign(cross(p, q, b))) return 0;
    best = Math.min(best, pointSegment(p, a, b), pointSegment(a, p, q), pointSegment(b, p, q));
  }
  return best;
}

function pointSegment([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
}

// Older saves: fields were the ground closed in all round by drawn field
// edges (the 'field' ways, each with its crop). Their ground is sown with
// the crop most of their edges carried, and the edges go. Not a step of
// the history.
export function fieldEdgesToCrops(world) {
  const edges = [...world.ways.edges.values()].filter((e) => e.kind === 'field');
  if (!edges.length) return;
  const found = findEnclosures(world, world.networks.field.graph);
  const votes = found.list.map(() => new Map());
  for (const e of edges) {
    const crop = e.crop ?? 'grain';
    for (let i = 1; i < e.pts.length; i++) {
      const [ax, ay] = e.pts[i - 1], [bx, by] = e.pts[i];
      const l = Math.hypot(bx - ax, by - ay) || 1, nx = ((ay - by) / l) * 0.15, ny = ((bx - ax) / l) * 0.15;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      for (const s of [-1, 1]) {
        const r = found.at(mx + nx * s, my + ny * s);
        if (r >= 0) votes[r].set(crop, (votes[r].get(crop) ?? 0) + l);
      }
    }
  }
  found.list.forEach((f, i) => {
    const crop = [...votes[i]].sort((a, b) => b[1] - a[1] || CROPS.indexOf(a[0]) - CROPS.indexOf(b[0]))[0]?.[0] ?? 'grain';
    // (its triangles on the half-step squares, each square spread over
    // the little ones it covers)
    const ow = world.fine.width - 1, n = CROP_RES / 2, cw = world.cropColumns;
    for (const k of f.tris) {
      const c = k >> 2, oi = c % ow, oj = (c - oi) / ow;
      for (let dj = 0; dj < n; dj++) for (let di = 0; di < n; di++) world.crops[(oj * n + dj) * cw + oi * n + di] = cropValue(crop);
    }
  });
  world.history.aside(() => {
    for (const e of edges) world.ways.removeEdge(e.id);
  });
  world.refreshNetwork('field');
  world.cropsChanged();
}
