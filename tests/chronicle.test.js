// The town's chronicle (sim/chronicle.js): firsts written once, round
// numbers of residents, a town that already stands when it starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road } from './helpers.js';
import { Chronicle } from '../src/sim/chronicle.js';
import { CONFIG } from '../src/config.js';

const texts = (c) => c.entries.map((e) => e.text);

test('firsts are written once', () => {
  const w = flatWorld();
  const c = new Chronicle(w, CONFIG);
  assert.match(texts(c)[0], /chronicle of Testov was begun/);
  road(w, [2, 5], [10, 5]);
  road(w, [2, 7], [10, 7]);
  w.placeStructure('house', w.grid.index(3, 6));
  w.placeStructure('house', w.grid.index(4, 6));
  assert.deepEqual(texts(c).slice(1), [
    'The first road was laid.',
    'The first house was built on its own, out in the fields.',
    'The second house was built.',
  ]);
  w.placeStructure('apartments-wide', w.grid.index(5, 6));
  assert.equal(texts(c).at(-1), 'The first apartments went up.');
  w.placeStructure('apartments', w.grid.index(8, 6)); // (another size of the same: no second line)
  assert.equal(texts(c).at(-1), 'The first apartments went up.');
  const s = w.placeStructure('house', w.grid.index(9, 6));
  w.convertStructure(s.id, 'block');                  // a house turned into a block: a first too
  assert.equal(texts(c).at(-1), 'The first panel block went up.');
  w.placeStructure('church', w.grid.index(7, 3));
  assert.equal(texts(c).at(-1), 'A church was built.');
});

test('the houses: the first ten each, where they stand, then round numbers', () => {
  const w = flatWorld(30, 30);
  const c = new Chronicle(w, CONFIG);
  w.placeStructure('church', w.grid.index(3, 3));
  road(w, [1, 5], [28, 5]);
  road(w, [1, 8], [28, 8]);
  for (let x = 1; x < 29; x++) w.placeStructure('house', w.grid.index(x, 6));
  const houses = texts(c).filter((t) => /house/.test(t));
  assert.equal(houses[0], 'The first house was built by the church.');
  assert.equal(houses[9].startsWith('The tenth house was built'), true);
  assert.deepEqual(houses.slice(10), ['Testov has fifteen houses now.', 'Testov has twenty houses now.']);
  // one pulled down and built again: no second line
  const last = [...w.structures.values()].at(-1);
  w.removeStructure(last.id);
  w.placeStructure('house', w.grid.index(last.node % 30, 6));
  assert.equal(texts(c).filter((t) => /house/.test(t)).length, 12);
});

test('round numbers of residents, once each', () => {
  const w = flatWorld();
  const c = new Chronicle(w, CONFIG);
  road(w, [2, 5], [12, 5]);
  for (let x = 2; x < 12; x++) w.placeStructure('apartments', w.grid.index(x, 6));
  c.update(CONFIG.chronicle.check);
  c.update(CONFIG.chronicle.check);
  const lines = texts(c).filter((t) => /residents/.test(t));
  assert.ok(lines.length >= 1);
  assert.equal(new Set(lines).size, lines.length);
});

test('a town that already stands: what is there counts as written', () => {
  const w = flatWorld();
  road(w, [2, 5], [10, 5]);
  w.placeStructure('house', w.grid.index(3, 6));
  const c = new Chronicle(w, CONFIG);
  assert.equal(c.entries.length, 1);
  w.placeStructure('house', w.grid.index(4, 6));
  // (the first house isn't written again; the second is new)
  assert.deepEqual(texts(c).slice(1), ['The second house was built.']);
});

test('an old save: levels become their own structures, keeping their look', async () => {
  const { World } = await import('../src/core/world.js');
  const { drawSeed } = await import('../structures/index.js');
  const w = flatWorld();
  road(w, [2, 5], [10, 5]);
  const json = JSON.parse(JSON.stringify(w.toJSON()));
  json.version = 3;
  json.structures = [
    { id: 90, type: 'residential', node: w.grid.index(3, 6), rotation: 0, level: 3, seed: 1234, data: { locked: true } },
    { id: 91, type: 'square', node: w.grid.index(4, 6), rotation: 0, level: 2, seed: 99, data: {} },
    { id: 92, type: 'mine', node: w.grid.index(2, 10), rotation: 0, seed: 7, data: {} },
  ];
  json.chronicle.marks = ['first:residential', 'first:residential:3', 'first:road'];
  const old = World.fromJSON(json);
  const [block, fountain, pit] = [90, 91, 92].map((id) => old.structures.get(id));
  assert.deepEqual([block.type, fountain.type, pit.type], ['block', 'fountain-square', 'pit']);
  assert.equal(drawSeed(block), (1234 ^ Math.imul(3, 0x9e3779b1)) >>> 0); // as it was drawn at level 3
  assert.equal(block.level, undefined);
  assert.deepEqual(block.data, {});
  assert.deepEqual(old.chronicle.marks, ['first:house', 'first:block', 'first:road']);
});

test('it is kept with the town', () => {
  const w = flatWorld();
  const c = new Chronicle(w, CONFIG);
  c.write('Grandma told of the mill.', 'story');
  const json = JSON.parse(JSON.stringify(w.toJSON()));
  assert.deepEqual(json.chronicle.entries.at(-1), { day: 1, text: 'Grandma told of the mill.', kind: 'story' });
});
