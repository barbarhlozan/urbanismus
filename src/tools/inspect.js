// Default tool: click a building, road or feature to get a menu of what can
// be done with it. Building new things is done from the Build menu.

import { STRUCTURES, STRUCTURE_TYPES, categoryOf, yardOf } from '../../structures/index.js';
import { YARDS, YARD_STYLES } from '../../structures/yards.js';
import { FEATURE_TYPES } from '../../features/index.js';
import { isTouch } from '../ui/device.js';
import { UNLOCKS } from '../story/unlocks.js';
import { statIcon } from '../ui/icons.js';

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

// The building at a glance: what it is and its numbers with their little
// drawings (as in the HUD), and a warning when nothing reaches it.
function summary(def, served) {
  const stats = Object.entries(def.stats ?? {}).map(([k, v]) =>
    `<span class="stat" title="${k[0].toUpperCase()}${k.slice(1)}">${statIcon(k)}<b>${v}</b></span>`);
  let html = `<div class="bi-row"><span class="bi-kind">${esc(def.blurb ?? def.name)}</span>${stats.join('')}</div>`;
  if (!served) {
    html += `<div class="bi-row warn"><span class="stat">${statIcon('cutoff')}${def.access === 'any' ? 'Needs a road or footpath' : 'Needs a road next to it'}</span></div>`;
  }
  return html;
}

function structureMenu({ world }, s, nav) {
  const def = STRUCTURE_TYPES[s.type];

  // turning it into something else of the same kind (a house into
  // apartments, a plaza into a fountain square): only what fits here, and
  // may be built (src/story/unlocks.js)
  const converts = STRUCTURES
    .filter((other) => other.id !== s.type && categoryOf(other) === categoryOf(def) && world.canConvert(s.id, other.id).ok
      && UNLOCKS.allows(other.id))
    .map((other) => ({ label: other.name, note: other.size, action: () => world.convertStructure(s.id, other.id) }));

  // the second page: just those, and the way back
  if (nav.page === 'convert' && converts.length) {
    return {
      title: def.name,
      items: [
        { label: '‹ Back', keepOpen: true, action: () => { nav.page = 'main'; } },
        { section: 'Turn into' },
        ...converts,
      ],
    };
  }

  // what it is: to look at, not to click
  const items = [{ block: summary(def, world.isServed(s)) }];

  // changing how it looks, or into what
  items.push({ section: 'Change' });
  items.push({ label: 'Change look', keepOpen: true, action: () => world.restyleStructure(s.id) });

  // Surroundings: cycles automatic -> each style -> none -> automatic.
  if (def.yards?.length) {
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

  return { title: def.name, items };
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
