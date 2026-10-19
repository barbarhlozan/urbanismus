// TEMPORARY: a small panel (top right, opened with the Debug button) to
// switch parts of the drawing on and off and watch the frame rate, to find
// out what costs performance.
// Not remembered between reloads. Remove it (and its lines in main.js and
// styles.css) once the performance questions are settled.

import { STYLE } from '../render/style.js';
import { DRAW } from '../render/draw.js';
import { DAY } from '../render/shadows.js';
import { NIGHT, showNight } from '../render/night.js';
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
      `<div class="sun-row"><span class="sun-at">Sun</span><input class="sun" type="range" min="0" max="${DAY.positions.length - 1}" step="1" value="${renderer.sunPos ?? 0}"></div>` +
      '<label><input type="checkbox" class="day-on" checked> The day goes on (unticked: the sun stays put)</label>' +
      '<div class="sun-row"><span class="sun-at">Night</span><select class="night"><option value="">off</option><option value="lines">in lines, over everything</option><option value="invert">colours turned to their negatives</option></select></div>' +
      `<div class="sun-row"><span class="sun-at night-every">Lines</span><input class="night-n" type="range" min="1" max="8" step="1" value="${NIGHT.every}"></div>` +
      `<div class="sun-row"><span class="sun-at night-tone">Negative</span><input class="night-t" type="range" min="0" max="1" step="0.1" value="${NIGHT.tone}"></div>` +
      `<div class="sun-row"><span class="sun-at night-cool">Blue</span><input class="night-c" type="range" min="0" max="1" step="0.1" value="${NIGHT.cool}"></div>` +
      toggles.map(([label], i) => `<label><input type="checkbox" data-i="${i}" checked> ${label}</label>`).join('');
    root.appendChild(this.el);
    this.el.addEventListener('change', (e) => {
      const i = e.target.dataset.i;
      if (i != null) toggles[i][1](e.target.checked);
    });
    this.el.querySelector('.close').addEventListener('click', () => this.toggle(false));

    // the sun (DAY in render/shadows.js): moving the slider holds it at a
    // position of the day, from the morning in the east to the evening in
    // the west; ticking the box lets the day carry on from the clock
    const sun = this.el.querySelector('.sun'), dayOn = this.el.querySelector('.day-on'), sunAt = this.el.querySelector('.sun-at');
    const steps = DAY.positions.length, mid = (steps - 1) / 2;
    const showSun = () => {
      const i = renderer.sunPos ?? 0;
      if (document.activeElement !== sun) sun.value = i;
      const part = i < mid - 1 ? 'morning' : i > mid + 1 ? 'evening' : i === mid ? 'midday' : i < mid ? 'late morning' : 'afternoon';
      sunAt.textContent = `Sun ${i + 1}/${steps} · ${part}`;
      dayOn.checked = DAY.on;
    };
    sun.addEventListener('input', () => {
      DAY.on = false;
      renderer.setSun(+sun.value);
      showSun();
    });
    dayOn.addEventListener('change', () => {
      DAY.on = dayOn.checked;
      showSun();
    });
    setInterval(() => { if (this.open) showSun(); }, 500);

    // the night (render/night.js): in lines (how dense) or in colours
    // (how far to the negative, how blue)
    const q = (c) => this.el.querySelector(c);
    const night = q('.night'), nightN = q('.night-n'), nightT = q('.night-t'), nightC = q('.night-c');
    const label = () => {
      const k = NIGHT.every;
      q('.night-every').textContent = `Lines: ${k === 1 ? 'every one' : `every ${k}${k === 2 ? 'nd' : k === 3 ? 'rd' : 'th'}`}`;
      q('.night-tone').textContent = `Negative: ${Math.round(NIGHT.tone * 100)} %`;
      q('.night-cool').textContent = `Blue: ${Math.round(NIGHT.cool * 100)} %`;
    };
    const setNight = () => {
      NIGHT.on = !!night.value;
      if (night.value) NIGHT.style = night.value;
      NIGHT.every = +nightN.value;
      NIGHT.tone = +nightT.value;
      NIGHT.cool = +nightC.value;
      label();
      showNight(renderer);
    };
    night.value = NIGHT.on ? NIGHT.style : '';
    label();
    night.addEventListener('change', setNight);
    for (const el of [nightN, nightT, nightC]) el.addEventListener('input', setNight);
  }

  get open() {
    return isShown(this.el);
  }

  toggle(open = !this.open) {
    reveal(this.el, open, { rows: 'label' });
    this.onToggle?.(open);
  }
}
