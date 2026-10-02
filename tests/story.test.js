// The story script (src/story/script.js): reading rules and branches,
// conditions, mistakes reported with their line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStory, parseExpression, evaluate, normalName, fillIn } from '../src/story/script.js';

const vars = { residential_house: 6, residents: 40, church: 0, heard_mill: 1 };
const lookup = (k) => vars[k];
const value = (src, seen = () => false) => evaluate(parseExpression(src), lookup, seen);

test('names are compared loosely', () => {
  assert.equal(normalName('Residential_House_Amount'), 'residential_house');
  assert.equal(normalName('residential-wide.Panel block'), 'residential_wide_panel_block');
  assert.equal(normalName('introDialogue'), normalName('IntroDialogue'));
});

test('conditions', () => {
  assert.equal(value('residential_house_amount > 5'), 1);
  assert.equal(value('residential_house > 5 and church >= 1'), 0);
  assert.equal(value('residential_house > 5 or church >= 1'), 1);
  assert.equal(value('not church'), 1);
  assert.equal(value('residents / 2 + 1 == 21'), 1);
  assert.equal(value('(residents - 10) * 2 = 60'), 1);
  assert.equal(value('unknown_thing > 0'), 0);
  assert.equal(value('seen(Intro)', (n) => n === 'intro'), 1);
  assert.equal(value('-residents < 0 && !church'), 1);
  assert.throws(() => parseExpression('residents >'), /ends too soon/);
  assert.throws(() => parseExpression('residents > 5 5'), /unexpected/);
});

test('a script with rules, lines, choices and jumps', () => {
  const { rules, branches, errors } = parseStory(`
# a comment
if residential_house_amount > 5 trigger introDialogue

::IntroDialogue::
Grandma: so in this village there were 5 houses and not much else
The wind blows over the meadow.
> Ask about the mill -> Mill
> Leave -> Bye
::

::Mill::
set heard_mill = heard_mill + 1
chronicle: Grandma told of the old mill.
if heard_mill > 1 -> Bye
Grandma: It burnt down in forty-five.

::Bye::
Grandma: Off you go then.
`);
  assert.deepEqual(errors, []);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].branch, 'introdialogue');
  const intro = branches.get('introdialogue');
  assert.deepEqual(intro.steps.map((s) => s.kind), ['say', 'say', 'choice']);
  assert.equal(intro.steps[0].speaker, 'Grandma');
  assert.equal(intro.steps[1].speaker, null);
  assert.equal(intro.steps[2].options.length, 2);
  assert.deepEqual(branches.get('mill').steps.map((s) => s.kind), ['set', 'chronicle', 'jump', 'say']);
});

test('mistakes come with their line', () => {
  const { errors } = parseStory(`if residents > trigger A
::A::
-> Nowhere
::A::
::
stray text`);
  const lines = errors.map((e) => e.line).sort();
  assert.deepEqual(lines, [1, 3, 4, 6]);
});

test('{name} in a line', () => {
  assert.equal(fillIn('{town} has {residents} people, {nobody}', lookup, 'Vranov'), 'Vranov has 40 people, {nobody}');
});
