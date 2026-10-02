// The New map menu: a dialog in the middle of the screen, the game blurred
// behind it (opened with the New map button), to set up the next map before
// the current city is discarded – the
// town's name (rolled at random, or typed), how many lakes, how much forest,
// how hilly, and whether a river runs across. The choices (all but the name)
// are remembered in this browser for the next time.
//
//   onCreate(settings)  called with { name, seed, hilliness, terrain } –
//                       `terrain` overrides CONFIG.terrain for generateWorld

import { townName } from '../core/townName.js';
import { reveal, isShown, bump } from './motion.js';
import { SketchSlider } from './sketchSlider.js';
import { controlIcon } from './icons.js';

// each setting: a slider over its options as [label, value], from least to
// most; `pick` is the default, `icon` its drawing (icons.js)
const SETTINGS = [
  { key: 'lakes', label: 'Lakes', icon: 'lakes', pick: 2, options: [['None', 0], ['1', 1], ['2', 2], ['3', 3], ['5', 5]] },
  {
    key: 'forest', label: 'Forests', icon: 'forest', pick: 'some', options: [
      ['None', 'none'], ['Few', 'few'], ['Some', 'some'], ['Many', 'many'], ['Lots', 'lots'],
    ],
  },
  {
    key: 'hills', label: 'Land', icon: 'terrain', pick: 1, options: [
      ['Flat', 0.3], ['Gentle', 0.6], ['Hilly', 1], ['Steep', 1.45],
    ],
  },
  { key: 'river', label: 'River', icon: 'river', pick: 'random', options: [['No', 'no'], ['Maybe', 'random'], ['Yes', 'yes']] },
];

// forest amount -> tree density and the forest noise threshold (generate.js)
const FOREST = {
  none: { treeDensity: 0, forestThreshold: 1 },
  few: { treeDensity: 2, forestThreshold: 0.68 },
  some: { treeDensity: 3, forestThreshold: 0.58 },
  many: { treeDensity: 4, forestThreshold: 0.49 },
  lots: { treeDensity: 5, forestThreshold: 0.4 },
};
const RIVER_CHANCE = { random: null, yes: 1, no: 0 };

const STORE_KEY = 'urbanismus.newMap';
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const randomSeed = () => Math.floor(Math.random() * 1e9);

export class NewMapMenu {
  constructor(root, button, { onCreate }) {
    this.button = button;
    this.onCreate = onCreate;
    this.choice = Object.fromEntries(SETTINGS.map((s) => [s.key, s.pick]));
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
      for (const s of SETTINGS) {
        if (s.options.some(([, v]) => v === saved[s.key])) this.choice[s.key] = saved[s.key];
      }
    } catch {
      // storage unavailable: start from the defaults
    }

    // everything behind it, blurred; a click there closes it
    this.scrim = document.createElement('div');
    this.scrim.className = 'newmap-scrim hidden';
    root.appendChild(this.scrim);

    this.el = document.createElement('div');
    this.el.className = 'newmap-panel hidden';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'New map');
    this.el.innerHTML = `
      <div class="newmap-head"><span>New map</span><button class="close" aria-label="Close">×</button></div>
      <div class="newmap-body">
        <label class="newmap-name">
          <span class="field-name">Name</span>
          <input class="name-field" maxlength="40" spellcheck="false" autocomplete="off" aria-label="Town name">
          <button class="dice" title="Another name" aria-label="Another name">${DICE}</button>
        </label>
        ${SETTINGS.map((s) => `
          <div class="newmap-row" data-key="${s.key}">
            <span class="field-name">${controlIcon(s.icon)}${s.label}</span>
            <span class="slot"></span>
            <span class="value"></span>
          </div>`).join('')}
        <p class="newmap-note">This city will be discarded.</p>
      </div>
      <div class="newmap-foot"><button class="cancel">Cancel</button><button class="create">Create map</button></div>`;
    root.appendChild(this.el);
    this.nameEl = this.el.querySelector('.name-field');

    this.sliders = {};
    for (const s of SETTINGS) {
      const slider = new SketchSlider(s.options.length, {
        label: s.label,
        onChange: (i) => {
          this.choice[s.key] = s.options[i][1];
          this.refresh();
          bump(this.el.querySelector(`[data-key="${s.key}"] .value`));
        },
      });
      this.el.querySelector(`[data-key="${s.key}"] .slot`).appendChild(slider.el);
      this.sliders[s.key] = slider;
    }
    addEventListener('resize', () => { if (this.open) this.drawSliders(); });

    this.el.querySelector('.close').addEventListener('click', () => this.toggle(false));
    this.el.querySelector('.cancel').addEventListener('click', () => this.toggle(false));
    this.el.querySelector('.dice').addEventListener('click', (e) => {
      e.preventDefault(); // not a click on the label's input
      this.rollName();
    });
    this.el.querySelector('.create').addEventListener('click', () => this.create());
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation(); // no hotkeys while typing
      if (e.key === 'Escape') this.toggle(false);
      if (e.key === 'Enter' && e.target === this.nameEl) this.create();
    });

    // a click anywhere else closes it
    document.addEventListener('pointerdown', (e) => {
      if (this.open && !this.el.contains(e.target) && !button.contains(e.target)) this.toggle(false);
    }, true);
  }

  get open() {
    return isShown(this.el);
  }

  toggle(open = !this.open) {
    reveal(this.scrim, open, { fade: true });
    reveal(this.el, open, { from: [0, 10], rows: '.newmap-name, .newmap-row, .newmap-note' });
    this.button.classList.toggle('on', open);
    if (open) {
      this.rollName();
      this.refresh();
      this.drawSliders();
    }
  }

  drawSliders() {
    for (const s of Object.values(this.sliders)) s.draw();
  }

  rollName() {
    this.nameEl.value = townName(randomSeed());
  }

  refresh() {
    for (const s of SETTINGS) {
      const i = s.options.findIndex(([, v]) => v === this.choice[s.key]);
      this.sliders[s.key].value = i;
      this.el.querySelector(`[data-key="${s.key}"] .value`).textContent = s.options[i][0];
    }
  }

  create() {
    const { lakes, forest, hills, river } = this.choice;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.choice));
    } catch {
      // storage unavailable: the choices just won't be remembered
    }
    const terrain = { lakes: [lakes, lakes], ...FOREST[forest] };
    if (RIVER_CHANCE[river] != null) terrain.riverChance = RIVER_CHANCE[river];
    this.onCreate({ name: this.nameEl.value.trim(), seed: randomSeed(), hilliness: hills, terrain });
  }
}

// a die showing five, drawn like the stat icons
const DICE = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.3"/>${[[5, 5], [11, 5], [8, 8], [5, 11], [11, 11]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.1" fill="currentColor"/>`).join('')}</svg>`;
