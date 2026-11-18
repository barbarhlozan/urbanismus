// The main menu: what the game opens on, once the cover has lifted
// (main.js openIntro) – the game's name, underlined by the pen as on the
// cover, and under it what to do, in a column on the paper at the left
// edge; the map stands behind it, the town as it was left (or, on a first
// visit, a little village put up for the picture, main.js demoVillage),
// drifting slowly. On a narrow screen the column stands at the bottom.
//
//   Pokračovat           back into the saved town (its name written small
//                        under it); only when there is one
//   Nová hra             the New map dialog (newMapMenu.js)
//   Otevřít ze souboru   a town from a file (saveFile.js)
//   Nastavení            the settings (settingsPanel.js), in the column's
//                        place – the same panel the Menu opens in the town
//   Poděkování           who made the sounds
//
// ↑ and ↓ go from one word to the next, Enter picks it; Esc goes back
// into the town (or out of Settings).
//
// Nothing here is drawn its own way: the words are plain buttons, so the
// pen marks (penMarks.js) underline the one pointed at, put crop marks on
// the one in keyboard focus and press them as everywhere else; boxes come
// and go with motion.js. Change any of those and this follows.
//
//   new MainMenu(root, { hasSave, town, settings, actions })
//     town      the saved town's name, or null
//     settings  the SettingsPanel
//     actions   { play, newGame(button), open(button), credits(button) }
//   show() / hide() / shown / setTown(name) / key(e)

import { reveal, isShown } from './motion.js';
import { CONFIG } from '../config.js';
import { t } from '../core/text.js';

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// the pen's underline under the name, as on the cover (index.html .intro-pen)
const PEN = '<span class="intro-pen" aria-hidden="true"><span class="intro-pen-reveal"><svg viewBox="0 0 160 12"><path d="M3 8 C30 4 52 9 80 6 S130 3 157 7"/></svg></span></span>';

// the column's words; Pokračovat first when there's a town to go back into,
// what it is written small under it
const listHTML = (town) => `
  ${town ? `<button data-mm="play"><span>${t('mainmenu.continue')}</span><span class="note">${esc(town)}</span></button>` : ''}
  <button data-mm="newGame">${t('mainmenu.new')}</button>
  <button data-mm="open">${t('control.import')}</button>
  <button data-mm="settings">${t('mainmenu.settings')}</button>
  <button data-mm="credits" class="mm-quiet">${t('credits')}</button>`;

export class MainMenu {
  constructor(root, { hasSave, town, settings, actions }) {
    this.hasSave = hasSave;
    this.settings = settings;
    this.actions = actions;

    this.el = document.createElement('div');
    this.el.className = 'main-menu hidden';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', CONFIG.app.name);
    this.el.innerHTML = `
      <div class="mm-veil" aria-hidden="true"></div>
      <div class="mm-column">
        <div class="intro-card mm-title"><div class="intro-name">${esc(CONFIG.app.name)}</div>${PEN}</div>
        <div class="mm-list">${listHTML(town)}</div>
      </div>
      <div class="mm-imprint">${esc(CONFIG.app.name)} v${esc(CONFIG.app.version)} · ${esc(CONFIG.app.author)}</div>`;
    root.appendChild(this.el);
    this.column = this.el.querySelector('.mm-column');
    this.list = this.el.querySelector('.mm-list');
    this.title = this.el.querySelector('.mm-title');

    this.list.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mm]');
      if (!btn) return;
      if (btn.dataset.mm === 'settings') this.openSettings();
      else this.actions[btn.dataset.mm]?.(btn);
    });
  }

  // The town to go back into (back from the game: it may be a new one).
  setTown(town) {
    this.hasSave = true;
    this.list.innerHTML = listHTML(town);
  }

  get shown() {
    return isShown(this.el);
  }

  get inSettings() {
    return this.settings.open && this.column.contains(this.settings.el);
  }

  show() {
    if (this.shown) return;
    this.list.classList.remove('hidden');
    reveal(this.el, true, { fade: true, force: true });
    // the name written again, the pen underlining it (as on the cover)
    this.title.classList.remove('shown');
    void this.title.offsetWidth;
    this.title.classList.add('shown');
    reveal(this.list, true, { from: [-6, 0], force: true, rows: 'button' });
    this.list.querySelector('button')?.focus({ preventScroll: true, focusVisible: false });
  }

  hide() {
    if (this.inSettings) this.settings.hide();
    reveal(this.el, false, { fade: true });
  }

  // Settings in the column's place; closed, the words come back
  openSettings() {
    if (this.inSettings) return;
    this.list.classList.add('hidden');
    this.settings.show({
      into: this.column,
      onClose: () => {
        reveal(this.list, true, { from: [-6, 0], force: true, rows: 'button' });
        this.list.querySelector('[data-mm="settings"]')?.focus({ preventScroll: true });
      },
    });
  }

  // A key while the menu is up (main.js keydown; Settings keeps its own).
  // ↑ ↓ from word to word, round from the last to the first; Esc back into
  // the town.
  key(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const words = [...this.list.querySelectorAll('button')];
      const at = words.indexOf(document.activeElement);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = at < 0 ? (step > 0 ? 0 : words.length - 1) : (at + step + words.length) % words.length;
      words[next]?.focus({ preventScroll: true, focusVisible: true });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (this.inSettings) this.settings.hide();
      else if (this.hasSave) this.actions.play();
    }
  }
}
