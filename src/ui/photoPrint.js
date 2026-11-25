// A photo from photo mode (render/photo.js), shown as a sheet of paper with
// a softly wavy edge, as if torn from a sketchbook (sketchSheet), and its
// pen line repeated a little below and to the right as the sheet's shadow
// on the map. Under it two drawn buttons: save it as a PNG (the Menu's
// save drawing) and put it away (×). No name on it: the drawing is the
// thing, and the town's name goes with it into the chronicle and the
// file's name. While it's out,
// photo mode rests: the map, its keys and the camera's controls wait until
// the print is put away (main.js, through onToggle; styles.css
// body.print-open). It is pasted into the chronicle too (main.js,
// ui/prints.js).

import { sketchSheet } from '../render/sketch.js';
import { menuIcon } from './icons.js';
import { t } from '../core/text.js';
import { printImage } from './prints.js';
import { brushPhoto } from './photoBrush.js';
import { drawPhoto } from './photoDraw.js';

// the sheet's edge: in and out by up to `amp` px every `step` px or so, its
// shadow line `shadow` px below and to the right; `pad` px of room round it
const SHEET = { amp: 1.1, step: 9, shadow: 3, pad: 6 };

export class PhotoPrint {
  constructor(root, { onToggle = () => {} } = {}) {
    this.onToggle = onToggle;
    this.el = document.createElement('div');
    this.el.className = 'photo-print hidden';
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') this.hide();
      if (act === 'save') this.save();
    });
  }

  // `onDrawn`: called once the drawing is done (or cut short: put away,
  // saved, another taken), with the finished photo still in the page – the
  // chronicle's print is made of it then (main.js).
  show(svg, caption, onDrawn = null) {
    this.settle();
    this.caption = caption;
    this.el.innerHTML = `
      <div class="photo-sheet">
        <svg class="sheet-edge" aria-hidden="true"><path class="sheet-shadow"/><path class="sheet-paper"/></svg>
        <div class="photo-frame">${svg}</div>
      </div>
      <div class="photo-buttons">
        <button data-act="save" title="${t('photo.save')}" aria-label="${t('photo.save')}">${menuIcon('export')}</button>
        <button class="close" data-act="close" title="${t('close')}" aria-label="${t('close')}">×</button>
      </div>`;
    this.el.classList.remove('hidden');
    this.edge();
    // (in the page now, so its styles are known: drawn with the pen's line)
    brushPhoto(this.photo);
    // and drawn in before your eyes, from the next frame (the finished photo
    // kept out of sight till then, so it doesn't flash up)
    const pending = { onDrawn, photo: this.photo };
    this.pending = pending;
    const frame = this.el.querySelector('.photo-frame');
    frame.style.opacity = 0;
    requestAnimationFrame(() => {
      frame.style.opacity = '';
      if (this.pending === pending) this.drawing = drawPhoto(pending.photo, { onDone: () => this.settle() });
    });
    this.onToggle(true);
  }

  // The drawing finished at once, and whoever waits for it told.
  settle() {
    const pending = this.pending, drawing = this.drawing;
    this.pending = null;
    this.drawing = null;
    drawing?.finish();
    pending?.onDrawn?.(pending.photo);
  }

  // The sheet's edge, fitted to its size (a new tear for each print).
  edge() {
    const sheet = this.el.querySelector('.photo-sheet');
    const w = sheet?.offsetWidth, h = sheet?.offsetHeight;
    if (!w || !h) return;
    const svg = sheet.querySelector('.sheet-edge'), seed = (Math.random() * 1e9) | 0;
    const { pad, amp, step, shadow } = SHEET;
    svg.setAttribute('viewBox', `${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}`);
    svg.querySelector('.sheet-paper').setAttribute('d', sketchSheet(0, 0, w, h, seed, { amp, step }));
    svg.querySelector('.sheet-shadow').setAttribute('d', sketchSheet(shadow, shadow, w, h, seed + 1, { amp, step }));
  }

  hide() {
    if (!this.open) return;
    this.settle();
    this.el.classList.add('hidden');
    this.onToggle(false);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  // The <svg> of the photo shown.
  get photo() {
    return this.el.querySelector('svg.photo');
  }

  async save() {
    const src = this.photo;
    if (!src) return;
    this.settle();
    const blob = await printImage(src, { scale: 3, type: 'image/png' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.caption.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'photo'}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
