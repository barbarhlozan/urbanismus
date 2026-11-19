// The table of the kinds of way (roads/rules.js): what meets what.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossRule, kindsWhere } from '../src/roads/rules.js';

test('roads, footpaths and railways join; fences and field edges leave a gap; two railways never cross', () => {
  assert.equal(crossRule('road', 'path'), 'join');
  assert.equal(crossRule('road', 'lane'), 'join');
  assert.equal(crossRule('rail', 'road'), 'join'); // (a level crossing)
  assert.equal(crossRule('rail', 'rail'), 'refuse');
  assert.equal(crossRule('fence', 'road'), 'gap');
  assert.equal(crossRule('road', 'fence'), 'gap');
  assert.equal(crossRule('fence', 'fence'), 'join');
  assert.equal(crossRule('fence', 'field'), 'gap');
});

test('what cuts a field and what goes round a building', () => {
  assert.deepEqual(kindsWhere('cutsFields').sort(), ['fence', 'lane', 'path', 'rail', 'road', 'wall']);
  assert.ok(!kindsWhere('goesRound').includes('fence'));
});
