// Numbers written out in words (core/numberWords.js): Czech with the
// noun's gender and the long numbers' fixed one and two, English plain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberWords } from '../src/core/numberWords.js';

const cs = (n, g) => numberWords(n, 'cs', g);
const en = (n) => numberWords(n, 'en');

test('Czech: one and two agree with the noun when they stand alone', () => {
  assert.equal(cs(1, 'm'), 'jeden');
  assert.equal(cs(1, 'f'), 'jedna');
  assert.equal(cs(1, 'n'), 'jedno');
  assert.equal(cs(2, 'm'), 'dva');
  assert.equal(cs(2, 'f'), 'dvě');
  assert.equal(cs(2, 'n'), 'dvě');
  assert.equal(cs(3, 'f'), 'tři');
  assert.equal(cs(0), 'nula');
});

test('Czech: teens, tens and their compounds', () => {
  assert.equal(cs(11), 'jedenáct');
  assert.equal(cs(14), 'čtrnáct');
  assert.equal(cs(19), 'devatenáct');
  assert.equal(cs(20), 'dvacet');
  assert.equal(cs(21, 'm'), 'dvacet jedna');
  assert.equal(cs(42, 'f'), 'čtyřicet dva');
  assert.equal(cs(55), 'padesát pět');
  assert.equal(cs(99), 'devadesát devět');
});

test('Czech: hundreds and thousands', () => {
  assert.equal(cs(100), 'sto');
  assert.equal(cs(101, 'f'), 'sto jedna');
  assert.equal(cs(200), 'dvě stě');
  assert.equal(cs(300), 'tři sta');
  assert.equal(cs(412), 'čtyři sta dvanáct');
  assert.equal(cs(500), 'pět set');
  assert.equal(cs(1000), 'tisíc');
  assert.equal(cs(1042), 'tisíc čtyřicet dva');
  assert.equal(cs(2000), 'dva tisíce');
  assert.equal(cs(4300), 'čtyři tisíce tři sta');
  assert.equal(cs(5000), 'pět tisíc');
  assert.equal(cs(21000), 'dvacet jedna tisíc');
  assert.equal(cs(999999), 'devět set devadesát devět tisíc devět set devadesát devět');
});

test('English', () => {
  assert.equal(en(0), 'nought');
  assert.equal(en(1), 'one');
  assert.equal(en(13), 'thirteen');
  assert.equal(en(42), 'forty-two');
  assert.equal(en(100), 'one hundred');
  assert.equal(en(105), 'one hundred and five');
  assert.equal(en(1000), 'one thousand');
  assert.equal(en(1005), 'one thousand and five');
  assert.equal(en(1240), 'one thousand two hundred and forty');
  assert.equal(en(21000), 'twenty-one thousand');
});

test('what can\'t be written stays digits', () => {
  assert.equal(numberWords(1e6, 'cs'), '1000000');
  assert.equal(numberWords(-3, 'en'), '-3');
  assert.equal(numberWords(2.4, 'cs', 'f'), 'dvě');
});
