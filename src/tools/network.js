// Drawing tool for any kind of way (roads, footpaths, railways, fences),
// point by point (docs/free-placement-plan.md, stage C): click where it
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
import { t } from '../core/text.js';

// The tightest bend each kind takes (radius, world units).
const RADIUS = { road: 1, path: 0.3, rail: 2.5, fence: 0.15 };
const LANE_RADIUS = 0.7;
const SNAP = 0.35;               // onto a junction or a way
const ANGLE_SNAP = Math.PI / 30; // 6°: onto the last leg's line, or square to it
const SAME = 0.3;                // a click this near the last point lays the way
const MARK_STEP = 0.4;           // a refused stretch gets a cross this often along the line
const MARK_NEAR = 0.55;          // …where the line passes this near a dot the check refused

// options: { kind, id (default: kind), lane / street (roads: build lanes / streets), group (Build menu group), fineGrid, curve (config key), hoverRadius }
// Its words are tool.<id>, tool.<id>.blurb and network.*.<id> (text/ui.txt).
export function createNetworkTool(ctx, options) {
  const { world, config } = ctx;
  const { kind, lane = false, street = false, fineGrid = false, hoverRadius = 0.32 } = options;
  const id = options.id ?? kind;
  const layer = world.networks[kind];
  const radius = lane ? LANE_RADIUS : RADIUS[kind] ?? 0.5;
  const cls = `preview ${kind}${lane ? ' lane' : street ? ' street' : ''}`;

  let points = [];   // clicked so far
  let at = null;     // the pointer, snapped
  let refused = null; // the last point it couldn't take, for a moment

  // The pointer snapped: a junction, else a way, else square to the last
  // leg, else as it is.
  const snapPoint = (x, y) => {
    const node = world.ways.nodeNear(x, y, SNAP * Math.max(layer.scale, 0.5));
    if (node) return [node.x, node.y];
    const hit = world.ways.edgeNear(x, y, SNAP * Math.max(layer.scale, 0.5));
    if (hit) return hit.point;
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

  const same = (p, q) => p && q && Math.hypot(p[0] - q[0], p[1] - q[1]) < SAME * Math.max(layer.scale, 0.5);
  const lineThrough = (pts) => (pts.length < 2 ? null : easeBends(pts, radius));

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
    return { line, check: world.checkWay(kind, line, { lane }) };
  };

  // the undo step of the way laid so far (null: nothing laid yet)
  let laidStep = null;
  const history = world.history;
  // Lays the way through `pts`, in place of the one laid at the last click.
  const relay = (pts) => {
    const line = lineThrough(pts);
    if (!line) return false;
    history.commit();
    const mine = laidStep && history.done[history.done.length - 1] === laidStep;
    if (mine && !history.undo().ok) return false;
    const result = world.layWay(kind, line, { lane, street });
    if (result?.ok) {
      history.commit();
      laidStep = history.done[history.done.length - 1] ?? null;
      return true;
    }
    if (mine) history.redo(); // (the way as it was)
    return false;
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
      if (!stroke) return;
      const last = stroke.at(-1);
      if (Math.hypot(x - last[0], y - last[1]) >= 0.04 * unit) stroke.push([x, y]);
    },
    end() {
      if (!stroke) return;
      const raw = stroke;
      stroke = null;
      if (raw.length < 2) return;
      raw[raw.length - 1] = snapPoint(...raw.at(-1));
      // looser and looser, until the bends are ones the kind can take
      for (const tol of [0.12, 0.25, 0.5]) {
        const pts = thin(raw, tol);
        if (pts.length >= 2 && lineThrough(pts) && relay(pts)) { stop(); return; }
      }
      refused = raw.at(-1);
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
        if (n >= 0 && layer.isBlocked(n) && !world.ways.nodeNear(...at, 1e-6)) { refused = at; return; }
        points = [at];
        laidStep = null;
        return;
      }
      if (!relay([...points, at])) { refused = at; return; }
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
      if (stroke) return stroke.length > 1 ? kit.path(stroke, cls, null) : '';
      if (at && !points.length) out += kit.ringAt(...at, hoverRadius * layer.scale);
      for (const p of points) out += kit.ringAt(...p, 0.18 * layer.scale, 'anchor');
      if (refused) out += kit.crossAt(...refused, size);
      const p = plan();
      if (!p) return out;
      out += kit.path(p.line, `${cls}${p.check.ok ? '' : ' invalid'}`, null);
      if (p.sharp) return out + kit.crossAt(...at, size);
      // little crosses along the line itself where it can't go (too steep,
      // water, something in the way) – not on the dots the check went by
      const bad = [...new Set(p.check.blocked ?? [])].map((n) => layer.pos(n));
      if (!bad.length) return out;
      const poly = measurePolyline(p.line), near = MARK_NEAR * Math.max(layer.scale, 0.5);
      for (let d = MARK_STEP / 2; d < poly.total; d += MARK_STEP) {
        const [x, y] = pointAt(poly, d);
        if (bad.some(([bx, by]) => Math.hypot(bx - x, by - y) < near)) out += kit.crossAt(x, y, size * 0.8);
      }
      return out;
    },
  };
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
