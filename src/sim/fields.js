// Crop fields: ground closed in all round by field edges (the 'field'
// network, on the dense dots like fences – the Grain and Potatoes tools).
// Found as pastures are (sim/pastures.js findEnclosures): a road or
// railway through an edge opens the field. The edges themselves aren't
// drawn on the map – a field is only its crop (render/meadow.js grows it).
//
// Each edge carries the crop of the tool that drew it ('grain' or
// 'potatoes'); a field grows the crop most of its edges carry. Its rows run
// along its longer side.
//
// fieldsOf(world) -> { list: [{ id, tris, area, crop, along }], at(x, y) }
// (`along`: 'x' or 'y', the rows' direction; at(x, y) the field's index
// there, -1 outside), found again only when what closes or opens them
// changed.

import { findEnclosures } from './pastures.js';

export const CROPS = ['grain', 'potatoes'];

export function fieldsOf(world) {
  const nw = world.networks;
  const stamp = `${nw.field.version}|${nw.road.version}|${nw.rail.version}|${world.ways.version}`;
  if (world._fields?.stamp === stamp) return world._fields.found;
  const found = findFields(world);
  world._fields = { stamp, found };
  return found;
}

function findFields(world) {
  const found = findEnclosures(world, world.networks.field.graph);
  if (!found.list.length) return found;
  const cw = world.fine.width - 1;

  // which crop: a vote of the edges on either side of each
  const votes = found.list.map(() => new Map());
  for (const e of world.ways.edges.values()) {
    if (e.kind !== 'field') continue;
    const crop = e.crop ?? 'grain';
    for (let i = 1; i < e.pts.length; i++) {
      const [ax, ay] = e.pts[i - 1], [bx, by] = e.pts[i];
      const l = Math.hypot(bx - ax, by - ay) || 1, nx = (ay - by) / l * 0.15, ny = (bx - ax) / l * 0.15;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      for (const s of [-1, 1]) {
        const r = found.at(mx + nx * s, my + ny * s);
        if (r >= 0) votes[r].set(crop, (votes[r].get(crop) ?? 0) + l);
      }
    }
  }
  found.list.forEach((f, i) => {
    f.crop = [...votes[i]].sort((a, b) => b[1] - a[1] || CROPS.indexOf(a[0]) - CROPS.indexOf(b[0]))[0]?.[0] ?? 'grain';
    // the rows along the longer side (of the squares it covers)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const k of f.tris) {
      const cell = k >> 2, ci = cell % cw, cj = (cell - ci) / cw;
      x0 = Math.min(x0, ci); x1 = Math.max(x1, ci); y0 = Math.min(y0, cj); y1 = Math.max(y1, cj);
    }
    f.along = x1 - x0 >= y1 - y0 ? 'x' : 'y';
  });
  return found;
}
