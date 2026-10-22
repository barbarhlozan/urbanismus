// Path data and fills made ready for the GPU. The painters draw with SVG
// paths (the `d` of a <path>); WebGL draws only triangles and line segments,
// so a path is first flattened into polylines, and the polylines of a fill
// are then cut into triangles.
//
// flattenPath reads the whole SVG path grammar and replaces every curve and
// arc by as many straight pieces as it needs to stay within `tolerance` (in
// the path's own units) of the real one: the Béziers by a bound on their
// second differences, the arcs by their radius and sweep. Small curves
// become one or two pieces, big ones more, never past a cap.
//
// triangulate cuts closed polylines into triangles by ear clipping, after
// mapbox's earcut: holes are joined to their outline by a bridge, rings that
// won't clip cleanly (collinear runs, repeated points, little loops) are
// cured or skipped, and big rings are helped by a z-order hash. Which rings
// are outlines and which are holes is decided here, from how the rings lie
// in one another and the fill rule, as SVG fills would; a ring that goes
// through a point twice (an outline touching itself, a slit to a hole) is
// first cut into the loops between the visits.
// All triangles wind the same way (counterclockwise with y up, so clockwise
// on the screen, where y is down).
//
//   const subs = flattenPath(d, 0.25)          -> [{ pts: [[x, y]…], closed }…]
//   const mesh = triangulate(subs, 'evenodd')  -> { positions: x y pairs, indices: triangles }
//   polygonArea(pts)                           -> the polyline's signed area

const MAX_STEPS = 500; // the most pieces one curve or arc is cut into

// How many numbers each path command takes.
const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
const ARGV = new Float64Array(7); // the numbers of the segment being read

// ---------------------------------------------------------------- the reader

const isSpace = (c) => c === 32 || (c >= 9 && c <= 13);

const skipSpace = (s, i) => {
  while (i < s.length && isSpace(s.charCodeAt(i))) i++;
  return i;
};

// Past the space and the one comma that may lie between two numbers.
function skipSeparator(s, i) {
  i = skipSpace(s, i);
  if (s.charCodeAt(i) === 44) i = skipSpace(s, i + 1);
  return i;
}

// The next number: sign, digits with a point somewhere, an exponent – and
// no separator needed before it, so `-.5.5` is two. NaN when there is none.
// (Read as it is scanned – the digits as a whole number, divided by the
// power of ten after the point: both exact, so the one division rounds as
// Number() would – with no string cut out; Number() for the rare rest.)
const POW10 = Array.from({ length: 23 }, (_, k) => 10 ** k);
function number(sc) {
  const s = sc.s;
  let i = skipSeparator(s, sc.i);
  const start = i;
  let c = s.charCodeAt(i), neg = false;
  if (c === 43 || c === 45) {
    neg = c === 45;
    c = s.charCodeAt(++i);
  }
  let digits = 0, whole = 0, after = 0;
  while (c >= 48 && c <= 57) { whole = whole * 10 + (c - 48); c = s.charCodeAt(++i); digits++; }
  if (c === 46) {
    c = s.charCodeAt(++i);
    while (c >= 48 && c <= 57) { whole = whole * 10 + (c - 48); c = s.charCodeAt(++i); digits++; after++; }
  }
  if (!digits) return NaN;
  let exp = false;
  if (c === 101 || c === 69) {
    let j = i + 1;
    c = s.charCodeAt(j);
    if (c === 43 || c === 45) c = s.charCodeAt(++j);
    if (c >= 48 && c <= 57) {
      while (c >= 48 && c <= 57) c = s.charCodeAt(++j);
      i = j;
      exp = true;
    }
  }
  sc.i = i;
  if (!exp && digits <= 15 && after < POW10.length) {
    const v = after ? whole / POW10[after] : whole;
    return neg ? -v : v;
  }
  const v = Number(s.slice(start, i));
  return Number.isFinite(v) ? v : NaN;
}

// An arc flag: one character, 0 or 1, which may be followed by the next
// number with nothing between (`a5 5 0 011 1`).
function flag(sc) {
  const i = skipSeparator(sc.s, sc.i);
  const c = sc.s.charCodeAt(i);
  if (c !== 48 && c !== 49) return NaN;
  sc.i = i + 1;
  return c - 48;
}

// The numbers of one segment of command `c` into ARGV; false if they are
// missing or not numbers.
function readArgs(sc, c) {
  const n = ARGS[c];
  for (let k = 0; k < n; k++) {
    const v = c === 'a' && (k === 3 || k === 4) ? flag(sc) : number(sc);
    if (v !== v) return false;
    ARGV[k] = v;
  }
  return true;
}

// ------------------------------------------------------------------ curves

// Pieces for a curve that needs `v` of them to stay within tolerance.
const steps = (v) => (v >= MAX_STEPS ? MAX_STEPS : v > 1 ? Math.ceil(v) : 1);

// A cubic's second derivative is at most 6 times the larger of its two
// second differences, and a chord over a parameter step h strays from the
// curve by at most h²/8 times that: so 1/h = √(¾ · difference / tolerance)
// pieces are enough. Appends the points after the start, up to the end.
function cubic(pts, x0, y0, x1, y1, x2, y2, x3, y3, tol) {
  const ax = x0 - 2 * x1 + x2, ay = y0 - 2 * y1 + y2;
  const bx = x1 - 2 * x2 + x3, by = y1 - 2 * y2 + y3;
  const dd = Math.max(ax * ax + ay * ay, bx * bx + by * by);
  const n = steps(Math.sqrt((0.75 * Math.sqrt(dd)) / tol));
  for (let i = 1; i < n; i++) {
    const t = i / n, u = 1 - t;
    const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
    pts.push([w0 * x0 + w1 * x1 + w2 * x2 + w3 * x3, w0 * y0 + w1 * y1 + w2 * y2 + w3 * y3]);
  }
  pts.push([x3, y3]);
}

// The same for a quadratic, whose second derivative is twice its one second
// difference.
function quad(pts, x0, y0, x1, y1, x2, y2, tol) {
  const ax = x0 - 2 * x1 + x2, ay = y0 - 2 * y1 + y2;
  const n = steps(0.5 * Math.sqrt(Math.sqrt(ax * ax + ay * ay) / tol));
  for (let i = 1; i < n; i++) {
    const t = i / n, u = 1 - t;
    const w0 = u * u, w1 = 2 * u * t, w2 = t * t;
    pts.push([w0 * x0 + w1 * x1 + w2 * x2, w0 * y0 + w1 * y1 + w2 * y2]);
  }
  pts.push([x2, y2]);
}

// An elliptical arc from the current point to (x2, y2), by the SVG spec's
// endpoint-to-centre conversion (F.6.5): radii too small for the endpoints
// are scaled up until they fit, a zero radius is a straight line, equal
// endpoints leave out the arc. The ellipse's parameter angle is stepped so
// that no chord strays more than the tolerance (a chord over a step d of a
// curve with |second derivative| ≤ R strays at most R·d²/8), and no step is
// longer than a quarter turn, so even a tiny circle keeps its four corners.
function arc(pts, x1, y1, rx, ry, rot, large, sweep, x2, y2, tol) {
  if (x1 === x2 && y1 === y2) return;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) { pts.push([x2, y2]); return; }
  const phi = ((rot % 360) * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const px = cos * dx + sin * dy, py = -sin * dx + cos * dy;
  const lambda = (px * px) / (rx * rx) + (py * py) / (ry * ry);
  if (lambda > 1) {
    const k = Math.sqrt(lambda);
    rx *= k;
    ry *= k;
  }
  const rx2 = rx * rx, ry2 = ry * ry;
  const den = rx2 * py * py + ry2 * px * px;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx2 * ry2 - den) / den));
  const qx = (k * rx * py) / ry, qy = (-k * ry * px) / rx; // the centre, in the ellipse's own frame
  const cx = cos * qx - sin * qy + (x1 + x2) / 2, cy = sin * qx + cos * qy + (y1 + y2) / 2;
  const t0 = Math.atan2((py - qy) / ry, (px - qx) / rx);
  let sw = Math.atan2((-py - qy) / ry, (-px - qx) / rx) - t0;
  if (sweep && sw < 0) sw += 2 * Math.PI;
  else if (!sweep && sw > 0) sw -= 2 * Math.PI;
  if (!Number.isFinite(cx + cy + sw)) { pts.push([x2, y2]); return; }
  const step = Math.min(Math.sqrt((8 * tol) / Math.max(rx, ry)), Math.PI / 2);
  const n = steps(Math.abs(sw) / step);
  for (let i = 1; i < n; i++) {
    const t = t0 + (sw * i) / n, ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    pts.push([cx + cos * ex - sin * ey, cy + sin * ex + cos * ey]);
  }
  pts.push([x2, y2]);
}

// ---------------------------------------------------------------- the paths

// A closed subpath that ends where it began doesn't say so twice.
function dropClosingPoint(pts) {
  const p = pts[0];
  while (pts.length > 1) {
    const q = pts[pts.length - 1];
    if (Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) break;
    pts.pop();
  }
}

// The subpaths of path data `d` as polylines. A path that goes wrong (a
// number missing, a letter that isn't a command) is kept up to the last
// whole segment, as browsers draw it. A lone moveto draws nothing and is
// dropped; `M x y Z` is kept as a closed point, which a round pen dots.
export function flattenPath(d, tolerance = 0.25) {
  const tol = tolerance > 0 && Number.isFinite(tolerance) ? tolerance : 0.25;
  const sc = { s: typeof d === 'string' ? d : String(d ?? ''), i: 0 };
  const out = [];
  let pts = null;             // the subpath being drawn
  let x = 0, y = 0;           // the current point
  let sx = 0, sy = 0;         // where the subpath began (what Z returns to)
  let kx = 0, ky = 0;         // the last control point of a curve …
  let kind = '';              // … 'c' cubic, 'q' quadratic: what S and T reflect
  let cmd = '';               // the command in force; numbers after it repeat it
  let started = false;

  const flush = (closed) => {
    if (pts && closed) {
      dropClosingPoint(pts);
      out.push({ pts, closed: true });
    } else if (pts && pts.length > 1) {
      out.push({ pts, closed: false });
    }
    pts = null;
  };

  for (;;) {
    const i = skipSpace(sc.s, sc.i);
    if (i >= sc.s.length) break;
    const ch = sc.s[i];
    if (ARGS[ch.toLowerCase()] !== undefined) {
      cmd = ch;
      sc.i = i + 1;
    } else if (cmd === '' || cmd === 'z' || cmd === 'Z') {
      break; // numbers with no command to go on with
    } else {
      sc.i = i;
    }
    const c = cmd.toLowerCase(), rel = cmd === c;
    if (!started && c !== 'm') break;
    if (c === 'z') {
      flush(true);
      x = sx;
      y = sy;
      kind = '';
      continue;
    }
    if (!readArgs(sc, c)) break;
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (c !== 'm' && !pts) pts = [[x, y]]; // drawing on after a Z starts a subpath where it closed
    switch (c) {
      case 'm':
        flush(false);
        x = sx = ARGV[0] + ox;
        y = sy = ARGV[1] + oy;
        pts = [[x, y]];
        started = true;
        cmd = rel ? 'l' : 'L'; // more pairs after a moveto are linetos
        kind = '';
        break;
      case 'l':
        x = ARGV[0] + ox;
        y = ARGV[1] + oy;
        pts.push([x, y]);
        kind = '';
        break;
      case 'h':
        x = ARGV[0] + ox;
        pts.push([x, y]);
        kind = '';
        break;
      case 'v':
        y = ARGV[0] + oy;
        pts.push([x, y]);
        kind = '';
        break;
      case 'c': {
        const x1 = ARGV[0] + ox, y1 = ARGV[1] + oy, x2 = ARGV[2] + ox, y2 = ARGV[3] + oy;
        const x3 = ARGV[4] + ox, y3 = ARGV[5] + oy;
        cubic(pts, x, y, x1, y1, x2, y2, x3, y3, tol);
        kx = x2; ky = y2; kind = 'c';
        x = x3; y = y3;
        break;
      }
      case 's': {
        const x1 = kind === 'c' ? 2 * x - kx : x, y1 = kind === 'c' ? 2 * y - ky : y;
        const x2 = ARGV[0] + ox, y2 = ARGV[1] + oy, x3 = ARGV[2] + ox, y3 = ARGV[3] + oy;
        cubic(pts, x, y, x1, y1, x2, y2, x3, y3, tol);
        kx = x2; ky = y2; kind = 'c';
        x = x3; y = y3;
        break;
      }
      case 'q': {
        const x1 = ARGV[0] + ox, y1 = ARGV[1] + oy, x2 = ARGV[2] + ox, y2 = ARGV[3] + oy;
        quad(pts, x, y, x1, y1, x2, y2, tol);
        kx = x1; ky = y1; kind = 'q';
        x = x2; y = y2;
        break;
      }
      case 't': {
        const x1 = kind === 'q' ? 2 * x - kx : x, y1 = kind === 'q' ? 2 * y - ky : y;
        const x2 = ARGV[0] + ox, y2 = ARGV[1] + oy;
        quad(pts, x, y, x1, y1, x2, y2, tol);
        kx = x1; ky = y1; kind = 'q';
        x = x2; y = y2;
        break;
      }
      case 'a': {
        const x2 = ARGV[5] + ox, y2 = ARGV[6] + oy;
        arc(pts, x, y, ARGV[0], ARGV[1], ARGV[2], ARGV[3], ARGV[4], x2, y2, tol);
        x = x2; y = y2;
        kind = '';
        break;
      }
    }
  }
  flush(false);
  return out;
}

// The signed area of a polyline (closed by the line from its last point
// back to its first): positive when the points go counterclockwise with y
// up, which is clockwise on the screen. Measured from the first point, so
// shapes far from the origin lose no digits.
export function polygonArea(pts) {
  const n = pts.length;
  if (n < 3) return 0;
  const x0 = pts[0][0], y0 = pts[0][1];
  let sum = 0;
  for (let i = 1; i < n - 1; i++) {
    sum += (pts[i][0] - x0) * (pts[i + 1][1] - y0) - (pts[i + 1][0] - x0) * (pts[i][1] - y0);
  }
  return sum / 2;
}

// ------------------------------------------------------------- the rings
//
// Scratch memory, kept between calls so that cutting thousands of small
// shapes allocates next to nothing: each call runs to its end before it
// returns, so they never share it at once.

let ringBuf = new Float64Array(4096); // the cleaned rings' points, x y x y …
let tri = new Uint32Array(4096);      // the triangles' corners (vertex numbers)
let triN = 0;

function emit(a, b, c) {
  if (triN + 3 > tri.length) {
    const t = new Uint32Array(tri.length * 2);
    t.set(tri);
    tri = t;
  }
  tri[triN++] = a;
  tri[triN++] = b;
  tri[triN++] = c;
}

// A ring's descriptor – { s: first point, n: how many, area: signed, and the
// bounds } – or null if it has under three points or no area.
function measure(start, n) {
  if (n < 3) return null;
  const ox = ringBuf[2 * start], oy = ringBuf[2 * start + 1], end = start + n;
  let sum = 0, x0 = ox, y0 = oy, x1 = ox, y1 = oy;
  for (let i = start + 1; i < end; i++) {
    const x = ringBuf[2 * i], y = ringBuf[2 * i + 1];
    if (x < x0) x0 = x; else if (x > x1) x1 = x;
    if (y < y0) y0 = y; else if (y > y1) y1 = y;
    if (i < end - 1) sum += (x - ox) * (ringBuf[2 * i + 3] - oy) - (ringBuf[2 * i + 2] - ox) * (y - oy);
  }
  return sum === 0 ? null : { s: start, n, area: sum / 2, x0, y0, x1, y1 };
}

function reserveRings(points) {
  if (points * 2 <= ringBuf.length) return;
  const b = new Float64Array(Math.max(points * 2, ringBuf.length * 2));
  b.set(ringBuf);
  ringBuf = b;
}

let probe = new Int32Array(1024); // a hash table of points, for finding repeats

// Whether a ring goes through the same point twice (not counting the
// closing one): an open-addressing hash of the points, in the scratch table.
function hasRepeats(start, n) {
  if (n < 4) return false;
  let size = 8;
  while (size < 2 * n) size *= 2;
  if (size > probe.length) probe = new Int32Array(size);
  probe.fill(0, 0, size);
  const mask = size - 1;
  for (let i = 0; i < n; i++) {
    const x = ringBuf[2 * (start + i)], y = ringBuf[2 * (start + i) + 1];
    let h = Math.imul((x * 64) | 0, 0x9e3779b1) ^ Math.imul((y * 64) | 0, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = (h ^ (h >>> 13)) & mask;
    for (;;) {
      const j = probe[h];
      if (j === 0) { probe[h] = i + 1; break; }
      const k = start + j - 1;
      if (ringBuf[2 * k] === x && ringBuf[2 * k + 1] === y) return true;
      h = (h + 1) & mask;
    }
  }
  return false;
}

// A ring that goes through a point twice – an outline touching itself, a
// hole joined to the outline by a slit – cut into the loops between the
// visits. What the loops enclose, by either fill rule, is what the ring
// did (windings add up round the loops, and so does the parity of
// crossings), and each loop is a ring a clipper can take. Written back from
// `start` (a repeated point is in the ring twice and in the loops twice, so
// there is always room); returns where the rings now end.
function splitRing(start, n, rings) {
  const stack = [], loops = [], at = new Map();
  for (let i = 0; i < n; i++) {
    const p = [ringBuf[2 * (start + i)], ringBuf[2 * (start + i) + 1]], key = p[0] + ',' + p[1];
    const seen = at.get(key);
    if (seen === undefined) {
      at.set(key, stack.length);
      stack.push(p);
      continue;
    }
    const loop = stack.splice(seen); // from the earlier visit on: a loop closed by this one
    for (let k = 1; k < loop.length; k++) at.delete(loop[k][0] + ',' + loop[k][1]);
    stack.push(loop[0]);
    loops.push(loop);
  }
  loops.push(stack);
  let vn = start;
  for (const loop of loops) {
    if (loop.length < 3) continue;
    for (let k = 0; k < loop.length; k++) {
      ringBuf[2 * (vn + k)] = loop[k][0];
      ringBuf[2 * (vn + k) + 1] = loop[k][1];
    }
    const r = measure(vn, loop.length);
    if (r) {
      rings.push(r);
      vn += loop.length;
    }
  }
  return vn;
}

// The rings to fill: each subpath's points with those that aren't numbers
// and the repeats of the one before dropped (and the end if it is the
// start), cut where they cross their own points, as descriptors (measure).
// Rings with under three points or no area are left out.
function collectRings(subpaths) {
  let cap = 0;
  for (const sp of subpaths) cap += sp && sp.pts ? sp.pts.length : 0;
  reserveRings(cap);
  const rings = [];
  let vn = 0;
  for (const sp of subpaths) {
    if (!sp || !sp.pts || sp.pts.length < 3) continue;
    const start = vn;
    for (const p of sp.pts) {
      const x = p[0], y = p[1];
      if (!(Number.isFinite(x) && Number.isFinite(y))) continue;
      if (vn > start && x === ringBuf[2 * vn - 2] && y === ringBuf[2 * vn - 1]) continue;
      ringBuf[2 * vn] = x;
      ringBuf[2 * vn + 1] = y;
      vn++;
    }
    while (vn - start > 1 && ringBuf[2 * vn - 2] === ringBuf[2 * start] && ringBuf[2 * vn - 1] === ringBuf[2 * start + 1]) vn--;
    const n = vn - start;
    if (n < 3) { vn = start; continue; }
    if (hasRepeats(start, n)) {
      vn = splitRing(start, n, rings);
      continue;
    }
    const r = measure(start, n);
    if (r) rings.push(r);
    else vn = start;
  }
  return { rings, count: vn };
}

// Where (x, y) lies against a ring: 1 inside, 0 outside, -1 on its edge.
function side(x, y, ring) {
  const s = ring.s, n = ring.n;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ringBuf[2 * (s + i)], yi = ringBuf[2 * (s + i) + 1];
    const xj = ringBuf[2 * (s + j)], yj = ringBuf[2 * (s + j) + 1];
    if ((xj - xi) * (y - yi) - (yj - yi) * (x - xi) === 0
      && x >= Math.min(xi, xj) && x <= Math.max(xi, xj) && y >= Math.min(yi, yj) && y <= Math.max(yi, yj)) return -1;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside ? 1 : 0;
}

// Whether ring r lies inside ring q: by the first of r's points that isn't
// on q's edge (rings that touch share some), or if all of them are, by the
// middle of one of r's edges that isn't.
function ringInside(r, q) {
  for (let k = 0; k < r.n; k++) {
    const s = side(ringBuf[2 * (r.s + k)], ringBuf[2 * (r.s + k) + 1], q);
    if (s !== -1) return s === 1;
  }
  for (let k = 0; k < r.n; k++) {
    const a = r.s + k, b = r.s + (k + 1) % r.n;
    const s = side((ringBuf[2 * a] + ringBuf[2 * b]) / 2, (ringBuf[2 * a + 1] + ringBuf[2 * b + 1]) / 2, q);
    if (s !== -1) return s === 1;
  }
  return false;
}

// The rings that ring i lies in, or null. A ring that contains another has
// the bigger area and the bigger bounds, which settles most pairs cheaply.
function containers(rings, i) {
  const r = rings[i], a = Math.abs(r.area);
  let found = null;
  for (let j = 0; j < rings.length; j++) {
    const q = rings[j];
    if (j === i || Math.abs(q.area) <= a) continue;
    if (r.x0 < q.x0 || r.y0 < q.y0 || r.x1 > q.x1 || r.y1 > q.y1) continue;
    if (ringInside(r, q)) (found || (found = [])).push(j);
  }
  return found;
}

// Cuts the rings into polygons – an outline and the holes in it – and
// triangulates each. A ring is an outline when the area just inside it is
// filled and the area just outside is not, a hole when it is the other way
// round, and neither when both are filled or both empty (a ring wound the
// same way inside another, for the nonzero rule). Evenodd fills what lies in
// an odd number of rings; nonzero what the rings' windings add up to
// something in, a ring's winding being the sign of its area, so a hole is
// a ring wound against the ones around it. Each hole belongs to the
// smallest outline round it.
function fillRings(rings, evenOdd) {
  const m = rings.length;
  const within = new Array(m);
  const kind = new Int8Array(m); // 1 outline, -1 hole, 0 neither
  for (let i = 0; i < m; i++) {
    const c = (within[i] = containers(rings, i));
    if (evenOdd) {
      kind[i] = (c ? c.length : 0) % 2 === 0 ? 1 : -1;
      continue;
    }
    let outer = 0;
    if (c) for (const j of c) outer += rings[j].area > 0 ? 1 : -1;
    const inner = outer + (rings[i].area > 0 ? 1 : -1);
    kind[i] = outer === 0 ? 1 : inner === 0 ? -1 : 0;
  }
  const holes = new Array(m).fill(null);
  for (let i = 0; i < m; i++) {
    if (kind[i] !== -1 || !within[i]) continue;
    let parent = -1;
    for (const j of within[i]) {
      if (kind[j] !== 0 && (parent === -1 || Math.abs(rings[j].area) < Math.abs(rings[parent].area))) parent = j;
    }
    if (parent !== -1 && kind[parent] === 1) (holes[parent] || (holes[parent] = [])).push(rings[i]);
  }
  for (let i = 0; i < m; i++) if (kind[i] === 1) earcutPolygon(rings[i], holes[i]);
}

// The triangles of the area inside the closed subpaths `subpaths` (as
// flattenPath gives them; one that isn't closed is filled as if it were),
// by `fillRule` 'nonzero' or 'evenodd'. `positions` holds the points of the
// rings, x then y, and `indices` three of their numbers to a triangle. A
// ring that makes no area, or is not a number, is left out; points that
// clipping finds collinear are simply not used.
export function triangulate(subpaths, fillRule = 'nonzero') {
  const { rings, count } = collectRings(Array.isArray(subpaths) ? subpaths : []);
  triN = 0;
  if (rings.length === 1) earcutPolygon(rings[0], null);
  else if (rings.length > 1) fillRings(rings, fillRule === 'evenodd');
  const positions = new Float32Array(2 * count);
  positions.set(ringBuf.subarray(0, 2 * count));
  return { positions, indices: tri.slice(0, triN) };
}

// ----------------------------------------------------------- ear clipping
//
// The polygon being cut is a doubly linked ring of nodes, kept in arrays
// (nodes are numbers, -1 is none) rather than objects:
//   nv vertex number     nx, ny position      np, nn previous and next
//   nz z-order of the point   npz, nnz previous and next in z-order
//   nst set for a hole that is a single point, which filtering must keep
// A bridge to a hole, or a cut across the polygon, copies two nodes (the
// same vertex number twice), so a polygon takes up to 3n + 2·holes of them.

let size = 0;
let used = 0;
let nx, ny, nv, np, nn, nz, npz, nnz, nst;

const widen = (a, Type, n) => {
  const b = new Type(n);
  if (a) b.set(a);
  return b;
};

function reserve(n) {
  let c = size || 256;
  while (c < n) c *= 2;
  nx = widen(nx, Float64Array, c);
  ny = widen(ny, Float64Array, c);
  nv = widen(nv, Int32Array, c);
  np = widen(np, Int32Array, c);
  nn = widen(nn, Int32Array, c);
  nz = widen(nz, Int32Array, c);
  npz = widen(npz, Int32Array, c);
  nnz = widen(nnz, Int32Array, c);
  nst = widen(nst, Uint8Array, c);
  size = c;
}

function newNode(v, x, y) {
  if (used === size) reserve(used + 1);
  const p = used++;
  nv[p] = v; nx[p] = x; ny[p] = y;
  np[p] = -1; nn[p] = -1; nz[p] = 0; npz[p] = -1; nnz[p] = -1; nst[p] = 0;
  return p;
}

function insertNode(v, x, y, last) {
  const p = newNode(v, x, y);
  if (last === -1) {
    np[p] = p;
    nn[p] = p;
  } else {
    nn[p] = nn[last];
    np[p] = last;
    np[nn[last]] = p;
    nn[last] = p;
  }
  return p;
}

function removeNode(p) {
  nn[np[p]] = nn[p];
  np[nn[p]] = np[p];
  if (npz[p] !== -1) nnz[npz[p]] = nnz[p];
  if (nnz[p] !== -1) npz[nnz[p]] = npz[p];
}

// Twice the signed area of the triangle p q r, negated: negative when the
// turn at q is the way an ear turns, positive for a reflex corner, 0 when
// they are collinear.
const area = (p, q, r) => (ny[q] - ny[p]) * (nx[r] - nx[q]) - (nx[q] - nx[p]) * (ny[r] - ny[q]);
const equals = (p, q) => nx[p] === nx[q] && ny[p] === ny[q];
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

// A ring's nodes, in the direction earcut wants: the outline running with
// positive area (`clockwise` true), holes against it.
function linkRing(ring, clockwise) {
  const s = ring.s;
  let last = -1;
  if (clockwise === ring.area > 0) {
    for (let i = 0; i < ring.n; i++) last = insertNode(s + i, ringBuf[2 * (s + i)], ringBuf[2 * (s + i) + 1], last);
  } else {
    for (let i = ring.n - 1; i >= 0; i--) last = insertNode(s + i, ringBuf[2 * (s + i)], ringBuf[2 * (s + i) + 1], last);
  }
  if (last !== -1 && equals(last, nn[last])) {
    removeNode(last);
    last = nn[last];
  }
  return last;
}

// Takes out repeated points and points on a straight line with their
// neighbours; returns a node that is still in the ring.
function filterPoints(start, end = -1) {
  if (start === -1) return start;
  if (end === -1) end = start;
  let p = start, again;
  do {
    again = false;
    if (!nst[p] && (equals(p, nn[p]) || area(np[p], p, nn[p]) === 0)) {
      removeNode(p);
      p = end = np[p];
      if (p === nn[p]) break;
      again = true;
    } else {
      p = nn[p];
    }
  } while (again || p !== end);
  return end;
}

function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
  return (cx - px) * (ay - py) >= (ax - px) * (cy - py)
    && (ax - px) * (by - py) >= (bx - px) * (ay - py)
    && (bx - px) * (cy - py) >= (cx - px) * (by - py);
}

// Whether node p keeps the ear a b c from being cut: it lies in the
// triangle (its corner a excepted) and is not itself convex.
function blocks(p, a, c, ax, ay, bx, by, cx, cy, x0, y0, x1, y1) {
  const px = nx[p], py = ny[p];
  return p !== a && p !== c && px >= x0 && px <= x1 && py >= y0 && py <= y1
    && !(ax === px && ay === py) && pointInTriangle(ax, ay, bx, by, cx, cy, px, py)
    && area(np[p], p, nn[p]) >= 0;
}

function isEar(ear) {
  const a = np[ear], c = nn[ear];
  if (area(a, ear, c) >= 0) return false;
  const ax = nx[a], ay = ny[a], bx = nx[ear], by = ny[ear], cx = nx[c], cy = ny[c];
  const x0 = Math.min(ax, bx, cx), y0 = Math.min(ay, by, cy), x1 = Math.max(ax, bx, cx), y1 = Math.max(ay, by, cy);
  for (let p = nn[c]; p !== a; p = nn[p]) {
    if (blocks(p, a, c, ax, ay, bx, by, cx, cy, x0, y0, x1, y1)) return false;
  }
  return true;
}

// The same, looking only at the points whose z-order falls in the ear's
// bounds, outward from the ear along the z-order in both directions.
function isEarHashed(ear, minX, minY, invSize) {
  const a = np[ear], c = nn[ear];
  if (area(a, ear, c) >= 0) return false;
  const ax = nx[a], ay = ny[a], bx = nx[ear], by = ny[ear], cx = nx[c], cy = ny[c];
  const x0 = Math.min(ax, bx, cx), y0 = Math.min(ay, by, cy), x1 = Math.max(ax, bx, cx), y1 = Math.max(ay, by, cy);
  const minZ = zOrder(x0, y0, minX, minY, invSize), maxZ = zOrder(x1, y1, minX, minY, invSize);
  let p = npz[ear], n = nnz[ear];
  while (p !== -1 && nz[p] >= minZ && n !== -1 && nz[n] <= maxZ) {
    if (blocks(p, a, c, ax, ay, bx, by, cx, cy, x0, y0, x1, y1)) return false;
    p = npz[p];
    if (blocks(n, a, c, ax, ay, bx, by, cx, cy, x0, y0, x1, y1)) return false;
    n = nnz[n];
  }
  while (p !== -1 && nz[p] >= minZ) {
    if (blocks(p, a, c, ax, ay, bx, by, cx, cy, x0, y0, x1, y1)) return false;
    p = npz[p];
  }
  while (n !== -1 && nz[n] <= maxZ) {
    if (blocks(n, a, c, ax, ay, bx, by, cx, cy, x0, y0, x1, y1)) return false;
    n = nnz[n];
  }
  return true;
}

// Clips ears off the ring until it is gone. Going round once without an
// ear it filters the collinear points (pass 1), then cures the little
// self-crossings (pass 2), then splits the ring along a diagonal and does
// each half on its own; if even that finds nothing the rest is let go.
function earcutLinked(ear, minX, minY, invSize, pass) {
  if (ear === -1) return;
  if (!pass && invSize) indexCurve(ear, minX, minY, invSize);
  let stop = ear;
  while (np[ear] !== nn[ear]) {
    const prev = np[ear], next = nn[ear];
    if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
      emit(nv[prev], nv[ear], nv[next]);
      removeNode(ear);
      ear = nn[next];
      stop = ear;
      continue;
    }
    ear = next;
    if (ear === stop) {
      if (!pass) {
        earcutLinked(filterPoints(ear), minX, minY, invSize, 1);
      } else if (pass === 1) {
        ear = cureLocalIntersections(filterPoints(ear));
        earcutLinked(ear, minX, minY, invSize, 2);
      } else if (pass === 2) {
        splitEarcut(ear, minX, minY, invSize);
      }
      break;
    }
  }
}

function intersects(p1, q1, p2, q2) {
  const o1 = sign(area(p1, q1, p2)), o2 = sign(area(p1, q1, q2));
  const o3 = sign(area(p2, q2, p1)), o4 = sign(area(p2, q2, q1));
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

// Whether q, known to be collinear with p and r, lies between them.
function onSegment(p, q, r) {
  return nx[q] <= Math.max(nx[p], nx[r]) && nx[q] >= Math.min(nx[p], nx[r])
    && ny[q] <= Math.max(ny[p], ny[r]) && ny[q] >= Math.min(ny[p], ny[r]);
}

// Cuts off the corners where two edges two apart cross (a small loop in the
// outline) as a triangle each.
function cureLocalIntersections(start) {
  let p = start;
  do {
    const a = np[p], b = nn[nn[p]];
    if (!equals(a, b) && intersects(a, p, nn[p], b) && locallyInside(a, b) && locallyInside(b, a)) {
      emit(nv[a], nv[p], nv[b]);
      removeNode(p);
      removeNode(nn[p]);
      p = start = b;
    }
    p = nn[p];
  } while (p !== start);
  return filterPoints(p);
}

// Looks for a diagonal that divides the ring in two and cuts each half.
function splitEarcut(start, minX, minY, invSize) {
  let a = start;
  do {
    let b = nn[nn[a]];
    while (b !== np[a]) {
      if (nv[a] !== nv[b] && isValidDiagonal(a, b)) {
        let c = splitPolygon(a, b);
        a = filterPoints(a, nn[a]);
        c = filterPoints(c, nn[c]);
        earcutLinked(a, minX, minY, invSize, 0);
        earcutLinked(c, minX, minY, invSize, 0);
        return;
      }
      b = nn[b];
    }
    a = nn[a];
  } while (a !== start);
}

// Joins the holes to the outline one by one, from the leftmost out: each by
// a bridge from its leftmost point to a point of the outline it can see.
function eliminateHoles(holes, outer) {
  const queue = [];
  for (const h of holes) {
    const list = linkRing(h, false);
    if (list === -1) continue;
    if (list === nn[list]) nst[list] = 1;
    queue.push(leftmost(list));
  }
  queue.sort(compareXYSlope);
  for (const q of queue) outer = eliminateHole(q, outer);
  return outer;
}

function compareXYSlope(a, b) {
  let r = nx[a] - nx[b];
  if (r === 0) {
    r = ny[a] - ny[b];
    if (r === 0) {
      const aSlope = (ny[nn[a]] - ny[a]) / (nx[nn[a]] - nx[a]);
      const bSlope = (ny[nn[b]] - ny[b]) / (nx[nn[b]] - nx[b]);
      r = aSlope - bSlope;
    }
  }
  return r;
}

function leftmost(start) {
  let p = start, best = start;
  do {
    if (nx[p] < nx[best] || (nx[p] === nx[best] && ny[p] < ny[best])) best = p;
    p = nn[p];
  } while (p !== start);
  return best;
}

function eliminateHole(hole, outer) {
  const bridge = findHoleBridge(hole, outer);
  if (bridge === -1) return outer;
  const back = splitPolygon(bridge, hole);
  filterPoints(back, nn[back]);
  return filterPoints(bridge, nn[bridge]);
}

// David Eberly's algorithm: shoot a ray left from the hole's leftmost point,
// take the outline edge it hits and that edge's left end; if outline points
// lie in the triangle between, take the one at the smallest angle to the ray.
function findHoleBridge(hole, outer) {
  let p = outer;
  const hx = nx[hole], hy = ny[hole];
  let qx = -Infinity, m = -1;
  if (equals(hole, p)) return p;
  do {
    const q = nn[p];
    if (equals(hole, q)) return q;
    if (hy <= ny[p] && hy >= ny[q] && ny[q] !== ny[p]) {
      const x = nx[p] + ((hy - ny[p]) * (nx[q] - nx[p])) / (ny[q] - ny[p]);
      if (x <= hx && x > qx) {
        qx = x;
        m = nx[p] < nx[q] ? p : q;
        if (x === hx) return m;
      }
    }
    p = q;
  } while (p !== outer);
  if (m === -1) return -1;
  const stop = m, mx = nx[m], my = ny[m];
  let tanMin = Infinity;
  p = m;
  do {
    const px = nx[p], py = ny[p];
    if (hx >= px && px >= mx && hx !== px
      && pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, px, py)) {
      const tan = Math.abs(hy - py) / (hx - px);
      if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && (px > nx[m] || (px === nx[m] && sectorContainsSector(m, p)))))) {
        m = p;
        tanMin = tan;
      }
    }
    p = nn[p];
  } while (p !== stop);
  return m;
}

function sectorContainsSector(m, p) {
  return area(np[m], m, np[p]) < 0 && area(nn[p], m, nn[m]) < 0;
}

// The z-order (Morton) curve index of a point: its coordinates, scaled to
// 15 bits each, interleaved. Points near each other in the plane are mostly
// near each other along the curve.
function zOrder(x, y, minX, minY, invSize) {
  x = ((x - minX) * invSize) | 0;
  y = ((y - minY) * invSize) | 0;
  x = (x | (x << 8)) & 0x00ff00ff;
  x = (x | (x << 4)) & 0x0f0f0f0f;
  x = (x | (x << 2)) & 0x33333333;
  x = (x | (x << 1)) & 0x55555555;
  y = (y | (y << 8)) & 0x00ff00ff;
  y = (y | (y << 4)) & 0x0f0f0f0f;
  y = (y | (y << 2)) & 0x33333333;
  y = (y | (y << 1)) & 0x55555555;
  return x | (y << 1);
}

// Threads the ring's nodes along the z-order curve too.
function indexCurve(start, minX, minY, invSize) {
  let p = start;
  do {
    if (nz[p] === 0) nz[p] = zOrder(nx[p], ny[p], minX, minY, invSize);
    npz[p] = np[p];
    nnz[p] = nn[p];
    p = nn[p];
  } while (p !== start);
  nnz[npz[p]] = -1;
  npz[p] = -1;
  sortLinked(p);
}

// A bottom-up merge sort of the z-order list (Simon Tatham's).
function sortLinked(list) {
  let numMerges, inSize = 1;
  do {
    let p = list, tail = -1;
    list = -1;
    numMerges = 0;
    while (p !== -1) {
      numMerges++;
      let q = p, pSize = 0;
      for (let i = 0; i < inSize; i++) {
        pSize++;
        q = nnz[q];
        if (q === -1) break;
      }
      let qSize = inSize;
      while (pSize > 0 || (qSize > 0 && q !== -1)) {
        let e;
        if (pSize !== 0 && (qSize === 0 || q === -1 || nz[p] <= nz[q])) {
          e = p;
          p = nnz[p];
          pSize--;
        } else {
          e = q;
          q = nnz[q];
          qSize--;
        }
        if (tail !== -1) nnz[tail] = e;
        else list = e;
        npz[e] = tail;
        tail = e;
      }
      p = q;
    }
    nnz[tail] = -1;
    inSize *= 2;
  } while (numMerges > 1);
  return list;
}

function isValidDiagonal(a, b) {
  return nv[nn[a]] !== nv[b] && nv[np[a]] !== nv[b] && !intersectsPolygon(a, b)
    && ((locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b)
      && (area(np[a], a, np[b]) !== 0 || area(a, np[b], b) !== 0))
    || (equals(a, b) && area(np[a], a, nn[a]) > 0 && area(np[b], b, nn[b]) > 0));
}

function intersectsPolygon(a, b) {
  let p = a;
  do {
    if (nv[p] !== nv[a] && nv[nn[p]] !== nv[a] && nv[p] !== nv[b] && nv[nn[p]] !== nv[b] && intersects(p, nn[p], a, b)) return true;
    p = nn[p];
  } while (p !== a);
  return false;
}

// Whether the diagonal from a to b leaves a into the polygon's inside.
function locallyInside(a, b) {
  return area(np[a], a, nn[a]) < 0
    ? area(a, b, nn[a]) >= 0 && area(a, np[a], b) >= 0
    : area(a, b, np[a]) < 0 || area(a, nn[a], b) < 0;
}

function middleInside(a, b) {
  let p = a, inside = false;
  const px = (nx[a] + nx[b]) / 2, py = (ny[a] + ny[b]) / 2;
  do {
    const q = nn[p];
    if (ny[p] > py !== ny[q] > py && ny[q] !== ny[p] && px < ((nx[q] - nx[p]) * (py - ny[p])) / (ny[q] - ny[p]) + nx[p]) inside = !inside;
    p = q;
  } while (p !== a);
  return inside;
}

// Splits the ring in two along a–b, each half getting its own copies of a
// and b; returns b's copy, a node of the second half.
function splitPolygon(a, b) {
  const a2 = newNode(nv[a], nx[a], ny[a]), b2 = newNode(nv[b], nx[b], ny[b]);
  const an = nn[a], bp = np[b];
  nn[a] = b;
  np[b] = a;
  nn[a2] = an;
  np[an] = a2;
  nn[b2] = a2;
  np[a2] = b2;
  nn[bp] = b2;
  np[b2] = bp;
  return b2;
}

// One polygon: an outline ring and the rings that are holes in it.
function earcutPolygon(outer, holes) {
  used = 0;
  let node = linkRing(outer, true);
  if (node === -1 || nn[node] === np[node]) return;
  let x0 = outer.x0, y0 = outer.y0, x1 = outer.x1, y1 = outer.y1, count = outer.n;
  if (holes) {
    for (const h of holes) {
      if (h.x0 < x0) x0 = h.x0;
      if (h.y0 < y0) y0 = h.y0;
      if (h.x1 > x1) x1 = h.x1;
      if (h.y1 > y1) y1 = h.y1;
      count += h.n;
    }
    node = eliminateHoles(holes, node);
  }
  // Past 80 points the z-order hash pays; its scale makes the longer side 15 bits.
  let invSize = 0;
  if (count > 80) {
    invSize = Math.max(x1 - x0, y1 - y0);
    invSize = invSize !== 0 ? 32767 / invSize : 0;
  }
  earcutLinked(node, x0, y0, invSize, 0);
}
