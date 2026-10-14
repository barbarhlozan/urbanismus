// Removes whatever is under the pointer: building, then footpath, then a
// street's sidewalks, then road, then railway, then fence, then trees. Snaps to the dense grid so footpaths between buildings can be hit.
// Its one option is Terrain, the contour lines (tools/terrain.js).

import { t } from '../core/text.js';
import { eraseTarget } from './erase.js';
import { terrainOption } from './terrain.js';

export function createBulldozeTool(ctx) {
  const { world, renderer } = ctx;
  let point = null;

  const target = () => eraseTarget(world, point);

  return {
    id: 'bulldoze',
    label: t('tool.erase'),
    hotkey: 'backspace', // (the letter rows pick build tools, see ui/keys.js)
    blurb: t('tool.erase.blurb'),
    touchConfirm: true,

    actions: () => terrainOption(ctx),

    snap(x, y) {
      point = [x, y];
      return world.grid.nodeAt(x, y);
    },

    click() {
      target()?.run();
    },

    // What would go: a building or tree turns to the secondary colour, and
    // the eraser pops up over it (a road, path or rail dot just gets the eraser)
    overlay(kit) {
      const t = target();
      if (renderer) renderer.erasing = t?.key ?? null;
      return t ? kit.eraserAt(...t.at, t.size) : '';
    },

    exit() {
      if (renderer) renderer.erasing = null;
    },
  };
}
