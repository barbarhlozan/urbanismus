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
  carriageRadius: 2,    // trains far out: half the oblong's width
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
  showPalette(nightTone.t ? nightPalette(scheme, nightTone.t, nightTone.cool) : scheme, root);
  save(SCHEME_KEY, String(choice));
  // the colours themselves too, for the opening cover (index.html), which
  // shows before any of this has loaded
  save(PALETTE_KEY, JSON.stringify({ bg: scheme.bg, main: scheme.main, detail: scheme.detail }));
  return scheme;
}

// The colours drawn with: on the page (the CSS variables) and for the
// canvases (THEME.palette).
function showPalette(colors, root = document.documentElement) {
  Object.assign(THEME.palette, colors);
  for (const name of COLOR_NAMES) root.style.setProperty(`--${name}`, colors[name]);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors.bg);
}

// ----- night, as the scheme's negative (render/night.js, style 'invert') -----

// How far the colours are turned to the night (0 day … 1), and how much
// they lean to blue there; set with setNightTone.
const nightTone = { t: 0, cool: 0 };

// The scheme in use, as the night makes it at `t` (0 … 1), in OKLab
// (where lightness is lightness to the eye), in two parts, as a plain mix
// would pass through a grey where paper and ink are the same and nothing
// shows:
//   dusk   (t up to ½) everything dims together, by up to DUSK of
//          lightness: the paper greys, the ink stays darker than it
//   night  (from ½) the lightness is turned over – the paper dark, each ink
//          lighter than it by how much darker it was by day (as a share
//          of the paper's lightness, its square root, so a mid-tone pen
//          still stands off the paper), up to the palest ink. The paper
//          starts at NIGHT_LIGHT[0] (a little darker than the dusk's, so
//          there is room above it for the ink) and ends at [1], a dark
//          grey rather than black; the palest ink is [2], short of white
// The hue stays (a warm paper stays warm, a blue pen blue), leaning
// `cool` to blue as it gets darker. A scheme whose paper is already the
// darkest of its colours (Night) is a night already, and stays as it is.
const DUSK = 0.3;
const NIGHT_LIGHT = [0.42, 0.25, 0.92];
export function nightPalette(scheme, t = 1, cool = 0) {
  const out = {};
  const lab = Object.fromEntries(COLOR_NAMES.map((n) => [n, toLab(scheme[n])]));
  if (COLOR_NAMES.some((n) => lab[n][0] < lab.bg[0] - 1e-6) === false) return { ...scheme };
  for (const name of COLOR_NAMES) {
    const [L, a, b] = lab[name];
    let L1;
    if (t <= 0.5) L1 = Math.max(0.03, L - DUSK * (t / 0.5));
    else {
      const s = (t - 0.5) / 0.5, [from, to, top] = NIGHT_LIGHT;
      const paper = from + (to - from) * s;
      L1 = paper + (top - paper) * Math.sqrt(Math.max(0, (lab.bg[0] - L) / lab.bg[0]));
    }
    out[name] = fromLab([L1, a, b - 0.03 * cool * t]);
  }
  return out;
}

// Turn the scheme in use towards the night (t 0 … 1); 0 is the day.
export function setNightTone(t, cool = 0) {
  nightTone.t = Math.min(1, Math.max(0, t));
  nightTone.cool = cool;
  const scheme = schemeChoice === 'custom' ? CUSTOM : SCHEMES[schemeChoice];
  showPalette(nightTone.t ? nightPalette(scheme, nightTone.t, cool) : scheme);
}

// #rrggbb <-> OKLab [L, a, b] (Björn Ottosson's).
function toLab(hex) {
  const n = parseInt(normalizeHex(hex).slice(1), 16);
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => lin(c / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function fromLab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, gam(c))) * 255).toString(16).padStart(2, '0')).join('')}`;
}

// Set one color of the custom scheme (a hex code: #rgb or #rrggbb) and switch
// to it. The first edit starts from the scheme in use. Returns the color as
// stored (#rrggbb), or null if the code isn't one.
export function setCustomColor(name, value) {
  const hex = normalizeHex(value);
  if (!hex || !COLOR_NAMES.includes(name)) return null;
  if (!customSaved && schemeChoice !== 'custom') {
    for (const n of COLOR_NAMES) CUSTOM[n] = SCHEMES[schemeChoice][n]; // (the day's, whatever the night shows)
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
