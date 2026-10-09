// Default tool: click a building, road or feature to get a menu of what can
// be done with it. Building new things is done from the Build menu.

import { STRUCTURES, STRUCTURE_TYPES, categoryOf, yardOf, kindsOf, kindShown } from '../../structures/index.js';
import { YARDS, YARD_STYLES } from '../../structures/yards.js';
import { FEATURE_TYPES } from '../../features/index.js';
import { isTouch } from '../ui/device.js';
import { UNLOCKS } from '../story/unlocks.js';
import { statIcon } from '../ui/icons.js';
import { t, hasText } from '../core/text.js';
import { nameOf, blurbOf, sizeOf } from '../ui/names.js';

// names of the surroundings and of what grows on the map (yard.<id>,
// feature.<id>), else their own
const named = (key, fallback) => (hasText(key) ? t(key) : fallback);
const yardName = (id) => named(`yard.${id}`, YARDS[id].name);
const featureName = (type) => named(`feature.${type}`, FEATURE_TYPES[type].name);

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function createInspectTool(ctx) {
  // which page of a building's menu is showing: its own, or 'convert' (the
  // types it can turn into); every new click starts on its own
  const nav = { page: 'main' };
  return {
    id: 'inspect',
    label: t('tool.select'),
    toolbar: false, // it's what you're in when no tool is picked

    hint: () => t(isTouch() ? 'select.tap' : 'select.click'),

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

    // No mark of its own under the pointer: a building's name over it is
    // enough (the hover label, ui/annotations.js).
    cursor: () => '',
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

// The building at a glance: what it is and its numbers in words, as in the
// town's panel ("8 jobs"), and a warning when nothing reaches it.
function summary(def, served) {
  const stats = Object.entries(def.stats ?? {}).map(([k, v]) =>
    `<span class="stat words">${esc(t(`stat.${k}.n`, { n: v })).replace(String(v), `<b>${v}</b>`)}</span>`);
  let html = `<div class="bi-row"><span class="bi-kind">${esc(blurbOf(def) || nameOf(def))}</span>${stats.join('')}</div>`;
  if (!served) {
    html += `<div class="bi-row warn"><span class="stat">${statIcon('cutoff')}${t(def.access === 'any' ? 'inspect.needs.any' : 'inspect.needs.road')}</span></div>`;
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
    .map((other) => ({ label: nameOf(other), note: other.size ? sizeOf(other) : '', action: () => world.convertStructure(s.id, other.id) }));

  // the second page: just those, and the way back
  if (nav.page === 'convert' && converts.length) {
    return {
      title: nameOf(def),
      items: [
        { label: `‹ ${t('back')}`, keepOpen: true, action: () => { nav.page = 'main'; } },
        { section: t('inspect.turn-into') },
        ...converts,
      ],
    };
  }

  // what it is: to look at, not to click
  const items = [{ block: summary(def, world.isServed(s)) }];

  // changing how it looks – its next kind, in the order Space goes through
  // them while building (tools/build.js) – or into what
  const kinds = kindsOf(def);
  const nextKind = () => kinds[(kinds.indexOf(kindShown(def, s)) + 1) % kinds.length];
  items.push({ label: t('inspect.change-look'), keepOpen: true, action: () => world.restyleStructure(s.id, kinds.length > 1 ? nextKind() : null) });

  // Surroundings: cycles automatic -> each style -> none -> automatic.
  if (def.yards?.length) {
    const choice = s.data.yard ?? 'auto';
    const cars = world.accessInfo(s) !== null; // no car park without a road
    const current = yardOf(def, s, { cars });
    const none = t('inspect.yard.none');
    // (left to itself, it just says what it has)
    const note = choice === 'auto' ? (current ? yardName(current) : none) : choice === 'none' ? none : yardName(choice);
    const order = ['auto', ...YARD_STYLES.filter((y) => cars || !YARDS[y].cars || y === choice), 'none'];
    const next = order[(order.indexOf(choice) + 1) % order.length];
    items.push({ label: t('inspect.yard'), note, keepOpen: true, action: () => world.setYard(s.id, next === 'auto' ? null : next) });
  }
  if (converts.length) items.push({ label: `${t('inspect.turn-into')}…`, note: '›', keepOpen: true, action: () => { nav.page = 'convert'; } });

  items.push({ section: '' }, { label: t('inspect.demolish'), action: () => world.removeStructure(s.id) });

  return { title: nameOf(def), items };
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
  const fence = world.fences.hasNode(fine);

  // Building is done from the Build menu; here only what's already there.
  const items = [];
  const lane = road && world.laneOnly(node);
  if (road) items.push({ label: t(lane ? 'inspect.remove.lane' : 'inspect.remove.road'), action: () => world.removeRoadAt(node) });
  if (rail) items.push({ label: t('inspect.remove.rail'), action: () => world.removeNetworkAt('rail', fine) });
  if (path) items.push({ label: t('inspect.remove.path'), action: () => world.removeNetworkAt('path', fine) });
  if (fence) items.push({ label: t('inspect.remove.fence'), action: () => world.removeNetworkAt('fence', fine) });
  if (feature) items.push({ label: t(`inspect.clear.${feature.type}`), action: () => world.removeFeature(feature.id) });
  if (!items.length) return null; // empty ground or water: no menu

  const title = road && rail ? t('inspect.crossing') : lane ? t('tool.lane') : road ? t('tool.road') : rail ? t('tool.rail')
    : path ? t('tool.path') : fence ? t('tool.fence') : featureName(feature.type);
  return { title, items };
}
