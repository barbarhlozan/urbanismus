// The main menu: what the game opens on, once the cover has lifted
// (main.js openIntro) – the game's name, underlined by the pen as on the
// cover, and under it what to do, in a column on the paper at the left
// edge; the map stands behind it, the town as it was left (or, on a first
// visit, a little village put up for the picture, main.js demoVillage),
// drifting slowly. On a narrow screen the column stands at the bottom.
//
//   Pokračovat           back into the saved town (with its name, people
//                        and buildings written small under it); only when
//                        there is one
//   Nová hra             the New map dialog (newMapMenu.js)
//   Otevřít ze souboru   a town from a file (saveFile.js)
//   Nastavení            the settings, in a panel in the column's place
//   Autoři               who made the sounds
//
// Nothing here is drawn its own way: the words are plain buttons, so the
// pen marks (penMarks.js) underline the one pointed at, put crop marks on
// the one in keyboard focus and press them as everywhere else; the
// Settings panel is a .panel with .setting-row rows (styles.css), the
// pen-drawn sliders of the New map dialog (sketchSlider.js), .choice words
// ticked when picked and .toggle words boxed; boxes come and go with
// motion.js. Change any of those and this follows.
//
//   new MainMenu(root, { hasSave, town, ambience, actions })
//     town      { name, residents, buildings } of the saved town, or null
//     actions   { play, newGame(button), open(button), credits(button),
//                 language(code), scheme(choice), fullscreen() } – what
//                 each item does (main.js)
//   show() / hide() / shown / key(e)

import { reveal, isShown, bump } from './motion.js';
import { SketchSlider } from './sketchSlider.js';
import { schemeChoices } from './colorMenu.js';
import { schemeChoice } from '../theme.js';
import { CONFIG } from '../config.js';
import { t, language, LANGUAGES } from '../core/text.js';

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// the sound's levels (audio/ambience.js setVolume): a slider of STOPS
// stops each, from silent to the loudest
const LEVELS = ['all', 'nature', 'effects'];
const STOPS = 6;
const percent = (i) => `${Math.round((i / (STOPS - 1)) * 100)} %`;

// the pen's underline under the name, as on the cover (index.html .intro-pen)
const PEN = '<span class="intro-pen" aria-hidden="true"><span class="intro-pen-reveal"><svg viewBox="0 0 160 12"><path d="M3 8 C30 4 52 9 80 6 S130 3 157 7"/></svg></span></span>';

// the column's words; Pokračovat first when there's a town to go back into,
// what it is written small under it
const listHTML = (town) => `
  ${town ? `<button data-mm="play"><span>${t('mainmenu.continue')}</span><span class="note">${[esc(town.name), t('mainmenu.residents', { n: town.residents }), t('import.buildings', { n: town.buildings })].join(' · ')}</span></button>` : ''}
  <button data-mm="newGame">${t('mainmenu.new')}</button>
  <button data-mm="open">${t('control.import')}</button>
  <button data-mm="settings">${t('mainmenu.settings')}</button>
  <button data-mm="credits" class="mm-quiet">${t('credits')}</button>`;

export class MainMenu {
  constructor(root, { hasSave, town, ambience, actions, fullscreen }) {
    this.hasSave = hasSave;
    this.ambience = ambience;
    this.actions = actions;
    this.fullscreen = fullscreen; // { can(), on() } – main.js fs

    this.el = document.createElement('div');
    this.el.className = 'main-menu hidden';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', CONFIG.app.name);
    this.el.innerHTML = `
      <div class="mm-veil" aria-hidden="true"></div>
      <div class="mm-column">
        <div class="intro-card mm-title"><div class="intro-name">${esc(CONFIG.app.name)}</div>${PEN}</div>
        <div class="mm-list">${listHTML(town)}</div>
        <div class="panel mm-settings hidden" role="group" aria-label="${t('mainmenu.settings')}">
          <div class="panel-head"><span>${t('mainmenu.settings')}</span><button class="close" aria-label="${t('close')}">×</button></div>
          <div class="panel-body">
            <div class="panel-group" data-group="sound">
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
              <div class="choices mm-schemes"></div>
            </div>
            <div class="panel-group mm-screen">
              <span class="group-name">${t('mainmenu.screen')}</span>
              <button class="toggle" data-mm="fullscreen" aria-pressed="false">${t('fullscreen')}</button>
            </div>
          </div>
          <div class="panel-foot"><button class="done main">${t('done')}</button></div>
        </div>
      </div>
      <div class="mm-imprint">${esc(CONFIG.app.name)} v${esc(CONFIG.app.version)} · ${esc(CONFIG.app.author)}</div>`;
    root.appendChild(this.el);
    this.list = this.el.querySelector('.mm-list');
    this.settings = this.el.querySelector('.mm-settings');
    this.title = this.el.querySelector('.mm-title');

    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.mm;
      if (act === 'settings') return this.openSettings(true);
      if (btn.matches('.close, .done')) return this.openSettings(false);
      if (act === 'fullscreen') return this.actions.fullscreen();
      if (btn.dataset.lang) {
        if (btn.dataset.lang !== language()) this.actions.language(btn.dataset.lang);
        return;
      }
      if (btn.dataset.choice != null) {
        this.actions.scheme(btn.dataset.choice === 'custom' ? 'custom' : Number(btn.dataset.choice));
        this.refresh();
        return;
      }
      if (act) this.actions[act]?.(btn);
    });

    // the sound's sliders, as the New map dialog's
    this.sliders = {};
    for (const k of LEVELS) {
      const row = this.el.querySelector(`[data-level="${k}"]`);
      const slider = new SketchSlider(STOPS, {
        label: t(`mainmenu.volume.${k}`),
        onChange: (i) => {
          this.ambience.setVolume(k, i / (STOPS - 1));
          // turned up while the sound was off: it comes on
          if (i > 0 && !this.ambience.on) this.ambience.set(true);
          this.refresh();
          bump(row.querySelector('.value'));
        },
      });
      row.querySelector('.slot').appendChild(slider.el);
      this.sliders[k] = slider;
    }
    addEventListener('resize', () => { if (this.inSettings) this.drawSliders(); });
    document.addEventListener('fullscreenchange', () => this.refresh());
    document.addEventListener('webkitfullscreenchange', () => this.refresh());
    if (!this.fullscreen.can()) this.el.querySelector('.mm-screen').hidden = true;
    this.refresh();
  }

  // The town to go back into (back from the game: it may be new, or grown).
  setTown(town) {
    this.hasSave = true;
    this.list.innerHTML = listHTML(town);
  }

  get shown() {
    return isShown(this.el);
  }

  get inSettings() {
    return isShown(this.settings);
  }

  show() {
    if (this.shown) return;
    this.list.classList.remove('hidden');
    this.settings.classList.add('hidden');
    reveal(this.el, true, { fade: true, force: true });
    // the name written again, the pen underlining it (as on the cover)
    this.title.classList.remove('shown');
    void this.title.offsetWidth;
    this.title.classList.add('shown');
    reveal(this.list, true, { from: [-6, 0], force: true, rows: 'button' });
    this.list.querySelector('button')?.focus({ preventScroll: true, focusVisible: false });
  }

  hide() {
    reveal(this.el, false, { fade: true });
  }

  // Settings in the column's place, and back
  openSettings(open) {
    if (open === this.inSettings) return;
    if (open) {
      this.list.classList.add('hidden');
      this.refresh();
      reveal(this.settings, true, { from: [-6, 0], rows: '.panel-group' });
      this.drawSliders();
      this.settings.querySelector('[role="slider"]')?.focus({ preventScroll: true });
    } else {
      this.settings.classList.add('hidden');
      reveal(this.list, true, { from: [-6, 0], force: true, rows: 'button' });
      this.list.querySelector('[data-mm="settings"]')?.focus({ preventScroll: true });
    }
  }

  drawSliders() {
    for (const s of Object.values(this.sliders)) s.draw();
  }

  // everything showing what's set now: the levels, the scheme, full screen
  refresh() {
    for (const k of LEVELS) {
      const i = Math.round(this.ambience.volume[k] * (STOPS - 1));
      const slider = this.sliders[k];
      if (!slider) continue;
      slider.value = i;
      slider.el.setAttribute('aria-valuetext', percent(i));
      this.el.querySelector(`[data-level="${k}"] .value`).textContent = percent(i);
    }
    this.el.querySelector('.mm-schemes').innerHTML = schemeChoices(schemeChoice, 'choice');
    const full = this.fullscreen.on();
    this.el.querySelector('[data-mm="fullscreen"]').setAttribute('aria-pressed', String(full));
  }

  // A key while the menu is up (main.js keydown). Esc: out of Settings, or
  // back into the town.
  key(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (this.inSettings) this.openSettings(false);
    else if (this.hasSave) this.actions.play();
  }
}
