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
// The Colors menu (ui/colorMenu.js) picks one of SCHEMES or the custom
// scheme, whose three colors the player sets; both the choice and the custom
// colors are remembered in the browser. Drawings may name palette colors
// (`fill: 'bg'`); color() turns them into CSS variables, so a scheme change
// needs no redraw.

export const SCHEMES = [
  { name: 'Blue pen', bg: '#ebe7dd', main: '#3e12b6', detail: '#9b9486' },
  { name: 'Black pen', bg: '#ebe7dd', main: '#23211d', detail: '#9b9486' },
  { name: 'Night', bg: '#000000', main: '#64645b', detail: '#363f46' },
  { name: 'Countryside', bg: '#d3d0c9', main: '#ce4919', detail: '#44499a' },
];

export const COLOR_NAMES = ['bg', 'main', 'detail'];

const SCHEME_KEY = 'urbanismus.scheme';
const CUSTOM_KEY = 'urbanismus.customScheme';
const PALETTE_KEY = 'urbanismus.palette';

// The player's own scheme; until first edited, a copy of the scheme in use.
const savedCustom = load(CUSTOM_KEY, JSON.parse);
export const CUSTOM = { name: 'Custom' };
for (const n of COLOR_NAMES) CUSTOM[n] = normalizeHex(savedCustom?.[n]) ?? SCHEMES[0][n];
let customSaved = savedCustom != null;

export const THEME = {
  palette: { ...SCHEMES[0] },
  gridDotRadius: 0.8,  // scene px
  fineDotRadius: 0.45, // footpath grid
  agentRadius: 1.1,    // scene px, cars (moving and parked): half the square's side
  cyclistRadius: 0.75, // cyclists (round dots)
  walkerRadius: 0.63,  // pedestrians (half this wide, twice this tall)
  carriageRadius: 2,    // train carriages: half the square's side
  truckRadius: 1.2,    // truck cab and trailer: half the square's side
};

// The scheme in use: an index into SCHEMES, or 'custom'.
export let schemeChoice = 0;

export function applyTheme(choice = load(SCHEME_KEY) ?? 0, root = document.documentElement) {
  if (choice !== 'custom') {
    const n = Number(choice) || 0;
    choice = ((n % SCHEMES.length) + SCHEMES.length) % SCHEMES.length;
  }
  schemeChoice = choice;
  const scheme = choice === 'custom' ? CUSTOM : SCHEMES[choice];
  Object.assign(THEME.palette, scheme);
  for (const name of COLOR_NAMES) root.style.setProperty(`--${name}`, scheme[name]);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', scheme.bg);
  save(SCHEME_KEY, String(choice));
  // the colours themselves too, for the opening cover (index.html), which
  // shows before any of this has loaded
  save(PALETTE_KEY, JSON.stringify({ bg: scheme.bg, main: scheme.main, detail: scheme.detail }));
  return scheme;
}

// Set one color of the custom scheme (a hex code: #rgb or #rrggbb) and switch
// to it. The first edit starts from the scheme in use. Returns the color as
// stored (#rrggbb), or null if the code isn't one.
export function setCustomColor(name, value) {
  const hex = normalizeHex(value);
  if (!hex || !COLOR_NAMES.includes(name)) return null;
  if (!customSaved && schemeChoice !== 'custom') {
    for (const n of COLOR_NAMES) CUSTOM[n] = THEME.palette[n];
  }
  CUSTOM[name] = hex;
  customSaved = true;
  save(CUSTOM_KEY, JSON.stringify({ bg: CUSTOM.bg, main: CUSTOM.main, detail: CUSTOM.detail }));
  applyTheme('custom');
  return hex;
}

export function normalizeHex(value) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return `#${h.toLowerCase()}`;
}

// localStorage, when there is one (a private window may refuse it)
function load(key, parse = (v) => v) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? null : parse(raw);
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the choice just won't be remembered
  }
}

// Palette names ('bg', 'main', 'detail'; 'fg' is the old name for main) as
// CSS variables; anything else is taken as a literal CSS color.
export function color(name) {
  if (name === 'fg') return 'var(--main)';
  return name === 'bg' || name === 'main' || name === 'detail' ? `var(--${name})` : name;
}
