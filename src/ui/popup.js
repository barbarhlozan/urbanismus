// Context menu shown when clicking a dot. On narrow screens it is a sheet
// along the bottom edge instead, within easy reach of the thumb.
// items: [{ label, note?, disabled?, info?, heading?, unavailable?, action?, keepOpen? }]
// (unavailable: can't be done here – shown crossed out in the detail colour)
// keepOpen items leave the menu open and rebuild it with `refresh()`
// (passed to show), e.g. to cycle through options.

import { isNarrow } from './device.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Popup {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'popup hidden';
    // the content scrolls inside, so the box itself (and its frame) stays put
    this.body = document.createElement('div');
    this.body.className = 'popup-body';
    this.el.appendChild(this.body);
    root.appendChild(this.el);

    this.el.addEventListener('click', (e) => {
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
    return !this.el.classList.contains('hidden');
  }

  show(x, y, title, items, refresh = null) {
    this.refresh = refresh;
    this.render(title, items);
    this.el.classList.toggle('sheet', isNarrow());
    this.body.scrollTop = 0;
    if (isNarrow()) {
      this.el.style.left = this.el.style.top = '';
      return;
    }
    const { width, height } = this.el.getBoundingClientRect();
    this.el.style.left = `${Math.max(8, Math.min(x + 12, innerWidth - width - 8))}px`;
    this.el.style.top = `${Math.max(8, Math.min(y + 12, innerHeight - height - 8))}px`;
  }

  render(title, items) {
    this.items = items;
    this.body.innerHTML = `<div class="title"><span>${esc(title)}</span><button class="close" aria-label="Close">×</button></div>` + items.map((item, i) => {
      const disabled = item.disabled || item.info || !item.action;
      const cls = item.heading ? 'heading' : item.info ? 'info' : item.unavailable ? 'unavailable' : '';
      return `<button data-i="${i}" class="${cls}" ${disabled ? 'disabled' : ''}>
        <span class="label">${esc(item.label)}</span><span class="note">${esc(item.note ?? '')}</span>
      </button>`;
    }).join('');
    this.el.classList.remove('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
  }
}
