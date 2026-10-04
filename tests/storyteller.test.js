// The storyteller (story/storyteller.js) with a stand-in dialogue window:
// rules start branches once, choices and jumps lead on, `set` and
// `chronicle:` lines do their part, and it's all kept with the town.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road } from './helpers.js';
import { Storyteller } from '../src/story/storyteller.js';
import { parseStory } from '../src/story/script.js';
import { Chronicle } from '../src/sim/chronicle.js';
import { World } from '../src/core/world.js';
import { CONFIG } from '../src/config.js';

const SCRIPT = `
if house_amount > 2 trigger introDialogue
if church >= 1 and seen(IntroDialogue) trigger Bells

::IntroDialogue::
Grandma: So in this village there were {residential} houses and not much else.
> Ask about the geese -> Geese
> Leave -> Bye
::Geese::
set geese = 11
chronicle: Grandma counted {geese} geese.
-> Bye
::Bye::
Grandma: Off you go.
::Bells::
The bells of {town}.
`;

// A dialogue that writes down what it's shown and picks the first choice.
function fakeDialogue(picks = []) {
  const said = [];
  return {
    said,
    say: async (speaker, text) => { said.push(speaker ? `${speaker}: ${text}` : text); },
    choose: async (options) => { said.push(`? ${options.join(' / ')}`); return picks.shift() ?? 0; },
    close: () => {},
  };
}

async function teller(world, dialogue) {
  globalThis.fetch = async (url) => new Response(String(url).includes('unlocks') ? '' : SCRIPT);
  const chronicle = new Chronicle(world, CONFIG);
  const story = new Storyteller({ world, dialogue, chronicle, config: CONFIG });
  await story.load();
  return { story, chronicle };
}

const tick = async (story) => {
  story.update(CONFIG.story.check);
  // let the branch run to its end
  for (let i = 0; i < 20 && story.telling; i++) await new Promise((r) => setTimeout(r, 0));
};

test('a rule starts its branch once, choices lead on', async () => {
  const w = flatWorld();
  const dialogue = fakeDialogue([0]);
  const { story, chronicle } = await teller(w, dialogue);
  road(w, [2, 5], [10, 5]);
  w.placeStructure('house', w.grid.index(3, 6));
  w.placeStructure('house', w.grid.index(4, 6));
  await tick(story);
  assert.deepEqual(dialogue.said, []); // two houses: not yet
  w.placeStructure('house', w.grid.index(5, 6));
  await tick(story);
  assert.deepEqual(dialogue.said, [
    'Grandma: So in this village there were 3 houses and not much else.',
    '? Ask about the geese / Leave',
    'Grandma: Off you go.',
  ]);
  assert.deepEqual(w.story.seen, ['introdialogue', 'geese', 'bye']);
  assert.equal(w.story.vars.geese, 11);
  assert.equal(chronicle.entries.at(-1).text, 'Grandma counted 11 geese.');
  await tick(story);
  assert.equal(dialogue.said.length, 3); // told once
});

test('what was told is kept with the town', async () => {
  const w = flatWorld();
  w.story.seen.push('introdialogue');
  const copy = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  assert.deepEqual(copy.story.seen, ['introdialogue']);
});

test('seen() and {town}', async () => {
  const w = flatWorld();
  const dialogue = fakeDialogue([1]);
  const { story } = await teller(w, dialogue);
  assert.deepEqual(story.script.errors, []);
  road(w, [2, 5], [10, 5]);
  w.placeStructure('church', w.grid.index(3, 3));
  await tick(story);
  assert.deepEqual(dialogue.said, []); // the bells wait for Grandma
  for (const x of [3, 4, 5]) w.placeStructure('house', w.grid.index(x, 6));
  await tick(story);
  await tick(story);
  assert.equal(dialogue.said.at(-1), 'The bells of Testov.');
});

test('a seen() of a branch that does not exist is a mistake', () => {
  globalThis.fetch = null;
  const { errors } = parseStory('if seen(Nobody) trigger A\n::A::\nhi');
  assert.match(errors[0].msg, /no branch called Nobody/);
});
