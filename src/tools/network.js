// Drawing tool for any kind of way (roads, footpaths, railways, fences),
// point by point (docs/free-placement-plan.md, stage C): click where it
// starts, click along, and click the last point again (or double-click)
// to lay it. The points become a smooth curve, its bends eased to what the
// kind can take (curves.js easeBends); a point it can't take is refused.
// Points snap onto a junction or a way near them, and a little to the
// way's own line and square off it. If anything blocks it, nothing is
// built; a cross marks where. After laying, the next way starts from its
// end, so ways can be chained; clicking that point again stops. Roads
// come as three tools: streets with sidewalks and lamps (`street`), roads
// and single-track lanes (`lane`); drawing one over another converts it.

import { easeBends } from '../roads/curves.js';
import { t } from '../core/text.js';

// The tightest bend each kind takes (radius, world units).
const RADIUS = { road: 1, path: 0.3, rail: 2.5, fence: 0.15 };
const LANE_RADIUS = 0.7;
const SNAP = 0.35;               // onto a junction or a way
const ANGLE_SNAP = Math.PI / 30; // 6°: onto the last leg's line, or square to it
const SAME = 0.3;                // a click this near the last point lays the way

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
    return { line, check: world.checkWay(kind, line, { lane }) };
  };

  const lay = () => {
    const line = lineThrough(points);
    const result = line && world.layWay(kind, line, { lane, street });
    if (result?.ok) points = [points[points.length - 1]];
    else refused = points[points.length - 1];
  };

  return {
    id,
    group: options.group,
    blurb: t(`tool.${id}.blurb`),
    label: t(`tool.${id}`),
    fineGrid,
    // a point is set with one tap; the next needs a confirming tap
    touchConfirm: () => points.length > 0,

    snap(x, y) {
      at = snapPoint(x, y);
      return layer.nodeAt(...at);
    },

    enter() {
      points = [];
    },

    exit() {
      points = [];
    },

    hover() {},

    click() {
      if (!at) return;
      refused = null;
      const last = points[points.length - 1];
      if (same(at, last)) {
        // the last point again: lay it (or, from a way just laid, stop)
        if (points.length >= 2) lay();
        else points = [];
        return;
      }
      if (!points.length) {
        const n = layer.nodeAt(...at);
        if (n >= 0 && layer.isBlocked(n) && !world.ways.nodeNear(...at, 1e-6)) { refused = at; return; }
        points = [at];
        return;
      }
      if (!lineThrough([...points, at])) { refused = at; return; }
      points = [...points, at];
    },

    cancel() {
      if (!points.length) return false;
      points = [];
      return true;
    },

    cancelLabel: () => t(points.length ? `network.stop.${id}` : 'done'),

    overlay(kit) {
      let out = '';
      const size = 0.16 * Math.sqrt(layer.scale);
      if (at && !points.length) out += kit.ringAt(...at, hoverRadius * layer.scale);
      for (const p of points) out += kit.ringAt(...p, 0.18 * layer.scale, 'anchor');
      if (refused) out += kit.crossAt(...refused, size);
      const p = plan();
      if (!p) return out;
      out += kit.path(p.line, `${cls}${p.check.ok ? '' : ' invalid'}`, null);
      if (p.sharp) return out + kit.crossAt(...at, size);
      // a steep-hill sign where it climbs too steeply, a cross for anything else
      const steep = new Set(p.check.steep ?? []);
      for (const n of new Set(p.check.blocked)) {
        if (steep.has(n)) out += kit.steepAt(...layer.pos(n), size);
        else out += kit.crossAt(...layer.dot(n), size);
      }
      return out;
    },
  };
}
