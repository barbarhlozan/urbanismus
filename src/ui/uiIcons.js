// The UI's drawings, each read from its own SVG file in icons/ui/ (see the
// README there), so a drawing is changed by replacing its file. Every file
// is fetched at startup, all at once, before any of the UI is built
// (main.js), and its drawing is written into the page inline wherever it's
// used, so it takes the colour scheme (currentColor) and the pen's weight
// of that place (styles.css) like the drawings written in the code. Only
// what's inside a file's <svg> is used, in that file's viewBox; the
// attributes on the <svg> itself are only for looking at the file on its
// own. A file that's missing, or isn't an SVG, leaves its place the drawing
// in the code, which each caller passes along as its stand-in.
//
// Not here: the Build menu's tiles for buildings (icons.js toolIcon, drawn
// by each building's own draw code) and the marks on the map. The menu's
// tabs are here, each group with a little sprite of its own (tab-…), and
// the tiles of the tools that aren't buildings (tool-…: roads, the
// footpath, the railway, the fence, the eraser).

// Every file in icons/ui/, by name, and where the game shows it (the
// reference sheet, icons/ui/index.html, lists them with this).
export const ICONS = {
  menu: 'Menu button, top right: ≡ while the Menu is folded',
  'menu-close': 'Menu button, top right: the cross while the Menu is open',
  colors: 'Menu: Barvy / Colours',
  export: 'Menu: Uložit do souboru / Save to a file',
  import: 'Menu: Otevřít ze souboru / Open from a file',
  newmap: 'Menu: Nová mapa / New map',
  settings: 'Menu: Nastavení / Settings (three sliders, as in the panel it opens)',
  'main-menu': 'Menu: Hlavní menu / Main menu, last before the imprint (the cover: a sheet with the name underlined)',
  // (not in the Menu for now: Settings has them, in words)
  fullscreen: 'Celá obrazovka / Full screen, going in (not shown for now: in Settings)',
  'fullscreen-exit': 'Celá obrazovka / Full screen, coming back (not shown for now)',
  sound: 'Zvuk / Sound, while it\'s on (not shown for now: the levels are in Settings)',
  'sound-off': 'Zvuk / Sound, while it\'s off (not shown for now)',
  'lang-cs': 'Čeština (not shown for now: the language is in Settings)',
  'lang-en': 'English (not shown for now)',
  rename: 'Top left: beside the town\'s name, to rename it',
  chronicle: 'The chronicle book (not shown for now)',
  'dev-time': 'Top left, after the chronicle, for now: the time menu (play, speed, the hour)',
  'dev-fire': 'Top left, after the time, for now: the fire menu (set alight, put out, burn down the building tapped last)',
  camera: 'Top left, beside the town\'s name: photo mode, P',
  rotate: 'Tool dock: rotate option, Tab',
  'bend-diagonal': 'Tool dock: a line\'s bend, diagonal first, Tab',
  'bend-straight': 'Tool dock: a line\'s bend, straight first, Tab',
  'another-look': 'Tool dock: another look, Space; and the Building card: Jiná podoba / Another look',
  terrain: 'Build menu, after Erase: Terén / Terrain (the contour lines), a range of mountains',
  undo: 'Build menu, first in the row, before Erase, and the dock on a phone: Zpět / Undo, ⌘Z',
  redo: 'Build menu, right after Zpět, and the dock on a phone: Znovu / Redo',
  erase: 'Building card: Zbourat / Demolish, last in the row of drawings (the Erase tool\'s eraser)',
  person: 'Building card: beside the number of people who live there (one of the town\'s people, as render/people.js draws them)',
  yard: 'Building card: Okolí / Surroundings, beside Jiná podoba (a fence and a shrub)',
  'no-road': 'Building card: the warning that no road or path reaches it',
  dice: 'New map: Jiné jméno / Another name, beside the town\'s name',
  hills: 'New map: Krajina / Land (the hills)',
  lakes: 'New map: Jezera / Lakes',
  forest: 'New map: Lesy / Forests',
  river: 'New map: Řeka / River',
  more: 'Dialogue: › to go on, once the line is all written',
  'tab-transport': 'Build menu tab: Cesty / Ways',
  'tab-housing': 'Build menu tab: Bydlení / Housing',
  'tab-amenities': 'Build menu tab: Občanská vybavenost / Amenities',
  'tab-work': 'Build menu tab: Výroba / Work',
  'tab-farming': 'Build menu tab: Zemědělství / Farming',
  'tab-fields': 'Build menu tab: Pole a pastviny / Fields and pastures',
  'tab-spaces': 'Build menu tab: Prostranství / Spaces',
  'tab-heritage': 'Build menu tab: Památky / Heritage',
  'tool-street': 'Build menu tile: Ulice / Street',
  'tool-road': 'Build menu tile: Silnice / Road',
  'tool-lane': 'Build menu tile: Úzká silnice / Narrow road',
  'tool-path': 'Build menu tile: Pěšina / Footpath',
  'tool-rail': 'Build menu tile: Železnice / Railway',
  'tool-fence': 'Build menu tile: Ohrada / Fence',
  'tool-wall': 'Build menu tile: Zídka / Churchyard wall',
  'tool-grain': 'Build menu tile: Obilí / Grain',
  'tool-potatoes': 'Build menu tile: Brambory / Potatoes',
  'tool-meadow': 'Build menu tile: Louka / Meadow',
  'tool-erase': 'Build menu: Vymazat / Erase (a rubber)',
};

// what was read: name → { viewBox, art }
const loaded = new Map();

export async function loadIcons() {
  await Promise.all(Object.keys(ICONS).map((name) => read(`ui/${name}`, name)));
}

// One file, icons/<path>.svg, kept as `name`.
async function read(path, name) {
  try {
    const res = await fetch(new URL(`../../icons/${path}.svg`, import.meta.url));
    if (!res.ok) throw new Error(`${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('not an SVG');
    for (const s of svg.querySelectorAll('script, foreignObject')) s.remove();
    loaded.set(name, { viewBox: svg.getAttribute('viewBox') ?? '0 0 24 24', art: svg.innerHTML });
  } catch (err) {
    console.warn(`icons/${path}.svg: ${err.message}; the drawing in the code stands in`);
  }
}

// A drawing as { viewBox, art, file }: its file's, or else the stand-in
// given (art on a box of `viewBox`), with file false.
export function drawing(name, art, viewBox = '0 0 16 16') {
  const read = loaded.get(name);
  return read ? { ...read, file: true } : { viewBox, art, file: false };
}

// A drawing in an <svg> of its own; `attrs` are that <svg>'s other
// attributes (its class…), as written.
export function iconSvg(name, attrs, art, viewBox) {
  const d = drawing(name, art, viewBox);
  return `<svg ${attrs} viewBox="${d.viewBox}">${d.art}</svg>`;
}
