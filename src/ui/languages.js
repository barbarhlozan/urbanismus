// Picking the language on the opening cover, each in its own name, for a
// player who hasn't picked one yet (main.js openIntro). (Afterwards the
// Menu's language button switches straight to the other one: hud.js.) The
// language picked is remembered and the game loads again in it (main.js
// switchLanguage).

import { language, LANGUAGES } from '../core/text.js';

const buttons = () => Object.entries(LANGUAGES).map(([code, name]) =>
  `<button class="lang" data-lang="${code}" lang="${code}" aria-pressed="${code === language()}">${name}</button>`).join('');

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
