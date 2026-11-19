// The crop tools (Grain, Potatoes): a brush that paints the crop on the
// ground (World.paintCrops, sim/fields.js). Its circle goes round with the
// pointer and shows how much it covers; pressed, it paints there, and as
// long as it's held it paints wherever it's drawn – one ⌘Z step for the
// stroke, from pressing to letting go. [ and ] make it smaller and bigger.
//
// Sown next to a field of the same crop it becomes part of it, its rows
// running on as they run there; a new field's rows run the way the stroke
// went. Over the other crop it takes its place. Roads, buildings and the
// rest may be painted over: they cut the field where they stand, and the
// crop grows there again once they go.
//
// A field is taken off a whole at once by the eraser (Vymazat, erase.js).

import { t } from '../core/text.js';
import { keyOf } from '../ui/keys.js';
import { cropOfValue, alongOfValue, cropValue } from '../core/world/crops.js';

const SIZES = [0.35, 0.6, 0.9, 1.3]; // the brush's radius, world units
const STEP = 0.1;  // a stroke's points no closer than this
const TURN = 0.5;  // how far a new field's stroke goes before its rows take its way

// The size the brushes share.
let size = 1;

// A press and drag, painted as it goes and taken back in one: `paint(from,
// to)` for each piece of it (from null: the press).
function heldStroke(world, paint) {
  let last = null, before = null;
  const finish = () => {
    if (!last) return;
    last = null;
    before = null;
    world.history.letGo();
  };
  return {
    get held() { return !!last; },
    down(x, y) {
      world.history.hold();
      before = world.crops.slice();
      last = [x, y];
      paint(null, last);
    },
    start() {},
    move(x, y) {
      if (!last || Math.hypot(x - last[0], y - last[1]) < STEP) return;
      paint(last, [x, y]);
      last = [x, y];
    },
    end: finish,
    // (a second finger came: the stroke so far goes)
    cancel() {
      if (before) {
        const back = [];
        for (let c = 0; c < before.length; c++) if (world.crops[c] !== before[c]) back.push([c, before[c]]);
        world.setCrops(back);
      }
      finish();
    },
  };
}

export function createCropBrush(ctx, { crop, group }) {
  const { world, sound } = ctx;
  let at = null;       // the pointer
  let along = 'x';     // the stroke's rows
  let fresh = null;    // a new field's stroke: the squares it sowed, and how far it reached
  const radius = () => SIZES[size];

  // The way the rows run where the brush is pressed: as in the field of
  // this crop under it (most of its squares), or null – a new field.
  const rowsUnder = ([x, y]) => {
    const r = radius(), count = { x: 0, y: 0 };
    for (let dy = -r; dy <= r; dy += 0.1) {
      for (let dx = -r; dx <= r; dx += 0.1) {
        const c = dx * dx + dy * dy <= r * r ? world.cropCellAt(x + dx, y + dy) : -1;
        if (c >= 0 && cropOfValue(world.crops[c]) === crop) count[alongOfValue(world.crops[c])]++;
      }
    }
    return count.x + count.y ? (count.y > count.x ? 'y' : 'x') : null;
  };

  const stroke = heldStroke(world, (from, to) => {
    if (!from) {
      along = rowsUnder(to) ?? 'x';
      fresh = rowsUnder(to) ? null : { cells: new Set(), x0: to[0], x1: to[0], y0: to[1], y1: to[1] };
    }
    // (the brush heard while it sows)
    if (world.paintCrops(from ? [from, to] : [to], radius(), crop, { along, into: fresh?.cells })) sound?.brush();
    if (!fresh) return;
    // a new field: its rows the way the stroke has gone furthest, the
    // squares it sowed so far turned with them
    fresh.x0 = Math.min(fresh.x0, to[0]); fresh.x1 = Math.max(fresh.x1, to[0]);
    fresh.y0 = Math.min(fresh.y0, to[1]); fresh.y1 = Math.max(fresh.y1, to[1]);
    const w = fresh.x1 - fresh.x0, h = fresh.y1 - fresh.y0;
    const way = Math.max(w, h) < TURN ? along : w >= h ? 'x' : 'y';
    if (way === along) return;
    along = way;
    const v = cropValue(crop, along);
    world.setCrops([...fresh.cells].filter((c) => cropOfValue(world.crops[c]) === crop).map((c) => [c, v]));
  });

  return {
    id: crop,
    group,
    blurb: t(`tool.${crop}.blurb`),
    label: t(`tool.${crop}`),
    fineGrid: true,
    sketch: stroke,

    snap(x, y) {
      at = [x, y];
      return world.grid.nodeAt(x, y);
    },

    enter() { stroke.end(); },
    exit() { stroke.end(); },

    // (the press has painted already; a click with no press – from the
    // keyboard or the like – paints a dab)
    click() {
      if (!stroke.held && at && world.paintCrops([at], radius(), crop, { along: rowsUnder(at) ?? 'x' })) sound?.brush();
    },

    key(e) {
      const k = { '[': -1, ']': 1 }[keyOf(e)]; // (by the key's place: ú ) on a Czech keyboard)
      if (!k) return false;
      size = Math.max(0, Math.min(SIZES.length - 1, size + k));
      return true;
    },

    // its circle, the same pen stroke wherever it goes
    cursor(kit) {
      return at ? kit.ringAt(...at, radius(), 'brush', 7 + size) : '';
    },
  };
}
