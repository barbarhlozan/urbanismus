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

// Wide screens (a computer, a tablet held sideways) get the Build menu as a
// rail of groups along the right edge; anything narrower keeps it at the
// bottom. (1024: a large tablet upright still counts as narrow.)
export const isWide = () => innerWidth > 1024;
