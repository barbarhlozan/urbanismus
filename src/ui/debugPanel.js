// TEMPORARY: a small panel (top right, opened with the Debug button) to
// switch parts of the drawing on and off and watch the frame rate, to find
// out what costs performance.
// Not remembered between reloads. Remove it (and its lines in main.js and
// styles.css) once the performance questions are settled.

import { STYLE } from '../render/style.js';
import { DRAW } from '../render/draw.js';
import { reveal, isShown } from './motion.js';

// The classes of a tree's parts (features/trees.js), also where a building
// draws trees in its yard or park.
const TREE_PARTS = '.tree, .leaf, .trunk, .twig, .limb';

export class DebugPanel {
  constructor(root, { renderer, camera }) {
    const layer = (name) => renderer.layers[name];
    const show = (el, on) => { el.style.display = on ? '' : 'none'; };
    const lift = camera.lift;

    // buildings, trees, lamps: hidden through the renderer's cull, which
    // would show them again on the next move if only their style was set
    const kind = (k) => (on) => {
      if (on) renderer.hiddenKinds.delete(k);
      else renderer.hiddenKinds.add(k);
      renderer.cull();
    };

    const toggles = [
      ['Relief (hills lift the map)', (on) => { camera.lift = on ? lift : null; renderer.invalidate(); }],
      ['Move map on GPU while panning / zooming', (on) => { renderer.deferView = on; }],
      ['Constant line width', (on) => { renderer.constantStrokes = on; renderer.updateStroke(camera.zoom); }],
      ['People, bikes, cars', (on) => { renderer.showAgents = on; }],
      ['Hide buildings outside the view', (on) => { renderer.cullOn = on; renderer.cull(); renderer.cullMeadow(); }],
      ['Buildings', kind('s')],
      // the trees on their own, and (by their classes, features/trees.js)
      // those drawn in yards and parks as part of a building
      ['Trees', (on) => { kind('f')(on); show(layer('forest'), on); document.body.classList.toggle('debug-no-trees', !on); }],
      ['Street lamps', kind('k')],
      ['Parked cars', (on) => show(layer('parked'), on)],
      ['Roads and paths', (on) => { show(layer('roads'), on); show(layer('paths'), on); }],
      ['Meadow grass', (on) => show(layer('meadow'), on)],
      ['Grid dots', (on) => show(layer('grid'), on)],
      ['Hover tags', (on) => { STYLE.hoverTags = on; }],
      ['Pen animations (build / demolish)', (on) => { DRAW.on = on; }],
    ];

    this.el = document.createElement('div');
    this.el.className = 'debug-panel hidden';
    this.onToggle = null; // (open) => …, for whoever needs to know
    this.el.innerHTML =
      '<div class="debug-head"><span>Debug</span><span class="fps">–</span><button class="close" aria-label="Close">×</button></div>' +
      '<div class="svg-count">–</div>' +
      toggles.map(([label], i) => `<label><input type="checkbox" data-i="${i}" checked> ${label}</label>`).join('');
    root.appendChild(this.el);
    this.el.addEventListener('change', (e) => {
      const i = e.target.dataset.i;
      if (i != null) toggles[i][1](e.target.checked);
    });
    this.el.querySelector('.close').addEventListener('click', () => this.toggle(false));

    // frame rate: frames per second, average and slowest frame, every half second
    const fps = this.el.querySelector('.fps');
    let n = 0, worst = 0, start = performance.now(), last = start;
    const tick = (now) => {
      requestAnimationFrame(tick);
      if (!this.open) {
        // closed: nothing to measure, start fresh when it opens again
        n = 0; worst = 0; start = last = now;
        return;
      }
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

    // SVG elements: in the page, and shown (not in a hidden layer, a culled
    // building or a hidden kind) by what they draw. Counted once a second
    // while open, when the browser is idle, as it walks the whole drawing.
    const count = this.el.querySelector('.svg-count');
    const k = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
    const idle = window.requestIdleCallback ?? ((f) => setTimeout(f, 0));
    const tally = () => {
      const all = (el) => el.getElementsByTagName('*').length;
      const visible = (el) => getComputedStyle(el).display !== 'none'; // (the grid is hidden by a class)
      const kinds = { s: 0, f: 0, k: 0 };
      let yard = 0; // tree parts in buildings' drawings (hidden by CSS with the trees off)
      let total = 0, other = 0;
      for (const el of Object.values(renderer.layers)) total += all(el);
      for (const e of renderer.objs.values()) {
        if (e.shown === false) continue;
        const n = (visible(layer('objects')) ? all(e.g) : 0) + (visible(layer('lots')) ? all(e.lg) : 0) + (visible(layer('shadows')) ? all(e.sg) : 0);
        kinds[e.key[0]] = (kinds[e.key[0]] ?? 0) + n;
        if (e.key[0] === 's' && visible(layer('objects'))) yard += e.g.querySelectorAll(TREE_PARTS).length;
      }
      kinds.s -= yard;
      if (document.body.classList.contains('debug-no-trees')) yard = 0;
      for (const [name, el] of Object.entries(renderer.layers)) {
        if (['objects', 'lots', 'shadows'].includes(name) || !visible(el)) continue;
        if (name === 'meadow') for (const chunk of renderer.meadow.values()) other += chunk.shown === false ? 0 : all(chunk.g);
        else other += all(el);
      }
      const shown = kinds.s + yard + kinds.f + kinds.k + other;
      count.textContent = `SVG: ${k(total)} in page · ${k(shown)} shown — buildings ${k(kinds.s)} · trees ${k(kinds.f)} + ${k(yard)} in yards · lamps ${k(kinds.k)} · rest ${k(other)}`;
    };
    setInterval(() => { if (this.open) idle(tally); }, 1000);
  }

  get open() {
    return isShown(this.el);
  }

  toggle(open = !this.open) {
    reveal(this.el, open, { rows: 'label' });
    this.onToggle?.(open);
  }
}
