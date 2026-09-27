// Default tool: click a building, road or feature to get a menu of what can
// be done with it. Building new things is done from the Build menu.

import { STRUCTURES, STRUCTURE_TYPES, levelOf, maxLevel, categoryOf, yardOf } from '../../structures/index.js';
import { YARDS, YARD_STYLES } from '../../structures/yards.js';
import { FEATURE_TYPES } from '../../features/index.js';
import { isTouch } from '../ui/device.js';

export function createInspectTool(ctx) {
  return {
    id: 'inspect',
    label: 'Select',
    hotkey: 'v',
    toolbar: false, // it's what you're in when no tool is picked

    hint: () => isTouch()
      ? 'Tap the map · drag to pan · pinch to zoom'
      : 'Click the map · right-click: build more of what’s there · drag to pan · scroll to zoom · Q / E rotate',

    click(node, event) {
      const menu = node < 0 ? null : menuFor(ctx, node);
      if (!menu) return ctx.popup.hide();
      const around = screenBox(ctx, node);
      ctx.popup.show(event.clientX, event.clientY, menu.title, menu.items, () => menuFor(ctx, node), around);
    },

    exit() {
      ctx.popup.hide();
    },

    // A ring only over something that can be clicked: around a building's
    // whole footprint, or on a road, railway, footpath or tree dot.
    cursor(kit, node) {
      if (node < 0) return '';
      const { world } = ctx;
      const s = world.structureAt(node);
      if (s) {
        const pts = world.nodesOf(s).map((n) => world.grid.xy(n));
        const span = (i) => Math.max(...pts.map((p) => p[i])) - Math.min(...pts.map((p) => p[i])) + 1;
        return kit.ringAt(...world.centerOf(s), Math.max(span(0), span(1)) / 2 + 0.15);
      }
      const something = world.hasRoad(node) || world.hasRail(node) || world.featureAt(node) || world.paths.hasNode(world.coarseToFine(node));
      return something ? kit.ring(node, 0.32) : '';
    },
  };
}

// Screen box around what was clicked (a building's whole footprint and some
// height, or the one dot), so the menu can open beside it, not over it.
const HEIGHT = 2.5; // in tiles; enough for most buildings
function screenBox({ world, camera }, node) {
  const s = world.structureAt(node);
  const nodes = s ? world.nodesOf(s) : [node];
  const z = s ? HEIGHT : 0.5;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const n of nodes) {
    const [x, y] = world.grid.xy(n);
    for (const [dx, dy] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
      for (const h of [0, z]) {
        const [sx, sy] = camera.project(x + dx, y + dy, h);
        const cx = sx * camera.zoom + camera.panX, cy = sy * camera.zoom + camera.panY;
        left = Math.min(left, cx); right = Math.max(right, cx);
        top = Math.min(top, cy); bottom = Math.max(bottom, cy);
      }
    }
  }
  return { left, top, right, bottom };
}

const TREND = {
  growing: 'Growing',
  declining: 'Declining',
  stable: 'Stable',
  waiting: 'Waiting',
  manual: 'Set by hand',
};

function structureMenu({ world, growth }, s) {
  const def = STRUCTURE_TYPES[s.type];
  const level = levelOf(def, s);
  const max = maxLevel(def);
  const { trend, missing, keep, boosts, progress } = growth.explain(s);
  const pct = (trend === 'growing' || trend === 'declining') && progress > 0.005 ? ` ${Math.round(progress * 100)}%` : '';

  const items = [
    { label: `Level ${s.level} of ${max}`, note: TREND[trend] + pct, info: true },
    ...Object.entries(level.stats ?? {}).map(([k, v]) => ({ label: k, note: String(v), info: true })),
  ];
  if (level.coverage) items.push({ label: 'Service area', note: `${level.coverage} dots`, info: true });
  if (!world.isServed(s)) {
    items.push({ label: def.access === 'any' ? 'Needs a road or footpath' : 'Needs a road next to it', info: true });
  } else if (missing.length && trend !== 'manual') {
    items.push({ label: keep ? 'To keep this level it needs' : 'Next level needs', info: true });
    for (const m of missing) items.push({ label: `· ${m}`, info: true });
  }
  for (const b of boosts) items.push({ label: `${b[0].toUpperCase()}${b.slice(1)} nearby`, note: 'faster growth', info: true });

  if (s.level < max) items.push({ label: 'Upgrade', note: def.levels[s.level].name, action: () => world.setStructureLevel(s.id, s.level + 1, { manual: true }) });
  if (s.level > 1) items.push({ label: 'Downgrade', note: def.levels[s.level - 2].name, action: () => world.setStructureLevel(s.id, s.level - 1, { manual: true }) });
  if (s.data.locked) items.push({ label: 'Let it grow on its own', action: () => world.setGrowthLocked(s.id, false) });
  items.push({ label: 'Change look', keepOpen: true, action: () => world.restyleStructure(s.id) });

  // Surroundings: cycles automatic -> each style -> none -> automatic.
  if (def.levels.some((l) => l.yards?.length)) {
    const choice = s.data.yard ?? 'auto';
    const cars = world.accessInfo(s) !== null; // no car park without a road
    const current = yardOf(def, s, { cars });
    const note = choice === 'auto' ? `Auto · ${current ? YARDS[current].name : 'none'}` : choice === 'none' ? 'None' : YARDS[choice].name;
    const order = ['auto', ...YARD_STYLES.filter((y) => cars || !YARDS[y].cars || y === choice), 'none'];
    const next = order[(order.indexOf(choice) + 1) % order.length];
    items.push({ label: 'Surroundings', note, keepOpen: true, action: () => world.setYard(s.id, next === 'auto' ? null : next) });
  }

  for (const other of STRUCTURES) {
    if (other.id === s.type || categoryOf(other) !== categoryOf(def)) continue;
    const check = world.canConvert(s.id, other.id);
    items.push({
      label: `Convert to ${other.name.toLowerCase()}`,
      note: check.ok ? '' : check.reason,
      disabled: !check.ok,
      action: () => world.convertStructure(s.id, other.id),
    });
  }
  items.push({ label: 'Erase', action: () => world.removeStructure(s.id) });

  return { title: `${def.name} · ${level.name}`, items };
}

function menuFor(ctx, node) {
  const { world } = ctx;
  const s = world.structureAt(node);
  if (s) return structureMenu(ctx, s);

  const feature = world.featureAt(node);
  const road = world.hasRoad(node);
  const rail = world.hasRail(node);
  const fine = world.coarseToFine(node);
  const path = world.paths.hasNode(fine);

  // Building is done from the Build menu; here only what's already there.
  const items = [];
  const lane = road && world.laneOnly(node);
  if (road) items.push({ label: lane ? 'Remove lane' : 'Remove road', action: () => world.removeRoadAt(node) });
  if (rail) items.push({ label: 'Remove railway', action: () => world.removeNetworkAt('rail', fine) });
  if (path) items.push({ label: 'Remove footpath', action: () => world.removeNetworkAt('path', fine) });
  if (feature) items.push({ label: `Clear ${FEATURE_TYPES[feature.type].name.toLowerCase()}`, action: () => world.removeFeature(feature.id) });
  if (!items.length) return null; // empty ground or water: no menu

  const title = road && rail ? 'Level crossing' : lane ? 'Lane' : road ? 'Road' : rail ? 'Railway' : path ? 'Footpath' : feature ? FEATURE_TYPES[feature.type].name : 'Empty lot';
  return { title, items };
}
