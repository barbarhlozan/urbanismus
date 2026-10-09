// Saves from before buildings were retired or split (core/legacy.js): every
// old type comes back as one that exists, the same size, and a split works
// keeps the kind it was drawn as.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unretire, upgrade } from '../src/core/legacy.js';
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
