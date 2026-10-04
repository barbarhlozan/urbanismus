// Drawing tool for any network layer (roads, footpaths…): click a start dot,
// click an end dot. The route goes diagonal then straight (or the reverse –
// toggle with Tab). If anything blocks it, nothing is built. After a
// successful build the next segment starts from the end point, so lines can
// be chained. Roads come as two tools: roads and single-track lanes
// (`lane`); drawing one over the other converts it.

import { planRoute, validateRoute, BEND } from '../roads/routing.js';
import { isTouch } from '../ui/device.js';
import { t, reasonText } from '../core/text.js';

// options: { kind, id (default: kind), lane (roads: build lanes), group (Build menu group), fineGrid, curve (config key), hoverRadius }
// Its words are tool.<id>, tool.<id>.blurb and network.*.<id> (text/ui.txt).
export function createNetworkTool({ world, config }, options) {
  const { kind, lane = false, fineGrid = false, hoverRadius = 0.32 } = options;
  const id = options.id ?? kind;
  const layer = world.networks[kind];
  const curve = config[options.curve ?? kind];
  const bendName = (b) => t(b === BEND.DIAGONAL_FIRST ? 'bend.diagonal' : 'bend.straight');

  let start = -1;
  let hover = -1;
  let bend = BEND.DIAGONAL_FIRST;

  const flip = () => {
    bend = bend === BEND.DIAGONAL_FIRST ? BEND.STRAIGHT_FIRST : BEND.DIAGONAL_FIRST;
  };

  // Footpath steps on or right beside a road (where a stroke becomes
  // sidewalks): 'road', 'lane' beside a lane (a sidewalk on that side
  // only), 'on-lane' right on one (a sidewalk on the right), or null.
  const streetBeside = (f, g) => {
    const road = world.roadBeside(f, g);
    if (!road) return null;
    if (!world.isLane(...road)) return 'road';
    return world.sideOf(f, g, road) ? 'lane' : 'on-lane';
  };
  const nearAnyRoad = (f) => layer.grid.neighbors(f).some((g) => streetBeside(f, g));
  const sidewalkNote = (plan) => {
    if (kind !== 'path' || !plan?.check.ok) return '';
    const along = plan.nodes.map((n, i) => i > 0 && streetBeside(plan.nodes[i - 1], n));
    const which = ['road', 'lane', 'on-lane'].find((w) => along.includes(w));
    return which ? `${t(`network.sidewalks.${which}`)} · ` : '';
  };
  // Roads and lanes drawn over each other: what changes.
  const convertNote = (plan) => {
    if (kind !== 'road' || !plan?.check.ok) return '';
    const over = plan.nodes.some((n, i) => i > 0 && world.roads.hasEdge(plan.nodes[i - 1], n) && world.isLane(plan.nodes[i - 1], n) !== lane);
    if (!over) return '';
    return `${t(lane ? 'network.narrows' : 'network.widens')} · `;
  };
  const note = (plan) => sidewalkNote(plan) || convertNote(plan);

  const currentPlan = () => {
    if (start < 0 || hover < 0 || hover === start) return null;
    const nodes = planRoute(layer.grid, start, hover, bend);
    return { nodes, check: validateRoute(layer, nodes, { lane }) };
  };

  return {
    id,
    group: options.group,
    blurb: t(`tool.${id}.blurb`),
    label: t(`tool.${id}`),
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
      const result = world.buildNetwork(kind, planRoute(layer.grid, start, node, bend), { lane });
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

    actions: () => [{
      label: `${t('bend')}: ${bendName(bend)}`, icon: bend === BEND.DIAGONAL_FIRST ? 'bend-diagonal' : 'bend-straight', key: 'Tab', run: flip,
    }],
    cancelLabel: () => t(start >= 0 ? `network.stop.${id}` : 'done'),

    hint() {
      if (isTouch()) {
        if (start < 0) return t(`network.tap.${id}`);
        const plan = currentPlan();
        if (!plan) return t('network.tap.end');
        return plan.check.ok ? `${note(plan)}${t('network.tap.build')}` : reasonText(plan.check.reason);
      }
      if (start < 0) {
        const nearRoad = kind === 'path' && hover >= 0 && nearAnyRoad(hover);
        return t(nearRoad ? 'network.start.path.road' : `network.start.${id}`);
      }
      const plan = currentPlan();
      const status = plan && !plan.check.ok ? `${reasonText(plan.check.reason)} · ` : note(plan);
      return status + t('network.end', { bend: bendName(bend) });
    },

    overlay(kit) {
      let out = '';
      if (hover >= 0) out += kit.ringAt(...layer.dot(hover), hoverRadius * layer.scale);
      if (start >= 0) out += kit.ringAt(...layer.dot(start), 0.22 * layer.scale, 'anchor');
      const plan = currentPlan();
      if (!plan) return out;
      const points = plan.nodes.map((n) => layer.pos(n));
      out += kit.path(points, `preview ${kind}${lane ? ' lane' : ''}${plan.check.ok ? '' : ' invalid'}`, curve);
      // a steep-hill sign where it climbs too steeply, a cross for anything else
      const steep = new Set(plan.check.steep ?? []);
      for (const n of new Set(plan.check.blocked)) {
        out += (steep.has(n) ? kit.steepAt : kit.crossAt).call(kit, ...layer.pos(n), 0.16 * Math.sqrt(layer.scale));
      }
      return out;
    },
  };
}
