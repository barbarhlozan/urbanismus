// Screen furniture: the town's name and numbers (top-left), controls
// (top-right), the active tool's actions (bottom centre), Build menu
// (bottom-right, see buildMenu.js), app name and version (bottom-left).
// The name can be edited in place; the arrow beside it folds the numbers away.
// The controls fold into their menu button: on phones they start folded and
// open as a list, folding again once a button is used or on a tap elsewhere;
// on wider screens they stay a row and the fold is remembered.
// The numbers change only every few seconds, so they don't flicker.

const REFRESH_MS = 5000;

import { STRUCTURE_TYPES, levelOf } from '../../structures/index.js';
import { BuildMenu } from './buildMenu.js';
import { statIcon } from './icons.js';
import { resize, shrink } from './motion.js';
import { CONFIG } from '../config.js';
import { isNarrow } from './device.js';

const MENU_KEY = 'urbanismus.controlsFolded';
const MENU_ICON = `<svg class="icon menu-icon" viewBox="0 0 16 16" aria-hidden="true">
  <path class="bars" d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/><path class="cross" d="M4 4l8 8M12 4l-8 8"/></svg>`;

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
// one number with its drawing; the label shows on hover
const stat = (icon, label, v, cls = '') => `<span class="stat ${cls}" title="${label}">${statIcon(icon)}<b>${v}</b></span>`;

export class Hud {
  constructor(root, { world, tools, agents, trains, actions }) {
    this.world = world;
    this.trains = trains;
    this.tools = tools;
    this.agents = agents;

    root.insertAdjacentHTML('beforeend', `
      <div class="hud">
        <div class="title"><label class="name-label"><span class="name-box"><input class="name" value="${esc(world.name)}" maxlength="40" spellcheck="false" autocomplete="off" aria-label="Town name"><span class="name sizer" aria-hidden="true"></span></span>${statIcon('pen')}</label><button class="close fold" title="Fold away the numbers" aria-expanded="true">–</button></div>
        <div class="stats row"></div>
        <div class="traffic row"></div>
      </div>
      <div class="credit">${CONFIG.app.name} <span>v${CONFIG.app.version}</span> · ${CONFIG.app.author}</div>
      <div class="controls">
        <button data-act="terrain" title="Terrain contour lines">Terrain</button>
        <button data-act="colors" title="Colors"></button>
        <button data-act="assets" title="All the buildings and structures in the game">Assets</button>
        <button data-act="debug" title="Debug panel: drawing switches and frame rate">Debug</button>
        <button data-act="export" title="Download this city as a file, to open on another computer">Export</button>
        <button data-act="import" title="Open a city from a file (replaces this one)">Import</button>
        <button data-act="newMap" title="Discard this city and generate a new map">New map</button>
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
    foldBtn.addEventListener('click', () => {
      let folded;
      resize(hudEl, () => { folded = hudEl.classList.toggle('folded'); });
      foldBtn.setAttribute('aria-expanded', String(!folded));
      foldBtn.title = folded ? 'Show the numbers' : 'Fold away the numbers';
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
      menuBtn.title = folded ? 'Show the menu' : 'Fold the menu away';
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

    this.buildMenu = new BuildMenu(root, tools);

    // (cars parking change nothing here, and happen all the time)
    world.events.on('*', (type) => { if (type !== 'parking:changed') this.statsDirty = true; });
    this.statsDirty = true;
  }

  update() {
    const actions = this.tools.actions();
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
      const html = stat('walk', 'On foot', count.walk) + stat('cycle', 'Cycling', count.cycle)
        + stat('drive', 'Driving', count.drive) + (trucks ? stat('truck', 'Trucks', trucks) : '')
        + (buses ? stat('bus', 'Buses', buses) : '');
      if (html !== this.trafficHTML) this.trafficEl.innerHTML = this.trafficHTML = html;
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
      const def = STRUCTURE_TYPES[s.type];
      for (const [k, v] of Object.entries(levelOf(def, s).stats ?? {})) totals[k] = (totals[k] ?? 0) + v;
    }
    const html = stat('residents', 'Residents', totals.residents ?? 0)
      + stat('jobs', 'Jobs', totals.jobs ?? 0)
      + stat('buildings', 'Buildings', world.structures.size)
      + (unconnected ? stat('cutoff', `${unconnected} cut off from the roads`, unconnected, 'warn') : '');
    if (html !== this.statsHTML) this.statsEl.innerHTML = this.statsHTML = html;
  }
}
