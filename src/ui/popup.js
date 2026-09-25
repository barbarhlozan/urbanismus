// Context menu shown when clicking a dot. On narrow screens it is a sheet
// along the bottom edge instead, within easy reach of the thumb.
// items: [{ label, note?, disabled?, info?, action?, keepOpen? }]
// keepOpen items leave the menu open and rebuild it with `refresh()`
// (passed to show), e.g. to cycle through options.

import { isNarrow } from './device.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Popup {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'popup hidden';
    root.appendChild(this.el);

    this.el.addEventListener('click', (e) => {
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
    this.el.scrollTop = 0;
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
    this.el.innerHTML = `<div class="title">${esc(title)}</div>` + items.map((item, i) => {
      const disabled = item.disabled || item.info || !item.action;
      return `<button data-i="${i}" class="${item.heading ? 'heading' : item.info ? 'info' : ''}" ${disabled ? 'disabled' : ''}>
        <span class="label">${esc(item.label)}</span><span class="note">${esc(item.note ?? '')}</span>
      </button>`;
    }).join('');
    this.el.classList.remove('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
  }
}
