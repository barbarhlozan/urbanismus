// The Colors menu: a small panel under the controls (opened with the Colors
// button) listing the color schemes, plus the player's own custom scheme with
// a picker and a hex field for each of its three colors (see theme.js).
// Editing a custom color switches to the custom scheme.

import { SCHEMES, CUSTOM, COLOR_NAMES, applyTheme, setCustomColor, normalizeHex, schemeChoice } from '../theme.js';
import { reveal, isShown } from './motion.js';

const LABELS = { bg: 'Background', main: 'Lines', detail: 'Detail' };

// three dots in a scheme's colors
const swatches = (s) => `<span class="swatches">${COLOR_NAMES.map((n) => `<i data-c="${n}" style="background:${s[n]}"></i>`).join('')}</span>`;

export class ColorMenu {
  constructor(root, button) {
    this.button = button;
    button.innerHTML = `<span class="swatches">${COLOR_NAMES.map((n) => `<i style="background:var(--${n})"></i>`).join('')}</span>`;

    this.el = document.createElement('div');
    this.el.className = 'color-panel hidden';
    this.el.innerHTML = `
      <div class="color-head"><span>Colors</span><button class="close" aria-label="Close">×</button></div>
      ${SCHEMES.map((s, i) => `<button class="scheme" data-choice="${i}">${swatches(s)}${s.name}</button>`).join('')}
      <button class="scheme" data-choice="custom">${swatches(CUSTOM)}Custom</button>
      <div class="custom-fields">
        ${COLOR_NAMES.map((n) => `
          <label data-c="${n}">
            <input type="color" data-c="${n}" value="${CUSTOM[n]}" aria-label="${LABELS[n]} color">
            <span class="field-name">${LABELS[n]}</span>
            <input type="text" class="hex" data-c="${n}" value="${CUSTOM[n]}" maxlength="7" spellcheck="false" autocomplete="off" aria-label="${LABELS[n]} hex code">
          </label>`).join('')}
      </div>`;
    root.appendChild(this.el);

    this.el.querySelector('.close').addEventListener('click', () => this.toggle(false));
    this.el.addEventListener('click', (e) => {
      const choice = e.target.closest('.scheme')?.dataset.choice;
      if (choice == null) return;
      applyTheme(choice === 'custom' ? 'custom' : Number(choice));
      this.refresh();
    });

    // the picker updates live while dragging; the hex field once the code is whole
    this.el.addEventListener('input', (e) => {
      const { c } = e.target.dataset;
      if (!c) return;
      const hex = e.target.type === 'color' ? e.target.value : normalizeHex(e.target.value);
      if (hex && setCustomColor(c, hex)) this.refresh(e.target);
    });
    // leaving a half-typed code puts the stored one back
    this.el.addEventListener('focusout', (e) => {
      if (e.target.classList.contains('hex')) this.refresh();
    });
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation(); // no hotkeys while typing
      if (e.key === 'Escape') this.toggle(false);
      if (e.key === 'Enter' && e.target.classList.contains('hex')) e.target.blur();
    });

    // a click anywhere else closes it
    document.addEventListener('pointerdown', (e) => {
      if (this.open && !this.el.contains(e.target) && !button.contains(e.target)) this.toggle(false);
    }, true);

    this.refresh();
  }

  get open() {
    return isShown(this.el);
  }

  toggle(open = !this.open) {
    reveal(this.el, open, { rows: '.scheme, .custom-fields' });
    this.button.classList.toggle('on', open);
    if (open) this.refresh();
  }

  // Mark the scheme in use and show the custom colors (except in the field
  // being edited, which keeps what's typed).
  refresh(editing = null) {
    for (const b of this.el.querySelectorAll('.scheme')) {
      b.classList.toggle('on', b.dataset.choice === String(schemeChoice));
    }
    for (const i of this.el.querySelectorAll('[data-choice="custom"] i')) i.style.background = CUSTOM[i.dataset.c];
    for (const input of this.el.querySelectorAll('.custom-fields input')) {
      if (input !== editing) input.value = CUSTOM[input.dataset.c];
    }
    this.button.title = `Colors: ${schemeChoice === 'custom' ? 'Custom' : SCHEMES[schemeChoice].name}`;
  }
}
