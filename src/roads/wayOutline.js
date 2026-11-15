// Ways drawn as their outlines, straight from their own curves (the edges'
// `pts` in ways.js) – not from the dot steps they pass. A road is two edge
// lines either side of its centre line; where ways meet, the junction is
// drawn as one shape, the way a hand draws a crossroads: the arms sorted
// round the node, each side line cut where it meets the neighbouring arm's
// side line, and that corner rounded a little. A footpath, a lane, a street
// – each keeps its own width; the corners between them still meet.
//
//   offsetLine(pts, d)         a line beside pts at d (+ to the left of
//                              the way along it, as offsetPolyline), with
//                              mitred joins and no folds: where a tight bend
//                              would loop the inner side, the loop is cut out
//   wayOutlines(ways, opts)    the outline pieces (see below)

import { measurePolyline, pointAt, subPolyline } from './geometry.js';
import { crossingsOf } from './curves.js';

// How far along the arms a junction looks for where neighbouring sides meet.
const LOOK = 2.5;

export function offsetLine(pts, d) {
  const n = pts.length;
  if (n < 2 || !d) return pts.map((p) => [p[0], p[1]]);
  const dirs = [];
  for (let i = 1; i < n; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], l = Math.hypot(dx, dy);
    dirs.push(l ? [dx / l, dy / l] : null);
  }
  // (a repeated point: the direction of its neighbours)
  for (let i = 0; i < dirs.length; i++) if (!dirs[i]) dirs[i] = dirs[i - 1] ?? dirs.slice(i).find(Boolean) ?? [1, 0];
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = dirs[Math.max(0, i - 1)], b = dirs[Math.min(dirs.length - 1, i)];
    let tx = a[0] + b[0], ty = a[1] + b[1];
    const l = Math.hypot(tx, ty);
    if (l < 1e-9) [tx, ty] = b; else [tx, ty] = [tx / l, ty / l];
    // a mitre: further out on a bend, so the side stays parallel (at most 2×)
    const cos = Math.max(0.5, tx * b[0] + ty * b[1]);
    out.push([pts[i][0] - (ty * d) / cos, pts[i][1] + (tx * d) / cos]);
  }
  return unfold(out);
}

// Cuts the loops out of a line (where it crosses itself within `window`
// points): the side of a road on the inside of a bend tighter than its width.
function unfold(line, window = 60) {
  const out = line;
  for (let i = 0; i < out.length - 3; i++) {
    for (let j = Math.min(out.length - 2, i + window); j >= i + 2; j--) {
      const hit = segmentHit(out[i], out[i + 1], out[j], out[j + 1]);
      if (!hit) continue;
      const p = [out[i][0] + (out[i + 1][0] - out[i][0]) * hit, out[i][1] + (out[i + 1][1] - out[i][1]) * hit];
      out.splice(i + 1, j - i, p);
      break;
    }
  }
  return out;
}

// Where segment a0–a1 crosses b0–b1, as the share along a0–a1, or null.
function segmentHit(a0, a1, b0, b1) {
  const rx = a1[0] - a0[0], ry = a1[1] - a0[1], sx = b1[0] - b0[0], sy = b1[1] - b0[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = b0[0] - a0[0], qy = b0[1] - a0[1];
  const u = (qx * sy - qy * sx) / den, v = (qx * ry - qy * rx) / den;
  return u > 1e-9 && u < 1 - 1e-9 && v > 1e-9 && v < 1 - 1e-9 ? u : null;
}

const quad = (p, c, q, n = 8) => {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t;
    pts.push([a * p[0] + b * c[0] + d * q[0], a * p[1] + b * c[1] + d * q[1]]);
  }
  return pts;
};

// The first `len` of a line.
function head(line, len) {
  const poly = measurePolyline(line);
  return poly.total <= len ? line : subPolyline(poly, 0, len);
}

// The outlines of the ways `keep(edge)` picks:
//   width(edge)    half the way's width
//   sides(edge)    [side 0, side 1] – which sides count (kerbs: only the
//                  sides with a sidewalk); side 0 is +width (offsetLine)
//                  going from the edge's a to b. Default both.
//   exitDir(node)  [dx, dy] where a way end runs off the map, else null:
//                  its sides carry on 0.8, then fade
//   capAt(node)    false leaves a dead end open (a footpath carrying on)
//   taper          where a narrower way runs on into a wider one, its sides
//                  widen into the wider one's over this length
//   round          how much a junction's corners are rounded (× the
//                  narrower way's width, more for a sharp corner)
//   dot(node)      a node's dot (for the pen's order); default the node id
// Edges run on through a node where only two meet with the same width and
// sides, so a way's outline is one line from junction to junction.
// Returns [{ key, kind, line, a, b, on }]: kind 'edge' (a side of a run,
// `on` true where that side counts), 'corner' (between two arms at a
// junction; `on` when both sides it joins count), 'end' (round a dead
// end; `on` when both sides count), 'exit' / 'fade' (off the map; `on`
// as the side). Keys stay while the ways do (the pen, ink.js).
export function wayOutlines(ways, opts) {
  const {
    keep = () => true, width, sides = () => [true, true], exitDir = () => null, capAt = () => true,
    taper = 0, round = 1.2, dot = (n) => n,
  } = opts;
  const at = new Map();
  for (const e of ways.edges.values()) {
    if (!keep(e)) continue;
    for (const n of [e.a, e.b]) (at.get(n) ?? at.set(n, []).get(n)).push(e);
  }
  const oriented = (e, fwd) => { const s = sides(e); return fwd ? s : [s[1], s[0]]; };
  // a node the outline runs on through, from edge e (arriving forward or
  // not) into the other one there
  const runsOn = (n, e, fwd) => {
    const list = at.get(n);
    if (list.length !== 2 || list[0] === list[1]) return null;
    const next = list[0] === e ? list[1] : list[0];
    if (width(next) !== width(e)) return null;
    const [p, q] = [oriented(e, fwd), oriented(next, next.a === n)];
    return p[0] === q[0] && p[1] === q[1] ? next : null;
  };
  const through = (n) => { const list = at.get(n); return list.length === 2 && !!runsOn(n, list[0], list[0].b === n); };

  // runs between junctions and ends
  const used = new Set(), runs = [];
  const walk = (start, first) => {
    const segs = [];
    let cur = start, e = first;
    for (;;) {
      const fwd = e.a === cur;
      segs.push({ e, fwd });
      used.add(e.id);
      cur = fwd ? e.b : e.a;
      const next = cur === start ? null : runsOn(cur, e, fwd);
      if (!next || used.has(next.id)) break;
      e = next;
    }
    return { start, end: cur, segs };
  };
  for (const [n, list] of at) if (!through(n)) for (const e of list) if (!used.has(e.id)) runs.push(walk(n, e));
  for (const list of at.values()) for (const e of list) if (!used.has(e.id)) runs.push(walk(e.a, e)); // loops

  const out = [];
  const arms = new Map(); // node -> [arm]
  for (const run of runs) {
    const centre = [];
    for (const { e, fwd } of run.segs) {
      const pts = fwd ? e.pts : [...e.pts].reverse();
      for (const p of pts) {
        const q = centre[centre.length - 1];
        if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-9) centre.push(p);
      }
    }
    if (centre.length < 2) continue;
    const { e: e0, fwd: f0 } = run.segs[0];
    run.w = width(e0);
    run.on = oriented(e0, f0);
    run.key = `${e0.id}${f0 ? '' : 'r'}`;
    run.lines = [offsetLine(centre, run.w), offsetLine(centre, -run.w)];
    run.cut = [[0, 0], [0, 0]];
    run.closed = run.start === run.end && through(run.start);
    if (run.closed) continue;
    for (const atStart of [true, false]) {
      const n = atStart ? run.start : run.end;
      const line = atStart ? centre : [...centre].reverse();
      const [x0, y0] = line[0];
      let q = line[line.length - 1];
      for (const p of line) if (Math.hypot(p[0] - x0, p[1] - y0) >= Math.min(0.4, run.w * 3)) { q = p; break; }
      const side = (k) => (atStart ? run.lines[k] : [...run.lines[k]].reverse());
      // ccw: the side a quarter turn anticlockwise (by atan2) from the way out
      const ccw = atStart ? 0 : 1, cw = 1 - ccw;
      (arms.get(n) ?? arms.set(n, []).get(n)).push({
        run, atStart, w: run.w, angle: Math.atan2(q[1] - y0, q[0] - x0), dir: [q[0] - x0, q[1] - y0],
        ccw, cw, out: [side(0), side(1)],
      });
    }
  }
  // a cut `len` along an arm's side, from the node
  const cut = (arm, k, len) => { arm.run.cut[k][arm.atStart ? 0 : 1] = Math.max(arm.run.cut[k][arm.atStart ? 0 : 1], len); };
  const along = (arm, k, len) => pointAt(measurePolyline(arm.out[k]), len);

  for (const [n, list] of arms) {
    const node = ways.nodes.get(n);
    if (list.length === 1) {
      const arm = list[0], { run } = arm;
      const l = Math.hypot(...arm.dir) || 1, [dx, dy] = [arm.dir[0] / l, arm.dir[1] / l];
      const ends = [arm.out[0][0], arm.out[1][0]];
      const away = exitDir(n);
      if (away) {
        const [ox, oy] = away;
        ends.forEach(([ex, ey], k) => {
          out.push({ key: `x${n}:${k}`, kind: 'exit', line: [[ex, ey], [ex + ox * 0.8, ey + oy * 0.8]], a: dot(n), b: dot(n), on: run.on[k] });
          out.push({ key: `f${n}:${k}`, kind: 'fade', line: [[ex + ox * 0.8, ey + oy * 0.8], [ex + ox * 1.9, ey + oy * 1.9]], a: dot(n), b: dot(n), on: run.on[k] });
        });
      } else if (capAt(n)) {
        // a half circle round the end, from one side to the other
        const a0 = Math.atan2(ends[0][1] - node.y, ends[0][0] - node.x);
        let sweep = Math.atan2(-dy, -dx) - a0;
        sweep = Math.atan2(Math.sin(sweep), Math.cos(sweep));
        const arc = [];
        for (let i = 0; i <= 10; i++) {
          const t = a0 + (2 * sweep * i) / 10;
          arc.push([node.x + Math.cos(t) * arm.w, node.y + Math.sin(t) * arm.w]);
        }
        out.push({ key: `e${n}`, kind: 'end', line: arc, a: dot(n), b: dot(arm.atStart ? run.end : run.start), on: run.on[0] && run.on[1] });
      }
      continue;
    }
    list.sort((p, q) => p.angle - q.angle);
    const wide = Math.max(...list.map((a) => a.w));
    for (let i = 0; i < list.length; i++) {
      const A = list[i], B = list[(i + 1) % list.length];
      let gap = B.angle - A.angle;
      if (gap <= 0) gap += Math.PI * 2;
      const la = head(A.out[A.ccw], LOOK), lb = head(B.out[B.cw], LOOK);
      let best = null;
      if (gap < Math.PI * 0.97) for (const c of crossingsOf(la, lb)) if (!best || c.sa + c.sb < best.sa + best.sb) best = c;
      let ca, cb, corner;
      if (best) {
        // rounded: the narrower way's width out from where they meet,
        // more the sharper the corner
        const k = Math.min(wide * 4, (round * Math.min(A.w, B.w)) / Math.tan(gap / 2));
        ca = best.sa + k;
        cb = best.sb + k;
        corner = best.point;
      } else {
        // straight across (the side of a T), or a narrower way running on
        // into a wider one
        const two = list.length === 2;
        ca = two ? (A.w < B.w ? taper : 0) : wide * 1.25;
        cb = two ? (B.w < A.w ? taper : 0) : wide * 1.25;
      }
      const ma = measurePolyline(A.out[A.ccw]), mb = measurePolyline(B.out[B.cw]);
      ca = Math.min(ca, ma.total);
      cb = Math.min(cb, mb.total);
      cut(A, A.ccw, ca);
      cut(B, B.cw, cb);
      const p = pointAt(ma, ca), q = pointAt(mb, cb);
      if (!corner) corner = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      out.push({
        key: `c${n}:${A.run.key}:${B.run.key}`, kind: 'corner', line: quad(p, corner, q),
        a: dot(n), b: dot(B.atStart ? B.run.end : B.run.start), on: A.run.on[A.ccw] && B.run.on[B.cw],
      });
    }
  }
  for (const run of runs) {
    if (!run.lines) continue;
    run.lines.forEach((line, k) => {
      const poly = measurePolyline(line);
      const [s0, s1] = run.cut[k];
      if (poly.total - s0 - s1 <= 1e-6) return;
      const piece = s0 || s1 ? subPolyline(poly, s0, poly.total - s1) : line;
      out.push({ key: `w${run.key}.${k}`, kind: 'edge', line: piece, a: dot(run.start), b: dot(run.end), on: run.on[k] });
    });
  }
  return out;
}
