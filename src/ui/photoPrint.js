// A photo from photo mode (render/photo.js), shown as a print with a white
// border and a caption, with a button to save it as a PNG. While it's out,
// photo mode rests: the map, its keys and the camera's controls wait until
// the print is put away (main.js, through onToggle; styles.css
// body.print-open). It is pasted into the chronicle too (main.js,
// ui/prints.js).

import { sketchFrame } from './sketchFrame.js';
import { t } from '../core/text.js';
import { printImage } from './prints.js';
import { brushPhoto } from './photoBrush.js';
import { drawPhoto } from './photoDraw.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class PhotoPrint {
  constructor(root, { onToggle = () => {} } = {}) {
    this.onToggle = onToggle;
    this.el = document.createElement('div');
    this.el.className = 'photo-print hidden';
    root.appendChild(this.el);
    sketchFrame(this.el);
    this.el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') this.hide();
      if (act === 'save') this.save();
    });
  }

  show(svg, caption) {
    this.caption = caption;
    this.el.innerHTML = `
      <div class="photo-frame">${svg}</div>
      <div class="photo-caption">${esc(caption)}</div>
      <div class="photo-buttons">
        <button data-act="save">${t('photo.save')}</button>
        <button data-act="close">${t('close')}</button>
      </div>`;
    this.el.classList.remove('hidden');
    // (in the page now, so its styles are known: drawn with the pen's line)
    brushPhoto(this.photo);
    // and drawn in before your eyes – from the next frame, once the print
    // for the chronicle (main.js) has been made of the finished photo
    this.drawing?.finish();
    this.drawing = null;
    // (the finished photo kept out of sight till then, so it doesn't flash up)
    const photo = this.photo, frame = this.el.querySelector('.photo-frame');
    frame.style.opacity = 0;
    requestAnimationFrame(() => {
      if (this.photo === photo) this.drawing = drawPhoto(photo);
      frame.style.opacity = '';
    });
    this.onToggle(true);
  }

  hide() {
    if (!this.open) return;
    this.drawing?.finish();
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
    this.drawing?.finish();
    const blob = await printImage(src, { scale: 3, type: 'image/png' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.caption.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'photo'}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
