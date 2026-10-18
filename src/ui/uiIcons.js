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
// Not here: the Build menu's tiles (icons.js toolIcon, drawn by each
// building's own draw code) and the marks on the map.

// Every file in icons/ui/, by name, and where the game shows it (the
// reference sheet, icons/ui/index.html, lists them with this).
export const ICONS = {
  menu: 'Menu button, top right: ≡ while the Menu is folded',
  'menu-close': 'Menu button, top right: the cross while the Menu is open',
  colors: 'Menu: Barvy / Colours',
  export: 'Menu: Uložit do souboru / Save to a file',
  import: 'Menu: Otevřít ze souboru / Open from a file',
  newmap: 'Menu: Nová mapa / New map',
  fullscreen: 'Menu: Celá obrazovka / Full screen, going in',
  'fullscreen-exit': 'Menu: Celá obrazovka / Full screen, coming back',
  'lang-cs': 'Menu: Čeština, shown while the game is in English',
  'lang-en': 'Menu: English, shown while the game is in Czech',
  rename: 'Top left: beside the town\'s name, to rename it',
  chronicle: 'Top left: the chronicle book, beside the town\'s name',
  camera: 'Bottom right corner: photo mode, P; and the dock while it\'s on',
  rotate: 'Tool dock: rotate option, Tab',
  'bend-diagonal': 'Tool dock: a line\'s bend, diagonal first, Tab',
  'bend-straight': 'Tool dock: a line\'s bend, straight first, Tab',
  'another-look': 'Tool dock: another look, Space',
  terrain: 'Build menu, beside Erase: Terén / Terrain (the contour lines)',
  undo: 'Build menu, beside Erase, and the dock on a phone: Zpět / Undo, ⌘Z',
  redo: 'Build menu, beside Erase, and the dock on a phone: Znovu / Redo',
  'no-road': 'Building card: the warning that no road or path reaches it',
  dice: 'New map: Jiné jméno / Another name, beside the town\'s name',
  hills: 'New map: Krajina / Land (the hills)',
  lakes: 'New map: Jezera / Lakes',
  forest: 'New map: Lesy / Forests',
  river: 'New map: Řeka / River',
  more: 'Dialogue: › to go on, once the line is all written',
};

// what was read: name → { viewBox, art }
const loaded = new Map();

export async function loadIcons() {
  await Promise.all(Object.keys(ICONS).map(async (name) => {
    try {
      const res = await fetch(new URL(`../../icons/ui/${name}.svg`, import.meta.url));
      if (!res.ok) throw new Error(`${res.status}`);
      const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
      const svg = doc.documentElement;
      if (svg.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('not an SVG');
      for (const s of svg.querySelectorAll('script, foreignObject')) s.remove();
      loaded.set(name, { viewBox: svg.getAttribute('viewBox') ?? '0 0 24 24', art: svg.innerHTML });
    } catch (err) {
      console.warn(`icons/ui/${name}.svg: ${err.message}; the drawing in the code stands in`);
    }
  }));
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
