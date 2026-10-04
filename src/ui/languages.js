// Picking the language, each in its own name, the one in use ticked: from
// the language button in the controls, a narrow list hanging under it (on
// phones, where the controls are a list, under the menu button like the
// Colours panel), and on the opening cover for a player who hasn't picked
// one yet (main.js openIntro). Another language is remembered and the game
// loads again in it (main.js switchLanguage).

import { reveal, isShown } from './motion.js';
import { isNarrow } from './device.js';
import { language, LANGUAGES } from '../core/text.js';

const GAP = 6; // px between the bar and the list

const buttons = () => Object.entries(LANGUAGES).map(([code, name]) =>
  `<button class="lang" data-lang="${code}" lang="${code}" aria-pressed="${code === language()}">${name}</button>`).join('');

export class LanguageMenu {
  constructor(root, button, { onPick }) {
    this.button = button;
    this.el = document.createElement('div');
    this.el.className = 'color-panel lang-panel hidden';
    this.el.innerHTML = buttons();
    root.appendChild(this.el);

    this.el.addEventListener('click', (e) => {
      const code = e.target.closest('[data-lang]')?.dataset.lang;
      if (!code) return;
      this.toggle(false);
      if (code !== language()) onPick(code);
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.toggle(false);
    });
    // a click anywhere else closes it
    document.addEventListener('pointerdown', (e) => {
      if (this.open && !this.el.contains(e.target) && !button.contains(e.target)) this.toggle(false);
    }, true);
    addEventListener('resize', () => { if (this.open) this.place(); });
  }

  get open() {
    return isShown(this.el);
  }

  toggle(open = !this.open) {
    if (open) this.place();
    reveal(this.el, open, { rows: '.lang' });
    this.button.classList.toggle('on', open);
  }

  // under its button, right edges lined up – but beside the Build menu's
  // rail rather than over it (phones: the stylesheet's place)
  place() {
    const s = this.el.style;
    if (isNarrow()) {
      s.top = s.right = '';
      return;
    }
    const at = this.button.getBoundingClientRect();
    const bar = this.button.closest('.controls').getBoundingClientRect();
    let right = innerWidth - at.right;
    const rail = document.querySelector('.build-menu.rail .bm-rail');
    if (rail) right = Math.max(right, innerWidth - rail.getBoundingClientRect().left + 8);
    s.top = `${bar.bottom + GAP}px`;
    s.right = `${right}px`;
  }
}

// On the opening cover, under the name: the languages to pick from. Resolves
// with the code picked (the cover takes clicks while it asks).
export function askLanguage(card) {
  const row = document.createElement('div');
  row.className = 'intro-langs';
  row.innerHTML = buttons();
  card.appendChild(row);
  card.closest('.intro')?.classList.add('asking');
  row.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
  return new Promise((resolve) => {
    row.addEventListener('click', (e) => {
      const code = e.target.closest('[data-lang]')?.dataset.lang;
      if (!code) return;
      card.closest('.intro')?.classList.remove('asking');
      row.classList.add('picked');
      for (const b of row.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === code));
      resolve(code);
    });
  });
}
