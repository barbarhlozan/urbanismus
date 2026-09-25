// The Style panel: toggles and sliders for every control in STYLE_CONTROLS.
// Opened from the "Style" button in the top-right controls.

import { STYLE_CONTROLS } from '../render/style.js';

export class StylePanel {
  constructor(root, style) {
    this.style = style;
    this.el = document.createElement('div');
    this.el.className = 'style-panel hidden';
    root.appendChild(this.el);

    let html = '';
    let group = null;
    for (const c of STYLE_CONTROLS) {
      if (c.group !== group) {
        group = c.group;
        html += `<div class="group">${group}</div>`;
      }
      html += c.type === 'range'
        ? `<label class="row"><span>${c.label}</span><input type="range" data-key="${c.key}" min="${c.min}" max="${c.max}" step="${c.step}"></label>`
        : `<label class="row"><span>${c.label}</span><input type="checkbox" data-key="${c.key}"></label>`;
    }
    this.el.innerHTML = html;

    for (const input of this.el.querySelectorAll('input')) {
      const key = input.dataset.key;
      if (input.type === 'checkbox') {
        input.checked = !!style.get(key);
        input.addEventListener('change', () => style.set(key, input.checked));
      } else {
        input.value = style.get(key);
        // apply when the slider is released (a warp change redraws the map)
        input.addEventListener('change', () => style.set(key, Number(input.value)));
      }
    }

    // keep the controls in sync if a setting changes from elsewhere
    style.onChange((key, value) => {
      const input = this.el.querySelector(`input[data-key="${key}"]`);
      if (!input) return;
      if (input.type === 'checkbox') input.checked = !!value;
      else input.value = value;
    });
  }

  toggle() {
    this.el.classList.toggle('hidden');
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }
}
