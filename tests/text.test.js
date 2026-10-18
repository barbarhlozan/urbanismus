// The dictionaries (text/*.txt, read by src/core/text.js): whole, and
// matching what the code asks for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { STRUCTURES } from '../structures/index.js';
import { normalName } from '../src/story/script.js';
import { parseText, addText, setLanguage, t, reasonText, LANGUAGES, FILES } from '../src/core/text.js';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const all = new Map();
for (const file of FILES) {
  const { entries, errors } = parseText(read(file), file);
  assert.deepEqual(errors, [], `${file} reads without mistakes`);
  for (const [k, v] of entries) all.set(k, v);
  addText(read(file), file);
}

const sources = (dir) => readdirSync(join(ROOT, dir)).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(join(ROOT, path)).isDirectory()) return sources(path);
  return name.endsWith('.js') ? [path] : [];
});

test('every word in every language, with the same blanks', () => {
  const blanks = (s) => [...new Set([...s.matchAll(/\{(\w+)(?::\w+)?\}/g)].map((m) => m[1]))].sort().join();
  for (const [key, words] of all) {
    for (const lang of Object.keys(LANGUAGES)) assert.ok(words[lang], `${key} has ${lang}`);
    assert.equal(blanks(words.cs), blanks(words.en), `${key}: same {…} in both`);
  }
});

test('every t(…) in the code has its word', () => {
  for (const file of ['src', 'structures', 'features'].flatMap(sources)) {
    const code = read(file).replace(/^\s*\/\/.*$/gm, ''); // (not the notes)
    for (const [, key] of code.matchAll(/\bt\('([^']+)'/g)) {
      assert.ok(all.has(key), `${file}: ${key}`);
    }
  }
  // the ones put together from a name
  const made = [
    ...['road', 'lane', 'path', 'rail'].flatMap((id) => [`tool.${id}`, `tool.${id}.blurb`, `network.stop.${id}`]),
    ...['transport', 'housing', 'work', 'amenities', 'spaces', 'heritage'].map((id) => `group.${id}`),
    ...['photo', 'assets', 'debug', 'export', 'import', 'newMap'].flatMap((a) => [`control.${a}`]),
    ...['residents', 'jobs'].map((k) => `stat.${k}.n`),
  ];
  for (const key of made) assert.ok(all.has(key), key);
});

test('everything that can be built has its name, words and sizes', () => {
  for (const def of STRUCTURES) {
    const name = normalName(def.name);
    assert.ok(all.has(name), `${def.id}: ${name}`);
    if (def.blurb) assert.ok(all.has(`${def.id}.blurb`) || all.has(`${name}.blurb`), `${def.id}: ${name}.blurb`);
    const size = def.size ?? (def.footprint?.length > 1 ? 'Large' : 'Small');
    assert.ok(all.has(`size.${normalName(size)}`), `${def.id}: size.${normalName(size)}`);
  }
});

test('a number in words takes its noun\'s gender and form', () => {
  setLanguage('cs');
  assert.equal(t('stat.residents.n', { n: 4 }), 'čtyři obyvatelé');
  assert.equal(t('stat.residents.n', { n: 42 }), 'čtyřicet dva obyvatel');
  assert.equal(t('stat.jobs.n', { n: 1 }), 'jedno pracovní místo');
  assert.equal(t('stat.jobs.n', { n: 2 }), 'dvě pracovní místa');
  assert.equal(t('ledger.kind.pub', { n: 3 }), 'tři hospody');
  assert.equal(t('ledger.kind.school', { n: 1 }), 'škola'); // (one: the thing alone)
  assert.equal(t('ledger.kind.church', { n: 12 }), 'dvanáct kostelů');
  assert.equal(t('ledger.homes.n', { n: 2 }), 'dva');
  assert.equal(t('ledger.work.n', { n: 2 }), 'dvě');
  setLanguage('en');
  assert.equal(t('stat.residents.n', { n: 42 }), 'forty-two residents');
  assert.equal(t('ledger.kind.church', { n: 1 }), 'church');
  assert.equal(t('ledger.kind.church', { n: 3 }), 'three churches');
});

test('numbers fill in, in the right form', () => {
  setLanguage('cs');
  assert.equal(t('import.buildings', { n: 1 }), '1 budova');
  assert.equal(t('import.buildings', { n: 3 }), '3 budovy');
  assert.equal(t('import.buildings', { n: 7 }), '7 budov');
  setLanguage('en');
  assert.equal(t('import.buildings', { n: 1 }), '1 building');
  assert.equal(t('import.buildings', { n: 3 }), '3 buildings');
  assert.equal(t('import.ask', { town: 'Lhota' }), 'Open the town Lhota?');
});

test('missing words fall back to English, then to the key', () => {
  addText('only.english\n  en: Only English\n', 'test');
  setLanguage('cs');
  assert.equal(t('only.english'), 'Only English');
  assert.equal(t('no.such.key'), 'no.such.key');
  setLanguage('en');
});

test('reasons from the world read in the language', () => {
  setLanguage('cs');
  assert.equal(reasonText('Too steep'), 'Příliš strmé');
  assert.equal(reasonText('Something new'), 'Something new');
  setLanguage('en');
});

test('mistakes in a dictionary are reported with their line', () => {
  const { errors } = parseText('a\n  cs: A\na\n  xx: ?\n  nonsense\n', 'f.txt');
  assert.equal(errors.length, 3);
  assert.match(errors[0], /f\.txt:3: a is there twice/);
});
