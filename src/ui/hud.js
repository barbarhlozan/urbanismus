// Screen furniture: stats (top-left), controls (top-right), toolbar, hint and
// the active tool's actions (bottom). Toolbar buttons are generated from the
// registered tools. Tools with a `group` (building categories) sit behind
// tabs; the rest are always shown. Tapping the stats box folds it away.

import { STRUCTURE_TYPES, CATEGORIES, levelOf } from '../../structures/index.js';
import { mapCode } from '../render/renderer.js';

export class Hud {
  constructor(root, { world, tools, agents, clock, actions }) {
    this.world = world;
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
        <div class="tabs"></div>
        <div class="toolbar"></div>
      </div>`);

    this.statsEl = root.querySelector('.hud .stats');
    this.trafficEl = root.querySelector('.hud .traffic');
    this.trafficTimer = 0;
    this.hintEl = root.querySelector('.hint');
    this.toolbarEl = root.querySelector('.toolbar');
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

    this.tabsEl = root.querySelector('.tabs');
    this.tabsEl.innerHTML = CATEGORIES.map((c) => `<button data-tab="${c.id}">${c.label}</button>`).join('');
    this.tabsEl.addEventListener('click', (e) => {
      const tab = e.target.closest('button')?.dataset.tab;
      if (tab) this.showTab(tab);
    });

    this.toolbarEl.innerHTML = tools.list()
      .filter((t) => t.toolbar !== false)
      .map((t) => `<button data-tool="${t.id}" data-group="${t.group ?? ''}"><span class="key">${(t.hotkey ?? '').toUpperCase()}</span>${t.label}</button>`)
      .join('');
    this.toolbarEl.addEventListener('click', (e) => {
      const id = e.target.closest('button')?.dataset.tool;
      if (id) tools.use(id);
    });
    tools.onChange((tool) => {
      if (tool.group) this.showTab(tool.group);
      for (const b of this.toolbarEl.children) b.classList.toggle('active', b.dataset.tool === tool.id);
      // on phones the toolbar scrolls sideways: keep the active tool in view
      this.toolbarEl.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    this.showTab(CATEGORIES[0].id);

    world.events.on('*', () => (this.statsDirty = true));
    this.statsDirty = true;
  }

  showTab(id) {
    this.tab = id;
    for (const b of this.tabsEl.children) b.classList.toggle('active', b.dataset.tab === id);
    for (const b of this.toolbarEl.children) b.classList.toggle('hidden', !!b.dataset.group && b.dataset.group !== id);
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
      const flow = this.agents.flow ?? 1;
      const traffic = !count.drive ? '' : flow > 0.85 ? 'flowing' : flow > 0.55 ? 'busy' : 'jammed';
      const item = (k, v) => `<span>${k}<b>${v}</b></span>`;
      this.trafficEl.innerHTML = item('On foot', count.walk) + item('Cycling', count.cycle) + item('Driving', count.drive)
        + (traffic ? item('Traffic', `${traffic} ${Math.round(flow * 100)}%`) : '')
        + (visitors ? item('Visitors', visitors) : '');
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
    if (unconnected) cells.push(['No road', unconnected]);
    this.statsEl.innerHTML = cells.map(([k, v]) => `<div class="cell"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  }
}
