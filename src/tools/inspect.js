// Default tool: click a building, road or feature to get a menu of what can
// be done with it. Building new things is done from the Build menu.

import { STRUCTURES, STRUCTURE_TYPES, levelOf, maxLevel, categoryOf, yardOf, matches, nameOf } from '../../structures/index.js';
import { YARDS, YARD_STYLES } from '../../structures/yards.js';
import { FEATURE_TYPES } from '../../features/index.js';
import { isTouch } from '../ui/device.js';
import { UNLOCKS } from '../story/unlocks.js';
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

// The building at a glance: its level as pips, its numbers with their
// little drawings (as in the HUD); then, in words, where it's going – what
// it's growing into (or shrinking back to) and how far along it is – and
// what it still needs to become the next level, a line each, with a
// drawing of what's asked for. (Staying as it is, the usual, goes unsaid.)
function summary(def, s, level, max, { trend, needs, keep, boosts, progress }, served) {
  const pips = Array.from({ length: max }, (_, i) => `<i class="${i < s.level ? 'on' : ''}"></i>`).join('');
  const stats = Object.entries(level.stats ?? {}).map(([k, v]) =>
    `<span class="stat" title="${k[0].toUpperCase()}${k.slice(1)}">${statIcon(k)}<b>${v}</b></span>`);
  if (level.coverage) stats.push(`<span class="stat" title="Serves everything within ${level.coverage} dots">${statIcon('area')}<b>${level.coverage}</b></span>`);
  let html = `<div class="bi-row"><span class="bi-kind">${esc(def.name)}</span>`
    + `<span class="bi-level" title="Level ${s.level} of ${max}">${pips}</span>${stats.join('')}</div>`;

  const name = (l) => def.levels[l - 1]?.name.toLowerCase();
  const pct = Math.min(99, Math.round(progress * 100));
  const bar = (title) => `<span class="bi-bar" title="${esc(title)}"><i style="width:${pct}%"></i></span><span class="bi-pct">${pct}%</span>`;
  if (served && trend === 'growing' && name(s.level + 1)) {
    html += `<div class="bi-trend growing"><span>Growing into ${esc(name(s.level + 1))}</span>${bar(`${pct}% of the way to becoming ${name(s.level + 1)}`)}</div>`;
  } else if (trend === 'declining' && name(s.level - 1)) {
    html += `<div class="bi-trend declining"><span>Shrinking back to ${esc(name(s.level - 1))}</span>${bar(`${pct}% of the way back to ${name(s.level - 1)}`)}</div>`;
  } else if (trend === 'manual') {
    html += `<div class="bi-trend"><span>Set by hand: it stays as it is</span></div>`;
  }

  if (!served) {
    html += `<div class="bi-row warn"><span class="stat">${statIcon('cutoff')}${def.access === 'any' ? 'Needs a road or footpath' : 'Needs a road next to it'}</span></div>`;
  } else if (needs.length && trend !== 'manual') {
    const next = def.levels[s.level]?.name;
    const head = keep ? `To stay ${level.name.toLowerCase()}, it needs` : next ? `To become ${next.toLowerCase()}, it needs` : 'To grow, it needs';
    html += `<div class="bi-needs"><span class="bi-head">${esc(head)}</span>${needs.map(need).join('')}</div>`;
  }
  if (boosts.length) {
    const near = boosts.map((b) => NOUNS[b]?.[0] ?? b).map((b, i) => esc(i ? b : b[0].toUpperCase() + b.slice(1)));
    html += `<div class="bi-boost">${near.join(', ')} nearby, so it grows faster</div>`;
  }
  return html;
}

// One thing a building needs, in words, with a drawing of what's asked for
// (crossed out when it's something to keep away).
function need(n) {
  const def = STRUCTURES.find((d) => matches(d, n.type));
  const pic = `<span class="bi-pic">${def ? structureIcon(def) : ''}</span>`;
  const [one, many] = NOUNS[n.type] ?? [nameOf(n.type), plural(nameOf(n.type))];
  const within = `within ${n.radius} ${n.radius === 1 ? 'dot' : 'dots'}`;
  let text;
  if (n.kind === 'more') {
    const what = n.count === 1 ? `1 more ${one}` : `${n.count} more ${many}`;
    const level = n.minLevel > 1 ? ` (${levelName(def, n.minLevel)} or bigger)` : '';
    text = `<b>${esc(what)}</b>${esc(level)} ${within}`;
  } else if (n.kind === 'avoid') {
    text = `no ${esc(many)} ${within}`;
  } else {
    text = one === many ? `<b>${esc(one)}</b> in reach` : `a <b>${esc(one)}</b> in reach`;
  }
  return `<span class="bi-need ${n.kind === 'avoid' ? 'avoid' : ''}">${pic}<span>${text}</span></span>`;
}

// What growth rules ask for, as it's said (one, more than one).
const NOUNS = {
  residential: ['home', 'homes'],
  industrial: ['industry', 'industry'],
  services: ['services', 'services'],
  heritage: ['landmark', 'landmarks'],
};
const plural = (name) => (/(s|x|ch|sh)$/.test(name) ? `${name}es` : /[^aeiou]y$/.test(name) ? `${name.slice(0, -1)}ies` : `${name}s`);
const levelName = (def, level) => (def?.levels[level - 1]?.name ?? `level ${level}`).toLowerCase();

function structureMenu({ world, growth }, s, nav) {
  const def = STRUCTURE_TYPES[s.type];
  const level = levelOf(def, s);
  const max = maxLevel(def);
  const why = growth.explain(s);

  // turning it into something else of the same kind: only what fits here,
  // and may be built (src/story/unlocks.js) at the level it would be
  const converts = STRUCTURES
    .filter((other) => other.id !== s.type && categoryOf(other) === categoryOf(def) && world.canConvert(s.id, other.id).ok
      && UNLOCKS.allows(other.id, Math.min(s.level, maxLevel(other))))
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
  if (s.level < max && UNLOCKS.allows(s.type, s.level + 1)) items.push({ label: 'Upgrade', note: def.levels[s.level].name, action: () => world.setStructureLevel(s.id, s.level + 1, { manual: true }) });
  if (s.level > 1 && UNLOCKS.allows(s.type, s.level - 1)) items.push({ label: 'Downgrade', note: def.levels[s.level - 2].name, action: () => world.setStructureLevel(s.id, s.level - 1, { manual: true }) });
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
