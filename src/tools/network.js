// Drawing tool for any network layer (roads, footpaths…): click a start dot,
// click an end dot. The route goes diagonal then straight (or the reverse –
// toggle with Tab). If anything blocks it, nothing is built. After a
// successful build the next segment starts from the end point, so lines can
// be chained. Roads come as two tools: roads and single-track lanes
// (`lane`); drawing one over the other converts it.

import { planRoute, validateRoute, BEND } from '../roads/routing.js';
import { t } from '../core/text.js';

// options: { kind, id (default: kind), lane (roads: build lanes), group (Build menu group), fineGrid, curve (config key), hoverRadius }
// Its words are tool.<id>, tool.<id>.blurb and network.*.<id> (text/ui.txt).
export function createNetworkTool(ctx, options) {
  const { world, config } = ctx;
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

  const overWater = (n) => world.terrain.isWater(world.grid.nodeAt(...layer.dot(n)));

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

    overlay(kit) {
      let out = '';
      // the ring where it can start or end; where something's built, a
      // no-entry sign instead (on water, nothing: a bridge may cross it)
      if (hover >= 0 && !layer.isBlocked(hover)) out += kit.ringAt(...layer.dot(hover), hoverRadius * layer.scale);
      else if (hover >= 0 && !overWater(hover)) out += kit.noEntryAt(...layer.dot(hover), 0.2 * Math.sqrt(layer.scale));
      if (start >= 0) out += kit.ringAt(...layer.dot(start), 0.22 * layer.scale, 'anchor');
      const plan = currentPlan();
      if (!plan) return out;
      const points = plan.nodes.map((n) => layer.pos(n));
      out += kit.path(points, `preview ${kind}${lane ? ' lane' : ''}${plan.check.ok ? '' : ' invalid'}`, curve);
      // a steep-hill sign where it climbs too steeply, the no-entry sign
      // where something's built, a cross for anything else
      const steep = new Set(plan.check.steep ?? []);
      for (const n of new Set(plan.check.blocked)) {
        const size = 0.16 * Math.sqrt(layer.scale);
        if (steep.has(n)) out += kit.steepAt(...layer.pos(n), size);
        else if (layer.isBlocked(n) && !overWater(n)) out += kit.noEntryAt(...layer.pos(n), 0.2 * Math.sqrt(layer.scale));
        else out += kit.crossAt(...layer.pos(n), size);
      }
      return out;
    },
  };
}
