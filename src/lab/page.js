// What the lab pages (the *.html beside index.html) share beyond labs.css.

import { MAP_PATTERNS } from '../render/patterns.js';

// The map's fill patterns (render/patterns.js) for the page's drawings to
// use, as the map's <svg> has them.
export function mapPatterns() {
  document.body.insertAdjacentHTML('afterbegin', `<svg width="0" height="0" style="position:absolute"><defs>${MAP_PATTERNS}</defs></svg>`);
}
