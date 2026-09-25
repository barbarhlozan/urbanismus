// One build tool per structure definition (created in main.js).
// The pointer grabs the middle of the footprint; Tab rotates, C tries
// another look. The preview shows exactly the variant that will be built.

import { footprintCenter, newSeed, categoryOf } from '../../structures/index.js';
import { isTouch } from '../ui/device.js';

export function createBuildTool({ world }, def) {
  let rotation = 0;
  let seed = newSeed();
  const rotate = () => { rotation = (rotation + 1) % 4; };
  const reroll = () => { seed = newSeed(); };

  return {
    id: `build:${def.id}`,
    label: def.name,
    hotkey: def.hotkey,
    group: categoryOf(def),
    touchConfirm: true,

    snap(x, y) {
      const [cx, cy] = footprintCenter(def, rotation);
      return world.grid.nodeAt(x - cx, y - cy);
    },

    hint: () => isTouch()
      ? `Tap a dot to preview, tap again to place ${def.name.toLowerCase()}`
      : `Click to place ${def.name.toLowerCase()} · Tab: rotate · C: another look · right-click to stop`,

    click(node) {
      if (world.placeStructure(def.id, node, { rotation, seed })) seed = newSeed();
    },

    key(e) {
      if (e.key === 'Tab') rotate();
      else if (e.key.toLowerCase() === 'c') reroll();
      else return false;
      return true;
    },

    actions: () => [
      { label: 'Rotate', key: 'Tab', run: rotate },
      { label: 'Another look', key: 'C', run: reroll },
    ],

    overlay(kit, hover) {
      if (hover < 0) return '';
      if (world.canPlaceStructure(def.id, hover, rotation).ok) {
        let out = kit.ghost(def, hover, world.facingRotation(def.id, hover, rotation), 1, seed);
        const r = def.levels[0].coverage;
        if (r) {
          // service area: everything within r dots of the footprint
          const pts = world.footprintNodes(def.id, hover, rotation).map((n) => world.grid.xy(n));
          const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
          out += kit.groundRect(Math.min(...xs) - r - 0.5, Math.min(...ys) - r - 0.5, Math.max(...xs) + r + 0.5, Math.max(...ys) + r + 0.5);
        }
        return out;
      }
      return world.footprintNodes(def.id, hover, rotation).map((n) => kit.cross(n)).join('');
    },
  };
}
