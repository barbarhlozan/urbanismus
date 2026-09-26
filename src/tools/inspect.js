// Default tool: click a dot to get a context menu of what can be done there.

import { STRUCTURES, STRUCTURE_TYPES, CATEGORIES, levelOf, maxLevel, categoryOf, yardOf } from '../../structures/index.js';
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
      : 'Click the map · right-click: build menu · drag to pan · scroll to zoom · Q / E rotate',

    click(node, event) {
      if (node < 0) return ctx.popup.hide();
      const { title, items } = menuFor(ctx, node);
      ctx.popup.show(event.clientX, event.clientY, title, items, () => menuFor(ctx, node));
    },

    exit() {
      ctx.popup.hide();
    },
  };
}

// keyboard shortcuts as menu notes, left out on touch screens
const key = (k) => (isTouch() ? '' : k);

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
    const current = yardOf(def, s);
    const note = choice === 'auto' ? `Auto · ${current ? YARDS[current].name : 'none'}` : choice === 'none' ? 'None' : YARDS[choice].name;
    const order = ['auto', ...YARD_STYLES, 'none'];
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
  const { world, tools } = ctx;
  const s = world.structureAt(node);
  if (s) return structureMenu(ctx, s);

  if (world.terrain.isWater(node)) {
    return { title: 'Water', items: [{ label: 'Nothing to build here', info: true }] };
  }

  const feature = world.featureAt(node);
  const road = world.hasRoad(node);
  const rail = world.hasRail(node);
  const fine = world.coarseToFine(node);
  const path = world.paths.hasNode(fine);

  // What fits here, by category; what doesn't is listed greyed out at the bottom.
  const items = [];
  const unavailable = [];
  for (const cat of CATEGORIES) {
    const fits = [];
    for (const def of STRUCTURES.filter((d) => categoryOf(d) === cat.id)) {
      // types with their own rule (stations) may need turning to fit
      const tries = def.canPlace ? [0, 1, 2, 3] : [0];
      const at = tries.map((r) => world.placementFor(def.id, node, r)).find((p) => p.check.ok) ?? world.placementFor(def.id, node, 0);
      if (!at.check.ok) {
        unavailable.push({ label: def.name, note: at.check.reason, disabled: true, unavailable: true });
        continue;
      }
      fits.push({ label: def.name, note: key(def.hotkey), action: () => world.placeStructure(def.id, at.node, { rotation: at.rotation }) });
    }
    if (fits.length) items.push({ label: cat.label, info: true, heading: true }, ...fits);
  }
  items.push({ label: 'Lines', info: true, heading: true });
  items.push({ label: 'Road from here', note: key('R'), action: () => tools.use('road', { start: node }) });
  items.push({ label: 'Footpath from here', note: key('F'), action: () => tools.use('path', { start: fine }) });
  items.push({ label: 'Railway from here', note: key('L'), action: () => tools.use('rail', { start: node }) });
  if (road) items.push({ label: 'Remove road', action: () => world.removeRoadAt(node) });
  if (rail) items.push({ label: 'Remove railway', action: () => world.removeNetworkAt('rail', node) });
  if (path) items.push({ label: 'Remove footpath', action: () => world.removeNetworkAt('path', fine) });
  if (feature) items.push({ label: `Clear ${FEATURE_TYPES[feature.type].name.toLowerCase()}`, action: () => world.removeFeature(feature.id) });
  if (unavailable.length) items.push({ label: 'Doesn’t fit here', info: true, heading: true }, ...unavailable);

  const title = road && rail ? 'Level crossing' : road ? 'Road' : rail ? 'Railway' : path ? 'Footpath' : feature ? FEATURE_TYPES[feature.type].name : 'Empty lot';
  return { title, items };
}
