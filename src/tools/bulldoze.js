// Removes whatever is under the pointer: building, then footpath, then a
// street's sidewalks, then road, then railway, then fence, then trees. Snaps to the dense grid so footpaths between buildings can be hit.

import { isTouch } from '../ui/device.js';
import { t } from '../core/text.js';
import { eraseTarget } from './erase.js';

export function createBulldozeTool({ world, renderer }) {
  let point = null;

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

    hint: () => isTouch()
      ? t('erase.tap')
      : `${t('erase.click')} · ${t('right-click.stop')}`,

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
