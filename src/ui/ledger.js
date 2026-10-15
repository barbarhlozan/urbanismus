// The ledger page at the back of the chronicle book (ui/chronicleBook.js):
// the town as it stands today, written out by hand the way a parish clerk
// kept the municipal register – a heading, then a few lines, each with its
// rubric in the ruled margin and its number written in words ("čtyřicet dva
// obyvatel", "jeden kostel, tři hospody"). Counted afresh each time it is
// written, never kept in the save.
//
// Only what says something about the town: people, homes, work, what
// stands there, and the buildings no road reaches. A nought is left out,
// unless it is itself the news – nobody living here yet, nowhere to work.
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

// Homes, in the order they are written: structure ids and how many homes
// each is (the two-plot family houses are two little houses).
const HOMES = [
  ['house', { house: 1, 'house-wide': 2 }],
  ['apartments', { apartments: 1, 'apartments-wide': 1 }],
  ['block', { block: 1, 'block-wide': 1 }],
];

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

// The town's numbers: { residents, jobs, homes: [[kind, n]], has: [[kind, n]],
// cutoff }. Residents and jobs count only where people can get to (as the
// story's do, story/variables.js); homes and what stands, everything built.
export function tally(world) {
  let residents = 0, jobs = 0, cutoff = 0;
  const homes = new Map(), has = new Map();
  for (const s of world.structures.values()) {
    const def = STRUCTURE_TYPES[s.type];
    if (!def) continue;
    if (world.isServed(s)) {
      residents += def.stats?.residents ?? 0;
      jobs += def.stats?.jobs ?? 0;
    } else cutoff++;
    for (const [kind, counts] of HOMES) if (counts[s.type]) homes.set(kind, (homes.get(kind) ?? 0) + counts[s.type]);
    const kind = kindOf.get(s.type);
    if (kind) has.set(kind, (has.get(kind) ?? 0) + 1);
  }
  const ordered = (map, order) => order.filter((k) => map.get(k)).map((k) => [k, map.get(k)]);
  return {
    residents,
    jobs,
    homes: ordered(homes, HOMES.map(([k]) => k)),
    has: ordered(has, KINDS.map(([k]) => k)),
    cutoff,
    buildings: world.structures.size,
  };
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

// The page's lines: [rubric, text], as written.
export function ledgerLines(n) {
  const list = (items, prefix) => items.map(([kind, k]) => t(`${prefix}.${kind}`, { n: k })).join(', ');
  const lines = [[t('ledger.people'), n.residents ? t('stat.residents.n', { n: n.residents }) : t('ledger.nobody')]];
  if (n.homes.length) lines.push([t('ledger.homes'), list(n.homes, 'ledger.home')]);
  if (n.jobs) lines.push([t('ledger.work'), t('stat.jobs.n', { n: n.jobs })]);
  else if (n.residents) lines.push([t('ledger.work'), t('ledger.no-work')]);
  if (n.has.length) lines.push([t('ledger.has'), list(n.has, 'ledger.kind')]);
  if (n.cutoff) lines.push([t('ledger.cutoff'), t('ledger.cutoff.n', { n: n.cutoff })]);
  return lines;
}

// Pen strokes as SVG, stretched to the box (the stroke keeps its width):
// a double rule under the heading, a single one down the margin.
const SEED = 4711;
const underline = () => `<svg class="ledger-underline" viewBox="0 0 300 6" preserveAspectRatio="none" aria-hidden="true">
  <path d="${sketchLine([2, 1.5], [298, 1.5], SEED, { over: 2 })}${sketchLine([4, 4.5], [271, 4.8], SEED + 1, { over: 3 })}"/></svg>`;
const marginRule = () => `<svg class="ledger-margin" viewBox="0 0 4 300" preserveAspectRatio="none" aria-hidden="true">
  <path d="${sketchLine([2, 0], [2, 300], SEED + 2, { bow: 0.6 })}"/></svg>`;

// The page as HTML (inside .chron-ledger).
export function ledgerHTML(world, day) {
  const n = tally(world);
  const rows = ledgerLines(n).map(([rubric, text]) =>
    `<p class="ledger-line"><span class="ledger-rubric">${esc(rubric)}</span><span class="ledger-text">${esc(text)}</span></p>`);
  return `<h4 class="ledger-title">${esc(ledgerTitle(world.name, n.residents))}${underline()}</h4>
    <p class="ledger-asof">${esc(t('ledger.asof', { day }))}</p>
    <div class="ledger-lines">${marginRule()}${rows.join('')}</div>`;
}
