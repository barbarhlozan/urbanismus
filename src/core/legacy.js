// Saves from before version 4, when buildings had levels and grew from one
// into the next (a residential house into apartments into a panel block).
// Each type and level is now a structure of its own: upgrade() turns a
// saved { type, level, seed } into the structure it was, keeping its look,
// and upgradeMarks() does the same for the chronicle's 'first:…' marks.

import { mulberry32 } from './random.js';

// Old type -> the structures its levels 1, 2, 3 are now. A function picks
// by the look the building had: the first pick its drawing made.
const LEVELS = {
  residential: ['house', 'apartments', 'block'],
  'residential-wide': ['house-wide', 'apartments-wide', 'block-wide'],
  business: [
    pick(['jednota', 'jednota', 'jednota', 'jednota', 'jednota', 'tuzex']), // pavilion, village, townhouse, jednota, tuzex
    'office',
    pick(['office-tower', 'office-tower', 'store', 'hotel']),               // spire, crown, store, hotel
  ],
  'business-wide': [
    pick(['jednota-wide', 'jednota-wide', 'hospoda-wide', 'jednota-wide']), // centre, inn, townhouses
    pick(['office-wide', 'office-wide', 'post-office']),                    // ribbon, district, bank
    pick(['store-wide', 'hotel-wide', 'office-tower-wide']),                // store, hotel, slab
  ],
  industrial: ['workshop-large', 'factory', 'plant'],
  'industrial-medium': ['workshop-medium', 'works-medium', 'plant-medium'],
  'industrial-small': ['workshop', 'works', 'plant-small'],
  mine: ['pit', 'colliery', 'deep-mine'],
  farm: ['farmstead', 'jzd', 'state-farm'],
  park: ['green', 'garden-park', 'pavilion-park'],
  'park-large': ['meadow', 'pond-park', 'city-park'],
  square: ['plaza', 'fountain-square', 'monument-square'],
  'square-large': ['market-square', 'fountain-square-large', 'grand-square'],
  services: [pick(['fire-house', 'police', 'health-centre']), 'fire-station', 'clinic'],
  'services-large': ['fire-station-large', 'service-centre', 'hospital'],
};

function pick(types) {
  return Object.assign((drawSeed) => types[Math.floor(mulberry32(drawSeed)() * types.length)], { first: types[0] });
}

// The seed the drawing was made from at that level (as drawSeed() was).
const oldDrawSeed = (seed, level) => (seed ^ Math.imul(level, 0x9e3779b1)) >>> 0;

// A saved structure as it is now (changed in place; unknown types are left).
export function upgrade(s) {
  const level = s.level ?? 1;
  delete s.level;
  if (s.data) {
    delete s.data.locked; // levelled by hand
    delete s.data.growth;
  }
  const to = LEVELS[s.type]?.[Math.min(level, 3) - 1];
  if (!to) return s;
  s.type = typeof to === 'function' ? to(oldDrawSeed(s.seed, level)) : to;
  // drawSeed() now mixes in 1, as level 1 did: the same look
  s.seed = (s.seed ^ Math.imul(level, 0x9e3779b1) ^ 0x9e3779b1) >>> 0;
  return s;
}

// 'first:residential:3' -> 'first:block' (and 'first:residential' ->
// 'first:house'). A pick by look can't be told from a mark: its first type.
export function upgradeMarks(marks) {
  return [...new Set(marks.map((m) => {
    const [, type, level] = /^first:([^:]+)(?::(\d+))?$/.exec(m) ?? [];
    let to = LEVELS[type]?.[(Number(level) || 1) - 1];
    if (typeof to === 'function') to = to.first;
    return to ? `first:${to}` : m;
  }))];
}
