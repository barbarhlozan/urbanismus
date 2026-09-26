// Screen furniture: stats (top-left), controls (top-right), hint and the
// active tool's actions (bottom centre), Build menu (bottom-right, see
// buildMenu.js). Tapping the stats box folds it away.

import { STRUCTURE_TYPES, levelOf } from '../../structures/index.js';
import { BuildMenu } from './buildMenu.js';
import { mapCode } from '../render/renderer.js';

export class Hud {
  constructor(root, { world, tools, agents, trains, clock, actions }) {
    this.world = world;
    this.trains = trains;
    this.tools = tools;
    this.agents = agents;
    this.clock = clock;

    root.insertAdjacentHTML('beforeend', `
      <div class="hud"><div class="title"><span>Urbanismus</span><small>MAP-${mapCode(world.seed)}</small></div><div class="stats cells"></div><div class="traffic strip"></div></div>
      <div class="controls">
        <button data-act="rotateLeft" title="Rotate (Q)">⟲</button>
        <button data-act="rotateRight" title="Rotate (E)">⟳</button>
        <button data-act="speed" title="Simulation speed (T)"><span class="long">Speed: </span><span class="val"></span></button>
        <button data-act="pause" title="Pause (P)">Pause</button>
        <button data-act="terrain" title="Terrain contour lines">Terrain</button>
        <button data-act="newMap" title="Discard this city and generate a new map">New map</button>
      </div>
      <div class="bottom">
        <div class="hint"></div>
        <div class="actions hidden"></div>
      </div>`);

    this.statsEl = root.querySelector('.hud .stats');
    this.trafficEl = root.querySelector('.hud .traffic');
    this.trafficTimer = 0;
    this.hintEl = root.querySelector('.hint');
    this.pauseBtn = root.querySelector('[data-act="pause"]');
    this.speedBtn = root.querySelector('[data-act="speed"]');
    this.speedVal = this.speedBtn.querySelector('.val');

    const hudEl = root.querySelector('.hud');
    hudEl.addEventListener('click', () => hudEl.classList.toggle('folded'));

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

    world.events.on('*', () => (this.statsDirty = true));
    this.statsDirty = true;
  }

  update() {
    const hint = this.tools.hint();
    if (hint !== this.lastHint) this.hintEl.textContent = this.lastHint = hint;
    const actions = this.tools.actions();
    const actionsKey = actions.map((a) => a.label).join('|');
    if (actionsKey !== this.lastActions) {
      this.lastActions = actionsKey;
      this.actionsEl.classList.toggle('hidden', !actions.length);
      this.actionsEl.innerHTML = actions
        .map((a, i) => `<button data-i="${i}">${a.key ? `<span class="key">${a.key}</span>` : ''}${a.label}</button>`)
        .join('');
    }
    const { paused, speed } = this.clock;
    this.pauseBtn.classList.toggle('on', paused);
    this.pauseBtn.textContent = paused ? 'Paused' : 'Pause';
    if (this.speedVal.textContent !== speed.name) this.speedVal.textContent = speed.name;
    this.speedBtn.classList.toggle('on', speed.scale !== 1);
    if (this.statsDirty) this.renderStats();
    if (this.trafficTimer-- <= 0) {
      this.trafficTimer = 20;
      const count = { walk: 0, cycle: 0, drive: 0 };
      for (const a of this.agents.visible()) count[a.trip.mode === 'stroll' ? 'walk' : a.trip.mode]++;
      const visitors = this.agents.visitorCount();
      const commute = this.agents.commuterCount();
      const flow = this.agents.flow ?? 1;
      const traffic = !count.drive ? '' : flow > 0.85 ? 'flowing' : flow > 0.55 ? 'busy' : 'jammed';
      const item = (k, v) => `<span>${k}<b>${v}</b></span>`;
      this.trafficEl.innerHTML = item('On foot', count.walk) + item('Cycling', count.cycle) + item('Driving', count.drive)
        + (traffic ? item('Traffic', `${traffic} ${Math.round(flow * 100)}%`) : '')
        + (visitors ? item('Visitors', visitors) : '')
        + (commute.inbound ? item('Commuting in', commute.inbound) : '')
        + (commute.outbound ? item('Working outside', commute.outbound) : '')
        + (this.trains.count ? item('Trains', this.trains.count) : '');
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
    const cells = [
      ['Residents', totals.residents ?? 0],
      ['Jobs', totals.jobs ?? 0],
      ['Buildings', world.structures.size],
      ['Road', world.roads.edgeCount],
      ['Paths', world.paths.edgeCount],
    ];
    if (world.rails.edgeCount) cells.push(['Rail', world.rails.edgeCount]);
    if (unconnected) cells.push(['No road', unconnected]);
    this.statsEl.innerHTML = cells.map(([k, v]) => `<div class="cell"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  }
}
