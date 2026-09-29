// A photo from photo mode (render/photo.js), shown as a print with a white
// border and a caption, with a button to save it as a PNG.

import { sketchFrame } from './sketchFrame.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// computed styles copied onto each element for the PNG (the page's CSS does
// not reach an SVG drawn into a canvas)
const PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'display', 'visibility'];

export class PhotoPrint {
  constructor(root) {
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
        <button data-act="save">Save PNG</button>
        <button data-act="close">Close</button>
      </div>`;
    this.el.classList.remove('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  async save() {
    const src = this.el.querySelector('svg.photo');
    if (!src) return;
    const copy = src.cloneNode(true);
    const from = [src, ...src.querySelectorAll('*')];
    const to = [copy, ...copy.querySelectorAll('*')];
    from.forEach((el, i) => {
      const cs = getComputedStyle(el);
      to[i].setAttribute('style', PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
    });
    const [w, h] = [Number(src.getAttribute('width')), Number(src.getAttribute('height'))];
    const scale = 3;
    copy.setAttribute('width', w * scale);
    copy.setAttribute('height', h * scale);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${this.caption.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'photo'}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
