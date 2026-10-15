// The chronicle as a little book (opened with the book button by the
// town's name): two ruled pages side by side (one on a phone), the entries
// written down them day by day, ‹ › to turn the pages. It opens at the
// last pages, where the newest lines are.
//
// The pages are CSS columns of a fixed height: the text runs on from one
// page into the next by itself, and turning a page scrolls the columns.
//
// After the last day's lines, on a page of its own, the ledger: the town as
// it stands today, its numbers written out in words (ui/ledger.js). The
// book opens on it. It is counted afresh whenever the book is opened, and
// while it's open, a moment after the town changes; it is no entry of the
// chronicle, so a changed number never marks the book as unread.

import { reveal } from './motion.js';
import { sketchFrame } from './sketchFrame.js';
import { isNarrow } from './device.js';
import { t } from '../core/text.js';
import { ledgerHTML } from './ledger.js';

// while the book is open, the ledger is written again this long (ms) after
// the town last changed, so a road being drawn isn't recounted every dot
const LEDGER_DELAY = 400;
const CHANGES = /^(structure|roads|paths|rails):|^world:renamed$/;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class ChronicleBook {
  constructor(root, { world, chronicle }) {
    this.world = world;
    this.chronicle = chronicle;
    this.spread = 0;

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'chron-backdrop hidden';
    this.el = document.createElement('div');
    this.el.className = 'chron-book hidden';
    this.el.setAttribute('role', 'dialog');
    this.el.innerHTML = `
      <div class="chron-head"><span class="chron-title"></span><button class="close" data-act="close" aria-label="${t('chronicle.close')}">×</button></div>
      <div class="chron-pages"><div class="chron-flow"></div></div>
      <div class="chron-foot">
        <button data-act="prev" aria-label="${t('chronicle.back')}">‹</button>
        <span class="chron-folio"></span>
        <button data-act="next" aria-label="${t('chronicle.next')}">›</button>
      </div>`;
    root.append(this.backdrop, this.el);
    sketchFrame(this.el);
    this.flowEl = this.el.querySelector('.chron-flow');
    this.folioEl = this.el.querySelector('.chron-folio');

    this.el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') this.hide();
      if (act === 'prev') this.turn(-1);
      if (act === 'next') this.turn(1);
    });
    this.backdrop.addEventListener('click', () => this.hide());
    world.events.on('chronicle:added', () => {
      if (this.open) this.render(true);
    });
    world.events.on('*', (type) => {
      if (!this.open || !CHANGES.test(type)) return;
      clearTimeout(this.ledgerTimer);
      this.ledgerTimer = setTimeout(() => this.writeLedger(), LEDGER_DELAY);
    });
    addEventListener('resize', () => {
      if (this.open) this.render(true);
    });
  }

  get open() {
    return !this.el.classList.contains('hidden') && !this.el.classList.contains('leaving');
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
  }

  // The pages are written and turned to the newest before it comes in, so
  // nothing shifts while it lands: un-hidden (unseen) to lay them out, then
  // the entrance.
  show() {
    this.chronicle.unread = false;
    this.el.style.visibility = 'hidden';
    this.el.classList.remove('hidden', 'leaving');
    this.render(true);
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
    let day = null;
    const html = [];
    for (const e of this.chronicle.entries) {
      if (e.day !== day) {
        day = e.day;
        html.push(`<h4 class="chron-day">${t('chronicle.day', { day })}</h4>`);
      }
      html.push(`<p class="chron-entry ${e.kind === 'story' ? 'story' : ''}">${esc(e.text)}</p>`);
    }
    this.ledgerHTML = this.ledger();
    html.push(`<section class="chron-ledger">${this.ledgerHTML}</section>`);
    this.flowEl.innerHTML = html.join('');
    this.ledgerEl = this.flowEl.querySelector('.chron-ledger');
    this.el.classList.toggle('single', isNarrow());
    // two pages at a time: an odd last page gets a blank one beside it, so
    // the last spread lines up with the others
    const { count, per } = this.pages();
    if (per === 2 && count % 2) this.flowEl.insertAdjacentHTML('beforeend', '<div class="chron-blank"></div>');
    if (toEnd) this.spread = Infinity;
    this.turn(0);
  }

  ledger() {
    return ledgerHTML(this.world, this.chronicle.day());
  }

  // The ledger written again in place, on the page that shows (the count
  // of pages rechecked, should it have run longer).
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
    const gap = parseFloat(getComputedStyle(f).columnGap) || 0;
    const per = this.el.classList.contains('single') ? 1 : 2;
    const page = (f.clientWidth - gap * (per - 1)) / per;
    const count = Math.max(1, Math.round((f.scrollWidth + gap) / (page + gap)));
    return { count, per, step: (page + gap) * per };
  }

  turn(by) {
    const { count, per, step } = this.pages();
    const spreads = Math.ceil(count / per);
    this.spread = Math.max(0, Math.min(spreads - 1, (this.spread === Infinity ? spreads - 1 : this.spread) + by));
    this.flowEl.scrollLeft = this.spread * step;
    const first = this.spread * per + 1, last = Math.min(count, first + per - 1);
    this.folioEl.textContent = `${first === last ? first : `${first}–${last}`} of ${count}`;
    this.el.querySelector('[data-act="prev"]').disabled = this.spread === 0;
    this.el.querySelector('[data-act="next"]').disabled = this.spread >= spreads - 1;
  }
}
