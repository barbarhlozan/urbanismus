// One build tool per structure family (BUILD_FAMILIES, created in main.js):
// the sizes of the same thing (park / large park…) share a tool, S switches
// between them. The pointer grabs the middle of the footprint; Tab rotates,
// C tries another look. The preview shows exactly the variant that will be
// built.

import { footprintCenter, newSeed, categoryOf } from '../../structures/index.js';
import { isTouch } from '../ui/device.js';
import { keyOf } from '../ui/keys.js';
import { UNLOCKS } from '../story/unlocks.js';
import { t } from '../core/text.js';
import { nameOf, blurbOf, sizeOf } from '../ui/names.js';


export function createBuildTool({ world, camera }, defs) {
  let variant = 0;
  // quarter turns from facing the viewer (Tab): buildings come facing
  // whoever's looking, whichever way the view is turned
  let rotation = 0;
  const placed = () => (rotation + camera.facingViewer()) % 4;
  let seed = newSeed();
  const def = () => defs[variant];
  // single-dot buildings turn relative to their road (s.data.turn), except
  // those that always face it (def.facesRoad: no turning at all)
  const single = () => (def().footprint ?? [[0, 0]]).length === 1;
  const turnable = () => !def().facesRoad;
  const turn = () => (single() && turnable() ? rotation : 0);
  const rotate = () => { if (turnable()) rotation = (rotation + 1) % 4; };
  const reroll = () => { seed = newSeed(); };
  // sizes that may be built (src/story/unlocks.js); the Size button skips the rest
  const open = () => defs.filter((d) => UNLOCKS.allows(d.id));
  const resize = () => {
    for (let k = 1; k <= defs.length; k++) {
      const i = (variant + k) % defs.length;
      if (UNLOCKS.allows(defs[i].id)) return void (variant = i);
    }
  };

  return {
    id: `build:${defs[0].id}`,
    label: nameOf(defs[0]),
    blurb: blurbOf(defs[0]),
    defs,
    group: categoryOf(defs[0]),
    touchConfirm: true,

    // params: { type, rotation } picks up a copy of a built structure
    // (right-click on it)
    enter(params) {
      const i = defs.findIndex((d) => d.id === params.type && UNLOCKS.allows(d.id));
      if (i >= 0) variant = i;
      else if (!UNLOCKS.allows(def().id)) resize();
      if (params.rotation != null) rotation = (params.rotation - camera.facingViewer() + 4) % 4;
      if (params.turn != null && single()) rotation = params.turn;
    },

    snap(x, y) {
      const [cx, cy] = footprintCenter(def(), placed());
      return world.grid.nodeAt(x - cx, y - cy);
    },

    hint() {
      const name = nameOf(def());
      if (isTouch()) return t('build.tap', { name });
      return [
        t('build.click', { name }),
        turnable() && `Tab: ${t('rotate').toLowerCase()}`,
        `Space: ${t('another-look').toLowerCase()}`,
        open().length > 1 && `Shift: ${t('size').toLowerCase()}`,
        t('right-click.stop'),
      ].filter(Boolean).join(' · ');
    },

    click(node) {
      if (!UNLOCKS.allows(def().id)) return;
      const at = world.placementFor(def().id, node, placed());
      const data = turn() ? { turn: turn() } : {};
      if (world.placeStructure(def().id, at.node, { rotation: at.rotation, seed, data })) seed = newSeed();
    },

    key(e) {
      if (e.key === 'Tab') rotate();
      else if (keyOf(e) === ' ') reroll();
      else if (e.key === 'Shift' && !e.repeat && open().length > 1) resize();
      else return false;
      return true;
    },

    actions: () => [
      ...(open().length > 1 ? [{ label: `${t('size')}: ${sizeOf(def())}`, key: 'Shift', run: resize }] : []),
      ...(turnable() ? [{ label: t('rotate'), icon: 'rotate', key: 'Tab', run: rotate }] : []),
      { label: t('another-look'), icon: 'another-look', key: 'Space', run: reroll },
    ],

    overlay(kit, hover) {
      if (hover < 0) return '';
      const d = def();
      const at = world.placementFor(d.id, hover, placed());
      if (at.check.ok) {
        let out = kit.ghost(d, at.node, world.facingRotation(d.id, at.node, at.rotation, turn()), seed);
        // the track a station will lay
        if (at.check.lay) out += kit.path(at.check.lay.map((f) => world.networks.rail.dot(f)), 'preview rail', null);
        return out;
      }
      // it can't go here: still show it where it would stand, faded, with
      // a cross on each of its dots – or, where the ground is too steep to
      // build on, a steep-hill sign
      const nodes = world.footprintNodes(d.id, hover, placed());
      const ghost = nodes.includes(-1) ? '' : kit.ghost(d, hover, world.facingRotation(d.id, hover, placed(), turn()), seed, { blocked: true });
      return ghost + nodes.map((n) => (n >= 0 && world.tooSteepToBuild(n, d.id) ? kit.steep(n) : kit.cross(n))).join('');
    },
  };
}
