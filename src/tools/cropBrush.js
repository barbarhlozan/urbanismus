// The crop tools (Grain, Potatoes): a brush that paints the crop on the
// ground (World.paintCrops, sim/fields.js). A tap sows a dab, a drag sows
// along the stroke – one ⌘Z step each, laid on release. Sown next to a
// field of the same crop it becomes part of it; over the other crop it
// takes its place. The Gumovat button turns the brush to
// clearing the crop instead. Roads, buildings and the rest may be painted
// over: they cut the field where they stand, and the crop grows there
// again once they go.

import { t } from '../core/text.js';

const BRUSH = 0.6; // its radius, world units
const STEP = 0.1;  // a stroke's points no closer than this

export function createCropBrush(ctx, { crop, group }) {
  const { world } = ctx;
  let at = null;      // the pointer
  let stroke = null;  // being dragged: its points
  let clearing = false;

  const sowing = () => (clearing ? null : crop);
  const paint = (pts) => world.paintCrops(pts, BRUSH, sowing());

  return {
    id: crop,
    group,
    blurb: t(`tool.${crop}.blurb`),
    label: t(`tool.${crop}`),
    fineGrid: true,

    sketch: {
      start(x, y) { stroke = [[x, y]]; },
      move(x, y) {
        if (!stroke) return;
        const last = stroke.at(-1);
        if (Math.hypot(x - last[0], y - last[1]) >= STEP) stroke.push([x, y]);
      },
      end() {
        if (stroke) paint(stroke);
        stroke = null;
      },
      cancel() { stroke = null; },
    },

    snap(x, y) {
      at = [x, y];
      return world.grid.nodeAt(x, y);
    },

    enter() { stroke = null; },
    exit() { stroke = null; clearing = false; },

    click() {
      if (at) paint([at]);
    },

    actions: () => [{ label: t(clearing ? 'crop.sow' : 'crop.clear'), on: clearing, run: () => { clearing = !clearing; } }],

    overlay(kit) {
      let out = '';
      const cls = sowing() ? 'hover' : 'hover clearing';
      if (stroke) {
        if (stroke.length > 1) out += kit.sketchPath(stroke, `preview field brush${sowing() ? '' : ' invalid'}`);
        out += kit.ringAt(...stroke.at(-1), BRUSH, cls);
        return out;
      }
      if (at) out += kit.ringAt(...at, BRUSH, cls);
      return out;
    },
  };
}
