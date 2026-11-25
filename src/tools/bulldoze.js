// Removes whatever is under the pointer: building, then footpath, then road
// (a street with its sidewalks), then railway, then fence, then a field (the
// whole of it), then trees. Snaps to the dense grid so footpaths between buildings can be hit.
// It has no options of its own; it stands in the Build menu's box of loose
// things, with Terrain and Zpět beside it (ui/buildMenu.js).

import { t } from '../core/text.js';
import { eraseTarget } from './erase.js';
import { cellsOutline } from '../sim/fields.js';

export function createBulldozeTool(ctx) {
  const { world, renderer } = ctx;
  let point = null;
  let outline = null; // { field, loops }: the outline of the field that would go

  const target = () => eraseTarget(world, point);

  return {
    id: 'bulldoze',
    label: t('tool.erase'),
    hotkey: 'backspace', // (the letter rows pick build tools, see ui/keys.js)
    blurb: t('tool.erase.blurb'),
    touchConfirm: true,

    snap(x, y) {
      point = [x, y];
      return world.grid.nodeAt(x, y);
    },

    click() {
      target()?.run();
    },

    // What would go: a building or tree turns to the secondary colour, a
    // field shows its outline in it; the rubber goes with the pointer
    overlay(kit) {
      const t = target();
      if (renderer) renderer.erasing = t?.key ?? null;
      const rubber = point ? kit.eraserAt(...point) : '';
      if (!t) return rubber;
      let out = '';
      if (t.field) {
        if (outline?.field[0] !== t.field[0] || outline.field.length !== t.field.length) outline = { field: t.field, loops: cellsOutline(world, t.field) };
        out = outline.loops.map((loop) => kit.sketchPath(loop, 'preview field invalid')).join('');
      }
      return out + rubber;
    },

    exit() {
      if (renderer) renderer.erasing = null;
    },
  };
}
