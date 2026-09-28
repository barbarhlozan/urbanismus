// Pen-drawn frames for the UI boxes, to match the sketched map: each box
// gets an <svg> over its border with a rectangle of four crossing strokes
// (render/sketch.js), redrawn when the box changes size. The CSS border
// stays for spacing but turns transparent (.sketched in styles.css).
//
// The frame is drawn a few pixels inside the box, so the overshooting
// strokes are never clipped by overflow: hidden and inner dividers that run
// to the edge poke out past it like overshoots too.

import { sketchRect, seedOf } from '../render/sketch.js';

const INSET = 3;
const NS = 'http://www.w3.org/2000/svg';

let count = 0;

export function sketchFrame(el) {
  const seed = seedOf(++count, 17);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'sk-frame');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('pathLength', '1'); // for the pen drawing it on (motion.js)
  svg.appendChild(path);
  el.classList.add('sketched');

  const draw = () => {
    const { width, height } = el.getBoundingClientRect();
    if (!width || !height) return;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    path.setAttribute('d', sketchRect(INSET, INSET, width - INSET * 2, height - INSET * 2, seed, { over: INSET }));
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
export function sketchFrames(root, selectors) {
  for (const el of root.querySelectorAll(selectors)) sketchFrame(el);
}
