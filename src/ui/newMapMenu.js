// The New map menu: a dialog in the middle of the screen, the game blurred
// behind it (opened with the New map button), to set up the next map before
// the current city is discarded – the town's name (rolled at random, or
// typed), how hilly, how many lakes, how much forest, and the water: none,
// a stream, a river, or a river with streams running into it. All but the
// name are shown as a picture (landscapePreview.js) over their sliders
// rather than in words; pointing at a slider brings out
// its part of the picture. The choices (all but the name) are remembered in
// this browser for the next time.
//
// "Create a new map" asks first, in a small box over the dialog, since the
// town goes: export it to a file and go on, go on without, or cancel the
// whole thing (Esc or a click beside the box: back to the dialog).
//
//   onCreate(settings)  called with { name, seed, hilliness, terrain } –
//                       `terrain` overrides CONFIG.terrain for generateWorld
//   onExport()          saves the current town to a file (saveFile.js)

import { townName } from '../core/townName.js';
import { reveal, isShown, bump } from './motion.js';
import { SketchSlider } from './sketchSlider.js';
import { controlIcon } from './icons.js';
import { LandscapePreview } from './landscapePreview.js';
import { t } from '../core/text.js';

// each setting: a slider over its options as [label, value], from least to
// most; `pick` is the default, `icon` its drawing (icons.js); `pictured`:
// shown in the landscape, not in words (its name and option still the
// slider's label and tooltip). The setting's name is newmap.<key>, an
// option's newmap.<key>.<label> (a number shows as is)
const SETTINGS = [
  {
    key: 'hills', icon: 'terrain', pick: 1, pictured: true, options: [
      ['flat', 0.3], ['gentle', 0.6], ['hilly', 1], ['steep', 1.45], ['mountains', 2.5],
    ],
  },
  { key: 'lakes', icon: 'lakes', pick: 2, pictured: true, options: [['none', 0], ['1', 1], ['2', 2], ['3', 3], ['5', 5]] },
  {
    key: 'forest', icon: 'forest', pick: 'some', pictured: true, options: [
      ['none', 'none'], ['few', 'few'], ['some', 'some'], ['many', 'many'], ['lots', 'lots'],
    ],
  },
  {
    key: 'river', icon: 'river', pick: 'yes', pictured: true, options: [
      ['none', 'no'], ['stream', 'stream'], ['river', 'yes'], ['streams', 'streams'],
    ],
  },
];
const settingName = (s) => t(`newmap.${s.key}`);
const optionName = (s, [label]) => (/^\d+$/.test(label) ? label : t(`newmap.${s.key}.${label}`));

// forest amount -> tree density and the forest noise threshold (generate.js)
const FOREST = {
  none: { treeDensity: 0, forestThreshold: 1 },
  few: { treeDensity: 2, forestThreshold: 0.68 },
  some: { treeDensity: 3, forestThreshold: 0.58 },
  many: { treeDensity: 4, forestThreshold: 0.49 },
  lots: { treeDensity: 5, forestThreshold: 0.4 },
};
// water -> CONFIG.terrain's riverChance, riverSize and tributaries
const RIVER = {
  no: { riverChance: 0 },
  stream: { riverChance: 1, riverSize: 'stream', tributaries: 0 },
  yes: { riverChance: 1, riverSize: 'river', tributaries: 0 },
  streams: { riverChance: 1, riverSize: 'river', tributaries: 2 },
};

const STORE_KEY = 'urbanismus.newMap';
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const randomSeed = () => Math.floor(Math.random() * 1e9);

export class NewMapMenu {
  constructor(root, button, { onCreate, onExport }) {
    this.button = button;
    this.onCreate = onCreate;
    this.onExport = onExport;
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
    this.el.setAttribute('aria-label', t('control.newMap'));
    this.el.innerHTML = `
      <div class="newmap-head"><span>${t('control.newMap')}</span><button class="close" aria-label="${t('close')}">×</button></div>
      <div class="newmap-body">
        <label class="newmap-name">
          <span class="field-name">${t('newmap.name')}</span>
          <input class="name-field" maxlength="40" spellcheck="false" autocomplete="off" aria-label="${t('town.name')}">
          <button class="dice" title="${t('newmap.reroll')}" aria-label="${t('newmap.reroll')}">${DICE}</button>
        </label>
        <div class="scene-slot"></div>
        ${SETTINGS.map((s) => `
          <div class="newmap-row${s.pictured ? ' pictured' : ''}" data-key="${s.key}">
            <span class="field-name">${controlIcon(s.icon)}${s.pictured ? '' : settingName(s)}</span>
            <span class="slot"></span>
            ${s.pictured ? '' : '<span class="value"></span>'}
          </div>`).join('')}
      </div>
      <div class="newmap-foot"><button class="cancel">${t('cancel')}</button><button class="create">${t('newmap.create')}</button></div>`;
    root.appendChild(this.el);
    this.nameEl = this.el.querySelector('.name-field');

    // the question before the town goes
    this.confirmEl = document.createElement('div');
    this.confirmEl.className = 'newmap-confirm hidden';
    this.confirmEl.setAttribute('role', 'alertdialog');
    this.confirmEl.setAttribute('aria-label', t('newmap.create'));
    this.confirmEl.innerHTML = `
      <p>${t('newmap.confirm')}</p>
      <button class="export-go">${t('newmap.export-continue')}</button>
      <button class="go">${t('newmap.continue')}</button>
      <button class="stop">${t('cancel')}</button>`;
    root.appendChild(this.confirmEl);
    this.confirmEl.querySelector('.export-go').addEventListener('click', () => {
      this.onExport?.();
      // (a moment for the download to start before the page reloads)
      setTimeout(() => this.create(), 700);
    });
    this.confirmEl.querySelector('.go').addEventListener('click', () => this.create());
    this.confirmEl.querySelector('.stop').addEventListener('click', () => this.toggle(false));
    this.confirmEl.addEventListener('keydown', (e) => {
      e.stopPropagation(); // no hotkeys
      if (e.key === 'Escape') this.ask(false);
    });
    this.preview = new LandscapePreview();
    this.el.querySelector('.scene-slot').replaceWith(this.preview.el);

    this.sliders = {};
    for (const s of SETTINGS) {
      const slider = new SketchSlider(s.options.length, {
        label: settingName(s),
        onChange: (i) => {
          this.choice[s.key] = s.options[i][1];
          this.refresh();
          if (!s.pictured) bump(this.el.querySelector(`[data-key="${s.key}"] .value`));
        },
      });
      const row = this.el.querySelector(`[data-key="${s.key}"]`);
      row.querySelector('.slot').appendChild(slider.el);
      this.sliders[s.key] = slider;
      // pointed at (or in use from the keyboard): its part of the picture
      if (s.pictured) {
        const show = (on) => this.preview.focus(on ? s.key : null);
        row.addEventListener('pointerenter', () => show(true));
        row.addEventListener('pointerleave', () => show(slider.el === document.activeElement));
        row.addEventListener('focusin', () => show(true));
        row.addEventListener('focusout', () => show(false));
      }
    }
    addEventListener('resize', () => { if (this.open) this.drawSliders(); });

    this.el.querySelector('.close').addEventListener('click', () => this.toggle(false));
    this.el.querySelector('.cancel').addEventListener('click', () => this.toggle(false));
    this.el.querySelector('.dice').addEventListener('click', (e) => {
      e.preventDefault(); // not a click on the label's input
      this.rollName();
    });
    this.el.querySelector('.create').addEventListener('click', () => this.ask(true));
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation(); // no hotkeys while typing
      if (e.key === 'Escape') this.toggle(false);
      if (e.key === 'Enter' && e.target === this.nameEl) this.ask(true);
    });

    // a click anywhere else closes it (beside the question: just that)
    document.addEventListener('pointerdown', (e) => {
      if (!this.open || this.el.contains(e.target) || button.contains(e.target)) return;
      if (this.asking) {
        if (!this.confirmEl.contains(e.target)) this.ask(false);
        return;
      }
      this.toggle(false);
    }, true);
  }

  get open() {
    return isShown(this.el);
  }

  get asking() {
    return isShown(this.confirmEl);
  }

  // the question over the dialog (which waits, faded, behind it)
  ask(show, refocus = true) {
    if (show === this.asking) return;
    reveal(this.confirmEl, show, { from: [0, 6], rows: 'p, button' });
    this.el.classList.toggle('waiting', show);
    if (refocus) (show ? this.confirmEl.querySelector('.export-go') : this.el.querySelector('.create')).focus({ preventScroll: true });
  }

  toggle(open = !this.open) {
    if (!open) this.ask(false, false);
    reveal(this.scrim, open, { fade: true });
    reveal(this.el, open, { from: [0, 10], rows: '.newmap-name, .newmap-scene, .newmap-row' });
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
    const at = {};
    for (const s of SETTINGS) {
      const i = at[s.key] = s.options.findIndex(([, v]) => v === this.choice[s.key]);
      const slider = this.sliders[s.key];
      const name = optionName(s, s.options[i]);
      slider.value = i;
      slider.el.setAttribute('aria-valuetext', name);
      if (s.pictured) this.el.querySelector(`[data-key="${s.key}"]`).title = `${settingName(s)}: ${name}`;
      else this.el.querySelector(`[data-key="${s.key}"] .value`).textContent = name;
    }
    this.preview.set({ hills: at.hills, lakes: this.choice.lakes, forest: at.forest, river: at.river });
  }

  create() {
    const { lakes, forest, hills, river } = this.choice;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.choice));
    } catch {
      // storage unavailable: the choices just won't be remembered
    }
    const terrain = { lakes: [lakes, lakes], ...FOREST[forest], ...RIVER[river] };
    this.onCreate({ name: this.nameEl.value.trim(), seed: randomSeed(), hilliness: hills, terrain });
  }
}

// a die showing five, drawn like the stat icons
const DICE = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.3"/>${[[5, 5], [11, 5], [8, 8], [5, 11], [11, 11]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.1" fill="currentColor"/>`).join('')}</svg>`;
