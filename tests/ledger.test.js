// The chronicle's ledger page (ui/ledger.js): the town counted and written
// out in words, the noughts left out unless they're the news, and the
// chronicle not marked unread by it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flatWorld, road } from './helpers.js';
import { addText, setLanguage, FILES } from '../src/core/text.js';
import { tally, ledgerLines, ledgerTitle, ledgerHTML, settlementOf } from '../src/ui/ledger.js';
import { Chronicle } from '../src/sim/chronicle.js';
import { CONFIG } from '../src/config.js';

const ROOT = new URL('..', import.meta.url).pathname;
for (const file of FILES) addText(readFileSync(ROOT + file, 'utf8'), file);

function town() {
  const w = flatWorld(30, 30);
  road(w, [1, 5], [28, 5]);
  for (const x of [3, 4, 5]) w.placeStructure('house', w.grid.index(x, 6));
  w.placeStructure('hospoda', w.grid.index(7, 6));
  w.placeStructure('hospoda', w.grid.index(8, 6));
  w.placeStructure('church', w.grid.index(10, 6));
  w.placeStructure('house', w.grid.index(15, 15)); // (out in the fields)
  return w;
}

test('counts what is served, and what stands', () => {
  const n = tally(town());
  assert.equal(n.residents, 12);
  assert.equal(n.jobs, 2 + 2 + 2);
  assert.deepEqual(n.homes, [['house', 4]]);
  assert.deepEqual(n.has, [['church', 1], ['pub', 2]]);
  assert.equal(n.cutoff, 1);
});

test('the lines, in words, in Czech and in English', () => {
  const n = tally(town());
  setLanguage('cs');
  assert.deepEqual(ledgerLines(n), [
    ['Lidé', 'dvanáct obyvatel'],
    ['Domy', 'čtyři domy'],
    ['Práce', 'šest pracovních míst'],
    ['V obci', 'jeden kostel, dvě hospody'],
    ['Bez cesty', 'jedna stavba'],
  ]);
  setLanguage('en');
  assert.deepEqual(ledgerLines(n).map(([, text]) => text), [
    'twelve residents', 'four houses', 'six jobs', 'one church, two pubs', 'one building',
  ]);
});

test('noughts are left out, unless they are the news', () => {
  setLanguage('cs');
  const empty = flatWorld();
  assert.deepEqual(ledgerLines(tally(empty)), [['Lidé', 'zatím tu nikdo nebydlí']]);
  const w = flatWorld();
  road(w, [1, 5], [10, 5]);
  w.placeStructure('house', w.grid.index(3, 6));
  const lines = ledgerLines(tally(w));
  assert.deepEqual(lines.find(([r]) => r === 'Práce'), ['Práce', 'zatím tu není kde pracovat']);
  assert.ok(!lines.some(([r]) => r === 'Bez cesty' || r === 'V obci'));
  setLanguage('en');
});

test('the heading names the place by its size, never twice', () => {
  assert.equal(settlementOf(0), 'hamlet');
  assert.equal(settlementOf(49), 'hamlet');
  assert.equal(settlementOf(50), 'village');
  assert.equal(settlementOf(1999), 'village');
  assert.equal(settlementOf(2000), 'town');
  setLanguage('cs');
  assert.equal(ledgerTitle('Lipnice', 120), 'Ves Lipnice');
  assert.equal(ledgerTitle('Nová Ves', 120), 'Nová Ves');
  assert.equal(ledgerTitle('České Město', 120), 'České Město');
  assert.equal(ledgerTitle('Lipnice', 3000), 'Město Lipnice');
  setLanguage('en');
  assert.equal(ledgerTitle('Lipnice', 10), 'The hamlet of Lipnice');
});

test('writing the ledger does not mark the chronicle unread', () => {
  const w = town();
  const c = new Chronicle(w, CONFIG);
  c.unread = false;
  const entries = c.entries.length;
  const html = ledgerHTML(w, c.day());
  assert.match(html, /ledger-title/);
  assert.equal(c.unread, false);
  assert.equal(c.entries.length, entries);
});
