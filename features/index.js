// Environment feature registry (trees now; rocks, bushes, fields… later).
// Features are natural objects placed on the map by the terrain generator.
//
//   clearable   true  -> roads and buildings remove it automatically
//   blocksRoad  true  -> roads can't pass (only meaningful if not clearable)

import tree from './tree.js';

export const FEATURES = [tree];

export const FEATURE_TYPES = Object.fromEntries(FEATURES.map((f) => [f.id, f]));
