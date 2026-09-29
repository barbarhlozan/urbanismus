// The Build menu, bottom-right: a vertical panel of groups (CATEGORIES), each
// opening to its tools with an icon, a line on what it does and its key, and
// tools without a group (Erase) at the bottom. It folds away to a single
// Build button, which then names the tool in hand.
//
// Only one group is open at a time. Clicking the active tool again, or
// closing its group, puts the tool down: that's select mode (the default
// tool has no entry). Picking a tool (here or by its key) folds the panel,
// to give the map back; on a wide screen it opens again when the tool is
// put down. On narrow screens it starts folded and stays so.

import { CATEGORIES } from '../../structures/index.js';
import { toolIcon } from './icons.js';
import { isNarrow } from './device.js';
import { keyLabel } from './keys.js';
import { corner, fadeIn, slide } from './motion.js';

const FOLD_KEY = 'urbanismus.buildMenuFolded';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class BuildMenu {
  constructor(root, tools) {
    this.tools = tools;
    this.group = null;

    const shown = tools.list().filter((t) => t.toolbar !== false);
    const row = (t) => `
      <button class="bm-tool" data-tool="${t.id}" data-group="${t.group ?? ''}">
        <span class="bm-icon">${toolIcon(t)}</span>
        <span class="bm-text"><span class="bm-name">${esc(t.label)}</span></span>
        <span class="key">${esc(t.hotkey ? keyLabel(t.hotkey) : '')}</span>
      </button>`;
    const groups = CATEGORIES.filter((c) => shown.some((t) => t.group === c.id));

    this.el = document.createElement('div');
    this.el.className = 'build-menu';
    this.el.innerHTML = `
      <div class="bm-panel">
        <div class="bm-head"><span>Build</span><button class="close bm-fold" aria-label="Fold the build menu">–</button></div>
        <div class="bm-body">
          ${groups.map((c) => `
            <button class="bm-group" data-tab="${c.id}"><span>${esc(c.label)}</span><span class="bm-caret"></span></button>
            <div class="bm-tools hidden" data-group="${c.id}">${shown.filter((t) => t.group === c.id).map(row).join('')}</div>`).join('')}
          <div class="bm-loose">${shown.filter((t) => !t.group).map(row).join('')}</div>
        </div>
      </div>
      <button class="bm-toggle" aria-label="Open the build menu"><span>Build</span><span class="bm-current"></span></button>`;
    root.appendChild(this.el);
    this.currentEl = this.el.querySelector('.bm-current');
    this.panelEl = this.el.querySelector('.bm-panel');
    this.toggleEl = this.el.querySelector('.bm-toggle');

    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.classList.contains('bm-fold')) return this.fold(true);
      if (btn.classList.contains('bm-toggle')) return this.fold(false);
      if (btn.dataset.tab) return this.toggleGroup(btn.dataset.tab);
      const id = btn.dataset.tool;
      if (!id) return;
      if (tools.active?.id === id) return tools.use(tools.defaultId);
      if (!btn.dataset.group) this.openGroup(null);
      tools.use(id);
    });

    tools.onChange((tool) => {
      if (tool.group) this.openGroup(tool.group);
      else if (tool.id !== tools.defaultId) this.openGroup(null);
      for (const b of this.el.querySelectorAll('.bm-tool')) b.classList.toggle('active', b.dataset.tool === tool.id);
      this.el.querySelector('.bm-tool.active')?.scrollIntoView({ block: 'nearest' });
      const picked = tool.id !== tools.defaultId;
      this.currentEl.textContent = picked ? tool.label : '';
      this.el.classList.toggle('has-tool', picked);
      // out of the way while building, back when done (unless it was folded before)
      if (picked && !this.folded) {
        this.fold(true, false);
        this.autoFolded = !isNarrow();
      } else if (!picked && this.autoFolded) {
        this.fold(false, false);
      }
    });

    let folded = isNarrow();
    try {
      const saved = localStorage.getItem(FOLD_KEY);
      if (saved != null && !isNarrow()) folded = saved === '1';
    } catch { /* storage unavailable */ }
    this.fold(folded, false, false);
  }

  get folded() {
    return this.el.classList.contains('folded');
  }

  fold(folded, remember = true, animate = true) {
    this.autoFolded = false;
    const change = folded !== this.folded;
    const button = this.toggleEl.getBoundingClientRect(); // (before it hides)
    this.el.classList.toggle('folded', folded);
    if (animate && change) this.animateFold(folded, button);
    if (!remember || isNarrow()) return;
    try { localStorage.setItem(FOLD_KEY, folded ? '1' : '0'); } catch { /* storage unavailable */ }
  }

  // The panel grows out of the Build button, and folds back into it (kept
  // on screen by .folding meanwhile) before the button reappears.
  animateFold(folded, button) {
    const size = button.width ? [button.width, button.height] : [110, 38];
    if (!folded) {
      this.el.classList.remove('folding');
      corner(this.panelEl, true, size);
      return;
    }
    this.el.classList.add('folding');
    corner(this.panelEl, false, size).then((done) => {
      if (!done || !this.el.classList.contains('folded')) return; // opened again meanwhile
      this.el.classList.remove('folding');
      fadeIn(this.toggleEl);
    });
  }

  // Open a group (null = none). A tool from another group is put down.
  openGroup(id) {
    this.group = id;
    const active = this.tools.active;
    if (active?.group && active.group !== id) this.tools.use(this.tools.defaultId);
    for (const b of this.el.querySelectorAll('.bm-group')) b.classList.toggle('open', b.dataset.tab === id);
    for (const g of this.el.querySelectorAll('.bm-tools')) slide(g, g.dataset.group === id);
  }

  toggleGroup(id) {
    if (this.group === id) return this.openGroup(null);
    if (this.tools.active && !this.tools.active.group && this.tools.active.id !== this.tools.defaultId) {
      this.tools.use(this.tools.defaultId);
    }
    this.openGroup(id);
  }
}
