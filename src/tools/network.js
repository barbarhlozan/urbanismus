// Drawing tool for any network layer (roads, footpaths…): click a start dot,
// click an end dot. The route goes diagonal then straight (or the reverse –
// toggle with Tab). If anything blocks it, nothing is built. After a
// successful build the next segment starts from the end point, so lines can
// be chained.

import { planRoute, validateRoute, BEND } from '../roads/routing.js';
import { isTouch } from '../ui/device.js';

// options: { kind, label, hotkey, fineGrid, curve (config key), hoverRadius }
export function createNetworkTool({ world, config }, options) {
  const { kind, label, hotkey, fineGrid = false, hoverRadius = 0.32 } = options;
  const layer = world.networks[kind];
  const curve = config[options.curve ?? kind];
  const noun = label.toLowerCase();

  let start = -1;
  let hover = -1;
  let bend = BEND.DIAGONAL_FIRST;

  const flip = () => {
    bend = bend === BEND.DIAGONAL_FIRST ? BEND.STRAIGHT_FIRST : BEND.DIAGONAL_FIRST;
  };

  // Footpath dots on or right beside a road (where a stroke becomes sidewalks).
  const nearAnyRoad = (f) => layer.grid.neighbors(f).some((g) => world.roadBeside(f, g));
  const sidewalkNote = (plan) => {
    if (kind !== 'path' || !plan?.check.ok) return '';
    const along = plan.nodes.some((n, i) => i > 0 && world.roadBeside(plan.nodes[i - 1], n));
    return along ? 'Along the road it becomes sidewalks · ' : '';
  };

  const currentPlan = () => {
    if (start < 0 || hover < 0 || hover === start) return null;
    const nodes = planRoute(layer.grid, start, hover, bend);
    return { nodes, check: validateRoute(layer, nodes) };
  };

  return {
    id: kind,
    label,
    hotkey,
    fineGrid,
    // the start dot is set with one tap; the end dot needs a confirming tap
    touchConfirm: () => start >= 0,

    snap: (x, y) => layer.nodeAt(x, y),

    enter(params) {
      start = params.start ?? -1;
    },

    exit() {
      start = -1;
    },

    hover(node) {
      hover = node;
    },

    click(node) {
      if (node < 0) return;
      if (start < 0) {
        if (!layer.isBlocked(node)) start = node;
        return;
      }
      if (node === start) {
        start = -1;
        return;
      }
      const result = world.buildNetwork(kind, planRoute(layer.grid, start, node, bend));
      if (result.ok) start = node;
    },

    cancel() {
      if (start < 0) return false;
      start = -1;
      return true;
    },

    key(e) {
      if (e.key === 'Tab') {
        flip();
        return true;
      }
      return false;
    },

    actions: () => [{ label: `Bend: ${bend}`, key: 'Tab', run: flip }],
    cancelLabel: () => (start >= 0 ? `Stop ${noun}` : 'Done'),

    hint() {
      if (isTouch()) {
        if (start < 0) return `Tap a dot to start a ${noun} · draw along a road to give it sidewalks`;
        const plan = currentPlan();
        if (!plan) return 'Tap where it should end';
        return plan.check.ok ? 'Tap again to build' : plan.check.reason;
      }
      if (start < 0) {
        const nearRoad = kind === 'path' && hover >= 0 && nearAnyRoad(hover);
        return nearRoad ? 'Draw along a road to give it sidewalks' : `Click a dot to start a ${noun}`;
      }
      const plan = currentPlan();
      const status = plan && !plan.check.ok ? `${plan.check.reason} · ` : sidewalkNote(plan);
      return `${status}Click to end · Tab: ${bend} · right-click to stop`;
    },

    overlay(kit) {
      let out = '';
      if (hover >= 0) out += kit.ringAt(...layer.dot(hover), hoverRadius * layer.scale);
      if (start >= 0) out += kit.ringAt(...layer.dot(start), 0.22 * layer.scale, 'anchor');
      const plan = currentPlan();
      if (!plan) return out;
      const points = plan.nodes.map((n) => layer.pos(n));
      out += kit.path(points, `preview ${kind}${plan.check.ok ? '' : ' invalid'}`, curve);
      for (const n of new Set(plan.check.blocked)) out += kit.crossAt(...layer.pos(n), 0.16 * Math.sqrt(layer.scale));
      return out;
    },
  };
}
