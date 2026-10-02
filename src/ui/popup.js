// Context menu shown when clicking a dot. On narrow screens it is a sheet
// along the bottom edge instead, within easy reach of the thumb.
// items: [{ label, note?, disabled?, info?, heading?, unavailable?, action?, keepOpen? }]
// or { section } – a line across with a small heading ('' for just the line)
// or { block } – ready-made HTML (escaped by whoever builds it), e.g. a summary
// (unavailable: can't be done here – shown crossed out in the detail colour)
// keepOpen items leave the menu open and rebuild it with `refresh()`
// (passed to show), e.g. to cycle through options.
// `around` (a screen box of what was clicked) puts the menu beside it rather
// than at the pointer: to the right if there's room, else to the left.

import { isNarrow } from './device.js';
import { reveal, isShown } from './motion.js';

const GHOST_MS = 400;
const ROWS = '.popup-body > :not(.title)'; // they follow the menu in, one by one

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Popup {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'popup hidden';
    this.openedAt = -Infinity;
    // the content scrolls inside, so the box itself (and its frame) stays put
    this.body = document.createElement('div');
    this.body.className = 'popup-body';
    this.el.appendChild(this.body);
    root.appendChild(this.el);

    this.el.addEventListener('click', (e) => {
      // on phones the tap that opened the menu can arrive again as a click a
      // moment later, on whatever row came up under the finger: not a choice
      if (performance.now() - this.openedAt < GHOST_MS) return;
      if (e.target.closest('.close')) return this.hide();
      const btn = e.target.closest('button[data-i]');
      if (!btn || btn.disabled) return;
      const item = this.items[Number(btn.dataset.i)];
      if (item?.keepOpen && this.refresh) {
        item.action?.();
        const { title, items } = this.refresh();
        this.render(title, items);
        return;
      }
      this.hide();
      item?.action?.();
    });
    document.addEventListener('pointerdown', (e) => {
      if (this.open && !this.el.contains(e.target)) this.hide();
    }, true);
  }

  get open() {
    return isShown(this.el);
  }

  show(x, y, title, items, refresh = null, around = null) {
    const wasOpen = this.open;
    if (!wasOpen) this.openedAt = performance.now();
    this.refresh = refresh;
    this.render(title, items);
    this.place(x, y, around);
    // arriving: a sheet rises from the bottom edge, a menu a few pixels
    if (!wasOpen) reveal(this.el, true, { from: isNarrow() ? [0, 40] : [0, 4], force: true, rows: ROWS });
  }

  place(x, y, around) {
    this.el.classList.toggle('sheet', isNarrow());
    this.body.scrollTop = 0;
    if (isNarrow()) {
      this.el.style.left = this.el.style.top = '';
      return;
    }
    const { width, height } = this.el.getBoundingClientRect();
    const GAP = 16;
    let left = x + 12, top = y + 12;
    if (around) {
      const fitsRight = around.right + GAP + width <= innerWidth - 8;
      const fitsLeft = around.left - GAP - width >= 8;
      if (fitsRight || !fitsLeft) left = around.right + GAP;
      else left = around.left - GAP - width;
      if (!fitsRight && !fitsLeft) left = x + 12; // too wide to go beside it
      top = (around.top + around.bottom) / 2 - height / 2;
    }
    this.el.style.left = `${Math.max(8, Math.min(left, innerWidth - width - 8))}px`;
    this.el.style.top = `${Math.max(8, Math.min(top, innerHeight - height - 8))}px`;
  }

  render(title, items) {
    this.items = items;
    this.body.innerHTML = `<div class="title"><span>${esc(title)}</span><button class="close" aria-label="Close">×</button></div>` + items.map((item, i) => {
      if (item.block != null) return `<div class="popup-block">${item.block}</div>`;
      if (item.section != null) return `<div class="popup-section">${esc(item.section)}</div>`;
      const disabled = item.disabled || item.info || !item.action;
      const cls = item.heading ? 'heading' : item.info ? 'info' : item.unavailable ? 'unavailable' : '';
      return `<button data-i="${i}" class="${cls}" ${disabled ? 'disabled' : ''}>
        <span class="label">${esc(item.label)}</span><span class="note">${esc(item.note ?? '')}</span>
      </button>`;
    }).join('');
    // shown (at once, for measuring) unless it's on its way out: then
    // show() brings it back with an entrance
    if (!this.el.classList.contains('leaving')) this.el.classList.remove('hidden');
  }

  hide() {
    reveal(this.el, false, { from: isNarrow() ? [0, 40] : [0, 4] });
  }
}
