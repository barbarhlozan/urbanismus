// The Build menu, in the middle of the bottom edge: a row of tabs for the groups (CATEGORIES),
// each shown by a drawing (a road, a house, a park, a chapel), over a grid
// of that group's tools – the building's own drawing, its name, its key –
// and tools without a group (Erase) along the bottom. It folds away to the
// dock: a Build button, or, while a tool is in hand, that tool's drawing and
// name with its options (size, rotate, another look…) beside it and an × to
// put it down.
//
// Clicking the active tool again puts it down: that's select mode (the
// default tool has no entry). Picking a tool (here or by its key) folds the
// panel, to give the map back; on a wide screen it opens again when the
// tool is put down. On narrow screens it starts folded and stays so.

import { CATEGORIES } from '../../structures/index.js';
import { toolIcon } from './icons.js';
import { isNarrow } from './device.js';
import { keyLabel } from './keys.js';
import { corner, fadeIn, cascade } from './motion.js';

const FOLD_KEY = 'urbanismus.buildMenuFolded';
const GROUP_KEY = 'urbanismus.buildMenuGroup';

// the tool whose drawing stands for each group on its tab
const TAB_ICON = { transport: 'road', zone: 'build:residential', civic: 'build:park', heritage: 'build:chapel' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Tool options in the dock as small drawings, by what they do (their label);
// options without one keep their words.
const OPTION = {
  Rotate: '<svg class="icon opt-icon" viewBox="0 0 16 16"><path d="M12.6 6.2 A5 5 0 1 0 13 9.6 M12.9 2.8 V6.4 H9.3"/></svg>',
  // a line's bend: which way it goes first, from the dot where it starts
  'Bend: diagonal first': '<svg class="icon opt-icon" viewBox="0 0 16 16"><path d="M2.5 12.5 L8 7 H13.5"/><circle cx="2.5" cy="12.5" r="1.1"/></svg>',
  'Bend: straight first': '<svg class="icon opt-icon" viewBox="0 0 16 16"><path d="M2.5 12.5 H8 L13.5 7"/><circle cx="2.5" cy="12.5" r="1.1"/></svg>',
  'Another look': '<svg class="icon opt-icon" viewBox="0 0 16 16"><path d="M2.5 2.5 H13.5 V13.5 H2.5 Z"/><circle cx="5.5" cy="5.5" r="0.9"/><circle cx="10.5" cy="10.5" r="0.9"/><circle cx="8" cy="8" r="0.9"/></svg>',
};

export class BuildMenu {
  constructor(root, tools) {
    this.tools = tools;
    const shown = tools.list().filter((t) => t.toolbar !== false);
    this.groups = CATEGORIES.filter((c) => shown.some((t) => t.group === c.id));
    let saved = null;
    try { saved = localStorage.getItem(GROUP_KEY); } catch { /* storage unavailable */ }
    this.group = this.groups.some((g) => g.id === saved) ? saved : this.groups[0]?.id;

    const tile = (t) => `
      <button class="bm-tool" data-tool="${t.id}" data-group="${t.group ?? ''}" title="${esc(t.label)}${t.hotkey ? ` (${esc(keyLabel(t.hotkey))})` : ''}">
        <span class="bm-icon">${toolIcon(t)}</span>
        <span class="bm-name">${esc(t.label)}</span>
        <span class="key">${esc(t.hotkey ? keyLabel(t.hotkey) : '')}</span>
      </button>`;
    const tabIcon = (c) => {
      const t = tools.list().find((x) => x.id === TAB_ICON[c.id]) ?? shown.find((x) => x.group === c.id);
      return t ? toolIcon(t) : '';
    };

    this.el = document.createElement('div');
    this.el.className = 'build-menu';
    this.el.innerHTML = `
      <div class="bm-panel">
        <div class="bm-head">
          <div class="bm-tabs" role="tablist">${this.groups.map((c) => `
            <button class="bm-tab" role="tab" data-tab="${c.id}" title="${esc(c.label)}" aria-label="${esc(c.label)}">${tabIcon(c)}</button>`).join('')}
          </div>
          <button class="close bm-fold" aria-label="Fold the build menu">–</button>
        </div>
        <div class="bm-body">
          <div class="bm-caption"></div>
          ${this.groups.map((c) => `
            <div class="bm-tools hidden" data-group="${c.id}">${shown.filter((t) => t.group === c.id).map(tile).join('')}</div>`).join('')}
        </div>
        <div class="bm-loose">${shown.filter((t) => !t.group).map(tile).join('')}</div>
      </div>
      <div class="bm-dock">
        <button class="bm-toggle" aria-label="Open the build menu"><span class="bm-held"></span><span class="bm-label">Build</span></button>
        <span class="bm-opts"></span>
        <button class="bm-drop" title="Put it down (Esc)" aria-label="Put it down">×<span class="key">Esc</span></button>
      </div>`;
    root.appendChild(this.el);
    this.panelEl = this.el.querySelector('.bm-panel');
    this.dockEl = this.el.querySelector('.bm-dock');
    this.toggleEl = this.el.querySelector('.bm-toggle');
    this.heldEl = this.el.querySelector('.bm-held');
    this.labelEl = this.el.querySelector('.bm-label');
    this.optsEl = this.el.querySelector('.bm-opts');
    this.captionEl = this.el.querySelector('.bm-caption');

    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.classList.contains('bm-fold')) return this.fold(true);
      if (btn.classList.contains('bm-toggle')) return this.fold(false);
      if (btn.classList.contains('bm-drop')) return tools.use(tools.defaultId);
      if (btn.dataset.opt != null) {
        tools.runAction(Number(btn.dataset.opt));
        this.optsKey = null; // (redrawn: a size or bend shows its new value)
        return;
      }
      if (btn.dataset.tab) return this.openGroup(btn.dataset.tab);
      const id = btn.dataset.tool;
      if (!id) return;
      if (tools.active?.id === id) return tools.use(tools.defaultId);
      tools.use(id);
    });

    tools.onChange((tool) => {
      if (tool.group) this.openGroup(tool.group, false);
      for (const b of this.el.querySelectorAll('.bm-tool')) b.classList.toggle('active', b.dataset.tool === tool.id);
      const picked = tool.id !== tools.defaultId && tool.toolbar !== false;
      this.heldEl.innerHTML = picked ? toolIcon(tool) : '';
      this.labelEl.textContent = picked ? tool.label : 'Build';
      this.el.classList.toggle('has-tool', picked);
      this.optsKey = null;
      // out of the way while building (or taking photos: their options bar
      // sits just above), back when done (unless it was folded before)
      const busy = tool.id !== tools.defaultId;
      if (busy && !this.folded) {
        this.fold(true, false);
        this.autoFolded = !isNarrow();
      } else if (!busy && this.autoFolded) {
        this.fold(false, false);
      }
    });

    this.showGroup(false);
    let folded = isNarrow();
    try {
      const saved = localStorage.getItem(FOLD_KEY);
      if (saved != null && !isNarrow()) folded = saved === '1';
    } catch { /* storage unavailable */ }
    this.fold(folded, false, false);
  }

  // Only what may be built (src/story/unlocks.js, through tools.allowed):
  // the other tools are left out, and so are groups with none left.
  refreshLocks() {
    const allowed = (id) => this.tools.allowed(this.tools.registry.get(id));
    for (const b of this.el.querySelectorAll('.bm-tool')) b.classList.toggle('locked', !allowed(b.dataset.tool));
    const open = this.groups.filter((g) => this.el.querySelector(`.bm-tools[data-group="${g.id}"] .bm-tool:not(.locked)`));
    for (const t of this.el.querySelectorAll('.bm-tab')) t.classList.toggle('locked', !open.some((g) => g.id === t.dataset.tab));
    if (open.length && !open.some((g) => g.id === this.group)) this.openGroup(open[0].id, false);
  }

  get folded() {
    return this.el.classList.contains('folded');
  }

  // The options of the tool in hand, shown in the dock while the panel is
  // folded (the HUD's bar at the bottom shows them otherwise). Returns
  // whether it took them. `actions` are ToolManager.actions(); the last one
  // is the way to put the tool down, which is the dock's ×.
  dock(actions) {
    if (!this.folded || !this.el.classList.contains('has-tool')) return false;
    const opts = actions.slice(0, -1);
    const key = opts.map((a) => a.label).join('|');
    if (key !== this.optsKey) {
      this.optsKey = key;
      this.optsEl.innerHTML = opts.map((a, i) => {
        const [name, value] = a.label.split(': ');
        const body = OPTION[a.label] ?? esc(value ?? name);
        const title = `${name}${value ? `: ${value}` : ''}${a.key ? ` (${a.key})` : ''}`;
        return `<button data-opt="${i}" title="${esc(title)}" aria-label="${esc(title)}">${body}${a.key ? `<span class="key">${esc(a.key)}</span>` : ''}</button>`;
      }).join('');
      this.dockEl.querySelector('.bm-drop').title = `${actions.at(-1)?.label ?? 'Done'} (Esc)`;
    }
    return true;
  }

  fold(folded, remember = true, animate = true) {
    this.autoFolded = false;
    const change = folded !== this.folded;
    const button = this.dockEl.getBoundingClientRect(); // (before it hides)
    this.el.classList.toggle('folded', folded);
    if (animate && change) this.animateFold(folded, button);
    if (!remember || isNarrow()) return;
    try { localStorage.setItem(FOLD_KEY, folded ? '1' : '0'); } catch { /* storage unavailable */ }
  }

  // The panel grows out of the dock, and folds back into it (kept on screen
  // by .folding meanwhile) before the dock reappears.
  animateFold(folded, button) {
    const size = button.width ? [button.width, button.height] : [110, 38];
    if (!folded) {
      this.el.classList.remove('folding');
      corner(this.panelEl, true, size, 'center');
      return;
    }
    this.el.classList.add('folding');
    corner(this.panelEl, false, size, 'center').then((done) => {
      if (!done || !this.el.classList.contains('folded')) return; // opened again meanwhile
      this.el.classList.remove('folding');
      fadeIn(this.dockEl);
    });
  }

  // Show a group's tools. A tool from another group is put down.
  openGroup(id, animate = true) {
    if (id === this.group) return;
    this.group = id;
    try { localStorage.setItem(GROUP_KEY, id); } catch { /* storage unavailable */ }
    const active = this.tools.active;
    if (active?.group && active.group !== id) this.tools.use(this.tools.defaultId);
    this.showGroup(animate);
  }

  showGroup(animate) {
    const id = this.group;
    for (const b of this.el.querySelectorAll('.bm-tab')) {
      b.classList.toggle('on', b.dataset.tab === id);
      b.setAttribute('aria-selected', String(b.dataset.tab === id));
    }
    let shown = null;
    for (const g of this.el.querySelectorAll('.bm-tools')) {
      g.classList.toggle('hidden', g.dataset.group !== id);
      if (g.dataset.group === id) shown = g;
    }
    this.captionEl.textContent = this.groups.find((g) => g.id === id)?.label ?? '';
    // the tiles of the group come in one by one
    if (animate && shown) cascade(shown.querySelectorAll('.bm-tool'));
  }
}
