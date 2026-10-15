// The chronicle as a little book (opened with the book button by the
// town's name): two ruled pages side by side (one on a phone), ‹ › to turn
// them, the page numbers in the outer corners. Three thumb tabs cut into
// its edge – down the fore edge on a wide screen, along the top on a
// phone – open its three parts:
//
//   Kronika     the entries, day by day: the town's lines, the story's
//               paragraphs, and every photo taken, pasted in with corner
//               mounts under the day it was taken (ui/prints.js). A cloth
//               ribbon lies in the newest pages.
//   Fotografie  the photos again, two to a page, as an album.
//   Stav obce   the ledger: the town as it stands today, its numbers in
//               words (ui/ledger.js), counted afresh whenever it shows.
//
// The book opens at the part last open (kept with the town), or at the
// newest pages of Kronika when something was written since it was last
// read. What is new since then has a pencil stroke beside it in the margin.
//
// The pages are CSS columns of a fixed height: the text runs on from one
// page into the next by itself, and turning a page scrolls the columns.
// Everything on them is a whole number of ruled lines high, prints too, so
// the writing stays on the ruling.

import { reveal } from './motion.js';
import { sketchFrame } from './sketchFrame.js';
import { isNarrow } from './device.js';
import { t } from '../core/text.js';
import { ledgerHTML } from './ledger.js';
import { printURL } from './prints.js';
import { sketchLine, seedOf } from '../render/sketch.js';
import { mulberry32 } from '../core/random.js';

const TABS = ['chronicle', 'photos', 'ledger'];

// while the ledger shows, it is written again this long (ms) after the town
// last changed, so a road being drawn isn't recounted every dot
const LEDGER_DELAY = 400;
const CHANGES = /^(structure|roads|paths|rails):|^world:renamed$/;

// A print's picture, in ruled lines (a photo is 3 : 2): in the chronicle,
// and smaller in the album, two to a page.
const PRINT = { chronicle: 8, photos: 6 };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hash = (s) => [...String(s)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
const svg = (cls, w, h, d, pad = 0) =>
  `<svg class="${cls}" viewBox="${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}" style="--w:${w + 2 * pad}px;--h:${h + 2 * pad}px;--pad:${pad}px" aria-hidden="true">${d}</svg>`;

// A pencil stroke down the margin, beside what hasn't been read yet.
const freshMark = (h, seed) => svg('chron-fresh', 4, h, `<path d="${sketchLine([2, 3], [1.4, h - 3], seed, { bow: 0.8 })}"/>`);

// The black paper corners a print is held in, one over each corner of a
// w × h print.
function corners(w, h, seed) {
  const rnd = mulberry32(seed), k = 14, d = [];
  for (const [x, y, sx, sy] of [[0, 0, 1, 1], [w, 0, -1, 1], [w, h, -1, -1], [0, h, 1, -1]]) {
    const o = 2 + rnd() * 1.5, kk = k + rnd() * 3;
    const a = [x - sx * o, y - sy * o], b = [x + sx * kk, y - sy * o], c = [x - sx * o, y + sy * kk];
    d.push(`<path class="corner" d="M${a}L${b}L${c}Z"/>`);
  }
  return svg('chron-corners', w, h, d.join(''), 6);
}

export class ChronicleBook {
  constructor(root, { world, chronicle }) {
    this.world = world;
    this.chronicle = chronicle;
    this.spread = 0;
    this.tab = 'chronicle';
    this.seen = 0; // entries read before this opening: the rest are new

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'chron-backdrop hidden';
    this.el = document.createElement('div');
    this.el.className = 'chron-book hidden';
    this.el.setAttribute('role', 'dialog');
    this.el.innerHTML = `
      <div class="chron-tabs" role="tablist">${TABS.map((tab) =>
        `<button class="chron-tab" role="tab" data-tab="${tab}"><span>${t(`chronicle.tab.${tab}`)}</span></button>`).join('')}</div>
      <div class="chron-head"><span class="chron-title"></span><button class="close" data-act="close" aria-label="${t('chronicle.close')}">×</button></div>
      <div class="chron-pages" role="tabpanel"><div class="chron-flow"></div></div>
      <div class="chron-foot">
        <button data-act="prev" aria-label="${t('chronicle.back')}">‹ <span class="chron-folio"></span></button>
        <button data-act="next" aria-label="${t('chronicle.next')}"><span class="chron-folio"></span> ›</button>
      </div>
      <div class="chron-ribbon hidden"></div>`;
    root.append(this.backdrop, this.el);
    sketchFrame(this.el);
    this.flowEl = this.el.querySelector('.chron-flow');
    this.folios = [...this.el.querySelectorAll('.chron-folio')];
    this.tabEls = [...this.el.querySelectorAll('.chron-tab')];
    this.ribbonEl = this.el.querySelector('.chron-ribbon');

    this.el.addEventListener('click', (e) => {
      const tab = e.target.closest('.chron-tab')?.dataset.tab; // (the book wears its tab's name too)
      if (tab) return this.show(tab);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') this.hide();
      if (act === 'prev') this.turn(-1);
      if (act === 'next') this.turn(1);
    });
    this.backdrop.addEventListener('click', () => this.hide());
    world.events.on('chronicle:added', () => {
      if (!this.open) return;
      this.chronicle.read(); // (it is being looked at)
      if (this.tab !== 'ledger') this.render(true);
    });
    world.events.on('*', (type) => {
      if (!this.open || this.tab !== 'ledger' || !CHANGES.test(type)) return;
      clearTimeout(this.ledgerTimer);
      this.ledgerTimer = setTimeout(() => this.writeLedger(), LEDGER_DELAY);
    });
    addEventListener('resize', () => {
      if (this.open) this.render(this.atEnd());
    });
  }

  get open() {
    return !this.el.classList.contains('hidden') && !this.el.classList.contains('leaving');
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
  }

  // Open the book (at `tab`, else where it opens by itself), or turn to
  // `tab` while it's open. The pages are written and turned before it comes
  // in, so nothing shifts while it lands: un-hidden (unseen) to lay them
  // out, then the entrance.
  show(tab) {
    if (this.open) {
      if (tab && tab !== this.tab) {
        this.tab = this.chronicle.data.tab = tab;
        this.render(tab !== 'ledger');
      }
      return;
    }
    this.tab = tab ?? (this.chronicle.unread ? 'chronicle' : (this.chronicle.data.tab ?? 'chronicle'));
    this.chronicle.data.tab = this.tab;
    this.seen = this.chronicle.data.seen;
    this.chronicle.read();
    this.el.style.visibility = 'hidden';
    this.el.classList.remove('hidden', 'leaving');
    this.render(this.tab !== 'ledger');
    this.el.style.visibility = '';
    reveal(this.backdrop, true, { fade: true });
    reveal(this.el, true, { from: [0, 10], force: true });
  }

  hide() {
    reveal(this.backdrop, false, { fade: true });
    reveal(this.el, false, { from: [0, 10] });
  }

  // ← → turn the pages, Esc closes. True if the key was used.
  key(e) {
    if (!this.open) return false;
    if (e.key === 'Escape') this.hide();
    else if (e.key === 'ArrowLeft') this.turn(-1);
    else if (e.key === 'ArrowRight') this.turn(1);
    else return false;
    return true;
  }

  render(toEnd = false) {
    this.el.querySelector('.chron-title').textContent = t('chronicle.title', { town: this.world.name });
    const single = isNarrow();
    this.el.classList.toggle('single', single);
    this.el.dataset.tab = this.tab;
    for (const el of this.tabEls) {
      const on = el.dataset.tab === this.tab;
      el.classList.toggle('on', on);
      el.setAttribute('aria-selected', String(on));
    }
    this.rule = parseFloat(getComputedStyle(this.el).getPropertyValue('--rule')) || 24;
    this.flowEl.innerHTML = this.tab === 'ledger' ? `<section class="chron-ledger">${(this.ledgerHTML = this.ledger())}</section>`
      : this.tab === 'photos' ? this.album()
      : this.entries();
    this.ledgerEl = this.flowEl.querySelector('.chron-ledger');
    this.drawMarks();
    this.loadPrints();
    // two pages at a time: an odd last page gets a blank one beside it, so
    // the last spread lines up with the others
    const { count, per } = this.pages();
    if (per === 2 && count % 2) this.flowEl.insertAdjacentHTML('beforeend', '<div class="chron-blank"></div>');
    if (toEnd) this.spread = Infinity;
    else if (this.tab === 'ledger') this.spread = 0;
    this.drawTabs();
    this.turn(0);
  }

  // Kronika: the entries under their days; what came since the last
  // reading marked.
  entries() {
    let day = null;
    const html = [];
    this.chronicle.entries.forEach((e, i) => {
      if (e.day !== day) {
        day = e.day;
        html.push(`<h4 class="chron-day">${t('chronicle.day', { day })}</h4>`);
      }
      const fresh = i >= this.seen ? ' fresh' : '';
      if (e.kind === 'photo') html.push(this.print(e, 'chronicle', esc(e.text), fresh));
      else if (e.kind === 'story') html.push(`<p class="chron-story${fresh}">${esc(e.text)}</p>`);
      else html.push(`<p class="chron-entry${fresh}">${esc(e.text)}</p>`);
    });
    return html.join('');
  }

  // Fotografie: the prints alone, captioned with their day.
  album() {
    const photos = this.chronicle.entries.map((e, i) => [e, i]).filter(([e]) => e.kind === 'photo');
    if (!photos.length) return `<p class="chron-none">${esc(t('chronicle.no-photos'))}</p>`;
    return photos.map(([e, i], k) =>
      this.print(e, 'photos', esc(t('chronicle.print.caption', { caption: e.text, day: e.day })), (i >= this.seen ? ' fresh' : '') + (k % 2 ? ' even' : ''))).join('');
  }

  // A print in its corner mounts, set down a little askew (the same each
  // time); its picture is put in once it has loaded (loadPrints).
  print(e, where, caption, cls) {
    const rnd = mulberry32(hash(e.print));
    const h = PRINT[where] * this.rule - 12, w = Math.round(h * 1.5);
    return `<figure class="chron-print ${where}${cls}" style="--tilt:${((rnd() - 0.5) * 1.6).toFixed(2)}deg">
      <div class="chron-mount" style="width:${w}px;height:${h}px"><img alt="${caption}" data-print="${esc(e.print)}">${corners(w, h, hash(e.print))}</div>
      <figcaption>${caption}</figcaption></figure>`;
  }

  async loadPrints() {
    for (const img of this.flowEl.querySelectorAll('img[data-print]')) {
      const url = await printURL(img.dataset.print);
      if (url) img.src = url;
      else img.closest('.chron-mount').classList.add('empty');
    }
  }

  // The pencil strokes beside what's new (sized to it, once it is laid out).
  drawMarks() {
    let i = 0;
    for (const el of this.flowEl.querySelectorAll('.fresh')) {
      // (beside a print, the length of a line or two)
      el.insertAdjacentHTML('afterbegin', freshMark(Math.max(12, Math.min(el.offsetHeight, this.rule * 2)), seedOf(++i, 53)));
    }
  }

  // The tabs' outlines: three sides each, drawn freehand, open toward the
  // page for the one that's open (it runs into the page), closed for the
  // others. (The ring round the open one is its pen mark, ui/penMarks.js.)
  drawTabs() {
    const down = !this.el.classList.contains('single'); // (down the fore edge)
    this.tabEls.forEach((el, i) => {
      el.querySelector('.chron-tab-ink')?.remove();
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return;
      const s = seedOf(i, 91);
      const line = (a, b, k) => sketchLine(a, b, s + k, { over: 1.5, bow: 0.5 });
      const open = down
        ? line([0, 0], [w, 0.5], 1) + line([w, 0], [w - 0.5, h], 2) + line([w, h], [0, h - 0.5], 3)
        : line([0, h], [0.5, 0], 1) + line([0, 0], [w, 0.5], 2) + line([w, 0], [w - 0.5, h], 3);
      const shut = down ? line([0, 0], [0.5, h], 4) : line([0, h], [w, h - 0.5], 4);
      el.insertAdjacentHTML('afterbegin', svg('chron-tab-ink', w, h, `<path d="${open}"/><path class="shut" d="${shut}"/>`, 8));
    });
  }

  // The ribbon: hangs from the top of the book over the newest pages and
  // out past the bottom, two edges, a few threads, the end cut in a V.
  drawRibbon(show) {
    this.ribbonEl.classList.toggle('hidden', !show);
    if (!show) return;
    const w = 12, h = this.el.offsetHeight + 40;
    if (this.ribbonEl.dataset.h === String(h)) return;
    this.ribbonEl.dataset.h = h;
    const s = 4021;
    let d = sketchLine([0, 0], [1, h - 8], s, { bow: 2 }) + sketchLine([w, 0], [w + 1, h - 8], s + 1, { bow: 2 });
    d += `M1 ${h - 8}L${w / 2 + 0.5} ${h - 15}L${w + 1} ${h - 8}`;
    for (const y of [h * 0.31, h * 0.34, h * 0.7]) d += sketchLine([2, y], [w - 1, y - 3], s + y, { bow: 0.2 });
    this.ribbonEl.innerHTML = svg('chron-ribbon-ink', w, h, `<path class="cloth" d="M0 0L${w} 0L${w + 1} ${h - 8}L${w / 2 + 0.5} ${h - 15}L1 ${h - 8}Z"/><path d="${d}"/>`, 2);
  }

  ledger() {
    return ledgerHTML(this.world, this.chronicle.day());
  }

  // The ledger written again in place (the count of pages rechecked, should
  // it have run longer).
  writeLedger() {
    if (!this.open || !this.ledgerEl) return;
    const html = this.ledger();
    if (html === this.ledgerHTML) return;
    this.ledgerEl.innerHTML = this.ledgerHTML = html;
    this.turn(0);
  }

  // Pages: how many columns the text runs to; a spread is what shows at once.
  pages() {
    const f = this.flowEl;
    const style = getComputedStyle(f);
    const gap = parseFloat(style.columnGap) || 0;
    const pad = parseFloat(style.paddingLeft) || 0; // (the margin for the pencil strokes)
    const per = this.el.classList.contains('single') ? 1 : 2;
    const page = (f.clientWidth - pad - gap * (per - 1)) / per;
    const count = Math.max(1, Math.round((f.scrollWidth - pad + gap) / (page + gap)));
    return { count, per, step: (page + gap) * per };
  }

  atEnd() {
    const { count, per } = this.pages();
    return this.spread >= Math.ceil(count / per) - 1;
  }

  turn(by) {
    const { count, per, step } = this.pages();
    const spreads = Math.ceil(count / per);
    this.spread = Math.max(0, Math.min(spreads - 1, (this.spread === Infinity ? spreads - 1 : this.spread) + by));
    this.flowEl.scrollLeft = this.spread * step;
    // the page numbers in the outer corners, as a book has them
    const first = this.spread * per + 1, last = Math.min(count, first + per - 1);
    this.folios[0].textContent = per === 2 || first === last ? first : '';
    this.folios[1].textContent = per === 2 && last > first ? last : '';
    this.el.querySelector('[data-act="prev"]').disabled = this.spread === 0;
    this.el.querySelector('[data-act="next"]').disabled = this.spread >= spreads - 1;
    this.drawRibbon(this.tab === 'chronicle' && this.spread === spreads - 1 && this.chronicle.entries.length > 0);
  }
}
