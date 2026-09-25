// Visual theme. Every color used anywhere goes through the palette, so adding
// color later means editing this file (and optionally referencing new names
// like `fill: 'water'` from structure / feature drawings).

export const THEME = {
  palette: {
    bg: '#000000',
    fg: '#ffffff',
  },
  gridDotRadius: 0.8,  // scene px
  fineDotRadius: 0.45, // footpath grid
  agentRadius: 1.4,    // scene px, cars (moving and parked)
  walkerRadius: 0.9,   // pedestrians
};

export function applyTheme(root = document.documentElement) {
  for (const [name, value] of Object.entries(THEME.palette)) {
    root.style.setProperty(`--${name}`, value);
  }
}

export function color(name) {
  return THEME.palette[name] ?? name;
}
