// Pen-drawn frames for the UI boxes, to match the sketched map: each box
// gets an <svg> over its border with a box drawn freehand – one stroke
// round rounded corners, closing a little past where it began, the way the
// buildings are drawn now (render/sketch.js sketchRoundBox) – redrawn when
// the box changes size. The CSS
// border stays for spacing but turns transparent, and the box no longer
// clips what's in it, so the strokes can run out past its edge (.sketched
// in styles.css).
//
// The frame lies on the box's border, so inner dividers that run to the
// edge end on it.
//
// Not every box in the same hand (HANDS): the town's panel is drawn
// steadily, a menu that comes and goes quickly and loosely, the rest in
// between – one even system for everything would look generated.
//
// A framed button (the camera in the corner) has its frame drawn afresh,
// with a new seed, when it's pressed (el.resketch, called by penMarks.js);
// otherwise a frame keeps its strokes and is only refitted to a new size.

import { sketchRoundBox, seedOf } from '../render/sketch.js';

const INSET = 1.5;
const RADIUS = 7; // px, the corners of a big box (small ones round less)
const NS = 'http://www.w3.org/2000/svg';

// { waver: px a side bends, slip: px the end lands off the start, lap: px
// it runs over the start, tremor: px the line trembles } (render/sketch.js sketchRoundBox)
export const HANDS = {
  steady: { waver: 0.8, slip: 0.5, lap: 4, tremor: 0.25 },
  loose: { waver: 2.2, slip: 1.6, lap: 10, tremor: 0.45 },
};

let count = 0;

export function sketchFrame(el, hand = {}) {
  let seed = seedOf(++count, 17);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'sk-frame');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('pathLength', '1'); // for the pen drawing it on (motion.js)
  svg.appendChild(path);
  el.classList.add('sketched');

  const draw = () => {
    // the box's own size, not its outline on screen: mid-entrance it's tilted
    // and scaled (motion.js), and a frame fitted to that wouldn't fit after
    const width = el.offsetWidth, height = el.offsetHeight;
    if (!width || !height) return;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    // (small boxes – a button, the dock – round less and bend less)
    const small = Math.min(width, height);
    const radius = Math.min(RADIUS, 2 + small * 0.12);
    const waver = Math.min(hand.waver ?? 1.4, small * 0.03);
    path.setAttribute('d', sketchRoundBox(INSET, INSET, width - INSET * 2, height - INSET * 2, seed, { ...hand, radius, waver }));
  };
  // boxes that rebuild their content (innerHTML) drop the frame: put it back
  const attach = () => {
    if (svg.parentNode !== el) el.appendChild(svg);
  };
  attach();
  el.resketch = () => {
    seed = seedOf(++count, 17);
    draw();
  };
  new ResizeObserver(draw).observe(el);
  new MutationObserver(attach).observe(el, { childList: true });
  draw();
}

// Frame every box matching the selectors under root.
export function sketchFrames(root, selectors, hand) {
  for (const el of root.querySelectorAll(selectors)) sketchFrame(el, hand);
}
