// Crop fields: the ground painted with a crop (world.crops, world/crops.js
// – the Grain and Potatoes tools' brush), in pieces. What's built on it
// cuts it: a road, railway, footpath or fence and the squares it runs
// over, a building and those under it, water. Each piece of one crop left
// whole is a field – a road across a field makes two, and when the road
// goes they are one again (the crop was under it all along). Fields are
// drawn only as their crop (render/meadow.js grows it), rows along their
// longer side.
//
// fieldsOf(world) -> { list: [{ id, cells, tris, area, crop, along }], at(x, y) }
// (`cells`: its squares; `tris`: the same as the four triangles of each,
// (cell << 2) | t, as pastures count them; `area` in grid squares; `along`:
// 'x' or 'y', the rows' direction; at(x, y) the field's index there, -1
// outside or where something cuts it), found again only when the crops
// or what cuts them changed.

import { findEnclosures } from './pastures.js';

export const CROPS = ['grain', 'potatoes'];

// The ways that cut a field, and the ground each keeps (World.wayClear).
const CUTS = ['road', 'rail', 'path', 'fence'];

export function fieldsOf(world) {
  const nw = world.networks;
  const stamp = `${world.cropVersion}|${nw.road.version}|${nw.rail.version}|${nw.path.version}|${nw.fence.version}|${world.ways.version}|${world.structureVersion ?? 0}`;
  if (world._fields?.stamp === stamp) return world._fields.found;
  const found = findFields(world);
  world._fields = { stamp, found };
  return found;
}

function findFields(world) {
  const cw = world.fine.width - 1, crops = world.crops;
  const region = new Int32Array(crops.length).fill(-1);
  const empty = { list: [], at: () => -1 };
  if (!crops.some((v) => v)) return empty;
  const cut = cutCells(world);
  const list = [];
  for (let start = 0; start < crops.length; start++) {
    if (!crops[start] || cut[start] || region[start] >= 0) continue;
    const id = list.length, v = crops[start], cells = [start];
    region[start] = id;
    for (let q = 0; q < cells.length; q++) {
      const c = cells[q], i = c % cw;
      for (const m of [i > 0 ? c - 1 : -1, i < cw - 1 ? c + 1 : -1, c - cw, c + cw]) {
        if (m < 0 || m >= crops.length || region[m] >= 0 || crops[m] !== v || cut[m]) continue;
        region[m] = id;
        cells.push(m);
      }
    }
    // the rows along the longer side
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of cells) {
      const i = c % cw, j = (c - i) / cw;
      x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, j); y1 = Math.max(y1, j);
    }
    const tris = cells.flatMap((c) => [c << 2, (c << 2) | 1, (c << 2) | 2, (c << 2) | 3]);
    list.push({ id, cells, tris, area: cells.length / 4, crop: CROPS[v - 1], along: x1 - x0 >= y1 - y0 ? 'x' : 'y' });
  }
  if (!list.length) return empty;
  const at = (x, y) => {
    const cell = world.cropCellAt(x, y);
    return cell < 0 ? -1 : region[cell];
  };
  return { list, at };
}

// Which sown squares something cuts: water or off the land, a way's width
// over them, a building on them. Uint8Array by cell.
function cutCells(world) {
  const cw = world.fine.width - 1, crops = world.crops;
  const cut = new Uint8Array(crops.length);
  for (let c = 0; c < crops.length; c++) if (crops[c] && !world.cropGround(c)) cut[c] = 1;
  const square = (c) => {
    const i = c % cw, j = (c - i) / cw;
    return [i / 2, j / 2, (i + 1) / 2, (j + 1) / 2];
  };
  // the ways, each along its line
  for (const e of world.ways.edges.values()) {
    if (!CUTS.includes(e.kind)) continue;
    const r = world.wayClear(e.kind, e);
    for (let k = 1; k < e.pts.length; k++) {
      const a = e.pts[k - 1], b = e.pts[k];
      const i0 = Math.max(0, Math.floor(2 * (Math.min(a[0], b[0]) - r))), i1 = Math.min(cw - 1, Math.floor(2 * (Math.max(a[0], b[0]) + r)));
      const j0 = Math.max(0, Math.floor(2 * (Math.min(a[1], b[1]) - r))), j1 = Math.floor(2 * (Math.max(a[1], b[1]) + r));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const c = j * cw + i;
          if (c >= crops.length || !crops[c] || cut[c]) continue;
          if (segmentSquareDistance(a, b, square(c)) < r) cut[c] = 1;
        }
      }
    }
  }
  // buildings: the squares their bodies (or, on the dots, outlines) stand on
  for (let c = 0; c < crops.length; c++) {
    if (!crops[c] || cut[c]) continue;
    const [x0, y0, x1, y1] = square(c);
    if (world.structureIndex.overlapping([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]).length) cut[c] = 1;
  }
  return cut;
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
    for (const k of f.tris) world.crops[k >> 2] = CROPS.indexOf(crop) + 1;
  });
  world.history.aside(() => {
    for (const e of edges) world.ways.removeEdge(e.id);
  });
  world.refreshNetwork('field');
  world.cropsChanged();
}
