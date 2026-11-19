// Churchyards: ground closed in all round by a churchyard wall (the 'wall'
// network, the Zídka tool), found as pastures are (sim/pastures.js
// findEnclosures). A road or railway through the wall opens it, and an
// open churchyard has no graves; a footpath through it is a gateway.
//
// Inside, the graves lie in rows across the whole of it, wherever there's
// room: not on the wall, a footpath, a building (the church) or a tree.
// The rows keep to the same lines however the wall runs, so drawing more
// wall doesn't shuffle the graves already there; a place here and there
// stays empty.
//
// churchyards(world) -> { list: [{ id, tris, area, nodes, slope }], at(x, y), graves: [{ x, y, kind, h }] }
// a grave from (x, y) to (x + GRAVE.w, y + GRAVE.d), its headstone at the
// far end: `kind` 'slab' | 'cross' | 'round', `h` its height.

import { findEnclosures } from './pastures.js';

export const GRAVE = { w: 0.045, d: 0.08, dx: 0.13, dy: 0.24, keep: 0.07 };
// of the places in a row, this many stay empty (the old graves let go)
const EMPTY = 0.22;

const KINDS = ['slab', 'slab', 'slab', 'cross', 'cross', 'round'];

export function churchyards(world) {
  const { wall, path, road, rail } = world.networks;
  const key = `${wall.version}|${path.version}|${road.version}|${rail.version}|${world.structureVersion ?? 0}|${world.features.size}`;
  if (world._churchyards?.key === key) return world._churchyards.found;
  const found = findEnclosures(world, world.walls);
  found.graves = found.list.length ? graveSpots(world, found) : [];
  world._churchyards = { key, found };
  return found;
}

// The graves in every churchyard (see above).
function graveSpots(world, found) {
  const { w, d, dx, dy, keep } = GRAVE;
  const out = [];
  for (const yard of found.list) {
    // the churchyard's box, from its triangles (squares of half a step)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const cw = world.fine.width - 1;
    for (const k of yard.tris) {
      const cell = k >> 2, i = cell % cw, j = (cell - i) / cw;
      x0 = Math.min(x0, i / 2); x1 = Math.max(x1, (i + 1) / 2);
      y0 = Math.min(y0, j / 2); y1 = Math.max(y1, (j + 1) / 2);
    }
    for (let y = Math.ceil(y0 / dy) * dy; y + d < y1; y += dy) {
      for (let x = Math.ceil(x0 / dx) * dx; x + w < x1; x += dx) {
        if (!fits(world, found, yard.id, x, y)) continue;
        const r = hash(Math.round(x * 100), Math.round(y * 100));
        if (hash(Math.round(y * 100), Math.round(x * 100)) < EMPTY) continue;
        out.push({ x: x + (r - 0.5) * 0.02, y, kind: KINDS[Math.floor(r * KINDS.length)], h: 0.035 + (Math.floor(r * 97) % 3) * 0.008 });
      }
    }
  }
  return out;
}

// Is there room for a grave at (x, y) in churchyard `id`?
function fits(world, found, id, x, y) {
  const { w, d, keep } = GRAVE;
  const cx = x + w / 2, cy = y + d / 2;
  // inside, and far enough from the wall all round
  for (const [ox, oy] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
    if (found.at(cx + ox * (w / 2 + keep), cy + oy * (d / 2 + keep)) !== id) return false;
  }
  if (world.structureIndex.at(cx, cy).length || world.structureIndex.near(cx, cy, 0.2).length) return false;
  const s = world.structureAt(world.grid.nodeAt(cx, cy));
  if (s) return false;
  if (world.ways.edgeNear(cx, cy, 0.14, (e) => e.kind === 'path')) return false;
  const f = world.featureAt(world.grid.nodeAt(cx, cy));
  if (f && Math.hypot(f.x - cx, f.y - cy) < 0.16) return false;
  return true;
}

function hash(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
