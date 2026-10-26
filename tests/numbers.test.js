// House numbers (World.numberStructure): every building gets the next one,
// open ground none; a number gone with its building isn't given again,
// ⌘Z takes back the one it undoes, and the save keeps them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road } from './helpers.js';
import { World } from '../src/core/world.js';

const at = (w, x, y) => w.grid.index(x, y);

function steps(w, ...clicks) {
  for (const click of clicks) {
    click();
    w.history.commit();
  }
}

test('buildings are numbered in the order they are built, open ground is not', () => {
  const w = flatWorld();
  road(w, [2, 5], [16, 5]);
  const a = w.placeStructure('house', at(w, 3, 6));
  const park = w.placeStructure('green', at(w, 6, 6));
  const b = w.placeStructure('hospoda', at(w, 9, 6));
  assert.equal(a.no, 1);
  assert.equal(park.no, undefined);
  assert.equal(b.no, 2);
  assert.equal(w.structureByNo(2), b);
  assert.equal(w.structureByNo(3), null);
});

test("a demolished building's number is not given again", () => {
  const w = flatWorld();
  road(w, [2, 5], [16, 5]);
  const a = w.placeStructure('house', at(w, 3, 6));
  w.placeStructure('house', at(w, 6, 6));
  w.removeStructure(a.id);
  assert.equal(w.placeStructure('house', at(w, 9, 6)).no, 3);
});

test('undo takes back the number of what it undoes, redo gives it again', () => {
  const w = flatWorld();
  road(w, [2, 5], [16, 5]);
  w.history.commit();
  let house;
  steps(w, () => w.placeStructure('house', at(w, 3, 6)), () => (house = w.placeStructure('house', at(w, 6, 6))));
  assert.equal(house.no, 2);
  w.history.undo();
  assert.equal(w.nextNo, 2);
  assert.equal(w.placeStructure('house', at(w, 9, 6)).no, 2); // no gap left
  w.history.commit();
  w.history.undo();
  w.history.undo();
  assert.equal(w.nextNo, 1);
  w.history.redo();
  assert.equal(w.structureByNo(1)?.node, at(w, 3, 6));
  assert.equal(w.nextNo, 2);

  // a demolition undone: the building comes back with its number
  const s = w.structureByNo(1);
  steps(w, () => w.removeStructure(s.id));
  w.history.undo();
  assert.equal(w.structureByNo(1)?.id, s.id);
  assert.equal(w.nextNo, 2);
});

test('the save keeps the numbers; an older save is numbered in build order', () => {
  const w = flatWorld();
  road(w, [2, 5], [16, 5]);
  const a = w.placeStructure('house', at(w, 3, 6));
  const b = w.placeStructure('house', at(w, 6, 6));
  w.removeStructure(a.id);
  const back = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(back.structureByNo(2)?.id, b.id);
  assert.equal(back.nextNo, 3);

  const old = JSON.parse(JSON.stringify(w.toJSON()));
  delete old.nextNo;
  for (const s of old.structures) delete s.no;
  const upgraded = World.fromJSON(old);
  assert.equal(upgraded.structureByNo(1)?.id, b.id);
  assert.equal(upgraded.nextNo, 2);
});

test('people sent from houses go there, stay a while and come home', async () => {
  const { AgentSystem } = await import('../src/sim/agents.js');
  const { CONFIG } = await import('../src/config.js');
  const { UNLOCKS } = await import('../src/story/unlocks.js');
  const w = flatWorld(30, 30);
  UNLOCKS.setWorld(w);
  road(w, [1, 5], [28, 5]);
  const homes = [3, 6, 9].map((x) => w.placeStructure('house', at(w, x, 6)));
  const pub = w.placeStructure('hospoda', at(w, 20, 6));
  const agents = new AgentSystem(w, CONFIG);
  const theirs = [...agents.agents.values()].filter((a) => homes.some((h) => h.id === a.home));
  for (const a of theirs) a.timer = 1e9; // (nobody goes anywhere of their own accord)

  const { sent, missed } = agents.send([...homes, pub], pub);
  assert.equal(sent, theirs.length);
  assert.deepEqual(missed.map((m) => m.why), ['already there']);

  const seen = new Set();
  for (let t = 0; t < 400 && theirs.some((a) => !seen.has(a.id) || a.state !== 'home'); t += 0.25) {
    agents.update(0.25);
    for (const a of theirs) {
      if (a.state === 'home' && seen.has(a.id)) a.timer = 1e9; // (home: stays in)
      if (a.state === 'away') {
        assert.equal(a.trip.dest, pub.id);
        seen.add(a.id);
      }
    }
  }
  assert.equal(seen.size, theirs.length); // all got there…
  assert.ok(theirs.every((a) => a.state === 'home')); // …and are home again
});

// ----- the story: pick, {name}, exists( ), send, burn -----

const STORY = `
if house >= 3 and not seen(Fire) trigger Fire

::Fire::
pick farm = oldest house
pick pub = nearest hospoda to farm
pick other = random house
send farm, other -> pub
Grandma: The folks from {farm} and {other} went down to {pub}.
burn farm
if exists(farm) -> Saved
chronicle: Č. p. {farm} burned down in the night.
::Saved::
Grandma: It stood.
`;

async function storyTown() {
  const { AgentSystem } = await import('../src/sim/agents.js');
  const { Storyteller } = await import('../src/story/storyteller.js');
  const { Chronicle } = await import('../src/sim/chronicle.js');
  const { CONFIG } = await import('../src/config.js');
  const { UNLOCKS } = await import('../src/story/unlocks.js');
  const w = flatWorld(30, 30);
  UNLOCKS.setWorld(w);
  road(w, [1, 5], [28, 5]);
  const homes = [3, 6, 9].map((x) => w.placeStructure('house', at(w, x, 6)));
  const pub = w.placeStructure('hospoda', at(w, 20, 6));
  w.history.commit();
  const agents = new AgentSystem(w, CONFIG);
  const said = [];
  const dialogue = { say: async (who, text) => said.push(`${who}: ${text}`), choose: async () => 0, close: () => {} };
  globalThis.fetch = async (url) => new Response(String(url).includes('unlocks') ? '' : STORY);
  const chronicle = new Chronicle(w, CONFIG);
  const story = new Storyteller({ world: w, agents, dialogue, chronicle, config: CONFIG });
  await story.load();
  return { w, homes, pub, agents, story, chronicle, said, CONFIG };
}

test('the story picks buildings, sends their people, burns one', async () => {
  const { w, homes, pub, agents, story, chronicle, said, CONFIG } = await storyTown();
  assert.deepEqual(said, []); // (no mistakes in it)
  story.update(CONFIG.story.check);
  for (let i = 0; i < 20 && story.telling; i++) await new Promise((r) => setTimeout(r, 0));

  const { farm, pub: picked, other } = w.story.places;
  assert.equal(farm, 1);
  assert.equal(picked, pub.no);
  assert.ok(other === 2 || other === 3); // not the farm again
  assert.deepEqual(said, [`Grandma: The folks from 1 and ${other} went down to ${pub.no}.`]); // (not saved: it burnt)
  assert.equal(chronicle.entries.at(-1).text, 'Č. p. 1 burned down in the night.');

  // the farm is a ruin: still there with its number, nobody in it, counted for nothing
  const ruin = w.structureByNo(1);
  assert.equal(ruin.id, homes[0].id);
  assert.ok(ruin.ruin);
  assert.ok(![...agents.agents.values()].some((a) => a.home === ruin.id));
  assert.equal(story.variables().get('house'), 2);
  assert.equal(story.variables().get('ruins'), 1);
  // the other went to the pub
  assert.ok([...agents.agents.values()].some((a) => a.home === w.structureByNo(other).id && a.sentTo === pub.id));

  // saved and loaded, the picks and the ruin are still there
  const back = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(back.story.places.farm, 1);
  assert.ok(back.structureByNo(1).ruin);
});

test('story mistakes: a place never picked, something unbuildable', async () => {
  const { parseStory } = await import('../src/story/script.js');
  const { errors } = parseStory('::A::\nburn barn\nsend 1 -> pub\nif exists(mill) -> A\npick x = tallest house\n');
  assert.equal(errors.length, 4);
  const { Storyteller } = await import('../src/story/storyteller.js');
  const { CONFIG } = await import('../src/config.js');
  const shown = [];
  globalThis.fetch = async (url) => new Response(String(url).includes('unlocks') ? '' : '::A::\npick house = oldest pub\npick y = oldest castle_tower\n');
  const story = new Storyteller({ world: flatWorld(), dialogue: { say: async (w, t) => shown.push(t), close: () => {} }, config: CONFIG });
  await story.load();
  assert.doesNotMatch(shown[0], /line 2/); // (a picked name may be one the town counts by)
  assert.match(shown[0], /"castle_tower" is nothing that can be built/);
});

test('a ruin is drawn for any footprint', async () => {
  const { drawRuin } = await import('../structures/ruin.js');
  const { STRUCTURE_TYPES } = await import('../structures/index.js');
  for (const id of ['house', 'block-wide', 'jzd', 'castle']) {
    const calls = { box: 0, line: 0, ground: 0 };
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const g = {
      range: (a, b) => a + r() * (b - a), int: (a, b) => a + Math.floor(r() * (b - a + 1)), pick: (l) => l[Math.floor(r() * l.length)], chance: (p) => r() < p,
      box: (...a) => { assert.ok(a.slice(3).every((v) => v > 0), `${id}: a box with no size`); calls.box++; },
      solid: () => {}, line: () => calls.line++, groundLine: () => calls.ground++,
    };
    drawRuin(g, STRUCTURE_TYPES[id]);
    assert.ok(calls.box > 6 && calls.line >= 2 && calls.ground >= 4, `${id}: ${JSON.stringify(calls)}`);
  }
});

test("burning is the town's doing: ⌘Z of an earlier change leaves the ruin", () => {
  const w = flatWorld();
  road(w, [2, 5], [10, 5]);
  w.history.commit();
  const s = w.placeStructure('house', at(w, 4, 6));
  w.history.commit();
  w.restyleStructure(s.id);
  w.history.commit();
  w.history.aside(() => w.burnStructure(s.id));
  assert.ok(w.history.undo().ok); // the new look
  assert.ok(w.structureByNo(1).ruin);
  assert.equal(w.burnStructure(s.id), false); // (burnt already)
  w.removeStructure(s.id); // cleared away: the number goes with it
  w.history.commit();
  assert.equal(w.placeStructure('house', at(w, 4, 6)).no, 2);
});
