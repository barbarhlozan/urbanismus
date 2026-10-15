// The Terrain option: the contour lines, offered in the dock beside the
// options of every tool that changes the town (build, network, Erase) –
// the ground's shape matters most while building. It's the player's
// setting, not the tool's: switched on, the lines stay on across tools and
// with nothing in hand, until switched off (main.js keeps it, remembered
// in this browser). Shown pressed while on; left out while story/unlocks.txt
// keeps Terrain locked.

import { UNLOCKS } from '../story/unlocks.js';
import { t } from '../core/text.js';

// ctx.contours: { on() -> bool, toggle() } (main.js); without it, no option
export function terrainOption({ contours }) {
  if (!contours || !UNLOCKS.allowsControl('terrain')) return [];
  return [{ label: t('terrain'), icon: 'terrain', on: contours.on(), run: contours.toggle }];
}
