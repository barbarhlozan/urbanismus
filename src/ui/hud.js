// Screen furniture: the town's name and numbers (top-left), controls
// (top-right), the active tool's actions (bottom centre), Build menu
// (bottom-right, see buildMenu.js), app name and version (bottom-left).
// The name can be edited in place; the arrow beside it folds the numbers away.
// The numbers change only every few seconds, so they don't flicker.

const REFRESH_MS = 5000;

import { STRUCTURE_TYPES, levelOf } from '../../structures/index.js';
import { BuildMenu } from './buildMenu.js';
import { statIcon } from './icons.js';
import { CONFIG } from '../config.js';

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
        <div class="split"><i class="walk"></i><i class="cycle"></i><i class="drive"></i></div>
      </div>
      <div class="credit">${CONFIG.app.name} <span>v${CONFIG.app.version}</span> · ${CONFIG.app.author}</div>
      <div class="controls">
        <button data-act="terrain" title="Terrain contour lines">Terrain</button>
        <button data-act="colors" title="Colors"></button>
        <button data-act="assets" title="All the buildings and structures in the game">Assets</button>
        <button data-act="debug" title="Debug panel: drawing switches and frame rate">Debug</button>
        <button data-act="newMap" title="Discard this city and generate a new map">New map</button>
      </div>
      <div class="bottom">
        <div class="actions hidden"></div>
      </div>`);

    this.statsEl = root.querySelector('.hud .stats');
    this.trafficEl = root.querySelector('.hud .traffic');
    this.trafficAt = -Infinity; // ms of the last traffic count
    this.statsAt = -Infinity;   // ms of the last stats count

    this.splitEl = root.querySelector('.hud .split');
    const hudEl = root.querySelector('.hud');
    const foldBtn = root.querySelector('.hud .fold');
    foldBtn.addEventListener('click', () => {
      const folded = hudEl.classList.toggle('folded');
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

    root.querySelector('.controls').addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act) actions[act]?.();
    });

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
      const visitors = this.agents.visitorCount();
      const commute = this.agents.commuterCount();
      const extra = [
        visitors && `${visitors} visiting`,
        commute.inbound && `${commute.inbound} commuting in`,
        commute.outbound && `${commute.outbound} working outside`,
        this.trains.count && `${this.trains.count} ${this.trains.count === 1 ? 'train' : 'trains'}`,
      ].filter(Boolean);
      const html = stat('walk', 'On foot', count.walk) + stat('cycle', 'Cycling', count.cycle)
        + stat('drive', 'Driving', count.drive) + (trucks ? stat('truck', 'Trucks', trucks) : '')
        + (buses ? stat('bus', 'Buses', buses) : '')
        + (extra.length ? `<span class="extra" title="${extra.join(', ')}">+${extra.length}</span>` : '');
      const moving = count.walk + count.cycle + count.drive;
      for (const [i, k] of ['walk', 'cycle', 'drive'].entries()) {
        this.splitEl.children[i].style.flexGrow = moving ? count[k] : 0;
      }
      this.splitEl.classList.toggle('empty', !moving);
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
