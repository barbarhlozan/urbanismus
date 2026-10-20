// The Terrain setting: the contour lines. It's the player's setting, not any
// tool's: switched on in the Build menu's box beside Erase (a button with a
// small hill, crossed while it's on; ui/buildMenu.js), the lines stay on
// across tools and with nothing in hand, until switched off. It's remembered
// in this browser; the button is left out while story/unlocks.txt keeps
// Terrain locked (main.js).
//
// While building (a tool in hand that puts something down) the lines show
// anyway, lent for as long as the player builds, and go again when the tool
// is put down if the setting was off. Switching them off while they're lent
// hides them until the next time building starts; the remembered setting is
// only ever the player's.

const KEY = 'urbanismus.contours';

// renderer: has setContours(on); fallback: what to start with when nothing is
// remembered; changed(on): told whenever the lines come or go (to redraw the
// button). Returns { on(), set(on), toggle(), start(), lend(on) }.
export function contoursSetting({ renderer, fallback, changed = () => {} }) {
  let chosen = false; // the player's setting
  let lent = false; // shown for building
  let building = false;
  const show = () => {
    const on = chosen || lent;
    if (on !== renderer.contours) renderer.setContours(on);
    changed(on);
  };
  const set = (on) => {
    chosen = on;
    if (!on) lent = false;
    show();
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // storage unavailable: the choice just won't be remembered
    }
  };
  // building started (true) or stopped (false)
  const lend = (on) => {
    if (on === building) return;
    building = lent = on;
    show();
  };
  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // storage unavailable
  }
  return {
    on: () => renderer.contours,
    set,
    toggle: () => set(!renderer.contours),
    lend,
    start: () => set(saved === null ? fallback : saved === '1'),
  };
}
