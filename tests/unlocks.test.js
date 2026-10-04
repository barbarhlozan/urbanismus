// What may be built (story/unlocks.js): the file's rules and the story's
// unlocks on top.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road } from './helpers.js';
import { UNLOCKS, parseUnlocks, resolveScheme } from '../src/story/unlocks.js';
import { parseStory } from '../src/story/script.js';
import { CONFIG } from '../src/config.js';

const rules = (text) => {
  const { rules, errors } = parseUnlocks(text);
  assert.deepEqual(errors, []);
  UNLOCKS.setBase(rules);
};

beforeEach(() => {
  UNLOCKS.setWorld(flatWorld());
  UNLOCKS.setBase([]);
});

test('everything is open unless locked', () => {
  assert.equal(UNLOCKS.allows('castle'), true);
  assert.equal(UNLOCKS.allowsNetwork('rail'), true);
});

test('the last line that matches wins', () => {
  rules(`
    lock all
    unlock road
    unlock residential
    lock block
    unlock block_wide
  `);
  assert.equal(UNLOCKS.allows('castle'), false);
  assert.equal(UNLOCKS.allowsNetwork('road'), true);
  assert.equal(UNLOCKS.allowsNetwork('path'), false);
  assert.equal(UNLOCKS.allows('house'), true);       // (by its tag)
  assert.equal(UNLOCKS.allows('apartments-wide'), true);
  assert.equal(UNLOCKS.allows('block'), false);      // (by its name: every size)
  assert.equal(UNLOCKS.allows('block-wide'), true);  // one size, by its id
});

test('groups, by id, label or old name, and sizes', () => {
  rules('lock landmarks\nlock fountain_square_large\nlock deep-mine\nunlock chapel');
  assert.equal(UNLOCKS.allows('castle'), false);
  assert.equal(UNLOCKS.allows('chapel'), true);
  assert.equal(UNLOCKS.allows('fountain-square'), true);
  assert.equal(UNLOCKS.allows('fountain-square-large'), false);
  assert.equal(UNLOCKS.allows('colliery'), true);
  assert.equal(UNLOCKS.allows('deep-mine'), false);
  rules('lock Národní výbor');
  assert.equal(UNLOCKS.allows('office-tower-wide'), false);
  assert.equal(UNLOCKS.allows('post-office'), true);
  rules('lock Občanská vybavenost\nunlock hospoda');
  assert.equal(UNLOCKS.allows('jednota'), false);
  assert.equal(UNLOCKS.allows('school'), false);
  assert.equal(UNLOCKS.allows('hospoda'), true);
  assert.equal(UNLOCKS.allows('plaza'), true);
  rules('lock public');
  assert.equal(UNLOCKS.allows('plaza'), false);
  assert.equal(UNLOCKS.allows('house'), true);
});

test('tools: a family needs one open size, networks their own', () => {
  rules('lock station\nlock station_main\nlock lane');
  const family = { defs: [{ id: 'station' }, { id: 'station-main' }, { id: 'stop' }] };
  assert.equal(UNLOCKS.allowsTool(family), true);
  rules('lock station\nlock station_main\nlock stop');
  assert.equal(UNLOCKS.allowsTool(family), false);
  assert.equal(UNLOCKS.allowsTool({ id: 'lane' }), true);
  rules('lock lane');
  assert.equal(UNLOCKS.allowsTool({ id: 'lane' }), false);
  assert.equal(UNLOCKS.allowsTool({ id: 'bulldoze' }), true);
});

test('the story unlocks on top of the file, kept with the town', () => {
  const w = flatWorld();
  UNLOCKS.setWorld(w);
  rules('lock railway');
  UNLOCKS.apply(true, 'Railway');
  assert.equal(UNLOCKS.allowsNetwork('rail'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(w.toJSON())).story.unlocks, [{ unlock: true, name: 'railway' }]);
});

test('mistakes: what is not a line, what is not a name', () => {
  assert.equal(parseUnlocks('unlcok road').errors.length, 1);
  assert.equal(UNLOCKS.known('castle'), true);
  assert.equal(UNLOCKS.known('block_wide'), true);
  assert.equal(UNLOCKS.known('residential_panel_block'), false); // levels are gone
  assert.equal(UNLOCKS.known('footpaths'), true);
  assert.equal(UNLOCKS.known('spaceport'), false);
});

test('unlock and lock in a branch', () => {
  const { branches, errors } = parseStory('::A::\nunlock station\nlock block\nGrandma: hi');
  assert.deepEqual(errors, []);
  assert.deepEqual(branches.get('a').steps.map((s) => [s.kind, s.unlock, s.name]).slice(0, 2), [['unlock', true, 'station'], ['unlock', false, 'block']]);
});

test('the buttons at the top: by name or all together, not with `all`', () => {
  rules('lock all\nlock debug');
  assert.equal(UNLOCKS.allowsControl('debug'), false);
  assert.equal(UNLOCKS.allowsControl('chronicle'), true);
  assert.equal(UNLOCKS.allowsTool({ id: 'photo' }), true);
  rules('lock controls\nunlock chronicle');
  assert.equal(UNLOCKS.allowsControl('assets'), false);
  assert.equal(UNLOCKS.allowsControl('chronicle'), true);
  assert.equal(UNLOCKS.allowsTool({ id: 'photo' }), false);
  assert.equal(UNLOCKS.known('new map'), true);
});

test('the colour scheme line', () => {
  assert.deepEqual(resolveScheme('Night'), { choice: 2 });
  assert.deepEqual(resolveScheme('black-pen'), { choice: 1 });
  assert.deepEqual(resolveScheme('1'), { choice: 0 });
  assert.deepEqual(resolveScheme('custom'), { choice: 'custom' });
  assert.deepEqual(resolveScheme('#000 #fff #888'), { bg: '#000000', main: '#ffffff', detail: '#888888' });
  assert.equal(resolveScheme('Sepia'), null);
  const { scheme, errors } = parseUnlocks('scheme Night\nlock debug\nscheme Countryside');
  assert.deepEqual(errors, []);
  assert.equal(scheme.value, 'Countryside');
  assert.equal(parseUnlocks('scheme Sepia').errors.length, 1);
});

test('traffic: cars, trucks and buses, each on its own, not with `all`', () => {
  rules('lock all\nlock cars');
  assert.equal(UNLOCKS.allowsVehicle('cars'), false);
  assert.equal(UNLOCKS.allowsVehicle('trucks'), true);
  rules('lock vehicles\nunlock bus');
  assert.equal(UNLOCKS.allowsVehicle('buses'), true);
  assert.equal(UNLOCKS.allowsVehicle('trucks'), false);
  assert.equal(UNLOCKS.known('lorries'), true);
});

test('no cars: nobody drives, car parks stand empty; no trucks: industry keeps none', async () => {
  const { AgentSystem } = await import('../src/sim/agents.js');
  const { ParkingSystem } = await import('../src/sim/parking.js');
  const w = flatWorld(30, 30);
  UNLOCKS.setWorld(w);
  const parking = new ParkingSystem(w);
  const agents = new AgentSystem(w, CONFIG, parking);
  road(w, [1, 5], [28, 5]);
  const home = w.placeStructure('house', w.grid.index(2, 6));
  const shop = w.placeStructure('jednota', w.grid.index(26, 6));
  const works = w.placeStructure('workshop-large', w.grid.index(12, 6));
  assert.ok(home && shop && works);
  for (const s of [home, shop, works]) agents.sync(s);
  parking.spots.set(shop.id, [[26, 6], [26.2, 6]]);
  shop.data.parked = 2;
  const trucks = () => [...agents.agents.values()].filter((a) => a.truck).length;
  assert.ok(trucks() > 0);
  assert.equal(parking.count(shop), 2);

  rules('lock cars\nlock trucks');
  agents.followVehicles();
  assert.equal(trucks(), 0);
  assert.equal(parking.count(shop), 0);
  for (let i = 0; i < 40; i++) {
    const plan = agents.planCommute(home, shop);
    assert.notEqual(plan?.mode, 'drive');
  }
  assert.equal(agents.planLeave(home), null); // no car, and no bus or train from here

  rules('');
  agents.followVehicles();
  assert.ok(trucks() > 0);
  assert.equal(parking.count(shop), 2); // the lot's count was kept
});
