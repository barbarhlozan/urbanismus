// Screen furniture: the town's name and numbers (top-left), controls
// (top-right), Build menu (bottom centre, see buildMenu.js) with photo
// mode's options just above it, app name and version (bottom-left).
// Photo and Terrain sit in the Build menu, under Erase; the controls keep
// what's set now and then (colours, files, language…).
// The name can be edited in place; the arrow beside it folds the numbers away.
// The controls fold into their menu button: on phones they start folded and
// open as a list, folding again once a button is used or on a tap elsewhere;
// on wider screens they stay a row and the fold is remembered.
// The numbers change only every few seconds, so they don't flicker.

const REFRESH_MS = 5000;

import { STRUCTURE_TYPES } from '../../structures/index.js';
import { BuildMenu } from './buildMenu.js';
import { statIcon, controlIcon } from './icons.js';
import { resize, shrink, bump } from './motion.js';
import { CONFIG } from '../config.js';
import { isNarrow } from './device.js';
import { t, language, LANGUAGES } from '../core/text.js';

const MENU_KEY = 'urbanismus.controlsFolded';
const MENU_ICON = `<svg class="icon menu-icon" viewBox="0 0 16 16" aria-hidden="true">
  <path class="bars" d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/><path class="cross" d="M4 4l8 8M12 4l-8 8"/></svg>`;

// The numbers in a row that changed since last time give a little hop
// (not the first time round: nothing has changed yet).
function hop(row, seen) {
  for (const s of row.querySelectorAll('.stat')) {
    const v = s.querySelector('b')?.textContent;
    if (seen.has(s.title) && seen.get(s.title) !== v) bump(s.querySelector('b'));
    seen.set(s.title, v);
  }
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
// one number with its drawing; the label shows on hover
const stat = (icon, label, v, cls = '') => `<span class="stat ${cls}" title="${label}">${statIcon(icon)}<b>${v}</b></span>`;

// a button in the controls: its drawing and its name (control.<act>), also
// on hover for when the name is hidden (narrow screens)
const control = (act, title = t(`control.${act}`), label = title) =>
  `<button data-act="${act}" title="${title}">${controlIcon(act)}<span class="label">${label}</span></button>`;

export class Hud {
  constructor(root, { world, tools, agents, trains, chronicle, actions }) {
    this.world = world;
    this.chronicle = chronicle;
    this.trains = trains;
    this.tools = tools;
    this.agents = agents;

    root.insertAdjacentHTML('beforeend', `
      <div class="hud">
        <div class="title"><label class="name-label"><span class="name-box"><input class="name" value="${esc(world.name)}" maxlength="40" spellcheck="false" autocomplete="off" aria-label="${t('town.name')}"><span class="name sizer" aria-hidden="true"></span></span>${statIcon('pen')}</label><button class="close chron" title="${t('hud.chronicle')}">${statIcon('book')}</button><button class="close fold" title="${t('hud.fold')}" aria-expanded="true">–</button></div>
        <div class="stats row"></div>
        <div class="traffic row"></div>
      </div>
      <div class="credit">${CONFIG.app.name} <span>v${CONFIG.app.version}</span> · ${CONFIG.app.author}</div>
      <div class="controls">
        <button data-act="colors" title="${t('control.colors')}" data-label="${t('control.colors')}"></button>
        ${control('assets')}
        ${control('debug')}
        ${control('export')}
        ${control('import')}
        ${control('newMap')}
        ${control('fullscreen', t('fullscreen'), t('fullscreen'))}
        ${control('language', `${t('control.language')}: ${LANGUAGES[language()]}`, LANGUAGES[language()])}
        <button class="close menu-toggle" aria-expanded="true">${MENU_ICON}</button>
      </div>
      <div class="bottom">
        <div class="actions hidden"></div>
      </div>`);

    this.statsEl = root.querySelector('.hud .stats');
    this.trafficEl = root.querySelector('.hud .traffic');
    this.trafficAt = -Infinity; // ms of the last traffic count
    this.statsAt = -Infinity;   // ms of the last stats count

    const hudEl = root.querySelector('.hud');
    const foldBtn = root.querySelector('.hud .fold');
    this.chronEl = root.querySelector('.hud .chron');
    this.chronEl.addEventListener('click', () => actions.chronicle());
    foldBtn.addEventListener('click', () => {
      let folded;
      resize(hudEl, () => { folded = hudEl.classList.toggle('folded'); });
      foldBtn.setAttribute('aria-expanded', String(!folded));
      foldBtn.title = t(folded ? 'hud.unfold' : 'hud.fold');
      foldBtn.textContent = folded ? '+' : '–';
    });

    // the town's name: typed over in place, kept in the save
    const nameEl = root.querySelector('.hud input.name');
    // an invisible copy of the text sets the box's width: inputs can't hug their text
    const sizerEl = root.querySelector('.hud .sizer');
    const fitName = () => { sizerEl.textContent = nameEl.value || ' '; };
    nameEl.addEventListener('input', fitName);
    const showName = () => {
      fitName();
      document.title = `${world.name} · ${CONFIG.app.name}`;
    };
    const commit = () => {
      world.rename(nameEl.value);
      nameEl.value = world.name; // an empty name puts the old one back
      showName();
    };
    nameEl.addEventListener('change', commit);
    nameEl.addEventListener('keydown', (e) => {
      e.stopPropagation(); // no hotkeys while typing
      if (e.key === 'Enter') nameEl.blur();
      if (e.key === 'Escape') { nameEl.value = world.name; fitName(); nameEl.blur(); }
    });
    nameEl.addEventListener('focus', () => nameEl.select());
    showName();

    this.actionsEl = root.querySelector('.actions');
    this.actionsEl.addEventListener('click', (e) => {
      const i = e.target.closest('button')?.dataset.i;
      if (i != null) {
        tools.runAction(Number(i));
        this.lastActions = null;
      }
    });

    // let other panels (event log) sit above the bottom bar, whatever its height
    const bottomEl = root.querySelector('.bottom');
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--bottom-h', `${bottomEl.offsetHeight}px`);
    }).observe(bottomEl);

    const controlsEl = root.querySelector('.controls');
    const menuBtn = controlsEl.querySelector('.menu-toggle');
    const fold = (folded, remember = false, animate = true) => {
      const apply = () => controlsEl.classList.toggle('folded', folded);
      // folding: the buttons fade while the bar shrinks to its menu button;
      // unfolding: the bar grows back out of it
      if (!animate || folded === controlsEl.classList.contains('folded')) apply();
      else if (folded) shrink(controlsEl, apply);
      else resize(controlsEl, apply);
      menuBtn.setAttribute('aria-expanded', String(!folded));
      menuBtn.title = t(folded ? 'controls.unfold' : 'controls.fold');
      if (remember) {
        try { localStorage.setItem(MENU_KEY, folded ? '1' : '0'); } catch { /* storage unavailable */ }
      }
    };
    let folded = isNarrow();
    if (!folded) {
      try { folded = localStorage.getItem(MENU_KEY) === '1'; } catch { /* storage unavailable */ }
    }
    fold(folded, false, false);
    controlsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn === menuBtn) return fold(!controlsEl.classList.contains('folded'), !isNarrow());
      const act = btn?.dataset.act;
      if (!act) return;
      if (isNarrow()) fold(true); // the list would cover the panel it opens
      actions[act]?.();
    });
    document.addEventListener('pointerdown', (e) => {
      if (isNarrow() && !controlsEl.contains(e.target)) fold(true);
    }, true);

    this.buildMenu = new BuildMenu(root, tools, actions);

    // (cars parking change nothing here, and happen all the time)
    world.events.on('*', (type) => { if (type !== 'parking:changed') this.statsDirty = true; });
    this.statsDirty = true;
  }

  update() {
    // a dot on the book while there's something new in it
    const unread = !!this.chronicle?.unread;
    if (unread !== this.unread) this.chronEl.classList.toggle('new', (this.unread = unread));
    // a Build menu tool's options sit beside it in the folded menu's dock;
    // anything else's (photo mode), or with the menu open, in the bar here
    let actions = this.tools.actions();
    if (this.buildMenu.dock(actions)) actions = [];
    const actionsKey = actions.map((a) => a.label).join('|');
    if (actionsKey !== this.lastActions) {
      this.lastActions = actionsKey;
      this.actionsEl.classList.toggle('hidden', !actions.length);
      this.actionsEl.innerHTML = actions
        .map((a, i) => `<button data-i="${i}">${a.key ? `<span class="key">${a.key}</span>` : ''}${a.label}</button>`)
        .join('');
    }
    // touch the DOM only on a change: any write restyles the page (the
    // map's SVGs included), too slow to do every frame
    const now = performance.now();
    if (this.statsDirty && now - this.statsAt >= REFRESH_MS) {
      this.statsAt = now;
      this.renderStats();
    }
    if (now - this.trafficAt >= REFRESH_MS) {
      this.trafficAt = now;
      const count = { walk: 0, cycle: 0, drive: 0 };
      let trucks = 0, buses = 0;
      for (const a of this.agents.visible()) {
        if (a.bus) buses++;
        else if (a.truck) trucks++;
        else count[a.trip.mode === 'drive' || a.trip.mode === 'cycle' ? a.trip.mode : 'walk']++;
      }
      const html = stat('walk', t('stat.walk'), count.walk) + stat('cycle', t('stat.cycle'), count.cycle)
        + stat('drive', t('stat.drive'), count.drive) + (trucks ? stat('truck', t('stat.trucks'), trucks) : '')
        + (buses ? stat('bus', t('stat.buses'), buses) : '')
        + `<span class="stat weather" title="${t(`weather.${this.world.weather.kind}`)}">${statIcon(this.world.weather.kind)}</span>`;
      if (html !== this.trafficHTML) {
        this.trafficEl.innerHTML = this.trafficHTML = html;
        hop(this.trafficEl, this.trafficSeen ??= new Map());
      }
    }
  }

  renderStats() {
    this.statsDirty = false;
    const { world } = this;
    const totals = {};
    let unconnected = 0;
    for (const s of world.structures.values()) {
      if (!world.isServed(s)) {
        unconnected++;
        continue;
      }
      for (const [k, v] of Object.entries(STRUCTURE_TYPES[s.type].stats ?? {})) totals[k] = (totals[k] ?? 0) + v;
    }
    const html = stat('residents', t('stat.residents'), totals.residents ?? 0)
      + stat('jobs', t('stat.jobs'), totals.jobs ?? 0)
      + stat('buildings', t('stat.buildings'), world.structures.size)
      + (unconnected ? stat('cutoff', t('stat.cutoff', { n: unconnected }), unconnected, 'warn') : '');
    if (html !== this.statsHTML) {
      this.statsEl.innerHTML = this.statsHTML = html;
      hop(this.statsEl, this.statsSeen ??= new Map());
    }
  }
}
