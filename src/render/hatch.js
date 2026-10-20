// The hatching on the paper: one set of pen lines laid straight across the
// screen, at one angle and spacing, that every shadow and the night are
// drawn with – a shadow is these strokes where the shadow lies, the night
// these strokes everywhere – so as the night comes in it fills in between
// the shadows' lines, and once it is full the shadows are lost in it.
//
// The lines are drawn as a hand hatches a roof: each a row of strokes, a
// few grid units long, slightly bowed and a little off the line at their
// ends, the next one starting where this one ends, or just short of it,
// or overlapping it. Where the strokes lie depends only on the line and
// the place along it, and repeats every TILE grid units, so the night can
// be one tile of them (an SVG pattern: however dense, it costs the same)
// and a shadow anywhere picks out exactly the strokes the tile has there.
//
// In scene pixels (before pan and zoom), with `px` of them to a grid unit;
// u along the lines, v across (`h.angle` on screen, clockwise from right).
// Line k lies at k·gap along v; its density tier is tierOf(k), as the
// roof hatching's, so the map can leave the denser ones out.
//
// The settings are SUN.hatch's (shadows.js): angle, gap, and for the
// strokes:
//   stroke   a stroke's length, from … to (grid units)
//   join     between one stroke's end and the next one's start, from … to:
//            below 0 they overlap, above it a little paper shows
//   bow      how far a stroke bows to one side at its middle (grid units)
//   drift    how far a stroke's ends lie off the line (grid units)
//
//   hatchFrame(h)                        -> { u, v, gap } (gap in grid units)
//   hatchStrokes(k, t0, t1, h, px)       -> path data, line k from t0 to t1 px
//   hatchTile(id, tier, h, px, cls)      -> an SVG <pattern>, lines up to tier
//   hatchTileLines(tier, h, px)          -> { d, size }: the same tile's strokes
//   hatchPoints(k, t, h, px)             -> line k's points at t, one a stroke

// The repeat, in grid units: long enough that the tiles don't show as
// tiles, short enough to keep the pattern small.
export const TILE = 8;

const r2 = (n) => Math.round(n * 100) / 100;

// The density tier of hatch line k: every 8th (0), every 4th (1), every
// other (2), the rest (3).
export const tierOf = (k) => (k % 8 === 0 ? 0 : k % 4 === 0 ? 1 : k % 2 === 0 ? 2 : 3);

// Deterministic noise in [0, 1) from two numbers.
export function hash(a, b) {
  let h = Math.imul(Math.round(a * 1000) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(b * 1000) | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// The lines' directions on screen and their spacing: as h.gap, made to fit
// the tile a whole number of times, and a multiple of 8 (the tiers).
export function hatchFrame(h) {
  const a = (h.angle * Math.PI) / 180;
  const n = Math.max(8, Math.round(TILE / h.gap / 8) * 8);
  return { u: [Math.cos(a), Math.sin(a)], v: [-Math.sin(a), Math.cos(a)], gap: TILE / n, n };
}

// The strokes of a line, in one repeat: [a, b, e0, e1, bow] – from a to b
// along it (grid units, a in 0 … TILE, b may run past the repeat), the
// ends e0 and e1 off the line and the bow at the middle. Line j stands for
// every line k with k ≡ j (mod n). Kept per line and settings.
const laid = new Map();
function strokesOf(j, h) {
  const key = `${j}|${h.stroke}|${h.join}|${h.bow}|${h.drift}`;
  let out = laid.get(key);
  if (out) return out;
  const lerp = ([lo, hi], t) => lo + (hi - lo) * t;
  const lens = [];
  let sum = 0;
  for (let i = 0; sum < TILE; i++) {
    const l = lerp(h.stroke, hash(j, i + 0.7));
    lens.push(l);
    sum += l;
  }
  const scale = TILE / sum; // (so the strokes go round the repeat exactly)
  let p = hash(j, 0.31) * TILE;
  out = lens.map((l, i) => {
    const a = p, b = p + l * scale - lerp(h.join, hash(j, i + 3.3));
    p += l * scale;
    const off = (s) => (hash(j, i + s) * 2 - 1);
    return [a, b, off(6.2) * h.drift, off(7.4) * h.drift, off(5.1) * h.bow];
  });
  if (laid.size > 4000) laid.clear();
  laid.set(key, out);
  return out;
}

// Path data for the part of line k from t0 to t1 (scene px along u): the
// pieces of its strokes there, each a quadratic (a piece of a bowed stroke
// is one too).
export function hatchStrokes(k, t0, t1, h, px, frame = hatchFrame(h)) {
  const { u, v, gap, n } = frame;
  const x0 = t0 / px, x1 = t1 / px;
  if (x1 <= x0) return '';
  const j = ((k % n) + n) % n, strokes = strokesOf(j, h);
  const at = (x, off) => {
    const c = (k * gap + off) * px, t = x * px;
    return `${r2(u[0] * t + v[0] * c)} ${r2(u[1] * t + v[1] * c)}`;
  };
  let d = '';
  const m0 = Math.floor(x0 / TILE) - 1, m1 = Math.floor(x1 / TILE);
  for (let m = m0; m <= m1; m++) {
    for (const [a0, b0, e0, e1, bow] of strokes) {
      const a = a0 + m * TILE, b = b0 + m * TILE;
      const p = Math.max(a, x0), q = Math.min(b, x1);
      if (q - p < 1e-3) continue;
      // off the line at s (0 … 1 along the stroke): ends drifting, bowed
      const s0 = (p - a) / (b - a), s1 = (q - a) / (b - a);
      const off = (s) => e0 + (e1 - e0) * s + 4 * bow * s * (1 - s);
      const slope = (s) => e1 - e0 + 4 * bow * (1 - 2 * s);
      const cOff = off(s0) + (slope(s0) * (s1 - s0)) / 2;
      d += `M${at(p, off(s0))}Q${at((p + q) / 2, cOff)} ${at(q, off(s1))}`;
    }
  }
  return d;
}

// The points of line k at t (scene px along u), one on each stroke there
// (two where strokes overlap, none where the paper shows between them).
// (For the tests: the strokes a shadow draws lie on the night's.)
export function hatchPoints(k, t, h, px, frame = hatchFrame(h)) {
  const { u, v, gap, n } = frame;
  const x = t / px, j = ((k % n) + n) % n, out = [];
  const m0 = Math.floor(x / TILE) - 1;
  for (let m = m0; m <= m0 + 2; m++) {
    for (const [a0, b0, e0, e1, bow] of strokesOf(j, h)) {
      const a = a0 + m * TILE, b = b0 + m * TILE;
      if (x < a - 2e-3 || x > b + 2e-3) continue; // (an end a hair off, rounded)
      const s = Math.min(1, Math.max(0, (x - a) / (b - a))), c = (k * gap + e0 + (e1 - e0) * s + 4 * bow * s * (1 - s)) * px;
      out.push([u[0] * t + v[0] * c, u[1] * t + v[1] * c]);
    }
  }
  return out;
}

// The night's tile: every line up to density tier `tier` (0 every 8th … 3
// all), as strokes, over one repeat each way, turned to the lines' angle.
export function hatchTile(id, tier, h, px, cls = 'night-line') {
  const { d, size } = hatchTileLines(tier, h, px);
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${r2(size)}" height="${r2(size)}" patternTransform="rotate(${h.angle})"><path class="${cls}" d="${d}"/></pattern>`;
}

// The tile's strokes as path data, in its own axes (before it is turned to
// the lines' angle), and its size: scene px (the night's canvas draws it
// as a pattern of its own, NightCanvas).
export function hatchTileLines(tier, h, px) {
  const frame = hatchFrame(h), { n } = frame;
  let d = '';
  // the tile in the lines' own axes: line j at j·gap, along it 0 … TILE;
  // the strokes running past the far end are drawn again from the near
  // one, and the first and last lines once more over the edges
  const flat = { ...frame, u: [1, 0], v: [0, 1] };
  for (let k = -1; k <= n; k++) {
    if (tierOf(((k % n) + n) % n) > tier) continue;
    d += hatchStrokes(k, -TILE * px * 0.5, TILE * px * 1.5, h, px, flat);
  }
  return { d, size: TILE * px };
}
