// Settings: one panel, wherever it's opened from – in the main menu, in the
// column's place (mainMenu.js), or in the town from the Menu's Nastavení
// drawing, hanging under the Menu as the Colours panel does (hud.js). The
// same panel either way, so it says and does the same in both:
//
//   Zvuk         the sound's three levels (audio/ambience.js setVolume):
//                all of it (down to nothing: the sound off), the nature
//                (birds, rain, wind), the pencil and the buttons – the
//                pen-drawn sliders of the New map dialog
//   Jazyk        the languages, each in its own name (picking another
//                loads the game again: main.js switchLanguage)
//   Barvy        the colour schemes (the custom one's colours are set in
//                the Colours panel)
//   Obrazovka    full screen, where the browser has it
//
// Built of the shared pieces: a .panel with .setting-row rows, .choice
// words ticked when picked and a .toggle boxed while on (styles.css,
// penMarks.js); it comes and goes with motion.js.
//
//   new SettingsPanel(root, { ambience, actions, fullscreen })
//     actions      { language(code), scheme(choice), fullscreen() }
//     fullscreen   { can(), on() }
//   show({ into, opener, onClose }) – `into`: the box to stand in (the main
//     menu's column), or none: hanging under the Menu, closed by a click
//     elsewhere (except on `opener`, the button that opened it)
//   hide() / toggle() / open / key(e)

import { reveal, isShown, bump } from './motion.js';
import { SketchSlider } from './sketchSlider.js';
import { schemeChoices } from './colorMenu.js';
import { schemeChoice } from '../theme.js';
import { t, language, LANGUAGES } from '../core/text.js';

// the sound's levels: a slider of STOPS stops each, silent to the loudest
const LEVELS = ['all', 'nature', 'effects'];
const STOPS = 6;
const percent = (i) => `${Math.round((i / (STOPS - 1)) * 100)} %`;

export class SettingsPanel {
  constructor(root, { ambience, actions, fullscreen }) {
    this.root = root;
    this.ambience = ambience;
    this.actions = actions;
    this.fullscreen = fullscreen;
    this.opener = null;
    this.onClose = null;

    this.el = document.createElement('div');
    this.el.className = 'panel settings-panel hidden';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', t('mainmenu.settings'));
    this.el.innerHTML = `
      <div class="panel-head"><span>${t('mainmenu.settings')}</span><button class="close" aria-label="${t('close')}">×</button></div>
      <div class="panel-body">
        <div class="panel-group">
          <span class="group-name">${t('mainmenu.sound')}</span>
          ${LEVELS.map((k) => `
            <div class="setting-row" data-level="${k}">
              <span class="field-name">${t(`mainmenu.volume.${k}`)}</span>
              <span class="slot"></span>
              <span class="value"></span>
            </div>`).join('')}
        </div>
        <div class="panel-group">
          <span class="group-name">${t('mainmenu.language')}</span>
          <div class="choices">${Object.entries(LANGUAGES).map(([code, name]) =>
            `<button class="choice${code === language() ? ' on' : ''}" data-lang="${code}" lang="${code}" aria-pressed="${code === language()}">${name}</button>`).join('')}</div>
        </div>
        <div class="panel-group">
          <span class="group-name">${t('control.colors')}</span>
          <div class="choices st-schemes"></div>
        </div>
        <div class="panel-group st-screen">
          <span class="group-name">${t('mainmenu.screen')}</span>
          <button class="toggle" data-st="fullscreen" aria-pressed="false">${t('fullscreen')}</button>
        </div>
      </div>
      <div class="panel-foot"><button class="done main">${t('done')}</button></div>`;
    root.appendChild(this.el);

    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.matches('.close, .done')) return this.hide();
      if (btn.dataset.st === 'fullscreen') return this.actions.fullscreen();
      if (btn.dataset.lang) {
        if (btn.dataset.lang !== language()) this.actions.language(btn.dataset.lang);
        return;
      }
      if (btn.dataset.choice != null) {
        this.actions.scheme(btn.dataset.choice === 'custom' ? 'custom' : Number(btn.dataset.choice));
        this.refresh();
      }
    });
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation(); // no hotkeys (the arrows move the sliders)
      if (e.key === 'Escape') this.hide();
    });

    this.sliders = {};
    for (const k of LEVELS) {
      const row = this.el.querySelector(`[data-level="${k}"]`);
      const slider = new SketchSlider(STOPS, {
        label: t(`mainmenu.volume.${k}`),
        onChange: (i) => {
          // the whole of it down to nothing is the sound off (no longer
          // playing at all), and up from there on again; the other two
          // turned up while it's off turn it on too
          if (k !== 'all' || i > 0) this.ambience.setVolume(k, i / (STOPS - 1));
          if ((i > 0) !== this.ambience.on && (k === 'all' || i > 0)) this.ambience.set(i > 0);
          this.refresh();
          bump(row.querySelector('.value'));
        },
      });
      row.querySelector('.slot').appendChild(slider.el);
      this.sliders[k] = slider;
    }
    addEventListener('resize', () => { if (this.open) this.drawSliders(); });
    document.addEventListener('fullscreenchange', () => this.refresh());
    document.addEventListener('webkitfullscreenchange', () => this.refresh());
    // hanging under the Menu: a click anywhere else closes it
    document.addEventListener('pointerdown', (e) => {
      if (!this.open || !this.floating || this.el.contains(e.target) || this.opener?.contains(e.target)) return;
      if (e.target.closest?.('.popup')) return;
      this.hide();
    }, true);
    this.refresh();
  }

  get open() {
    return isShown(this.el);
  }

  get floating() {
    return this.el.classList.contains('floating');
  }

  show({ into = null, opener = null, onClose = null } = {}) {
    if (this.open) return;
    (into ?? this.root).appendChild(this.el);
    this.el.classList.toggle('floating', !into);
    this.opener = opener;
    this.onClose = onClose;
    this.opener?.classList.add('on');
    this.el.querySelector('.st-screen').hidden = !this.fullscreen.can();
    this.refresh();
    reveal(this.el, true, { from: into ? [-6, 0] : [0, 4], rows: '.panel-group' });
    this.drawSliders();
    this.el.querySelector('[role="slider"]')?.focus({ preventScroll: true, focusVisible: false });
  }

  hide() {
    if (!this.open) return;
    // (in the main menu's column it goes at once, the menu's words taking
    // its place; hanging under the Menu it leaves as the other panels do)
    if (this.floating) reveal(this.el, false);
    else this.el.classList.add('hidden');
    this.opener?.classList.remove('on');
    const done = this.onClose;
    this.opener = this.onClose = null;
    done?.();
  }

  toggle(options) {
    if (this.open) this.hide();
    else this.show(options);
  }

  drawSliders() {
    for (const s of Object.values(this.sliders)) s.draw();
  }

  // everything showing what's set now: the levels, the scheme, full screen
  refresh() {
    for (const k of LEVELS) {
      const i = k === 'all' && !this.ambience.on ? 0 : Math.round(this.ambience.volume[k] * (STOPS - 1));
      const slider = this.sliders[k];
      if (!slider) continue;
      slider.value = i;
      slider.el.setAttribute('aria-valuetext', percent(i));
      this.el.querySelector(`[data-level="${k}"] .value`).textContent = percent(i);
    }
    this.el.querySelector('.st-schemes').innerHTML = schemeChoices(schemeChoice, 'choice');
    this.el.querySelector('[data-st="fullscreen"]').setAttribute('aria-pressed', String(this.fullscreen.on()));
  }
}
