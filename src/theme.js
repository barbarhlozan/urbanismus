// Visual theme. Colors come from the current color scheme – three colors,
// applied as CSS variables (--bg, --main, --detail) and used by styles.css:
//
//   bg      background, and the fill that lets buildings and spruces hide
//           what stands behind them
//   main    the structure of the map: roads, rails, paths, building outlines,
//           people and vehicles, the map frame; UI text and borders
//   detail  texture that should sit back: lines on walls (windows, floors),
//           ground drawing (lots, paving, parking), trees and shrubs, grid
//           dots, water hatching; secondary UI text. Terrain contours are
//           mixed from detail and bg.
//
// The Colors button cycles through SCHEMES; the choice is remembered in the
// browser. Drawings may name palette colors (`fill: 'bg'`); color() turns
// them into CSS variables, so a scheme change needs no redraw.

export const SCHEMES = [
  { name: 'Blue', bg: '#ebe7dd', main: '#3e12b6', detail: '#9b9486' },
  { name: 'Night', bg: '#000000', main: '#8f4646', detail: '#552936' },
  { name: 'Paper', bg: '#ebe7dd', main: '#23211d', detail: '#9b9486' },
];

const SCHEME_KEY = 'urbanismus.scheme';

export const THEME = {
  palette: { ...SCHEMES[0] },
  gridDotRadius: 0.8,  // scene px
  fineDotRadius: 0.45, // footpath grid
  agentRadius: 1.1,    // scene px, cars (moving and parked): half the square's side
  cyclistRadius: 0.75, // cyclists (round dots)
  walkerRadius: 0.63,  // pedestrians (half this wide, twice this tall)
  carriageRadius: 1.25, // train carriages: half the square's side
  truckRadius: 1.2,    // truck cab and trailer: half the square's side
};

// Index of the scheme in use.
export let schemeIndex = 0;

export function applyTheme(index = savedScheme(), root = document.documentElement) {
  schemeIndex = ((index % SCHEMES.length) + SCHEMES.length) % SCHEMES.length;
  const scheme = SCHEMES[schemeIndex];
  Object.assign(THEME.palette, scheme);
  for (const name of ['bg', 'main', 'detail']) root.style.setProperty(`--${name}`, scheme[name]);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', scheme.bg);
  try {
    localStorage.setItem(SCHEME_KEY, String(schemeIndex));
  } catch {
    // storage unavailable: the choice just won't be remembered
  }
  return scheme;
}

export function nextScheme() {
  return applyTheme(schemeIndex + 1);
}

function savedScheme() {
  try {
    return Number(localStorage.getItem(SCHEME_KEY)) || 0;
  } catch {
    return 0;
  }
}

// Palette names ('bg', 'main', 'detail'; 'fg' is the old name for main) as
// CSS variables; anything else is taken as a literal CSS color.
export function color(name) {
  if (name === 'fg') return 'var(--main)';
  return name === 'bg' || name === 'main' || name === 'detail' ? `var(--${name})` : name;
}
