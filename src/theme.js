// Visual theme. Colors come from the current color scheme – five colors,
// applied as CSS variables (--bg, --main, --detail, --shade, --green) and
// used by styles.css:
//
//   bg      background, and the fill that lets buildings and spruces hide
//           what stands behind them
//   main    the structure of the map: roads, rails, paths, building outlines,
//           people and vehicles, the map frame; UI text and borders
//   detail  texture that should sit back: lines on walls (windows, floors),
//           ground drawing (lots, paving, parking), trees and shrubs, grid
//           dots, water hatching; secondary UI text. Terrain contours are
//           mixed from detail and bg.
//   shade   the side of a building turned from the light, its roof, and
//           the shadows on the ground (tone schemes, html.tone)
//   green   trees, shrubs and the grass at their feet (tone schemes)
//
// A scheme may leave out shade and green (schemes from before there were
// five): they are then mixed from detail and bg (withAll), so it looks as
// it did. A scheme with `tone` fills faces by what they are (Painter._wash
// tags them) with shade and green, in brush strokes along each face; with
// `painted` as well, without outlines, each face a tone of shade by what
// it is; `clean`: drawn without the sketch's overshoots, most of its
// wobble and tilt (Painter) – the loose hand suits only the Blue pen;
// one with `wash` is the watercolour experiment; `tint`: the pen sketch
// coloured in with the watercolour's colours. (No scheme has `tone` or
// `painted` for now: Pencil and the Painted ones were set aside.)
//
// The Colors menu (ui/colorMenu.js) picks one of SCHEMES or the custom
// scheme, whose three colors the player sets; both the choice and the custom
// colors are remembered in the browser. Drawings may name palette colors
// (`fill: 'bg'`); color() turns them into CSS variables, so a scheme change
// needs no redraw.

export const SCHEMES = [
  { name: 'Blue pen', bg: '#ebe7dd', main: '#3e12b6', detail: '#9b9486' },
  { name: 'Black pen', bg: '#ebe7dd', main: '#23211d', detail: '#9b9486', clean: true },
  // the pen sketch coloured in: drawn as the Blue pen is, over the
  // watercolour's colours (html.tint in styles.css)
  { name: 'Countryside', bg: '#f3eee2', main: '#3a2c24', detail: '#8f8a6e', tint: true },
  // painted in watercolour on cream paper: the faces washed in colour by
  // what they are (html.wc in styles.css, Painter._wash), no pen round them
  { name: 'Watercolour', bg: '#f6f0e3', main: '#4b3324', detail: '#8d8a5e', wash: true, clean: true },
];

export const COLOR_NAMES = ['bg', 'main', 'detail', 'shade', 'green'];
// The colours the Colors menu shows and lets the player set: shade and
// green only while a scheme uses them (a `tone` one; none for now).
export const MENU_COLORS = SCHEMES.some((s) => s.tone) ? COLOR_NAMES : COLOR_NAMES.slice(0, 3);

// A scheme with all five colours: shade and green, where it has none,
// mixed from its own (a mid tone of detail on bg; the trees in detail).
export function withAll(scheme) {
  return {
    ...scheme,
    shade: scheme.shade ?? mixHex(scheme.detail, scheme.bg, 0.45),
    green: scheme.green ?? scheme.detail,
  };
}

// Two colours (#rrggbb) mixed, `t` of the second, as #rrggbb.
function mixHex(a, b, t) {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

const SCHEME_KEY = 'urbanismus.scheme';
const CUSTOM_KEY = 'urbanismus.customScheme';
const PALETTE_KEY = 'urbanismus.palette';

// The player's own scheme; until first edited, a copy of the scheme in use.
const savedCustom = load(CUSTOM_KEY, JSON.parse);
export const CUSTOM = { name: 'Custom' };
const customBase = withAll({ ...SCHEMES[0], ...savedCustom });
for (const n of COLOR_NAMES) CUSTOM[n] = normalizeHex(savedCustom?.[n]) ?? normalizeHex(customBase[n]) ?? withAll(SCHEMES[0])[n];
let customSaved = savedCustom != null;

export const THEME = {
  palette: withAll(SCHEMES[0]),
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
  const scheme = withAll(choice === 'custom' ? CUSTOM : SCHEMES[choice]);
  Object.assign(THEME.palette, scheme);
  for (const flag of ['wash', 'tone', 'painted', 'clean', 'tint']) THEME.palette[flag] = !!scheme[flag];
  root.classList.toggle('wc', THEME.palette.wash);
  root.classList.toggle('tone', THEME.palette.tone);
  root.classList.toggle('painted', THEME.palette.painted);
  root.classList.toggle('clean', THEME.palette.clean);
  root.classList.toggle('tint', THEME.palette.tint);
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
  save(CUSTOM_KEY, JSON.stringify(Object.fromEntries(COLOR_NAMES.map((n) => [n, CUSTOM[n]]))));
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
// Two colours (#rrggbb) mixed, `t` of the second.
export function mixColour(a, b, t) {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}

export function color(name) {
  if (name === 'fg') return 'var(--main)';
  return name === 'bg' || name === 'main' || name === 'detail' ? `var(--${name})` : name;
}
