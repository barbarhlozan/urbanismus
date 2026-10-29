// Saves from before buildings were retired or split (core/legacy.js): every
// old type comes back as one that exists, the same size, and a split works
// keeps the kind it was drawn as.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unretire, upgrade, regroup, rehouse, refarm, repark } from '../src/core/legacy.js';
import { STRUCTURE_TYPES, kindShown } from '../structures/index.js';

const OLD = { 'service-centre': 4, tuzex: 1, workshop: 1, works: 1, 'plant-small': 1, 'workshop-medium': 2, 'works-medium': 2, 'plant-medium': 2, 'workshop-large': 6, factory: 6, plant: 6 };

test('retired and split types load as ones that exist, the same size', () => {
  for (const [type, dots] of Object.entries(OLD)) {
    const seen = new Set();
    for (let seed = 1; seed < 400; seed++) {
      const s = unretire({ type, seed, data: { turn: 1 } });
      const def = STRUCTURE_TYPES[s.type];
      assert.ok(def, `${type} -> ${s.type}`);
      assert.equal(def.footprint.length, dots, `${type} -> ${s.type}`);
      assert.equal(s.data.turn, 1);
      if (s.data.kind) assert.equal(kindShown(def, s), s.data.kind);
      seen.add(s.type);
    }
    assert.ok(seen.size >= 1);
  }
});

test('an old factory drawn as a spinning mill is a spinning mill', () => {
  // find a seed whose old pick was 'mill' (index 3 of five)
  for (let seed = 1; seed < 400; seed++) {
    const s = unretire({ type: 'factory', seed, data: {} });
    if (s.data.kind === 'spinning') return assert.equal(s.type, 'textilka');
  }
  assert.fail('no seed gave a mill');
});

test('saves from before version 4 go through both steps', () => {
  const s = unretire(upgrade({ type: 'industrial', level: 3, seed: 12345, data: {} }));
  assert.ok(STRUCTURE_TYPES[s.type]);
  assert.equal(STRUCTURE_TYPES[s.type].footprint.length, 6);
});

test('types that stay are left alone', () => {
  assert.equal(unretire({ type: 'house', seed: 5, data: {} }).type, 'house');
});

test('parks of before version 5 go to the tool their look belongs to, the same size', () => {
  const OLD_PARKS = { green: 1, meadow: 4, 'garden-park': 1, 'pavilion-park': 1, 'city-park': 4 };
  for (const [type, dots] of Object.entries(OLD_PARKS)) {
    for (let seed = 1; seed < 200; seed++) {
      const s = repark(regroup({ type, seed, data: { turn: 1 } }));
      const def = STRUCTURE_TYPES[s.type];
      assert.ok(def, `${type} -> ${s.type}`);
      assert.equal(def.footprint.length, dots, `${type} -> ${s.type}`);
      assert.equal(s.data.turn, 1);
      if (s.data.kind) assert.ok(def.kinds.includes(s.data.kind), `${s.type} ${s.data.kind}`);
    }
  }
  // a look the player chose wins over the seed
  assert.equal(regroup({ type: 'green', seed: 1, data: { kind: 'pitch' } }).type, 'pitch');
  assert.deepEqual(regroup({ type: 'meadow', seed: 1, data: { kind: 'woods' } }), { type: 'meadow', seed: 1, data: { kind: 'woods' } }); // (a meadow since version 9)
  assert.equal(regroup({ type: 'meadow', seed: 1, data: { kind: 'forest' } }).type, 'forest-park');
});

test('houses of before version 6 keep their look under the tool it belongs to now', () => {
  const OLD_HOUSE = ['cube', 'cube', 'street', 'street', 'farm', 'villa', 'mansard', 'farmstead', 'farmstead'];
  const NOW = { cube: 'family-house', villa: 'family-house', mansard: 'family-house', street: 'house', farm: 'house', farmstead: 'house' };
  const seen = new Set();
  for (let seed = 1; seed < 400; seed++) {
    const was = kindShown({ kinds: OLD_HOUSE }, { seed, data: {} });
    const s = rehouse({ type: 'house', seed, data: { turn: 2 } });
    const def = STRUCTURE_TYPES[s.type];
    assert.equal(s.type, NOW[was]);
    assert.equal(def.footprint.length, 1);
    assert.equal(s.data.turn, 2);
    assert.equal(kindShown(def, s), was === 'mansard' ? 'villa' : was);
    seen.add(s.type);
  }
  assert.equal(seen.size, 2);
  // terraced rows become the farmstead with a barn, the rest stay
  assert.deepEqual(rehouse({ type: 'house-wide', seed: 1, data: { kind: 'row' } }), { type: 'house-wide', seed: 1, data: { kind: 'barn' } });
  assert.deepEqual(unretire({ type: 'family-house-wide', seed: 1, data: { kind: 'row' } }), { type: 'house-wide', seed: 1, data: { kind: 'barn' } });
  assert.deepEqual(rehouse({ type: 'house-wide', seed: 1, data: { kind: 'longhouse' } }), { type: 'house-wide', seed: 1, data: { kind: 'longhouse' } });
  assert.deepEqual(rehouse({ type: 'apartments', seed: 1, data: {} }), { type: 'apartments', seed: 1, data: {} });
});

test('farmsteads of before version 7 keep the layout they had', () => {
  assert.deepEqual(refarm({ type: 'farmstead', seed: 3, data: {} }), { type: 'farmstead', seed: 3, data: { kind: 'three-sided' } });
  assert.equal(kindShown(STRUCTURE_TYPES.farmstead, refarm({ type: 'farmstead', seed: 9, data: {} })), 'three-sided');
  assert.deepEqual(refarm({ type: 'jzd', seed: 3, data: {} }), { type: 'jzd', seed: 3, data: {} });
});

test('parks and squares of before version 9 keep their size, each look to the kind nearest it', () => {
  const OLD = { meadow: 4, 'garden-park': 1, 'garden-park-large': 4, 'pond-park': 4, plaza: 1, 'fountain-square': 1,
    'monument-square': 1, precinct: 1, 'market-square': 4, 'fountain-square-large': 4, 'grand-square': 4, 'parade-square': 4 };
  for (const [type, dots] of Object.entries(OLD)) {
    for (let seed = 1; seed < 100; seed++) {
      const s = repark({ type, seed, data: { turn: 1 } });
      const def = STRUCTURE_TYPES[s.type];
      assert.ok(def, `${type} -> ${s.type}`);
      assert.equal(def.footprint.length, dots, `${type} -> ${s.type}`);
      assert.equal(s.data.turn, 1);
      if (s.data.kind) assert.ok(def.kinds.includes(s.data.kind), `${s.type} ${s.data.kind}`);
    }
  }
  assert.deepEqual(repark({ type: 'meadow', seed: 1, data: { kind: 'woods' } }), { type: 'meadow', seed: 1, data: { kind: 'meadow' } });
  assert.deepEqual(repark({ type: 'pond-park', seed: 1, data: { kind: 'bridge' } }), { type: 'pond-park', seed: 1, data: { kind: 'fire-pond' } });
  assert.deepEqual(repark({ type: 'grand-square', seed: 1, data: { kind: 'pair' } }), { type: 'market-square', seed: 1, data: { kind: 'column' } });
  assert.deepEqual(repark({ type: 'green', seed: 1, data: {} }), { type: 'green', seed: 1, data: {} });
});
