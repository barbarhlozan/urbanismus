// Getting a lot of SVG onto the page cheaply and in the right order: line
// paths merged into fewer elements, and the painter's order for buildings.

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

// Painter's-algorithm order for objects with rectangular ground areas of any
// size, in the axes of the view's nearest quarter turn (Camera.quarter). A
// is behind B when A lies entirely on the far side of B along either axis.
// Only pairs that overlap on screen matter; the rest keep a rough
// back-to-front order. Resolved with a depth-first topological sort.
// `view` (Camera.quarterView): how the axes show, in depth and across the
// screen, for a view turned past its quarter.
export function isoSort(items, [[da, db], [sa, sb]] = [[1, 1], [1, -1]]) {
  for (const it of items) {
    it.key = da * (it.minX + it.maxX) + db * (it.minY + it.maxY);
    it.left = sa * it.minX + sb * it.maxY;   // horizontal screen extent (in view units)
    it.right = sa * it.maxX + sb * it.minY;
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
