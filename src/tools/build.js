// One build tool per structure family (BUILD_FAMILIES, created in main.js):
// the sizes of the same thing (park / large park…) share a tool, S switches
// between them. The pointer grabs the middle of the footprint; Tab rotates,
// C tries another look. The preview shows exactly the variant that will be
// built.

import { footprintCenter, newSeed, categoryOf } from '../../structures/index.js';
import { isTouch } from '../ui/device.js';
import { keyOf } from '../ui/keys.js';

// Label of a variant for the Size button: its own `size`, else by footprint.
const sizeOf = (def) => def.size ?? (def.footprint.length > 1 ? 'Large' : 'Small');

export function createBuildTool({ world }, defs) {
  let variant = 0;
  let rotation = 0;
  let seed = newSeed();
  const def = () => defs[variant];
  const rotate = () => { rotation = (rotation + 1) % 4; };
  const reroll = () => { seed = newSeed(); };
  const resize = () => { variant = (variant + 1) % defs.length; };

  return {
    id: `build:${defs[0].id}`,
    label: defs[0].name,
    blurb: defs[0].blurb ?? '',
    defs,
    hotkey: defs[0].hotkey,
    // every variant keeps its own key; pressing it picks that variant
    hotkeys: defs.map((d) => d.hotkey).filter(Boolean),
    group: categoryOf(defs[0]),
    touchConfirm: true,

    // params: { hotkey } picks that variant; { type, rotation } picks up a
    // copy of a built structure (right-click on it)
    enter(params) {
      const i = defs.findIndex((d) => (d.hotkey && d.hotkey === params.hotkey) || d.id === params.type);
      if (i >= 0) variant = i;
      if (params.rotation != null) rotation = params.rotation;
    },

    snap(x, y) {
      const [cx, cy] = footprintCenter(def(), rotation);
      return world.grid.nodeAt(x - cx, y - cy);
    },

    hint() {
      const name = def().name.toLowerCase();
      if (isTouch()) return `Tap a dot to preview, tap again to place ${name}`;
      return `Click to place ${name} · Tab: rotate · C: another look${defs.length > 1 ? ' · S: size' : ''} · right-click to stop`;
    },

    click(node) {
      const at = world.placementFor(def().id, node, rotation);
      if (world.placeStructure(def().id, at.node, { rotation: at.rotation, seed })) seed = newSeed();
    },

    key(e) {
      if (e.key === 'Tab') rotate();
      else if (keyOf(e) === '.') reroll();
      else if (e.key === 'Shift' && !e.repeat && defs.length > 1) resize();
      else return false;
      return true;
    },

    actions: () => [
      ...(defs.length > 1 ? [{ label: `Size: ${sizeOf(def())}`, key: 'Shift', run: resize }] : []),
      { label: 'Rotate', key: 'Tab', run: rotate },
      { label: 'Another look', key: '.', run: reroll },
    ],

    overlay(kit, hover) {
      if (hover < 0) return '';
      const d = def();
      const at = world.placementFor(d.id, hover, rotation);
      if (at.check.ok) {
        let out = kit.ghost(d, at.node, world.facingRotation(d.id, at.node, at.rotation), 1, seed);
        const r = d.levels[0].coverage;
        if (r) {
          // service area: everything within r dots of the footprint
          const pts = world.footprintNodes(d.id, hover, rotation).map((n) => world.grid.xy(n));
          const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
          out += kit.groundRect(Math.min(...xs) - r - 0.5, Math.min(...ys) - r - 0.5, Math.max(...xs) + r + 0.5, Math.max(...ys) + r + 0.5);
        }
        return out;
      }
      return world.footprintNodes(d.id, hover, rotation).map((n) => kit.cross(n)).join('');
    },
  };
}
