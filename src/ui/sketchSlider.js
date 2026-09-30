// A slider drawn by pen, like the UI frames (render/sketch.js): a bowed line
// for the track, a short stroke at each stop, and a circled knob that snaps
// to the stops. Drag it, tap along it, or use the arrow keys.
//
//   const s = new SketchSlider(stops, { label, onChange })
//   root.appendChild(s.el); s.value = 2; s.draw()  // draw() once it's on screen

import { sketchLine, sketchEllipse, seedOf } from '../render/sketch.js';

const NS = 'http://www.w3.org/2000/svg';
const H = 26;    // px: the slider's height
const PAD = 9;   // px: room at the ends for the knob
const KNOB = 6.5;

let count = 0;

export class SketchSlider {
  constructor(stops, { label = '', onChange = () => {} } = {}) {
    this.stops = stops; // how many
    this.index = 0;
    this.onChange = onChange;
    this.seed = seedOf(++count, 31);

    this.el = document.createElement('div');
    this.el.className = 'sk-slider';
    this.el.tabIndex = 0;
    this.el.setAttribute('role', 'slider');
    this.el.setAttribute('aria-label', label);
    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', String(stops - 1));
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('aria-hidden', 'true');
    this.track = document.createElementNS(NS, 'path');
    this.track.setAttribute('class', 'sk-track');
    this.fill = document.createElementNS(NS, 'path');
    this.fill.setAttribute('class', 'sk-fill');
    this.knob = document.createElementNS(NS, 'g');
    this.knob.setAttribute('class', 'sk-knob');
    this.knobPath = document.createElementNS(NS, 'path');
    this.knob.appendChild(this.knobPath);
    this.svg.append(this.track, this.fill, this.knob);
    this.el.appendChild(this.svg);

    // drag or tap anywhere along it
    const pick = (e) => {
      const r = this.el.getBoundingClientRect();
      const t = (e.clientX - r.left - PAD) / Math.max(1, r.width - PAD * 2);
      this.set(Math.round(Math.min(1, Math.max(0, t)) * (this.stops - 1)));
    };
    this.el.addEventListener('pointerdown', (e) => {
      try { this.el.setPointerCapture(e.pointerId); } catch { /* gone */ }
      this.dragging = true;
      this.el.classList.add('dragging');
      pick(e);
    });
    this.el.addEventListener('pointermove', (e) => { if (this.dragging) pick(e); });
    const end = () => { this.dragging = false; this.el.classList.remove('dragging'); };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
    this.el.addEventListener('keydown', (e) => {
      const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
      if (step) {
        e.preventDefault();
        this.set(this.index + step);
      } else if (e.key === 'Home') this.set(0);
      else if (e.key === 'End') this.set(this.stops - 1);
    });
  }

  get value() { return this.index; }
  set value(i) {
    this.index = Math.min(this.stops - 1, Math.max(0, i));
    this.el.setAttribute('aria-valuenow', String(this.index));
    this.place();
  }

  set(i) {
    const before = this.index;
    this.value = i;
    if (this.index !== before) this.onChange(this.index);
  }

  xOf(i) {
    return PAD + (this.w - PAD * 2) * (this.stops > 1 ? i / (this.stops - 1) : 0.5);
  }

  // (Re)draw at the slider's current width: the track and its stops, the knob.
  draw() {
    const w = this.el.clientWidth;
    if (!w) return;
    this.w = w;
    const y = H / 2;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${H}`);
    let d = sketchLine([PAD, y], [w - PAD, y], this.seed, { over: 2 });
    for (let i = 0; i < this.stops; i++) {
      const x = this.xOf(i);
      d += sketchLine([x, y - 4], [x, y + 4], this.seed + i + 1, { bow: 0.4 });
    }
    this.track.setAttribute('d', d);
    this.knobPath.setAttribute('d', sketchEllipse(0, y, KNOB, KNOB, this.seed + 99));
    this.place();
  }

  // the knob at its stop, and the stretch of track behind it gone over again
  place() {
    if (!this.w) return;
    const x = this.xOf(this.index), y = H / 2;
    this.knob.style.transform = `translateX(${x.toFixed(1)}px)`;
    this.fill.setAttribute('d', x > PAD + 1 ? sketchLine([PAD, y - 0.6], [x, y + 0.6], this.seed + 50, { bow: 0.6 }) : '');
  }
}
