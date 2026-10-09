// Pen-drawn frames for the UI boxes, to match the sketched map: each box
// gets an <svg> over its border with a box drawn freehand – four wavering
// strokes that run on past the corners, long sides sometimes in two goes
// (render/sketch.js sketchBox) – redrawn when the box changes size. The CSS
// border stays for spacing but turns transparent, and the box no longer
// clips what's in it, so the strokes can run out past its edge (.sketched
// in styles.css).
//
// The frame is drawn a couple of pixels inside the box, so inner dividers
// that run to the edge poke out past it like overshoots too.
//
// Not every box in the same hand (HANDS): the town's panel is drawn
// steadily, a menu that comes and goes quickly and loosely, the rest in
// between – one even system for everything would look generated.

import { sketchBox, seedOf } from '../render/sketch.js';

const INSET = 2;
const OVER = 8; // px the strokes run on past the corners, at most
const NS = 'http://www.w3.org/2000/svg';

// { over: px past the corners at most, waver: px a side bends, slip: px its
// ends start off the line } (render/sketch.js sketchBox)
export const HANDS = {
  steady: { over: 4, waver: 1, slip: 0.7 },
  loose: { over: 12, waver: 3.4, slip: 2.4 },
};

let count = 0;

export function sketchFrame(el, hand = {}) {
  const seed = seedOf(++count, 17);
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
    // (small boxes – a button, the dock – overshoot less)
    const over = Math.min(hand.over ?? OVER, 3 + Math.min(width, height) * 0.1);
    path.setAttribute('d', sketchBox(INSET, INSET, width - INSET * 2, height - INSET * 2, seed, { ...hand, over }));
  };
  // boxes that rebuild their content (innerHTML) drop the frame: put it back
  const attach = () => {
    if (svg.parentNode !== el) el.appendChild(svg);
  };
  attach();
  new ResizeObserver(draw).observe(el);
  new MutationObserver(attach).observe(el, { childList: true });
  draw();
}

// Frame every box matching the selectors under root.
export function sketchFrames(root, selectors, hand) {
  for (const el of root.querySelectorAll(selectors)) sketchFrame(el, hand);
}
