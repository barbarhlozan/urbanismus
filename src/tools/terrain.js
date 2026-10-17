// The Terrain setting: the contour lines. It's the player's setting, not any
// tool's: switched on in the Build menu's box beside Erase (a button with a
// small hill, crossed while it's on; ui/buildMenu.js), the lines stay on
// across tools and with nothing in hand, until switched off. It's never
// switched on by itself, and it's remembered in this browser; the button is
// left out while story/unlocks.txt keeps Terrain locked (main.js).

const KEY = 'urbanismus.contours';

// renderer: has setContours(on); fallback: what to start with when nothing is
// remembered; changed(on): told whenever the setting changes (to redraw the
// button). Returns { on(), set(on), toggle() }.
export function contoursSetting({ renderer, fallback, changed = () => {} }) {
  const set = (on) => {
    renderer.setContours(on);
    changed(on);
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // storage unavailable: the choice just won't be remembered
    }
  };
  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // storage unavailable
  }
  return { on: () => renderer.contours, set, toggle: () => set(!renderer.contours), start: () => set(saved === null ? fallback : saved === '1') };
}
