// A number written out in words, as a clerk would write it in a register:
// "čtyřicet dva", "dvě stě tři", "forty-two". Used by the dictionaries
// (`{n:f}` in text/*.txt, src/core/text.js) for the ledger page of the
// chronicle and the Building card.
//
//   numberWords(42, 'cs')        'čtyřicet dva'
//   numberWords(1, 'cs', 'f')    'jedna'   (gender: m, f, n – only one and two
//   numberWords(2, 'cs', 'n')    'dvě'      change with it; default m)
//   numberWords(42, 'en')        'forty-two'
//
// Czech: one and two take the noun's gender when they stand alone; inside
// a longer number ("dvacet jedna", "sto dva") they are written the one way,
// and the noun goes into the genitive plural ("čtyřicet dva obyvatel") –
// which is what Intl.PluralRules('cs') already picks for anything past four.
// Thousands up to 999 999; beyond that, digits.

const CS_ONE = { m: 'jeden', f: 'jedna', n: 'jedno' };
const CS_TWO = { m: 'dva', f: 'dvě', n: 'dvě' };
const CS_UNITS = ['nula', 'jeden', 'dva', 'tři', 'čtyři', 'pět', 'šest', 'sedm', 'osm', 'devět', 'deset',
  'jedenáct', 'dvanáct', 'třináct', 'čtrnáct', 'patnáct', 'šestnáct', 'sedmnáct', 'osmnáct', 'devatenáct'];
const CS_TENS = ['', '', 'dvacet', 'třicet', 'čtyřicet', 'padesát', 'šedesát', 'sedmdesát', 'osmdesát', 'devadesát'];
const CS_HUNDREDS = ['', 'sto', 'dvě stě', 'tři sta', 'čtyři sta', 'pět set', 'šest set', 'sedm set', 'osm set', 'devět set'];

const EN_UNITS = ['nought', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const LIMIT = 1e6;

// 1–999 in Czech; `alone`: the whole number is this, so one and two agree
// with the noun.
function czechBelowThousand(n, gender, alone) {
  const parts = [];
  const h = Math.floor(n / 100), rest = n % 100;
  if (h) parts.push(CS_HUNDREDS[h]);
  if (rest >= 20) {
    parts.push(CS_TENS[Math.floor(rest / 10)]);
    const u = rest % 10;
    if (u === 1) parts.push('jedna');
    else if (u) parts.push(CS_UNITS[u]);
  } else if (rest) {
    const lone = alone && !h;
    if (rest === 1) parts.push(lone ? CS_ONE[gender] ?? CS_ONE.m : 'jedna');
    else if (rest === 2) parts.push(lone ? CS_TWO[gender] ?? CS_TWO.m : 'dva');
    else parts.push(CS_UNITS[rest]);
  }
  return parts.join(' ');
}

function czech(n, gender) {
  if (n === 0) return CS_UNITS[0];
  const k = Math.floor(n / 1000), rest = n % 1000;
  const parts = [];
  // tisíc is a masculine noun: dva tisíce, pět tisíc, dvacet jedna tisíc
  if (k === 1) parts.push('tisíc');
  else if (k >= 2 && k <= 4) parts.push(`${CS_UNITS[k]} tisíce`);
  else if (k) parts.push(`${czechBelowThousand(k, 'm', false)} tisíc`);
  if (rest) parts.push(czechBelowThousand(rest, gender, !k));
  return parts.join(' ');
}

function englishBelowThousand(n) {
  const h = Math.floor(n / 100), rest = n % 100;
  const tail = rest < 20 ? (rest ? EN_UNITS[rest] : '')
    : EN_TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${EN_UNITS[rest % 10]}` : '');
  if (!h) return tail;
  return `${EN_UNITS[h]} hundred${tail ? ` and ${tail}` : ''}`;
}

function english(n) {
  if (n === 0) return EN_UNITS[0];
  const k = Math.floor(n / 1000), rest = n % 1000;
  const parts = [];
  if (k) parts.push(`${englishBelowThousand(k)} thousand`);
  // (a thousand and five, but a thousand two hundred)
  if (rest) parts.push(rest < 100 && k ? `and ${englishBelowThousand(rest)}` : englishBelowThousand(rest));
  return parts.join(' ');
}

// n in words in a language (cs, en); `gender` is the Czech noun's (m, f, n).
// Fractions are rounded; negative numbers and numbers past the limit stay
// digits.
export function numberWords(n, lang = 'cs', gender = 'm') {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < 0 || v >= LIMIT) return String(n);
  return lang === 'cs' ? czech(v, gender) : english(v);
}
