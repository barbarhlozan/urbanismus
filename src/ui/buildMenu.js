// The Build menu, in the middle of the bottom edge: a row of tabs for the groups (CATEGORIES),
// each shown by a drawing (a road, a house, a park, a chapel), over a grid
// of that group's tools – the building's own drawing, its name, its key –
// and, along the bottom, a box of loose things, each a small drawing with
// its name: Zpět (Undo) and, right after an undo, Znovu (Redo), then Erase,
// Terrain (the contour lines, a setting: tools/terrain.js) and last the
// camera (photo mode, also P). It folds away to the dock: a Build button,
// or, while a tool is in hand, that tool's drawing and name with its
// options (size, rotate, another look…) beside it and an × to put it down.
// The dock serves photo mode too, but leads with what it's for instead of
// the tool's drawing and name: Vyfotit (Take a picture) in plain words,
// not boxed, pressing it takes the picture (the tool's `lead`); then the
// lens and Move. Terrain has a small box in its corner, crossed while it's on
// (penMarks.js); Zpět is struck through while there is nothing to take
// back (historyOffer.js decides what is offered); Terrain and the history
// are left out in photo mode, while the camera stays, boxed, to put it
// down again. Zpět and Znovu run the same code as ⌘Z (main.js takeBack).
// On a narrow screen the box is the panel's bottom row with Erase, Terrain
// and the camera only, the panel being folded most of the time: Zpět and
// Znovu stand in the dock there instead, beside the Build button or before
// the × of the tool in hand. The tool in hand has its name boxed in the
// thick pen, the chosen tab and tile are boxed in the thin pen
// (penMarks.js).
//
// Keys (ui/keys.js): the number row opens a group, the letter rows pick a
// tool in the open group, its tiles in reading order – the keys shown on
// the tabs and tiles, given out again whenever what's unlocked changes.
//
// Clicking the active tool again puts it down: that's select mode (the
// default tool has no entry). Picking a tool (here or by its key) folds the
// panel, to give the map back; it opens again when the tool is put down.
// On narrow screens it starts folded and stays so.
//
// On a wide screen (device.js isWide) it's laid out differently: the tabs
// stand in a rail along the right edge, under the top bar, with the loose
// things in a box of their own below them, drawings alone, and the panel is a drawer of tiles opening to
// the rail's left;
// a tab opens its group, or folds the drawer if it's the one showing. The
// dock keeps the middle of the bottom edge, there only while a tool is in
// hand. Picking a tool folds the drawer, and it stays folded when the tool
// is put down: the rail is enough to come back.

import { CATEGORIES } from '../../structures/index.js';
import { toolIcon, cameraIcon } from './icons.js';
import { iconSvg, drawing } from './uiIcons.js';
import { historyOffer } from './historyOffer.js';
import { isNarrow, isWide } from './device.js';
import { keyLabel, GROUP_KEYS, slotKey } from './keys.js';
import { corner, drawer, fadeIn, cascade } from './motion.js';
import { t } from '../core/text.js';

// a group's name on screen (its own `label` is what story/unlocks.txt matches)
const groupName = (c) => t(`group.${c.id}`);

const FOLD_KEY = 'urbanismus.buildMenuFolded';
const GROUP_KEY = 'urbanismus.buildMenuGroup';

// Each group's tab shows its sprite, icons/ui/tab-<group>.svg; without
// one, the drawing of the tool here
const TAB_ICON = { transport: 'road', housing: 'build:house', work: 'build:textilka', farming: 'build:jzd', amenities: 'build:jednota', spaces: 'build:green', heritage: 'build:chapel' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Tool options in the dock as small drawings, by what they do (their
// `icon`), each read from its file in icons/ui/ (uiIcons.js); options
// without one keep their words. The drawings written here, on a 16×16 box,
// stand in for a file that can't be read.
const OPTION_ART = {
  rotate: '<path d="M12.6 6.2 A5 5 0 1 0 13 9.6 M12.9 2.8 V6.4 H9.3"/>',
  // a line's bend: which way it goes first, from the dot where it starts
  'bend-diagonal': '<path d="M2.5 12.5 L8 7 H13.5"/><circle cx="2.5" cy="12.5" r="1.1"/>',
  'bend-straight': '<path d="M2.5 12.5 H8 L13.5 7"/><circle cx="2.5" cy="12.5" r="1.1"/>',
  'another-look': '<path d="M2.5 2.5 H13.5 V13.5 H2.5 Z"/><circle cx="5.5" cy="5.5" r="0.9"/><circle cx="10.5" cy="10.5" r="0.9"/><circle cx="8" cy="8" r="0.9"/>',
  // taking a step back, and putting it back: a hooked arrow each way
  undo: '<path d="M5.8 3.6 L2.9 6.7 L6 9.6 M3 6.7 H9.4 C11.9 6.7 13.4 8.4 13.2 10.6 C13 12.2 11.9 13.1 10.4 13.2"/>',
  redo: '<path d="M10.2 3.6 L13.1 6.7 L10 9.6 M13 6.7 H6.6 C4.1 6.7 2.6 8.4 2.8 10.6 C3 12.2 4.1 13.1 5.6 13.2"/>',
  // the lie of the land: a small range of pointed mountains, the tallest
  // with its snow line, a low one in front
  terrain: '<path d="M1.2 12.6 L4.1 8.6 L5.6 10.5 M4.6 9.3 L8.2 3.5 L10.7 7.7 L12.3 5.8 L15 12.6 M6.9 5.7 L7.7 6.5 L8.6 5.8 L9.6 6.1 M0.8 12.7 C5.2 12.5 10.6 12.8 15.2 12.6"/>',
};

const option = (icon) => (icon in OPTION_ART ? iconSvg(icon, 'class="icon opt-icon"', OPTION_ART[icon]) : undefined);

export class BuildMenu {
  constructor(root, tools, actions = {}, history = null) {
    this.tools = tools;
    this.history = history;
    const shown = tools.list().filter((t) => t.toolbar !== false);
    this.groups = CATEGORIES.filter((c) => shown.some((t) => t.group === c.id));
    let saved = null;
    try { saved = localStorage.getItem(GROUP_KEY); } catch { /* storage unavailable */ }
    this.group = this.groups.some((g) => g.id === saved) ? saved : this.groups[0]?.id;

    const tile = (t) => `
      <button class="bm-tool" data-tool="${t.id}" data-group="${t.group ?? ''}" title="${esc(t.label)}${t.hotkey ? ` (${esc(keyLabel(t.hotkey))})` : ''}" data-label="${esc(t.label)}">
        <span class="bm-icon">${toolIcon(t)}</span>
        <span class="bm-name">${esc(t.label)}</span>
        <span class="key">${esc(t.hotkey ? keyLabel(t.hotkey) : '')}</span>
      </button>`;
    // Zpět, Znovu and Terrain beside Erase: a drawing and its name
    const act = (name, icon, label, attrs = '', more = '') => `
      <button class="bm-act ${more}" data-act="${name}" ${attrs} title="${esc(label)}" aria-label="${esc(label)}">
        <span class="bm-icon">${option(icon)}</span>
        <span class="bm-name">${esc(label)}</span>
      </button>`;
    const tabIcon = (c) => {
      const d = drawing(`tab-${c.id}`, '');
      if (d.file) return `<svg class="icon sprite" viewBox="${d.viewBox}" aria-hidden="true">${d.art}</svg>`;
      const t = tools.list().find((x) => x.id === TAB_ICON[c.id]) ?? shown.find((x) => x.group === c.id);
      return t ? toolIcon(t) : '';
    };

    this.el = document.createElement('div');
    this.el.className = 'build-menu';
    this.el.innerHTML = `
      <div class="bm-rail"><div class="bm-rail-box"></div><div class="bm-rail-box"></div></div>
      <div class="bm-panel">
        <div class="bm-head">
          <div class="bm-tabs" role="tablist">${this.groups.map((c) => `
            <button class="bm-tab" role="tab" data-tab="${c.id}" title="${esc(groupName(c))}" aria-label="${esc(groupName(c))}">${tabIcon(c)}<span class="key"></span></button>`).join('')}
          </div>
          <span class="bm-title"></span>
          <button class="close bm-fold" aria-label="${t('build.fold')}">–</button>
        </div>
        <div class="bm-body">
          <div class="bm-caption"></div>
          ${this.groups.map((c) => `
            <div class="bm-tools hidden" data-group="${c.id}">${shown.filter((t) => t.group === c.id).map(tile).join('')}</div>`).join('')}
        </div>
        <div class="bm-loose">
          ${act('undo', 'undo', t('undo'), 'disabled', 'bm-hist')}
          ${act('redo', 'redo', t('redo'), 'hidden', 'bm-hist')}
          ${shown.filter((t) => !t.group).map(tile).join('')}
          ${act('terrain', 'terrain', t('terrain'), 'aria-pressed="false"')}
          <button class="bm-camera" data-act="photo" title="${t('control.photo')} (P)" aria-label="${t('control.photo')}" aria-pressed="false">
            <span class="bm-icon">${cameraIcon()}</span>
            <span class="bm-name">${t('control.photo')}</span>
          </button>
        </div>
      </div>
      <div class="bm-dock">
        <button class="bm-toggle" aria-label="${t('build.open')}"><span class="bm-label">${t('build')}</span></button>
        <span class="bm-opts"></span>
        <span class="bm-history">
          <button data-act="undo" hidden title="${t('undo')}" aria-label="${t('undo')}">${option('undo')}<span>${t('undo')}</span></button>
          <button data-act="redo" hidden title="${t('redo')}" aria-label="${t('redo')}">${option('redo')}<span>${t('redo')}</span></button>
        </span>
        <button class="bm-drop" title="${t('build.drop')} (Esc)" aria-label="${t('build.drop')}">×<span class="key">Esc</span></button>
      </div>`;
    root.appendChild(this.el);
    this.panelEl = this.el.querySelector('.bm-panel');
    this.dockEl = this.el.querySelector('.bm-dock');
    this.toggleEl = this.el.querySelector('.bm-toggle');
    this.labelEl = this.el.querySelector('.bm-label');
    this.optsEl = this.el.querySelector('.bm-opts');
    this.undoEl = this.el.querySelector('.bm-dock [data-act="undo"]');
    this.redoEl = this.el.querySelector('.bm-dock [data-act="redo"]');
    this.terrainEl = this.el.querySelector('.bm-loose [data-act="terrain"]');
    this.looseUndoEl = this.el.querySelector('.bm-loose [data-act="undo"]');
    this.looseRedoEl = this.el.querySelector('.bm-loose [data-act="redo"]');
    this.cameraEl = this.el.querySelector('.bm-camera');
    this.captionEl = this.el.querySelector('.bm-caption');
    this.titleEl = this.el.querySelector('.bm-title');
    this.bodyEl = this.el.querySelector('.bm-body');
    this.railEl = this.el.querySelector('.bm-rail');
    this.headEl = this.el.querySelector('.bm-head');
    this.tabsEl = this.el.querySelector('.bm-tabs');
    this.looseEl = this.el.querySelector('.bm-loose');
    this.layout();
    addEventListener('resize', () => { this.layout(); this.place(); });
    // (the rail grows or shrinks as groups unlock)
    new ResizeObserver(() => this.place()).observe(this.railEl);

    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.classList.contains('bm-fold')) return this.fold(true);
      if (btn.dataset.act) return actions[btn.dataset.act]?.();
      if (btn.classList.contains('bm-toggle')) return tools.active?.lead ? tools.active.lead.run() : this.fold(false);
      if (btn.classList.contains('bm-drop')) return tools.use(tools.defaultId);
      if (btn.dataset.opt != null) {
        tools.runAction(Number(btn.dataset.opt));
        this.optsKey = null; // (redrawn: a size or bend shows its new value)
        return;
      }
      if (btn.dataset.tab) {
        if (!this.rail) return this.openGroup(btn.dataset.tab);
        // the rail: a tab opens its group, or folds the drawer it's showing
        if (btn.dataset.tab === this.group && !this.folded) return this.fold(true);
        this.openGroup(btn.dataset.tab);
        if (this.folded) this.fold(false);
        return;
      }
      const id = btn.dataset.tool;
      if (!id) return;
      if (tools.active?.id === id) return tools.use(tools.defaultId);
      tools.use(id);
    });

    this.showHistory();
    history?.onChange(() => this.showHistory());

    tools.onChange((tool) => {
      this.showHistory();
      if (tool.group) this.openGroup(tool.group, false);
      for (const b of this.el.querySelectorAll('.bm-tool')) {
        b.classList.toggle('active', b.dataset.tool === tool.id);
        b.setAttribute('aria-pressed', String(b.dataset.tool === tool.id));
      }
      // (photo mode isn't in the menu, but it's held in the dock all the same)
      const picked = tool.id !== tools.defaultId;
      this.cameraEl.classList.toggle('on', tool.id === 'photo');
      this.cameraEl.setAttribute('aria-pressed', String(tool.id === 'photo'));
      this.labelEl.textContent = tool.lead?.label ?? (picked ? tool.label : t('build'));
      this.el.classList.toggle('has-lead', !!tool.lead);
      this.toggleEl.setAttribute('aria-label', tool.lead?.label ?? t('build.open'));
      this.el.classList.toggle('has-tool', picked);
      this.optsKey = null;
      // out of the way while building or taking photos (their options are
      // in the dock), back when done (unless it was folded before);
      // the rail's drawer stays folded when the tool is put down
      const busy = tool.id !== tools.defaultId;
      if (this.rail) {
        if (busy && !this.folded) this.fold(true, false);
      } else if (busy && !this.folded) {
        this.fold(true, false);
        this.autoFolded = !isNarrow();
      } else if (!busy && this.autoFolded) {
        this.fold(false, false);
      }
    });

    this.showGroup(false);
    this.giveKeys(this.groups);
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
    this.giveKeys(open);
  }

  // Keys for what's shown: a number for each open group's tab, and in each
  // group a letter for each tool, by where its tile sits (slotKey) in the
  // drawer's two columns or the panel's four (styles.css).
  giveKeys(open) {
    this.keyedGroups = open;
    const cols = this.rail ? 2 : 4;
    this.groupKeys = new Map(open.map((g, i) => [GROUP_KEYS[i], g.id]));
    this.slotKeys = new Map(); // group id -> Map(key -> tool id)
    for (const tab of this.el.querySelectorAll('.bm-tab')) {
      const k = [...this.groupKeys].find(([, id]) => id === tab.dataset.tab)?.[0];
      tab.querySelector('.key').textContent = k ?? '';
      tab.title = k ? `${tab.getAttribute('aria-label')} (${k})` : tab.getAttribute('aria-label');
    }
    for (const g of this.groups) {
      const keys = new Map();
      const tiles = [...this.el.querySelectorAll(`.bm-tools[data-group="${g.id}"] .bm-tool:not(.locked)`)];
      tiles.forEach((b, i) => {
        const k = slotKey(i, cols);
        if (k) keys.set(k, b.dataset.tool);
        b.querySelector('.key').textContent = k ? keyLabel(k) : '';
        b.title = k ? `${b.dataset.label} (${keyLabel(k)})` : b.dataset.label;
      });
      this.slotKeys.set(g.id, keys);
    }
  }

  // A key pressed on the map: a number opens its group (and the panel), a
  // letter picks up that tool of the open group (or puts it down if it's
  // the one in hand). Returns whether it was one of the menu's keys.
  key(k) {
    const group = this.groupKeys?.get(k);
    if (group) {
      this.openGroup(group);
      if (this.folded) this.fold(false);
      return true;
    }
    const id = this.slotKeys?.get(this.group)?.get(k);
    if (!id) return false;
    this.tools.use(this.tools.active?.id === id ? this.tools.defaultId : id);
    return true;
  }

  get folded() {
    return this.el.classList.contains('folded');
  }

  // The rail on a wide screen, the panel over the dock otherwise: the tabs
  // and Erase move between the rail and the panel.
  layout() {
    const rail = isWide();
    if (rail === this.rail) return;
    this.rail = rail;
    this.el.classList.toggle('rail', rail);
    if (this.keyedGroups) this.giveKeys(this.keyedGroups); // (the columns changed)
    // (the groups and the rest each in a box of their own, a gap between)
    if (rail) {
      const [groups, rest] = this.railEl.children;
      groups.append(this.tabsEl);
      rest.append(this.looseEl);
    }
    else {
      this.headEl.prepend(this.tabsEl);
      this.panelEl.append(this.looseEl);
    }
    this.place();
  }

  // The rail halfway down the window (but under the top bar), the drawer
  // beside it from the rail's top – or starting higher, up to the top bar,
  // when its group wouldn't fit below that; only then does it scroll.
  place() {
    const s = this.el.style, p = this.panelEl.style;
    if (!this.rail) {
      s.top = p.marginTop = p.maxHeight = '';
      return;
    }
    const bar = parseFloat(getComputedStyle(this.el).getPropertyValue('--bar-h')) || 38;
    const highest = 16 + bar + 2 + 12; // under the top bar
    const room = 20 + bar + 2 + 20;    // the dock's, at the bottom
    const top = Math.max(highest, Math.round((innerHeight - this.railEl.offsetHeight) / 2));
    s.top = `${top}px`;
    if (this.folded && !this.el.classList.contains('folding')) return;
    const below = innerHeight - top - room;
    const tall = this.headEl.offsetHeight + this.bodyEl.scrollHeight + 2;
    const lift = Math.min(top - highest, Math.max(0, tall - below));
    p.marginTop = `${-lift}px`;
    p.maxHeight = `${below + lift}px`;
  }

  // A panel hanging from the top bar (Colours, Debug) opens beside the
  // rail, where the drawer is: the drawer folds to make room for it.
  makeRoom() {
    if (this.rail && !this.folded) this.fold(true, false);
  }

  // Zpět and Znovu as far as there is something to take back or put back:
  // in the dock (a narrow screen), and in the box beside Erase (a wide one),
  // where Zpět stays, struck through, when there is nothing to take back.
  showHistory() {
    const offer = this.history ? historyOffer(this.history, this.tools.active?.id) : { undo: false, redo: false };
    const photo = this.tools.active?.id === 'photo';
    this.undoEl.hidden = !offer.undo;
    this.redoEl.hidden = !offer.redo;
    this.looseUndoEl.hidden = photo;
    this.looseUndoEl.disabled = !offer.undo;
    this.looseRedoEl.hidden = !offer.redo;
    this.terrainEl.hidden = photo;
  }

  // The Terrain button shows whether the contour lines are on.
  showTerrain(on) {
    this.terrainEl.setAttribute('aria-pressed', String(on));
  }

  // The options of the tool in hand, shown in the dock while the panel is
  // folded (they wait there while it's open over it). Returns whether it
  // took them. `actions` are ToolManager.actions(); the last one is the way
  // to put the tool down, which is the dock's ×.
  dock(actions) {
    if ((!this.folded && !this.rail) || !this.el.classList.contains('has-tool')) return false;
    const opts = actions.slice(0, -1);
    const key = opts.map((a) => `${a.label}${a.on ? '+' : ''}`).join('|');
    if (key !== this.optsKey) {
      this.optsKey = key;
      this.optsEl.innerHTML = opts.map((a, i) => {
        const [name, value] = a.label.split(': ');
        const body = option(a.icon) ?? esc(value ?? name);
        const title = `${name}${value ? `: ${value}` : ''}${a.key ? ` (${a.key})` : ''}`;
        const on = a.on != null ? ` aria-pressed="${a.on}"${a.on ? ' class="on"' : ''}` : '';
        return `<button data-opt="${i}"${on} title="${esc(title)}" aria-label="${esc(title)}">${body}${a.key ? `<span class="key">${esc(a.key)}</span>` : ''}</button>`;
      }).join('');
      this.dockEl.querySelector('.bm-drop').title = `${actions.at(-1)?.label ?? t('done')} (Esc)`;
    }
    return true;
  }

  fold(folded, remember = true, animate = true) {
    this.autoFolded = false;
    const change = folded !== this.folded;
    const button = this.dockEl.getBoundingClientRect(); // (before it hides)
    this.el.classList.toggle('folded', folded);
    if (!folded) this.place();
    if (animate && change) this.animateFold(folded, button);
    if (!remember || isNarrow()) return;
    try { localStorage.setItem(FOLD_KEY, folded ? '1' : '0'); } catch { /* storage unavailable */ }
  }

  // The panel grows out of the dock, and folds back into it (kept on screen
  // by .folding meanwhile) before the dock reappears.
  animateFold(folded, button) {
    if (this.rail) return this.animateDrawer(folded);
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

  // The rail's drawer slides out to the left of it, and back in (kept on
  // screen by .folding meanwhile).
  animateDrawer(folded) {
    if (!folded) {
      this.el.classList.remove('folding');
      drawer(this.panelEl, true);
      return;
    }
    this.el.classList.add('folding');
    drawer(this.panelEl, false).then((done) => {
      if (done && this.folded) this.el.classList.remove('folding');
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
    this.captionEl.textContent = this.titleEl.textContent = (id ? groupName({ id }) : '');
    this.place();
    // the tiles of the group come in one by one
    if (animate && shown) cascade(shown.querySelectorAll('.bm-tool'));
  }
}
