// Forest trees. Instance fields: variant (0 = conifer, 1 = broadleaf), scale.
// Each one is a small clump of 2–4 simple trees (features/trees.js), so
// forests read as dense without a heavy drawing. Which broadleaf kinds,
// how many and where exactly come from the feature's own seed (see
// Renderer.buildFeature).

import { drawClump } from './trees.js';

export default {
  id: 'tree',
  name: 'Trees',
  clearable: true,
  blocksRoad: false,

  draw(g, f) {
    const s = f.scale ?? 1;
    const trees = [];
    for (let i = g.int(2, 4); i > 0; i--) {
      const x = g.range(-0.38, 0.38), y = g.range(-0.38, 0.38), k = g.range(0.75, 1.1);
      // mostly the forest's own kind, now and then one of the other
      const conifer = (f.variant !== 1) !== g.chance(0.15);
      if (conifer) trees.push({ x, y, kind: 'spruce', height: 0.85 * s * k });
      else trees.push({ x, y, kind: g.chance(0.6) ? 'spreading' : 'sapling', height: 0.65 * s * k });
    }
    drawClump(g, 0, 0, trees);
  },
};
