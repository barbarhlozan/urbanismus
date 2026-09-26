// TEMPORARY: a small panel (bottom right) to switch parts of the drawing on
// and off and watch the frame rate, to find out what costs performance.
// Not remembered between reloads. Remove it (and its lines in main.js and
// styles.css) once the performance questions are settled.

import { STYLE } from '../render/style.js';

export class DebugPanel {
  constructor(root, { renderer, camera }) {
    const svg = renderer.svg;
    const layer = (name) => svg.querySelector(`.layer-${name}`);
    const show = (el, on) => { el.style.display = on ? '' : 'none'; };
    const lift = camera.lift;

    const toggles = [
      ['Relief (hills lift the map)', (on) => { camera.lift = on ? lift : null; renderer.invalidate(); }],
      ['Move map on GPU while panning / zooming', (on) => { renderer.deferView = on; }],
      ['Constant line width', (on) => document.body.classList.toggle('scaling-strokes', !on)],
      ['People, bikes, cars', (on) => { renderer.showAgents = on; }],
      ['Buildings and trees', (on) => { show(layer('objects'), on); show(layer('lots'), on); }],
      ['Roads and paths', (on) => { show(layer('roads'), on); show(layer('paths'), on); }],
      ['Grid dots', (on) => show(layer('grid'), on)],
      ['Map frame', (on) => show(layer('frame'), on)],
      ['Hover tags', (on) => { STYLE.hoverTags = on; }],
    ];

    this.el = document.createElement('div');
    this.el.className = 'debug-panel';
    this.el.innerHTML =
      '<div class="debug-head"><span>Debug</span><span class="fps">–</span></div>' +
      toggles.map(([label], i) => `<label><input type="checkbox" data-i="${i}" checked> ${label}</label>`).join('');
    root.appendChild(this.el);
    this.el.addEventListener('change', (e) => {
      const i = e.target.dataset.i;
      if (i != null) toggles[i][1](e.target.checked);
    });
    this.el.querySelector('.debug-head').addEventListener('click', () => this.el.classList.toggle('folded'));

    // frame rate: frames per second, average and slowest frame, every half second
    const fps = this.el.querySelector('.fps');
    let n = 0, worst = 0, start = performance.now(), last = start;
    const tick = (now) => {
      requestAnimationFrame(tick);
      n++;
      worst = Math.max(worst, now - last);
      last = now;
      if (now - start < 500) return;
      const ms = (now - start) / n;
      fps.textContent = `${Math.round(1000 / ms)} fps · ${ms.toFixed(1)} ms · worst ${worst.toFixed(0)} ms`;
      n = 0;
      worst = 0;
      start = now;
    };
    requestAnimationFrame(tick);
  }
}
