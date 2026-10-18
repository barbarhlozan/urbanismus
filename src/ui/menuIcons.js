// The Menu's drawings, read from their own SVG files in icons/menu/ (see the
// README there), so a drawing is changed by replacing its file. Each file is
// fetched once at startup and written into the page inline, so it takes the
// colour scheme (currentColor) and the pen's weight like the other icons.
// A file that's missing, or isn't an SVG, leaves that item its old drawing
// from icons.js (controlArt).

import { controlArt } from './icons.js';

// a Menu item's drawing: its file in icons/menu/, and the icons.js drawing
// it falls back on (on a 16×16 box)
const FILES = {
  colors: ['colors', 'colors'],
  export: ['export', 'export'],
  import: ['import', 'import'],
  newMap: ['newmap', 'newMap'],
  fullscreen: ['fullscreen', 'fullscreen'],
  fullscreenExit: ['fullscreen-exit', 'fullscreen'],
  flagcs: ['lang-cs', 'flagcs'],
  flagen: ['lang-en', 'flagen'],
};

// what was read: id → { viewBox, art }
const loaded = new Map();

export async function loadMenuIcons() {
  await Promise.all(Object.entries(FILES).map(async ([id, [file]]) => {
    try {
      const res = await fetch(new URL(`../../icons/menu/${file}.svg`, import.meta.url));
      if (!res.ok) throw new Error(`${res.status}`);
      const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
      const svg = doc.documentElement;
      if (svg.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('not an SVG');
      for (const s of svg.querySelectorAll('script, foreignObject')) s.remove();
      loaded.set(id, { viewBox: svg.getAttribute('viewBox') ?? '0 0 24 24', art: svg.innerHTML });
    } catch (err) {
      console.warn(`icons/menu/${file}.svg: ${err.message}; the old drawing stands in`);
    }
  }));
}

// One part of a drawing, in a box of its own (its file's viewBox, or the
// old drawing's 16×16).
function part(id, cls = '') {
  const file = loaded.get(id);
  const c = cls ? ` class="${cls}"` : '';
  return file
    ? `<svg${c} viewBox="${file.viewBox}"><g class="from-file">${file.art}</g></svg>`
    : `<svg${c} viewBox="0 0 16 16">${controlArt(FILES[id][1])}</svg>`;
}

// A Menu item's drawing as an <svg>. Full screen has two, going in and
// coming back, and the button shows one or the other (styles.css). (Where
// the old drawing stands in for one, it carries both of its own; the same
// rule hides the one that doesn't belong.)
export function menuIcon(id) {
  const inner = id === 'fullscreen'
    ? part('fullscreen', 'fs-enter') + part('fullscreenExit', 'fs-exit')
    : part(id);
  return `<svg class="icon ctl-icon menu-art" viewBox="0 0 1 1" aria-hidden="true">${inner}</svg>`;
}
