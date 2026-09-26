// Visual theme. Every color used anywhere goes through the palette, so adding
// color later means editing this file (and optionally referencing new names
// like `fill: 'water'` from structure / feature drawings).

export const THEME = {
  palette: {
    bg: '#000000',
    fg: '#ffffff',
    contour: '#484848',      // terrain contour lines
    contourIndex: '#7a7a7a', // every fifth one, and its height labels
  },
  gridDotRadius: 0.8,  // scene px
  fineDotRadius: 0.45, // footpath grid
  agentRadius: 1.1,    // scene px, cars (moving and parked): half the square's side
  cyclistRadius: 0.75, // cyclists (round dots)
  walkerRadius: 0.63,  // pedestrians (half this wide, twice this tall)
};

export function applyTheme(root = document.documentElement) {
  for (const [name, value] of Object.entries(THEME.palette)) {
    root.style.setProperty(`--${name}`, value);
  }
}

export function color(name) {
  return THEME.palette[name] ?? name;
}
