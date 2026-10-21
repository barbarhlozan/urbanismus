// TEMPORARY: a small panel (top right, opened with the Debug button) to
// switch parts of the drawing on and off and watch the frame rate, to find
// out what costs performance.
// Not remembered between reloads. Remove it (and its lines in main.js and
// styles.css) once the performance questions are settled.

import { STYLE } from '../render/style.js';
import { DRAW } from '../render/draw.js';
import { DAY, hourAt, stepAt, sunAt, holdDay, goOnDay, dayLength } from '../render/shadows.js';
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
      // TEMPORARY, the WebGL map's first step (webgl-plan.md): the ground's
      // lines drawn on the GPU instead
      ['Roads, paths, rails, fences in SVG (unticked: WebGL)', (on) => { renderer.setGlLines(!on); }],
    ];

    this.el = document.createElement('div');
    this.el.className = 'debug-panel hidden';
    this.onToggle = null; // (open) => …, for whoever needs to know
    this.el.innerHTML =
      '<div class="debug-head"><span>Debug</span><span class="fps">–</span><button class="close" aria-label="Close">×</button></div>' +
      '<div class="svg-count">–</div>' +
      '<div class="sun-row"><span class="sun-at">Day</span><input class="sun" type="range" min="0" max="23.75" step="0.25" value="0"></div>' +
      '<label><input type="checkbox" class="day-on" checked> The day goes on from there (unticked: the time stays put)</label>' +
      '<div class="sun-row"><span class="sun-at">A day lasts</span><select class="day-length"><option value="1800">30 minutes</option><option value="300">5 minutes</option><option value="120">2 minutes</option><option value="45">45 seconds</option></select></div>' +
      toggles.map(([label], i) => `<label><input type="checkbox" data-i="${i}" checked> ${label}</label>`).join('');
    root.appendChild(this.el);
    this.el.addEventListener('change', (e) => {
      const i = e.target.dataset.i;
      if (i != null) toggles[i][1](e.target.checked);
    });
    this.el.querySelector('.close').addEventListener('click', () => this.toggle(false));

    // the day (DAY in render/shadows.js), all 24 hours from the sunrise
    // round to just before the next: moving the slider holds the time
    // there, ticking the box lets the day carry on from where it is held;
    // a shorter day, to watch it go by
    const sun = this.el.querySelector('.sun'), dayOn = this.el.querySelector('.day-on'), dayAt = this.el.querySelector('.sun-at');
    const length = this.el.querySelector('.day-length');
    const part = (hour, step) => {
      if (step.night) return 'night';
      if (step.length) return hour < 12 ? 'dawn' : 'dusk';
      return hour < 10.5 ? 'morning' : hour < 13.5 ? 'midday' : hour < 16.5 ? 'afternoon' : 'evening';
    };
    const showDay = () => {
      const hour = DAY.on || DAY.held == null ? hourAt(renderer.world.time) : DAY.held;
      if (document.activeElement !== sun) sun.value = (((hour - DAY.dawn) % 24) + 24) % 24;
      const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
      dayAt.textContent = `Day ${hh}:${String(mm).padStart(2, '0')} · ${part(hour, DAY.steps[stepAt(hour)])}`;
      dayOn.checked = DAY.on;
      if (document.activeElement !== length) length.value = String(DAY.day);
    };
    sun.addEventListener('input', () => {
      holdDay((DAY.dawn + +sun.value) % 24);
      renderer.setSun(stepAt(DAY.held));
      showDay();
    });
    dayOn.addEventListener('change', () => {
      if (dayOn.checked) {
        goOnDay(renderer.world.time);
        renderer.setSun(sunAt(renderer.world.time));
      } else holdDay(hourAt(renderer.world.time));
      showDay();
    });
    length.addEventListener('change', () => {
      dayLength(+length.value, renderer.world.time);
      showDay();
    });
    setInterval(() => { if (this.open) showDay(); }, 500);
  }

  get open() {
    return isShown(this.el);
  }

  toggle(open = !this.open) {
    reveal(this.el, open, { rows: 'label' });
    this.onToggle?.(open);
  }
}
