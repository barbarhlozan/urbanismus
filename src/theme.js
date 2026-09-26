// Visual theme. Every color used anywhere goes through the palette, so adding
// color later means editing this file (and optionally referencing new names
// like `fill: 'water'` from structure / feature drawings).

export const THEME = {
  palette: {
    bg: '#000000',
    fg: '#bababa',
    contour: '#171717',      // terrain contour lines
    contourIndex: '#222222', // every fifth one, and its height labels
  },
  gridDotRadius: 0.8,  // scene px
  fineDotRadius: 0.45, // footpath grid
  agentRadius: 1.1,    // scene px, cars (moving and parked): half the square's side
  cyclistRadius: 0.75, // cyclists (round dots)
  walkerRadius: 0.63,  // pedestrians (half this wide, twice this tall)
  carriageRadius: 1.25, // train carriages: half the square's side
};

export function applyTheme(root = document.documentElement) {
  for (const [name, value] of Object.entries(THEME.palette)) {
    root.style.setProperty(`--${name}`, value);
  }
}

export function color(name) {
  return THEME.palette[name] ?? name;
}
