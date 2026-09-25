// Touch or mouse? Starts from the media query and then follows whatever the
// player last used (hybrid laptops, tablets with a mouse). Sets `touch` on
// <body> so CSS can hide keyboard hints and enlarge buttons.

let touch = matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', touch);

export const isTouch = () => touch;

export function notePointer(e) {
  const t = e.pointerType !== 'mouse';
  if (t === touch) return;
  touch = t;
  document.body.classList.toggle('touch', touch);
}

// Narrow screens get a bottom-sheet menu instead of a popup at the pointer.
export const isNarrow = () => innerWidth <= 640;
