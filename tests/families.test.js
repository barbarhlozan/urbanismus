// Families and who runs what (sim/families.js): surnames in their three
// forms, families per home, slots filled from them, vacated and filled
// again, kept in the save and on ⌘Z.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road } from './helpers.js';
import { World } from '../src/core/world.js';
import { Families, familiesFor } from '../src/sim/families.js';
import { SURNAMES, FIRST_NAMES, familyName, personName } from '../src/core/surnames.js';
import { STRUCTURE_TYPES } from '../structures/index.js';
import { STAFF, ROLES } from '../structures/staff.js';

const at = (w, x, y) => w.grid.index(x, y);

test('every surname has its three forms, and they agree', () => {
  assert.ok(SURNAMES.size >= 60);
  for (const [key, { m, f, family }] of SURNAMES) {
    assert.ok(m && f && family, key);
    if (m.endsWith('í')) { // soft adjective: the same in every form
      assert.equal(f, m);
      assert.equal(family, m);
    } else if (m.endsWith('ý')) { // hard adjective: -á, and -í in the plural
      assert.equal(f, `${m.slice(0, -1)}á`, key);
      assert.ok(family.endsWith('í') && family.length <= m.length + 1, key);
    } else { // a noun: -ová and -ovi on the same stem
      assert.ok(f.endsWith('ová') && family.endsWith('ovi'), key);
      assert.equal(f.slice(0, -3), family.slice(0, -3), key);
      assert.ok(m.startsWith(f.slice(0, -3).slice(0, -2)), key); // (a stem may lose a vowel: Němec – Němc-)
    }
  }
  assert.equal(SURNAMES.get('kopecky').family, 'Kopečtí');
  assert.equal(SURNAMES.get('tichy').family, 'Tiší');
  assert.equal(SURNAMES.get('nemec').f, 'Němcová');
  assert.equal(personName({ first: 'Marie', sex: 'f', surname: 'novak' }), 'Marie Nováková');
  for (const sex of ['m', 'f']) assert.equal(new Set(FIRST_NAMES[sex]).size, FIRST_NAMES[sex].length);
});

test('every slot names a role, with words in both languages', async () => {
  for (const [id, roles] of Object.entries(STAFF)) {
    assert.ok(STRUCTURE_TYPES[id], id);
    for (const r of roles) assert.ok(ROLES[r], `${id}: ${r}`);
  }
  const fs = await import('node:fs');
  const words = fs.readFileSync(new URL('../text/buildings.txt', import.meta.url), 'utf8');
  for (const r of Object.keys(ROLES)) assert.match(words, new RegExp(`^staff\\.${r}\\n  cs: .+\\n  en: .+`, 'm'), r);
});

function town() {
  const w = flatWorld(30, 30);
  road(w, [1, 5], [28, 5]);
  w.history.commit();
  const fam = new Families(w);
  return { w, fam };
}

test('homes get their families, places their people from them', () => {
  const { w } = town();
  const pub = w.placeStructure('hospoda', at(w, 20, 6));
  assert.deepEqual(pub.data.staff, [{ role: 'hostinsky' }]); // nobody in town yet
  const house = w.placeStructure('house', at(w, 3, 6));
  const block = w.placeStructure('block', at(w, 8, 6));
  assert.equal(house.data.families.length, familiesFor(STRUCTURE_TYPES.house));
  assert.equal(block.data.families.length, 8);
  const names = [...house.data.families, ...block.data.families].map((f) => f.surname);
  assert.equal(new Set(names).size, names.length); // nobody shares a name while there are others
  const [keeper] = pub.data.staff;
  assert.equal(keeper.sex, 'm');
  assert.ok([house.id, block.id].includes(keeper.home));
  assert.ok(w.structures.get(keeper.home).data.families.some((f) => f.surname === keeper.surname));
  assert.ok(familyName(names[0]).length > 2);
});

test('a slot is vacated when its home goes, and filled again', () => {
  const { w } = town();
  const house = w.placeStructure('house', at(w, 3, 6));
  const pub = w.placeStructure('hospoda', at(w, 20, 6));
  assert.equal(pub.data.staff[0].home, house.id);
  w.removeStructure(house.id);
  assert.deepEqual(pub.data.staff, [{ role: 'hostinsky' }]);
  const other = w.placeStructure('house', at(w, 9, 6));
  assert.equal(pub.data.staff[0].home, other.id);
});

test('nobody runs a burnt place; a burnt home keeps its family', () => {
  const { w } = town();
  const house = w.placeStructure('house', at(w, 3, 6));
  const pub = w.placeStructure('hospoda', at(w, 20, 6));
  const family = house.data.families[0].surname;
  w.burnStructure(pub.id);
  assert.equal(pub.data.staff, undefined);
  w.burnStructure(house.id);
  assert.equal(house.data.families[0].surname, family);
});

test('families and slots are kept in the save and come back on ⌘Z', () => {
  const { w } = town();
  let house, pub;
  for (const click of [() => (house = w.placeStructure('house', at(w, 3, 6))), () => (pub = w.placeStructure('hospoda', at(w, 20, 6)))]) {
    click();
    w.history.commit();
  }
  const keeper = { ...pub.data.staff[0] };
  const back = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  new Families(back);
  assert.deepEqual(back.structures.get(pub.id).data.staff[0], keeper);
  assert.deepEqual(back.structures.get(house.id).data.families, house.data.families);

  w.removeStructure(house.id);
  w.history.commit();
  assert.ok(!pub.data.staff[0].first);
  w.history.undo();
  assert.deepEqual(w.structures.get(pub.id).data.staff[0], keeper);
});

test('a town from before families gets them once it loads', () => {
  const { w } = town();
  const house = w.placeStructure('house', at(w, 3, 6));
  delete house.data.families;
  const back = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  new Families(back);
  assert.equal(back.structures.get(house.id).data.families.length, 1);
});
