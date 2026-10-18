// Default tool: click a building to get its card – what it is, another
// look, its surroundings, and Zbourat. Roads, railways, paths, fences and
// trees open nothing: Erase takes them away (and ⌘Z brings them back).
// Building new things is done from the Build menu.

import { STRUCTURE_TYPES, yardOf, kindsOf, kindShown } from '../../structures/index.js';
import { YARDS, YARD_STYLES } from '../../structures/yards.js';
import { statIcon } from '../ui/icons.js';
import { iconSvg } from '../ui/uiIcons.js';
import { t, hasText } from '../core/text.js';
import { nameOf, blurbOf } from '../ui/names.js';

// names of the surroundings (yard.<id>), else their own
const yardName = (id) => (hasText(`yard.${id}`) ? t(`yard.${id}`) : YARDS[id].name);

// stand-ins for the card's two drawings, icons/ui/another-look.svg and
// icons/ui/yard.svg (uiIcons.js)
const ANOTHER_LOOK = '<path d="M2.5 2.5 H13.5 V13.5 H2.5 Z"/><circle cx="5.5" cy="5.5" r="0.9"/><circle cx="10.5" cy="10.5" r="0.9"/><circle cx="8" cy="8" r="0.9"/>';
const YARD = '<path d="M1.5 13.6 C5 13.3 10 13.8 14.6 13.4"/><path d="M2.6 13.5 V8.6 L3.3 7.6 L4 8.6 V13.5 M6.2 13.5 V8.6 L6.9 7.6 L7.6 8.6 V13.5 M1.6 10 H8.8 M1.6 12 H8.8"/><path d="M9.6 13.4 C8.9 12 9.5 10.2 11 10.1 C11.2 8.4 13.6 8.2 14 9.9 C15.2 10.4 15.1 12.6 13.9 13.4"/>';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function createInspectTool(ctx) {
  return {
    id: 'inspect',
    label: t('tool.select'),
    toolbar: false, // it's what you're in when no tool is picked

    click(node, event) {
      const s = node < 0 ? null : ctx.world.structureAt(node);
      if (!s) return ctx.popup.hide();
      const { title, items } = structureMenu(ctx, s);
      ctx.popup.show(event.clientX, event.clientY, title, items, () => structureMenu(ctx, s), screenBox(ctx, s));
    },

    exit() {
      ctx.popup.hide();
    },

    // No mark of its own under the pointer: a building's name over it is
    // enough (the hover label, ui/annotations.js).
    cursor: () => '',
  };
}

// Screen box around the building clicked (its whole footprint and some
// height), so the card can open beside it, not over it.
const HEIGHT = 2.5; // in tiles; enough for most buildings
function screenBox({ world, camera }, s) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const n of world.nodesOf(s)) {
    const [x, y] = world.grid.xy(n);
    for (const [dx, dy] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
      for (const h of [0, HEIGHT]) {
        const [sx, sy] = camera.project(x + dx, y + dy, h);
        const cx = sx * camera.zoom + camera.panX, cy = sy * camera.zoom + camera.panY;
        left = Math.min(left, cx); right = Math.max(right, cx);
        top = Math.min(top, cy); bottom = Math.max(bottom, cy);
      }
    }
  }
  return { left, top, right, bottom };
}

// The building at a glance: what it is and its numbers written out in
// words, as on the chronicle's ledger page ("osm pracovních míst"), and a
// warning when nothing reaches it.
function summary(def, served) {
  const stats = Object.entries(def.stats ?? {}).map(([k, v]) =>
    `<span class="stat words">${esc(t(`stat.${k}.n`, { n: v }))}</span>`);
  let html = `<div class="bi-row"><span class="bi-kind">${esc(blurbOf(def) || nameOf(def))}</span>${stats.join('')}</div>`;
  if (!served) {
    html += `<div class="bi-row warn"><span class="stat">${statIcon('cutoff')}${t(def.access === 'any' ? 'inspect.needs.any' : 'inspect.needs.road')}</span></div>`;
  }
  return html;
}

function structureMenu({ world }, s) {
  const def = STRUCTURE_TYPES[s.type];

  // what it is: to look at, not to click
  const items = [{ block: summary(def, world.isServed(s)) }];

  // how it looks, as two drawings side by side (each named on pointing at
  // it): its next kind, in the order Space goes through them while
  // building (tools/build.js)…
  const kinds = kindsOf(def);
  const nextKind = () => kinds[(kinds.indexOf(kindShown(def, s)) + 1) % kinds.length];
  items.push({
    icon: iconSvg('another-look', 'class="icon" aria-hidden="true"', ANOTHER_LOOK),
    label: t('inspect.change-look'),
    keepOpen: true,
    action: () => world.restyleStructure(s.id, kinds.length > 1 ? nextKind() : null),
  });

  // …and its surroundings: automatic -> each style -> none -> automatic,
  // the one it has now named with it
  if (def.yards?.length) {
    const choice = s.data.yard ?? 'auto';
    const cars = world.accessInfo(s) !== null; // no car park without a road
    const current = yardOf(def, s, { cars });
    const none = t('inspect.yard.none');
    // (left to itself, it just says what it has)
    const note = choice === 'auto' ? (current ? yardName(current) : none) : choice === 'none' ? none : yardName(choice);
    const order = ['auto', ...YARD_STYLES.filter((y) => cars || !YARDS[y].cars || y === choice), 'none'];
    const next = order[(order.indexOf(choice) + 1) % order.length];
    items.push({
      icon: iconSvg('yard', 'class="icon" aria-hidden="true"', YARD),
      label: `${t('inspect.yard')}: ${note}`,
      keepOpen: true,
      action: () => world.setYard(s.id, next === 'auto' ? null : next),
    });
  }

  items.push({ section: '' }, { label: t('inspect.demolish'), action: () => world.removeStructure(s.id) });

  return { title: nameOf(def), items };
}
