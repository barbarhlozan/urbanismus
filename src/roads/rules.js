// What each kind of way is, and what happens where it meets something
// else – in one place, so a new kind is a new row here rather than a
// change in every file that asks (docs/ways-fields-plan.md, step 3).
//
//   family      kinds of one family meet as one (a lane joins a road)
//   meets       where it crosses a way of another family: 'join' (a
//               junction both share: two roads, a footpath onto a road, a
//               level crossing), 'gap' (they pass without meeting: a fence
//               or a field's edge leaves a gap) or 'refuse'; its own
//               family: `self`
//   cutsFields  a crop field ends at it (sim/fields.js): a road across a
//               field makes two
//   goesRound   a building put down across it bends it round (World.detoursFor)
//   blocks      the reason a building can't stand on it (World.wayAcross),
//               null if it may
//   half        its half width, kept off a building's walls (World.wayClear;
//               roads by their lane and street, CONFIG)

export const WAY_KINDS = {
  road: { family: 'road', meets: 'join', self: 'join', cutsFields: true, goesRound: true, blocks: 'Road' },
  lane: { family: 'road', meets: 'join', self: 'join', cutsFields: true, goesRound: true, blocks: 'Road' },
  path: { family: 'path', meets: 'join', self: 'join', cutsFields: true, goesRound: true, blocks: 'Footpath', half: 'path' },
  rail: { family: 'rail', meets: 'join', self: 'refuse', cutsFields: true, goesRound: true, blocks: 'Railway', half: 0.12 },
  fence: { family: 'fence', meets: 'gap', self: 'join', cutsFields: true, goesRound: false, blocks: null, half: 0.03 },
  field: { family: 'field', meets: 'gap', self: 'join', cutsFields: false, goesRound: false, blocks: null, half: 0 },
};

const kindOf = (k) => WAY_KINDS[k] ?? { family: k, meets: 'join', self: 'join' };

// What happens where a way of kind k1 meets one of kind k2 (either order
// gives the same): 'join', 'gap' or 'refuse'. A 'gap' on either side wins.
export function crossRule(k1, k2) {
  const a = kindOf(k1), b = kindOf(k2);
  if (a.family === b.family) return a.self;
  if (a.meets === 'gap' || b.meets === 'gap') return 'gap';
  if (a.meets === 'refuse' || b.meets === 'refuse') return 'refuse';
  return 'join';
}

// The kinds with a property set: kindsWhere('cutsFields') -> ['road', …].
export function kindsWhere(prop) {
  return Object.keys(WAY_KINDS).filter((k) => WAY_KINDS[k][prop]);
}
