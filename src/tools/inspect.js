// Default tool: click a building, road or feature to get a menu of what can
// be done with it. Building new things is done from the Build menu.

import { STRUCTURES, STRUCTURE_TYPES, levelOf, maxLevel, categoryOf, yardOf, matches, nameOf } from '../../structures/index.js';
import { YARDS, YARD_STYLES } from '../../structures/yards.js';
import { FEATURE_TYPES } from '../../features/index.js';
import { isTouch } from '../ui/device.js';
import { statIcon, structureIcon } from '../ui/icons.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function createInspectTool(ctx) {
  // which page of a building's menu is showing: its own, or 'convert' (the
  // types it can turn into); every new click starts on its own
  const nav = { page: 'main' };
  return {
    id: 'inspect',
    label: 'Select',
    toolbar: false, // it's what you're in when no tool is picked

    hint: () => isTouch()
      ? 'Tap the map · drag to pan · pinch to zoom'
      : 'Click the map · right-click: build more of what’s there · drag to pan · scroll to zoom · [ / ] rotate',

    click(node, event) {
      nav.page = 'main';
      const menu = node < 0 ? null : menuFor(ctx, node, nav);
      if (!menu) return ctx.popup.hide();
      const around = screenBox(ctx, node);
      ctx.popup.show(event.clientX, event.clientY, menu.title, menu.items, () => menuFor(ctx, node, nav), around);
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
  growing: 'growing',
  declining: 'declining',
  waiting: 'waiting',
  manual: 'set by hand',
};

// The building at a glance, drawn rather than listed: its level as pips,
// whether it's growing, its numbers with their little drawings (as in the
// HUD), and what it still needs, each shown by a drawing of that building.
function summary(def, s, level, max, { trend, needs, keep, boosts, progress }, served) {
  const pips = Array.from({ length: max }, (_, i) => `<i class="${i < s.level ? 'on' : ''}"></i>`).join('');
  const moving = trend === 'growing' || trend === 'declining';
  const bar = moving && progress > 0.005 ? `<span class="bi-bar"><i style="width:${Math.round(progress * 100)}%"></i></span>` : '';
  const arrow = trend === 'growing' ? '↗ ' : trend === 'declining' ? '↘ ' : '';
  const stats = Object.entries(level.stats ?? {}).map(([k, v]) =>
    `<span class="stat" title="${k[0].toUpperCase()}${k.slice(1)}">${statIcon(k)}<b>${v}</b></span>`);
  if (level.coverage) stats.push(`<span class="stat" title="Serves everything within ${level.coverage} dots">${statIcon('area')}<b>${level.coverage}</b></span>`);
  let html = `<div class="bi-row"><span class="bi-kind">${esc(def.name)}</span>`
    + `<span class="bi-level" title="Level ${s.level} of ${max}">${pips}</span>${stats.join('')}`
    // (stable, the usual state, goes unsaid)
    + (TREND[trend] ? `<span class="bi-trend ${trend}">${arrow}${TREND[trend]}${bar}</span>` : '') + '</div>';

  if (!served) {
    html += `<div class="bi-row warn"><span class="stat">${statIcon('cutoff')}${def.access === 'any' ? 'Needs a road or footpath' : 'Needs a road next to it'}</span></div>`;
  } else if (needs.length && trend !== 'manual') {
    html += `<div class="bi-needs"><span>${keep ? 'To stay' : 'To grow'}</span>${needs.map(need).join('')}</div>`;
  }
  if (boosts.length) html += `<div class="bi-boost">${boosts.map((b) => `${esc(b[0].toUpperCase() + b.slice(1))} nearby`).join(', ')} · growing faster</div>`;
  return html;
}

// One thing a building needs: a drawing of what's asked for, how many more
// (or none of it, crossed out), the details on hover.
function need(n) {
  const def = STRUCTURES.find((d) => matches(d, n.type));
  const pic = `<span class="bi-pic">${def ? structureIcon(def) : ''}</span>`;
  const name = nameOf(n.type);
  if (n.kind === 'more') {
    const title = `${n.count} more ${name}${n.minLevel > 1 ? ` of level ${n.minLevel} or up` : ''} within ${n.radius} dots`;
    return `<span class="bi-need" title="${esc(title)}">${pic}<b>+${n.count}</b>${n.minLevel > 1 ? `<small>L${n.minLevel}+</small>` : ''}</span>`;
  }
  if (n.kind === 'avoid') return `<span class="bi-need avoid" title="${esc(`No ${name} within ${n.radius} dots`)}">${pic}</span>`;
  return `<span class="bi-need" title="${esc(`Within reach of a ${name}`)}">${pic}<small>in reach</small></span>`;
}

function structureMenu({ world, growth }, s, nav) {
  const def = STRUCTURE_TYPES[s.type];
  const level = levelOf(def, s);
  const max = maxLevel(def);
  const why = growth.explain(s);

  // turning it into something else of the same kind: only what fits here
  const converts = STRUCTURES
    .filter((other) => other.id !== s.type && categoryOf(other) === categoryOf(def) && world.canConvert(s.id, other.id).ok)
    .map((other) => ({ label: other.name, action: () => world.convertStructure(s.id, other.id) }));

  // the second page: just those, and the way back
  if (nav.page === 'convert' && converts.length) {
    return {
      title: level.name,
      items: [
        { label: '‹ Back', keepOpen: true, action: () => { nav.page = 'main'; } },
        { section: 'Turn into' },
        ...converts,
      ],
    };
  }

  // what it is and how it's doing: to look at, not to click
  const items = [{ block: summary(def, s, level, max, why, world.isServed(s)) }];

  // making it bigger or smaller, or changing how it looks
  items.push({ section: 'Change' });
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
  if (converts.length) items.push({ label: 'Turn into…', note: '›', keepOpen: true, action: () => { nav.page = 'convert'; } });

  items.push({ section: '' }, { label: 'Erase', action: () => world.removeStructure(s.id) });

  return { title: level.name, items };
}

function menuFor(ctx, node, nav = { page: 'main' }) {
  const { world } = ctx;
  const s = world.structureAt(node);
  if (s) return structureMenu(ctx, s, nav);

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
