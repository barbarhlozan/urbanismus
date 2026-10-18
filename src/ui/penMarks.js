// Pen marks on the controls: what a button is doing is drawn on it in the
// map's pen, never shown by a wash of colour or by turning it to solid ink.
// Each control gets one small <svg class="pm"> over it, its marks drawn
// with render/sketch.js from a seed of its own, so no two look alike; the
// marks are drawn when something changes (it's pointed at, pressed,
// chosen, resized) and never move on their own. styles.css decides which
// mark shows when:
//
//   pointed at       a line drawn under its word, or under its drawing if
//                    it has no word, from the left; down the side of a
//                    word written upright, from the top (never on a touch
//                    screen, which has no pointer to hover)
//   pressed          it grows a little and settles back (motion.js press),
//                    and its marks – and its own pen frame, if it has one –
//                    are drawn afresh
//   chosen           boxed: a box drawn in the thin pen round the edge of
//                    the control, filling round it (a tab, a tile, the
//                    camera, a Menu word whose panel is open), just inside
//                    a cell packed against its neighbours
//   picked line      a tick at the right of the line of words picked (a
//                    colour scheme)
//   setting          a small box in the corner, crossed while it's on
//                    (Terrain, beside Erase)
//   in hand          the name of the tool in hand boxed in the thick pen,
//                    a little askew, each tool at its own angle
//   can't            struck through (a popup's choice, Zpět with nothing
//                    to take back)
//   keyboard focus   crop marks at the four corners, as a printer marks
//                    where a sheet is cut (only on :focus-visible, so a
//                    click doesn't leave them)
//
// At rest nothing is added: what can be pressed already says so by where
// it stands – a cell ruled off by a pen frame, a drawing with its word, a
// numbered line, a row in a box just opened.
//
// penMarks(root) marks every control under root, and the ones added later.

import { sketchLine, sketchBox, seedOf } from '../render/sketch.js';
import { press } from './motion.js';

const NS = 'http://www.w3.org/2000/svg';
const CONTROLS = 'button, [role="slider"]';
// cells packed against their neighbours and the frame (tabs, tiles, the
// dock's buttons, the × in a heading): their marks sit just inside, not
// over the next cell
const CELLS = '.close, .bm-tab, .bm-tool, .bm-act, .bm-toggle, .bm-opts button, .bm-drop, .photo-corner, .chron-tab';
// what can be chosen, by the mark it gets (styles.css shows it)
const CHOSEN = '.bm-tab, .bm-tool, .photo-corner, .controls button, .chron-tab';
const TICKED = '.scheme';
const SETTING = '.bm-opts button[aria-pressed], .bm-act[aria-pressed]';
const HELD = '.bm-toggle';
const STRUCK = '.popup button, .bm-act';
// not part of the word that's underlined (a key, a value, a number, a Menu
// item's name written beside its drawing)
const ASIDE = '.pm, .key, .note, .dlg-n, .controls .label';
const OUT = 3;  // px the crop marks stand off a control…
const IN = -3;  // …or inside a cell, or a box that would clip them
const ARM = 6;  // px: each arm of a crop mark

let count = 0;
const parts = ['crop', 'u', 'chosen', 'tick', 'box', 'x', 'held', 'strike'];

export function penMarks(root) {
  const resized = new ResizeObserver((entries) => {
    for (const e of entries) draw(e.target);
  });
  const mark = (el) => {
    if (el.pmSvg) return;
    el.pmSeed = seedOf(++count, 53);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'pm');
    svg.setAttribute('aria-hidden', 'true');
    for (const p of parts) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('class', `pm-${p}`);
      svg.appendChild(path);
    }
    svg.querySelector('.pm-u').setAttribute('pathLength', '1'); // drawn on from the left (styles.css)
    el.pmSvg = svg;
    el.classList.add('pm-host');
    el.appendChild(svg);
    el.addEventListener('pointerenter', () => draw(el));
    el.addEventListener('focus', () => draw(el));
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && !el.disabled) pressed(el);
    });
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && !el.disabled && el.matches('button')) pressed(el);
    });
    resized.observe(el);
    draw(el);
  };
  for (const el of root.querySelectorAll(CONTROLS)) mark(el);
  new MutationObserver((records) => {
    const redraw = new Set();
    for (const r of records) {
      const host = r.target.nodeType === 1 ? r.target.closest('.pm-host') : r.target.parentElement?.closest('.pm-host');
      if (r.type === 'attributes') {
        if (r.target.pmSvg) redraw.add(r.target);
        continue;
      }
      // a control whose contents were written over has lost its marks
      if (r.target.pmSvg && r.target.pmSvg.parentNode !== r.target) r.target.appendChild(r.target.pmSvg);
      if (host) redraw.add(host); // (its word changed: the tool in hand)
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1 || n.classList.contains('pm')) continue;
        if (n.matches(CONTROLS)) mark(n);
        for (const el of n.querySelectorAll(CONTROLS)) mark(el);
      }
    }
    for (const el of redraw) draw(el);
  }).observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'aria-selected', 'disabled'] });
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

// The box round what's in it, in the control's own px: its words (the
// key, a value at the right, a choice's number left out), or failing
// that its drawing, or its padding box. (Measured on screen, then scaled
// back: mid-entrance the panel is scaled, motion.js.)
function contents(el, w) {
  const at = el.getBoundingClientRect();
  const k = at.width ? w / at.width : 1;
  const rects = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.textContent.trim() || n.parentElement.closest(ASIDE)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    rects.push(...[...range.getClientRects()].filter((r) => r.width > 1));
  }
  if (!rects.length) {
    const drawing = [...el.querySelectorAll('svg, .swatches')].find((s) => !s.closest('.pm') && s.getBoundingClientRect().width > 1);
    if (drawing) rects.push(drawing.getBoundingClientRect());
  }
  if (!rects.length) {
    const cs = getComputedStyle(el);
    const l = parseFloat(cs.paddingLeft), r = parseFloat(cs.paddingRight), t = parseFloat(cs.paddingTop), b = parseFloat(cs.paddingBottom);
    return { x: l, y: t, w: w - l - r, h: el.offsetHeight - t - b };
  }
  const x0 = Math.min(...rects.map((r) => r.left)), x1 = Math.max(...rects.map((r) => r.right));
  const y0 = Math.min(...rects.map((r) => r.top)), y1 = Math.max(...rects.map((r) => r.bottom));
  return { x: (x0 - at.left) * k, y: (y0 - at.top) * k, w: (x1 - x0) * k, h: (y1 - y0) * k };
}

function draw(el) {
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h || !el.pmSvg) return;
  // the svg needs a box to sit in: a control that's static becomes relative
  if (!el.classList.contains('pm-rel') && getComputedStyle(el).position === 'static') el.classList.add('pm-rel');
  const s = el.pmSeed;
  const set = (p, d, attrs = {}) => {
    const path = el.pmSvg.querySelector(`.pm-${p}`);
    path.setAttribute('d', d);
    for (const [k, v] of Object.entries(attrs)) path.setAttribute(k, v);
  };
  const cell = el.matches(CELLS);

  // keyboard focus
  const o = cell || clipped(el) ? IN : OUT;
  let d = '';
  [[-o, -o, 1, 1], [w + o, -o, -1, 1], [w + o, h + o, -1, -1], [-o, h + o, 1, -1]].forEach(([x, y, sx, sy], i) => {
    d += sketchLine([x - sx * 0.6, y], [x + sx * ARM, y], s + i * 2, { over: 0.6, bow: 0.4 });
    d += sketchLine([x, y - sy * 0.6], [x, y + sy * ARM], s + i * 2 + 1, { over: 0.6, bow: 0.4 });
  });
  set('crop', d);
  if (el.matches('[role="slider"]')) return; // (its knob shows the rest)

  // the line under its word: a little past each end, never quite level;
  // down the side of a word written upright (a book's thumb tab), on the
  // side its letters stand on, from its first letter
  const c = contents(el, w);
  const tilt = ((s % 3) - 1) * 0.5;
  if (getComputedStyle(el).writingMode.startsWith('vertical')) {
    const side = Math.max(c.x - 2.5, cell ? 4 : 1.5);
    set('u', sketchLine([side, c.y - 1], [side + tilt, c.y + c.h + 1], s, { over: 2 + (s % 4), bow: 1.3 }));
  } else {
    const base = Math.min(c.y + c.h + 2.5, h - (cell ? 4 : 1.5)); // (clear of a cell's rule)
    set('u', sketchLine([c.x - 1, base], [c.x + c.w + 1, base + tilt], s, { over: 2 + (s % 4), bow: 1.3 }));
  }

  if (el.matches(CHOSEN)) {
    // a box round its edge, in the thin pen and squarer than the tool in
    // hand's: on the edge (clear of the pen frame round a row of them),
    // just inside a cell, so it keeps off the next one
    const i = cell || clipped(el) ? 2.5 : 0;
    set('chosen', sketchBox(i, i, w - 2 * i, h - 2 * i, s + 7, { over: 2.5, waver: 0.8, slip: 0.6 }));
  }
  if (el.matches(TICKED)) {
    const x = w - 24, y = h / 2;
    set('tick', sketchLine([x, y], [x + 4, y + 5], s, { over: 0.5 }) + sketchLine([x + 4, y + 5], [x + 13, y - 7], s + 1, { over: 1.5, bow: 1.5 }));
  }
  if (el.matches(SETTING)) {
    const z = 7, x = 6, y = 6; // (clear of the dock's frame along the edge)
    set('box', sketchBox(x, y, z, z, s, { over: 1.2, waver: 0.4, slip: 0.5 }));
    set('x', sketchLine([x - 1, y - 1], [x + z + 1.5, y + z + 1], s, { over: 0.8 }) + sketchLine([x + z + 1, y - 1.5], [x - 1, y + z + 1], s + 3, { over: 0.8 }));
  }
  if (el.matches(HELD)) {
    // round the tool's name (or its drawing, where a phone leaves the name
    // out), at an angle that's its own: the same tool sits the same way
    // each time it's picked up
    const label = el.querySelector('.bm-label');
    const what = [label, el.querySelector('.bm-held')].find((x) => x?.offsetWidth);
    const t = seedOf(...[...(label?.textContent ?? '')].map((ch) => ch.charCodeAt(0)));
    const a = ((t % 5) - 2) * 0.5;
    const b = what ? { x: what.offsetLeft, y: what.offsetTop, w: what.offsetWidth, h: what.offsetHeight } : c;
    const [px, py] = what === label ? [6, 4] : [-2, -2]; // (a drawing fills its cell: inside it)
    set('held', sketchBox(b.x - px, b.y - py, b.w + 2 * px, b.h + 2 * py, t, { over: 3, waver: 1, slip: 0.8 }),
      { transform: `rotate(${a} ${b.x + b.w / 2} ${b.y + b.h / 2})` });
  }
  if (el.matches(STRUCK)) {
    const label = el.querySelector('.label');
    const b = label ? { x: label.offsetLeft, y: label.offsetTop, w: label.offsetWidth, h: label.offsetHeight } : c;
    set('strike', sketchLine([b.x - 3, b.y + b.h * 0.6], [b.x + b.w + 3, b.y + b.h * 0.47], s, { over: 3, bow: 1.2 }));
  }
}
