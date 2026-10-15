// Pen marks on the controls: what a button is doing (pressed, in keyboard
// focus) is drawn on it in the map's pen, never shown by a wash of colour.
// Each control gets one small <svg class="pm"> over it, its marks drawn
// with render/sketch.js from a seed of its own, so no two look alike; the
// marks are drawn once and redrawn only on an event (a press, a change of
// size), never continuously.
//
//   keyboard focus   crop marks at the four corners, as a printer marks
//                    where a sheet is cut (styles.css shows them only on
//                    :focus-visible, so a click doesn't leave them)
//   press            the control grows a little and settles back
//                    (motion.js press), and its marks – and its own pen
//                    frame, if it has one – are drawn afresh
//
// penMarks(root) marks every control under root, and the ones added later.

import { sketchLine, seedOf } from '../render/sketch.js';
import { press } from './motion.js';

const NS = 'http://www.w3.org/2000/svg';
const CONTROLS = 'button, [role="slider"]';
// cells packed against their neighbours and the frame (tabs, tiles, the
// dock's buttons, the × in a heading): their marks sit just inside, not
// over the next cell
const CELLS = '.close, .bm-tab, .bm-tool, .bm-act, .bm-toggle, .bm-opts button, .bm-drop, .photo-corner';
const OUT = 3;  // px the crop marks stand off a control…
const IN = -3;  // …or inside a cell, or a box that would clip them
const ARM = 6;  // px: each arm of a crop mark

let count = 0;

export function penMarks(root) {
  for (const el of root.querySelectorAll(CONTROLS)) mark(el);
  new MutationObserver((records) => {
    for (const r of records) {
      // a control whose contents were written over has lost its marks
      if (r.target.pmSvg && r.target.pmSvg.parentNode !== r.target) r.target.appendChild(r.target.pmSvg);
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1 || n.classList.contains('pm')) continue;
        if (n.matches(CONTROLS)) mark(n);
        for (const el of n.querySelectorAll(CONTROLS)) mark(el);
      }
    }
  }).observe(root, { childList: true, subtree: true });
}

function mark(el) {
  if (el.pmSvg) return;
  el.pmSeed = seedOf(++count, 53);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'pm');
  svg.setAttribute('aria-hidden', 'true');
  const crop = document.createElementNS(NS, 'path');
  crop.setAttribute('class', 'pm-crop');
  svg.appendChild(crop);
  el.pmSvg = svg;
  el.classList.add('pm-host');
  el.appendChild(svg);
  // drawn when needed: on focus, and afresh on a press
  el.addEventListener('focus', () => draw(el));
  el.addEventListener('pointerdown', (e) => {
    if (e.button === 0 && !el.disabled) pressed(el);
  });
  el.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && !el.disabled && el.matches('button')) pressed(el);
  });
}

function pressed(el) {
  el.pmSeed = seedOf(++count, 91);
  draw(el);
  el.resketch?.(); // its own frame (sketchFrame.js)
  press(el);
}

// Does a box between the control and the panel cut off what pokes out?
function clipped(el) {
  for (let a = el.parentElement; a && a.id !== 'ui'; a = a.parentElement) {
    if (a.classList.contains('sketched')) return false; // (a framed box lets its strokes out)
    if (getComputedStyle(a).overflow !== 'visible') return true;
  }
  return false;
}

function draw(el) {
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h) return;
  // the svg needs a box to sit in: a control that's static becomes relative
  if (!el.classList.contains('pm-rel') && getComputedStyle(el).position === 'static') el.classList.add('pm-rel');
  const o = el.matches(CELLS) || clipped(el) ? IN : OUT;
  const s = el.pmSeed;
  let d = '';
  [[-o, -o, 1, 1], [w + o, -o, -1, 1], [w + o, h + o, -1, -1], [-o, h + o, 1, -1]].forEach(([x, y, sx, sy], i) => {
    d += sketchLine([x - sx * 0.6, y], [x + sx * ARM, y], s + i * 2, { over: 0.6, bow: 0.4 });
    d += sketchLine([x, y - sy * 0.6], [x, y + sy * ARM], s + i * 2 + 1, { over: 0.6, bow: 0.4 });
  });
  el.pmSvg.querySelector('.pm-crop').setAttribute('d', d);
}
