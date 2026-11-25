// Drawing tool for any kind of way (roads, footpaths, railways, fences, walls),
// point by point (README, Free placement, stage C): click where it
// starts, then click along – the way is built as you go, from the first
// point to the last one clicked, one smooth curve through them all, its
// bends eased to what the kind can take (curves.js easeBends). Each click
// takes back the way laid at the one before (its own undo step, nothing
// else) and lays the longer curve in its place, so the whole way is one
// step for ⌘Z. A point it can't take is refused (a cross marks where) and
// the way stays as it was. Clicking the last point again, Esc or
// right-click ends the way; the next click starts a new one. Points snap
// onto a junction or a way near them, and a little to the way's own line
// and square off it. Roads
// come as three tools: streets with sidewalks and lamps (`street`), roads
// and single-track lanes (`lane`); drawing one over another converts it.

import { easeBends } from '../roads/curves.js';
import { measurePolyline, pointAt } from '../roads/geometry.js';
import { traceLine } from '../roads/dotView.js';
import { t, reasonText } from '../core/text.js';
import { EXIT_REACH } from '../core/world/access.js';

// The tightest bend each kind takes (radius, world units).
const RADIUS = { road: 1, path: 0.3, rail: 2.5, fence: 0.15, wall: 0.15, field: 0.15 };
const LANE_RADIUS = 0.7;
const SNAP = 0.35;               // onto a junction or a way
const ANGLE_SNAP = Math.PI / 30; // 6°: onto the last leg's line, or square to it
const SAME = 0.3;                // a click this near the last point lays the way
const MARK_STEP = 0.4;           // a refused stretch gets a cross this often along the line
const MARK_NEAR = 0.55;          // …where the line passes this near a dot the check refused

// options: { kind, id (default: kind), lane / street (roads: build lanes / streets), crop (field edges: what the field grows), group (Build menu group), fineGrid, curve (config key), hoverRadius }
// Its words are tool.<id>, tool.<id>.blurb and network.*.<id> (text/ui.txt).
export function createNetworkTool(ctx, options) {
  const { world, config } = ctx;
  const { kind, lane = false, street = false, crop = null, fineGrid = false, hoverRadius = 0.32 } = options;
  const id = options.id ?? kind;
  const layer = world.networks[kind];
  const radius = lane ? LANE_RADIUS : RADIUS[kind] ?? 0.5;
  const cls = `preview ${kind}${lane ? ' lane' : street ? ' street' : ''}`;

  let points = [];   // clicked so far
  let at = null;     // the pointer, snapped
  let refused = null; // the last point it couldn't take, for a moment: { at, reason }

  // The pointer snapped: a junction, else a way, else square to the last
  // leg, else as it is.
  const snapPoint = (x, y) => {
    const node = world.ways.nodeNear(x, y, SNAP * Math.max(layer.scale, 0.5));
    if (node) return [node.x, node.y];
    const hit = world.ways.edgeNear(x, y, SNAP * Math.max(layer.scale, 0.5));
    if (hit) return hit.point;
    const edge = toEdge(x, y);
    if (edge) return edge;
    const n = points.length;
    if (n >= 2) {
      const [px, py] = points[n - 1], [qx, qy] = points[n - 2];
      const leg = Math.atan2(py - qy, px - qx), d = Math.hypot(x - px, y - py);
      const ang = Math.atan2(y - py, x - px);
      for (let k = -1; k <= 1; k++) {
        const want = leg + (k * Math.PI) / 2;
        const off = Math.atan2(Math.sin(ang - want), Math.cos(ang - want));
        if (Math.abs(off) < ANGLE_SNAP) return [px + Math.cos(want) * d, py + Math.sin(want) * d];
      }
    }
    return [x, y];
  };

  // A point near the land's edge, or past it, onto the edge: the way runs
  // on off the map there (World.roadExits). null when well inside.
  const toEdge = (x, y) => {
    const d = world.land.depth(x, y);
    if (d > EXIT_REACH) return null;
    const [ox, oy] = world.land.outward(x, y);
    let p = [x + ox * d, y + oy * d];
    // (the edge as measured along the radius: a step or two to sit on it)
    for (let i = 0; i < 3; i++) {
      const e = world.land.depth(...p);
      p = [p[0] + ox * e, p[1] + oy * e];
    }
    return p;
  };

  // Where the line from p (on the land) to q (off it) crosses the edge.
  const edgeCrossing = (p, q) => {
    let lo = 0, hi = 1;
    const at = (t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (world.land.depth(...at(mid)) >= 0) lo = mid; else hi = mid;
    }
    return at(lo);
  };

  const same = (p, q) => p && q && Math.hypot(p[0] - q[0], p[1] - q[1]) < SAME * Math.max(layer.scale, 0.5);
  // an end set on a way (snapPoint) stays there
  const onWay = (p) => !!(world.ways.nodeNear(...p, 1e-3) || world.ways.edgeNear(...p, 1e-3));
  const lineThrough = (pts) => {
    if (pts.length < 2) return null;
    const line = easeBends(pts, radius);
    if (!line || !layer.bridge) return line;
    // (longer straight runs on the banks if the bends won't ease into a short one)
    // (and the next nearest direction, where the nearest bends too sharply)
    for (const next of [false, true]) {
      for (const run of [1.2, 2, 0.7].map((k) => Math.max(radius * k, 0.6))) {
        const fixed = straightCrossings(pts, line, layer, { run, next, keep: onWay });
        if (fixed === pts) return line;
        const eased = easeBends(fixed, radius);
        if (eased) return eased;
      }
    }
    return line;
  };

  // The way as it would be with the pointer's point added: { line, check }.
  const plan = () => {
    if (!points.length || !at || same(at, points[points.length - 1])) return null;
    const line = lineThrough([...points, at]);
    if (!line) return { line: [...points, at], check: { ok: false, blocked: [], reason: 'Too sharp a bend' }, sharp: true };
    // part of it laid already: just the stretch beyond the last point (the
    // world holds the rest, so a check would find it in its own way – the
    // click says whether it can go)
    if (laidStep) {
      const [lx, ly] = points[points.length - 1];
      let k = 0, best = Infinity;
      line.forEach(([x, y], i) => { const d = Math.hypot(x - lx, y - ly); if (d < best) [k, best] = [i, d]; });
      return { line: line.slice(k), check: { ok: true, blocked: [] } };
    }
    return { line, check: world.checkWay(kind, line, { lane, street }) };
  };

  // the undo step of the way laid so far (null: nothing laid yet)
  let laidStep = null;
  const history = world.history;
  // Lays the way through `pts`, in place of the one laid at the last click.
  // { ok, reason }.
  const relay = (pts) => {
    const line = lineThrough(pts);
    if (!line) return { ok: false, reason: 'Too sharp a bend' };
    history.commit();
    const mine = laidStep && history.done[history.done.length - 1] === laidStep;
    if (mine && !history.undo().ok) return { ok: false };
    const result = world.layWay(kind, line, { lane, street, crop });
    if (result?.ok) {
      history.commit();
      laidStep = history.done[history.done.length - 1] ?? null;
      return { ok: true };
    }
    if (mine) history.redo(); // (the way as it was)
    return { ok: false, reason: result?.reason };
  };
  const stop = () => { points = []; laidStep = null; };

  // Drawn freehand (a drag, one finger on a phone): the stroke as the
  // pointer went, laid on release – thinned to its turning points and
  // eased into the kind's bends, so a wobbly hand gives a gentle curve.
  let stroke = null;
  const unit = Math.max(layer.scale, 0.5);
  const thin = (pts, tol) => {
    const keep = simplify(pts, tol * unit);
    // (no two points closer than a road's bend can use)
    const out = [keep[0]];
    for (const p of keep.slice(1, -1)) if (Math.hypot(p[0] - out.at(-1)[0], p[1] - out.at(-1)[1]) >= radius * 0.6) out.push(p);
    const end = keep.at(-1);
    if (out.length > 1 && Math.hypot(end[0] - out.at(-1)[0], end[1] - out.at(-1)[1]) < radius * 0.6) out.pop();
    out.push(end);
    return out;
  };
  const sketch = {
    start(x, y) {
      stop();
      refused = null;
      stroke = [snapPoint(x, y)];
    },
    move(x, y) {
      if (!stroke || stroke.offMap) return;
      const last = stroke.at(-1);
      if (Math.hypot(x - last[0], y - last[1]) < 0.04 * unit) return;
      if (world.land.inside(x, y)) { stroke.push([x, y]); return; }
      // Off the map: the way ends where the hand crossed the edge, so it
      // runs out there (an exit, World.roadExits) and nothing is drawn
      // beyond, however far the drag goes on. A stroke begun on the edge
      // waits until the hand comes onto the land.
      if (world.land.depth(...last) <= 1e-3) return;
      stroke.push(edgeCrossing(last, [x, y]));
      stroke.offMap = true;
    },
    end() {
      if (!stroke) return;
      const raw = stroke;
      stroke = null;
      if (raw.length < 2) return;
      raw[raw.length - 1] = snapPoint(...raw.at(-1));
      // looser and looser, until the bends are ones the kind can take
      let reason = 'Too sharp a bend';
      for (const tol of [0.12, 0.25, 0.5]) {
        const pts = thin(raw, tol);
        if (pts.length < 2 || !lineThrough(pts)) continue;
        const done = relay(pts);
        if (done.ok) { stop(); return; }
        reason = done.reason ?? reason;
      }
      refused = { at: raw.at(-1), reason };
      stop();
    },
    cancel() { stroke = null; },
  };

  return {
    id,
    group: options.group,
    blurb: t(`tool.${id}.blurb`),
    label: t(`tool.${id}`),
    fineGrid,
    sketch,
    // a point is set with one tap; the next needs a confirming tap
    touchConfirm: () => points.length > 0,

    snap(x, y) {
      at = snapPoint(x, y);
      return layer.nodeAt(...at);
    },

    enter() {
      stop();
    },

    exit() {
      stop();
    },

    hover() {},

    click() {
      if (!at) return;
      refused = null;
      const last = points[points.length - 1];
      if (same(at, last)) { stop(); return; } // the last point again: done
      if (!points.length) {
        const n = layer.nodeAt(...at);
        if (n >= 0 && layer.isBlocked(n) && !world.ways.nodeNear(...at, 1e-6)) { refused = { at, reason: 'Something is in the way' }; return; }
        points = [at];
        laidStep = null;
        return;
      }
      const done = relay([...points, at]);
      if (!done.ok) { refused = { at, reason: done.reason }; return; }
      points = [...points, at];
    },

    cancel() {
      if (!points.length) return false;
      stop();
      return true;
    },

    cancelLabel: () => t(points.length ? `network.stop.${id}` : 'done'),

    overlay(kit) {
      let out = '';
      const size = 0.16 * Math.sqrt(layer.scale);
      if (stroke) return out + (stroke.length > 1 ? kit.sketchPath(stroke, cls) : '');
      if (at && !points.length) out += kit.ringAt(...at, hoverRadius * layer.scale);
      for (const p of points) out += kit.ringAt(...p, 0.18 * layer.scale, 'anchor');
      if (refused) out += kit.crossAt(...refused.at, size) + (refused.reason ? kit.noteAt(...refused.at, reasonText(refused.reason)) : '');
      const p = plan();
      if (!p) return out;
      out += kit.sketchPath(p.line, `${cls}${p.check.ok ? '' : ' invalid'}`);
      // why it can't go, by the first cross on it (not again after a click: that cross says it)
      const note = (x, y) => (refused || !p.check.reason ? '' : kit.noteAt(x, y, reasonText(p.check.reason)));
      if (p.sharp) return out + kit.crossAt(...at, size) + note(...at);
      // little crosses along the line itself where it can't go (too steep,
      // water, something in the way) – not on the dots the check went by
      const bad = [...new Set(p.check.blocked ?? [])].map((n) => layer.pos(n));
      if (!bad.length) return p.check.ok ? out : out + note(...at);
      const poly = measurePolyline(p.line), near = MARK_NEAR * Math.max(layer.scale, 0.5);
      let first = null;
      for (let d = MARK_STEP / 2; d < poly.total; d += MARK_STEP) {
        const [x, y] = pointAt(poly, d);
        if (!bad.some(([bx, by]) => Math.hypot(bx - x, by - y) < near)) continue;
        out += kit.crossAt(x, y, size * 0.5);
        first ??= [x, y];
      }
      return out + note(...(first ?? at));
    },
  };
}

// A bridge goes straight from dot to dot, so a hand-drawn line over a river
// rarely makes one: where `line` (eased through `pts`) crosses water, the
// crossing is set straight in the grid direction nearest to how it was
// drawn, from the last land dot before the water to the first after it,
// with a straight `run` on land either side for the bends to ease into.
// An end too near the water for its run is moved onto the bridge's line,
// unless `keep(end)` says it must stay (it's on a way). `next`: the next
// nearest direction rather than the nearest. Returns new points
// to ease, or `pts` itself when nothing needed setting.
export function straightCrossings(pts, line, layer, { run = 1, next = false, keep = () => false } = {}) {
  const { grid, bridge } = layer;
  const dots = traceLine(line, grid, layer.scale);
  const poly = measurePolyline(pts);
  // where along `pts` a point lies (arc length of the nearest point on it)
  const sOf = ([x, y]) => {
    let best = Infinity, at = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], vx = pts[i][0] - ax, vy = pts[i][1] - ay, l2 = vx * vx + vy * vy;
      const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2)) : 0;
      const d = Math.hypot(ax + vx * t - x, ay + vy * t - y);
      if (d < best) [best, at] = [d, poly.cum[i - 1] + t * Math.sqrt(l2)];
    }
    return at;
  };
  const cuts = [];
  for (let i = 1; i < dots.length - 1; i++) {
    if (!bridge.water(dots[i].n) || bridge.water(dots[i - 1].n)) continue;
    let j = i;
    while (j + 1 < dots.length && bridge.water(dots[j + 1].n)) j++;
    if (j + 1 >= dots.length) break; // ends in the water: nothing to set straight
    const a = dots[i - 1].n, pa = dots[i - 1].p, pb = dots[j + 1].p;
    // straight already: the bridge goes as drawn
    const step = (m, n) => grid.xy(n).map((v, k) => v - grid.xy(m)[k]).join();
    const first = step(dots[i - 1].n, dots[i].n);
    let straight = true;
    for (let k = i; k <= j; k++) straight &&= step(dots[k].n, dots[k + 1].n) === first;
    if (straight) { i = j; continue; }
    // the nearest of the eight grid directions to the drawn line, then the
    // next nearest
    const turn = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]) / (Math.PI / 4);
    const k0 = Math.round(turn), k1 = turn > k0 ? k0 + 1 : k0 - 1;
    for (const k of next ? [k1, k0] : [k0, k1]) {
      const dx = Math.round(Math.cos((k * Math.PI) / 4)), dy = Math.round(Math.sin((k * Math.PI) / 4));
      let q = grid.offset(a, dx, dy), steps = 1;
      if (q < 0 || !bridge.water(q)) continue;
      while (q >= 0 && bridge.water(q) && steps <= bridge.span) [q, steps] = [grid.offset(q, dx, dy), steps + 1];
      if (q < 0 || bridge.water(q)) continue;
      const A = layer.dot(a), Q = layer.dot(q), u = Math.hypot(dx, dy);
      const d = [(dx / u) * run, (dy / u) * run];
      cuts.push({ from: sOf(A) - run, to: sOf(Q) + run, A, Q, dir: [dx / u, dy / u], put: [[A[0] - d[0], A[1] - d[1]], A, Q, [Q[0] + d[0], Q[1] + d[1]]] });
      break;
    }
    i = j;
  }
  if (!cuts.length) return pts;
  // a run reaching past an end of the way, or leaving too short a leg to
  // it: the end goes onto the bridge's line, as far from the bank as it was
  // drawn (or, kept, joins it there)
  const total = poly.total;
  let start = pts[0], end = pts.at(-1);
  const along = (P, dir, from, sign) => {
    const l = Math.max(Math.hypot(from[0] - P[0], from[1] - P[1]), 0.3);
    return [P[0] + dir[0] * l * sign, P[1] + dir[1] * l * sign];
  };
  const [head, tail] = [cuts[0], cuts.at(-1)];
  if (head.from <= run) {
    head.put.shift();
    if (!keep(start)) start = along(head.A, head.dir, start, -1);
  }
  if (tail.to >= total - run) {
    tail.put.pop();
    if (!keep(end)) end = along(tail.Q, tail.dir, end, 1);
  }
  const out = [start];
  let c = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const s = poly.cum[i];
    while (c < cuts.length && s > cuts[c].to) out.push(...cuts[c++].put);
    if (c < cuts.length && s >= cuts[c].from) continue;
    out.push(pts[i]);
  }
  while (c < cuts.length) out.push(...cuts[c++].put);
  out.push(end);
  return out.filter((p, i) => !i || Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > 1e-6);
}

// A line with only the points that matter (Ramer–Douglas–Peucker): none
// further than `tol` from the line kept.
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const [a, b] = [pts[0], pts.at(-1)];
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
  let far = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const d = l ? Math.abs((x - a[0]) * dy - (y - a[1]) * dx) / l : Math.hypot(x - a[0], y - a[1]);
    if (d > far) [far, at] = [d, i];
  }
  if (far <= tol) return [a, b];
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}
