// Removes whatever is under the pointer: building, then footpath, then a
// street's sidewalks, then road, then railway, then trees. Snaps to the dense grid so footpaths between buildings can be hit.

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
    const sidewalks = world.hasRoad(node) ? world.sidewalksAt(node) : [];
    if (sidewalks.length) return { at: world.grid.xy(node), size: 0.2, run: () => world.setSidewalks(sidewalks, false) };
    if (world.hasRoad(node)) return { at: world.grid.xy(node), size: 0.2, run: () => world.removeRoadAt(node) };
    const rail = world.networks.rail.nodeAt(...point);
    if (rail >= 0 && world.rails.hasNode(rail)) {
      return { at: world.networks.rail.pos(rail), size: 0.16, run: () => world.removeNetworkAt('rail', rail) };
    }
    const f = world.featureAt(node);
    if (f) return { at: world.grid.xy(node), size: 0.2, run: () => world.removeFeature(f.id) };
    return null;
  };

  return {
    id: 'bulldoze',
    label: 'Erase',
    hotkey: 'x',
    blurb: 'Remove anything',
    touchConfirm: true,

    snap(x, y) {
      point = [x, y];
      return world.grid.nodeAt(x, y);
    },

    hint: () => isTouch()
      ? 'Tap to pick what to remove, tap again to remove it'
      : 'Click to remove a building, footpath, sidewalks, road or railway dot, or tree · right-click to stop',

    click() {
      target()?.run();
    },

    overlay(kit) {
      const t = target();
      return t ? kit.crossAt(...t.at, t.size) : '';
    },
  };
}
