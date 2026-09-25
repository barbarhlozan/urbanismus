// Removes whatever is under the pointer: building, then footpath, then road,
// then trees. Snaps to the dense grid so footpaths between buildings can be hit.

import { isTouch } from '../ui/device.js';

export function createBulldozeTool({ world }) {
  let point = null;

  const target = () => {
    if (!point) return null;
    const node = world.grid.nodeAt(...point);
    const fine = world.networks.path.nodeAt(...point);
    if (node < 0) return null;

    const s = world.structureAt(node);
    if (s) return { at: world.centerOf(s), size: 0.3, run: () => world.removeStructure(s.id) };
    if (fine >= 0 && world.paths.hasNode(fine)) {
      return { at: world.networks.path.pos(fine), size: 0.12, run: () => world.removeNetworkAt('path', fine) };
    }
    if (world.hasRoad(node)) return { at: world.grid.xy(node), size: 0.2, run: () => world.removeRoadAt(node) };
    const f = world.featureAt(node);
    if (f) return { at: world.grid.xy(node), size: 0.2, run: () => world.removeFeature(f.id) };
    return null;
  };

  return {
    id: 'bulldoze',
    label: 'Demolish',
    hotkey: 'x',
    touchConfirm: true,

    snap(x, y) {
      point = [x, y];
      return world.grid.nodeAt(x, y);
    },

    hint: () => isTouch()
      ? 'Tap to pick what to remove, tap again to remove it'
      : 'Click to remove a building, footpath, road dot or tree · right-click to stop',

    click() {
      target()?.run();
    },

    overlay(kit) {
      const t = target();
      return t ? kit.crossAt(...t.at, t.size) : '';
    },
  };
}
