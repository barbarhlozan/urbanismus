// The ledger, the chronicle book's "Stav obce" tab (ui/chronicleBook.js):
// the town as it stands today, written out by hand the way a parish clerk
// kept the municipal register – a heading, a few lines each with its rubric
// in the ruled margin and its number written in words ("Lidé – šedesát"),
// then what stands in the village, one thing a line ("dva kostely",
// "škola"). Counted afresh each time it is written, never kept in the save.
//
// Only what says something about the town: people, homes, work and what
// stands there. A nought is left out, unless it is itself the news –
// nobody living here yet, nowhere to work.
//
// The heading names the place by its size (osada, ves, město: SETTLEMENTS).
// To do without that, make settlementOf return null: the heading is then
// the town's name alone.

import { STRUCTURE_TYPES, matches, categoryOf } from '../../structures/index.js';
import { sketchLine } from '../render/sketch.js';
import { t } from '../core/text.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// What the place is called by how many live in it, the smallest first:
// up to `below` residents. 2 000 is the line the Czechoslovak censuses and
// statistical lexicons drew between rural and urban municipalities; a
// hamlet (osada) has no such line, a few dozen people is the game's own
// judgement. The legal titles (statutory town, the městys abolished in 1954)
// are left alone.
export const SETTLEMENTS = [
  { id: 'hamlet', below: 50 },   // osada
  { id: 'village', below: 2000 }, // ves
  { id: 'town', below: Infinity }, // město
];

export function settlementOf(residents) {
  return SETTLEMENTS.find((s) => residents < s.below)?.id ?? null;
}

// Homes: how many each structure is (the two-plot family houses are two
// little houses).
const HOMES = { house: 1, 'house-wide': 2, apartments: 1, 'apartments-wide': 1, block: 1, 'block-wide': 1 };

// What stands in the town, in the order a register lists it – church and
// offices, the services, the shops, the railway and the road, work and the
// farms, open spaces, landmarks – each by structure ids, or by a test of
// its definition. Sizes of one thing count together.
const ids = (...list) => (def) => list.includes(def.id);
const KINDS = [
  ['church', ids('church')],
  ['chapel', ids('chapel')],
  ['town-hall', (d) => matches(d, 'town-hall')],
  ['office', ids('office', 'office-wide', 'office-tower', 'office-tower-wide')],
  ['school', ids('school')],
  ['post-office', ids('post-office')],
  ['health-centre', ids('health-centre')],
  ['clinic', ids('clinic')],
  ['hospital', ids('hospital')],
  ['fire', (d) => matches(d, 'fire')],
  ['police', ids('police')],
  ['pub', (d) => matches(d, 'pub')],
  ['shop', ids('jednota', 'jednota-wide')],
  ['store', ids('store', 'store-wide')],
  ['hotel', (d) => matches(d, 'hotel')],
  ['culture-house', ids('culture-house')],
  ['pool', ids('pool')],
  ['cemetery', ids('cemetery')],
  ['station', ids('station', 'station-main')],
  ['halt', ids('stop')],
  ['bus-station', ids('bus-station')],
  ['bus-stop', ids('bus-stop')],
  ['benzina', ids('benzina')],
  ['works', (d) => matches(d, 'industrial') && ['work', 'farming'].includes(categoryOf(d))],
  ['jzd', ids('jzd')],
  ['state-farm', ids('state-farm')],
  ['farmstead', ids('farmstead')],
  ['smallholding', ids('smallholding')],
  ['park', (d) => matches(d, 'park') && d.id !== 'pool'],
  ['square', (d) => matches(d, 'square') && d.id !== 'bus-station'],
  ['memorial', ids('memorial')],
  ['castle', ids('castle')],
  ['tv-tower', ids('tv-tower')],
  ['stadium', ids('stadium')],
];
const kindOf = new Map(Object.values(STRUCTURE_TYPES).map((def) => [def.id, KINDS.find(([, is]) => is(def))?.[0]]));

// The town's numbers: { residents, jobs, homes, has: [[kind, n]] }.
// Residents and jobs count only where people can get to (as the story's
// do, story/variables.js); homes and what stands, everything built.
export function tally(world) {
  let residents = 0, jobs = 0, homes = 0;
  const has = new Map();
  for (const s of world.structures.values()) {
    const def = STRUCTURE_TYPES[s.type];
    if (!def) continue;
    if (world.isServed(s)) {
      residents += def.stats?.residents ?? 0;
      jobs += def.stats?.jobs ?? 0;
    }
    homes += HOMES[s.type] ?? 0;
    const kind = kindOf.get(s.type);
    if (kind) has.set(kind, (has.get(kind) ?? 0) + 1);
  }
  return { residents, jobs, homes, has: KINDS.filter(([k]) => has.get(k)).map(([k]) => [k, has.get(k)]) };
}

// The heading: "Ves Lipnice", or the name alone when the settlement word
// is done without, or the name already holds one of them (Nová Ves, České
// Město – "Ves České Město" would read wrong).
export function ledgerTitle(name, residents) {
  const kind = settlementOf(residents);
  if (!kind) return name;
  const words = SETTLEMENTS.map((s) => t(`ledger.settlement.${s.id}`, { town: '' }).trim().toLowerCase());
  const own = name.toLowerCase().split(/\s+/);
  if (words.some((w) => own.includes(w))) return name;
  return t(`ledger.settlement.${kind}`, { town: name });
}

// The page's lines: [rubric, number in words], as written.
export function ledgerLines(n) {
  const lines = [[t('ledger.people'), n.residents ? t('ledger.people.n', { n: n.residents }) : t('ledger.nobody')]];
  if (n.homes) lines.push([t('ledger.homes'), t('ledger.homes.n', { n: n.homes })]);
  if (n.jobs) lines.push([t('ledger.work'), t('ledger.work.n', { n: n.jobs })]);
  else if (n.residents) lines.push([t('ledger.work'), t('ledger.no-work')]);
  return lines;
}

// What stands in the village, one thing a line: "dva kostely", "škola".
export function ledgerHas(n) {
  return n.has.map(([kind, k]) => t(`ledger.kind.${kind}`, { n: k }));
}

// Pen strokes as SVG, stretched to the box (the stroke keeps its width):
// a double rule under the heading, a single one down the margin.
const SEED = 4711;
const underline = () => `<svg class="ledger-underline" viewBox="0 0 300 6" preserveAspectRatio="none" aria-hidden="true">
  <path d="${sketchLine([2, 1.5], [298, 1.5], SEED, { over: 2 })}${sketchLine([4, 4.5], [271, 4.8], SEED + 1, { over: 3 })}"/></svg>`;
const marginRule = () => `<svg class="ledger-margin" viewBox="0 0 4 300" preserveAspectRatio="none" aria-hidden="true">
  <path d="${sketchLine([2, 0], [2, 300], SEED + 2, { bow: 0.6 })}"/></svg>`;

// The page as HTML (inside .chron-ledger). What stands in the village is a
// list of its own (.ledger-has), on the facing page when there are two.
export function ledgerHTML(world, day) {
  const n = tally(world);
  const rows = ledgerLines(n).map(([rubric, text]) =>
    `<p class="ledger-line"><span class="ledger-rubric">${esc(rubric)}</span><span class="ledger-text">${esc(text)}</span></p>`);
  const has = ledgerHas(n);
  return `<h4 class="ledger-title">${esc(ledgerTitle(world.name, n.residents))}${underline()}</h4>
    <p class="ledger-asof">${esc(t('ledger.asof', { day }))}</p>
    <div class="ledger-lines">${marginRule()}${rows.join('')}</div>
    ${has.length ? `<div class="ledger-has"><h5 class="ledger-rubric">${esc(t('ledger.has'))}</h5>${has.map((line) => `<p class="ledger-thing">${esc(line)}</p>`).join('')}</div>` : ''}`;
}
