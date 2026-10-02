// Getting a lot of SVG onto the page cheaply and in the right order: line
// paths merged into fewer elements, elements put in order with as few moves
// as possible, and the painter's order for buildings.

// Fewer elements for the same drawing: a run of neighbouring <path>s of the
// same class that draw lines only – no fill (ln, glyph, gnd), or one in
// the stroke's own colour (ink) – becomes one <path> with all their
// subpaths. Nothing else is drawn between them, so it looks the same, and
// the page has far fewer elements to style, lay out and repaint (a city
// has tens of thousands of these). Filled faces are left alone: each
// one's fill must cover the lines drawn before it. Tree glyphs (all one
// colour, no fill) take turns by class – trunk, limb, leaf… – so between
// other elements they are gathered by class, whatever their order.
const RUN = /<path d="(M[^"]*)" class="([^"]*)"\/>/g;
const LINES = /(^| )(ln|glyph|gnd)( |$)/;
export function mergeRuns(svg) {
  let out = '', last = 0;
  const runs = new Map(); // class -> path data, in order of first use
  const flush = () => {
    for (const [cls, d] of runs) out += `<path d="${d}" class="${cls}"/>`;
    runs.clear();
  };
  for (const m of svg.matchAll(RUN)) {
    if (m.index !== last) {
      flush();
      out += svg.slice(last, m.index);
    }
    last = m.index + m[0].length;
    const cls = m[2];
    if (!LINES.test(cls) || cls.includes('filled')) {
      flush();
      out += m[0];
      continue;
    }
    // other line classes merge only with the one right before them
    const glyph = cls.startsWith('glyph');
    if (!runs.has(cls) && runs.size && !(glyph && [...runs.keys()].every((k) => k.startsWith('glyph')))) flush();
    else if (!glyph && runs.size > 1) flush();
    runs.set(cls, (runs.get(cls) ?? '') + m[1]);
  }
  flush();
  return out + svg.slice(last);
}

// Put `parent`'s children `els` in this order, moving as few as possible:
// the longest run of them already in order stays, the rest are moved in
// around it. (Moving an element makes the browser restyle and lay it out
// again, and there are thousands of buildings.)
export function placeInOrder(parent, els) {
  const at = new Map();
  let i = 0;
  for (let c = parent.firstChild; c; c = c.nextSibling) at.set(c, i++);
  // longest increasing subsequence of the current positions (patience sort)
  const tails = [], prev = new Array(els.length);
  els.forEach((el, k) => {
    const p = at.get(el);
    if (p === undefined) return;
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at.get(els[tails[mid]]) < p) lo = mid + 1; else hi = mid;
    }
    prev[k] = lo ? tails[lo - 1] : -1;
    tails[lo] = k;
  });
  const keep = new Set();
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) keep.add(els[k]);
  // back to front: each one goes right before the one after it
  let next = null;
  for (let k = els.length - 1; k >= 0; k--) {
    const el = els[k];
    if (!keep.has(el) && (el.parentNode !== parent || el.nextSibling !== next)) parent.insertBefore(el, next);
    next = el;
  }
}

// Painter's-algorithm order for objects with rectangular ground areas of any
// size. A is behind B when A lies entirely on the far side of B along either
// view axis. Only pairs that overlap on screen matter; the rest keep a rough
// back-to-front order. Resolved with a depth-first topological sort.
export function isoSort(items) {
  for (const it of items) {
    it.key = it.minX + it.maxX + it.minY + it.maxY;
    it.left = it.minX - it.maxY;   // horizontal screen extent (in view units)
    it.right = it.maxX - it.minY;
    it.behind = [];
  }
  items.sort((a, b) => a.key - b.key);

  // Only pairs overlapping horizontally on screen can conflict: sweep over
  // items sorted by their left edge.
  const byLeft = items.slice().sort((a, b) => a.left - b.left);
  for (let i = 0; i < byLeft.length; i++) {
    const a = byLeft[i];
    for (let j = i + 1; j < byLeft.length && byLeft[j].left < a.right; j++) {
      const b = byLeft[j];
      if (a.maxX <= b.minX || a.maxY <= b.minY) b.behind.push(a);
      else if (b.maxX <= a.minX || b.maxY <= a.minY) a.behind.push(b);
    }
  }

  const out = [];
  const state = new Map(); // 1 = visiting, 2 = done
  const visit = (it) => {
    if (state.has(it)) return;
    state.set(it, 1);
    for (const b of it.behind) visit(b);
    state.set(it, 2);
    out.push(it);
  };
  items.forEach(visit);
  return out;
}
