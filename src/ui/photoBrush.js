// A photo drawn with the pen's own line. The map draws every line through
// the brush (render/brush.js: thinner at its ends, swelling and thinning
// along it, each stroke a little heavier or lighter than the next); a photo
// is an <svg> of even strokes, so once it is in the page – where its styles
// say how wide and in what ink each line is – each stroke is traded for
// the brush's ribbons, filled in its ink, in its place.
//
// A photo's hand is heavier than the map's brush: each line swells and
// thins much more along it, tapers further at its ends, and one is drawn
// heavier or lighter than the next by more (PHOTO_BRUSH) – a pen dipped
// and pressed, not a fineliner. And the drawing fades out towards the
// edges (EDGES): its lines thin away before the frame, over an uneven
// margin, as a sketch left unfinished there, not a picture cut out of a
// bigger one.
//
// Left as they are: dashed lines, outlines in the paper's own colour (the
// ground's bands, the decks), and what is drawn turned or scaled (deer,
// cows, sheep and people, whose strokes keep the map's widths).

import { BRUSH, brushPathData } from '../render/brush.js';

export const PHOTO_BRUSH = { ...BRUSH, taper: 0.6, fade: 4, swell: 0.45, wave: 6, weight: 0.4 };
// how far in from each edge the lines thin away (shares of the picture's
// width at the sides, of its height at the top and bottom), each margin
// `uneven` wider or narrower here and there along its edge
export const EDGES = { side: 0.12, top: 0.06, bottom: 0.2, uneven: 0.45 };

// smooth noise in 0…1 along an edge
function wave(t, seed) {
  return 0.5 + 0.3 * Math.sin(t * 0.045 + seed) + 0.2 * Math.sin(t * 0.13 + seed * 2.7);
}

// The share of a line's width left at (x, y) in a w × h picture.
function edgeFade(w, h) {
  const { side, top, bottom, uneven } = EDGES;
  const ease = (d, m) => { const t = Math.min(1, Math.max(0, d / m)); return t * t * (3 - 2 * t); };
  const m = (base, t, seed) => base * (1 - uneven + 2 * uneven * wave(t, seed));
  return (x, y) => ease(x, m(w * side, y, 1.3)) * ease(w - x, m(w * side, y, 4.1))
    * ease(y, m(h * top, x, 2.2)) * ease(h - y, m(h * bottom, x, 5.9));
}

const NS = 'http://www.w3.org/2000/svg';

// path data for a drawn element, or '' for one that isn't a line
function dataOf(el) {
  switch (el.tagName) {
    case 'path': return el.getAttribute('d') ?? '';
    case 'line': return `M${el.getAttribute('x1')} ${el.getAttribute('y1')}L${el.getAttribute('x2')} ${el.getAttribute('y2')}`;
    case 'polyline':
    case 'polygon': {
      const n = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
      let d = '';
      for (let i = 0; i + 1 < n.length; i += 2) d += `${i ? 'L' : 'M'}${n[i]} ${n[i + 1]}`;
      return d && el.tagName === 'polygon' ? `${d}Z` : d;
    }
    default: return '';
  }
}

export function brushPhoto(svg) {
  if (!svg || svg.dataset.brushed) return;
  svg.dataset.brushed = '1';
  const box = svg.viewBox?.baseVal;
  const fade = box?.width ? edgeFade(box.width, box.height) : null;
  for (const el of [...svg.querySelectorAll('path, line, polyline, polygon')]) {
    if (el.closest('[transform]')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const ink = cs.stroke, width = parseFloat(cs.strokeWidth);
    if (!ink || ink === 'none' || !(width > 0) || ink === cs.fill) continue;
    if (cs.strokeDasharray && cs.strokeDasharray !== 'none') continue;
    const d = brushPathData(dataOf(el), width, { brush: PHOTO_BRUSH, fade });
    if (!d) continue;
    const ribbon = document.createElementNS(NS, 'path');
    ribbon.setAttribute('d', d);
    ribbon.setAttribute('style', `fill:${ink};fill-opacity:${cs.strokeOpacity};stroke:none;opacity:${cs.opacity}`);
    el.style.stroke = 'none';
    el.after(ribbon);
  }
}
