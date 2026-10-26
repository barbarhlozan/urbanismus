// Default tool: click a building to get its card – its name (a home's:
// the families living there, sim/families.js; three or more listed
// under it instead), its house number (č. p., World.numberStructure),
// who of the house runs a place in town and who runs this one
// (structures/staff.js), how many live
// there under it (a little figure for each), and a row of drawings, all in
// the middle: another look, its surroundings, Zbourat (an eraser). Roads, railways, paths, fences and
// trees open nothing: Erase takes them away (and ⌘Z brings them back).
// Building new things is done from the Build menu.

import { STRUCTURE_TYPES, yardOf, kindsOf, kindShown } from '../../structures/index.js';
import { YARDS, YARD_STYLES } from '../../structures/yards.js';
import { statIcon } from '../ui/icons.js';
import { iconSvg } from '../ui/uiIcons.js';
import { t, hasText } from '../core/text.js';
import { nameOf } from '../ui/names.js';
import { familyName, personName } from '../core/surnames.js';
import { ROLES } from '../../structures/staff.js';

// names of the surroundings (yard.<id>), else their own
const yardName = (id) => (hasText(`yard.${id}`) ? t(`yard.${id}`) : YARDS[id].name);

// stand-ins for the card's drawings, its files in icons/ui/ (uiIcons.js):
// another-look, yard, erase and person
const ANOTHER_LOOK = '<path d="M2.5 2.5 H13.5 V13.5 H2.5 Z"/><circle cx="5.5" cy="5.5" r="0.9"/><circle cx="10.5" cy="10.5" r="0.9"/><circle cx="8" cy="8" r="0.9"/>';
const ERASE = '<path d="M6 22 L20.1 7.9 L26.5 14.3 L12.4 28.4 Z M10.9 17.1 L17.3 23.5"/><path d="M16 29 H28" stroke-dasharray="2 2"/>';
const PERSON = '<circle cx="8.1" cy="3.9" r="1.9"/><path d="M5.3 6.9 L10.9 6.7 L11.5 12.4 L4.8 12.5 Z"/><path d="M6.6 12.5 V14.6 M9.7 12.4 V14.5"/>';
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
      ctx.onPick?.(s); // (the fire menu acts on it, ui/devMenus.js)
      const { title, items } = structureMenu(ctx, s);
      // beside the building's own drawing as it's shown (its tower or
      // chimney too), or failing that its footprint and some height
      const around = ctx.renderer?.buildingBox(`s${s.id}`) ?? screenBox(ctx, s);
      ctx.popup.show(event.clientX, event.clientY, title, items, () => structureMenu(ctx, s), around);
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
// height), for when its drawing can't be measured, so the card can open
// clear of it.
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

// The building at a glance, kept short: how many people live there, one
// little figure for each, as the town's people are drawn (none for a
// building nobody lives in) – a few in a line for a house, a small crowd
// in rows for a block, smaller (.crowd in styles.css). Each stands a hair
// higher or lower than the next, the same each time, as if drawn in one by
// one. The number itself is the figures' name, for pointing and reading
// aloud.
function residents(def) {
  const n = def.stats?.residents;
  if (!n) return '';
  const figure = iconSvg('person', 'class="icon" aria-hidden="true"', PERSON);
  const one = (i) => `<span class="fig" style="--lift:${((i * 7) % 5) - 2}">${figure}</span>`;
  const label = esc(t('stat.residents.n', { n }));
  return `<span class="bi-people${n > 12 ? ' crowd' : ''}" role="img" title="${label}" aria-label="${label}">${Array.from({ length: n }, (_, i) => one(i)).join('')}</span>`;
}
function warning(def) {
  return `<div class="bi-row warn"><span class="stat">${statIcon('cutoff')}${t(def.access === 'any' ? 'inspect.needs.any' : 'inspect.needs.road')}</span></div>`;
}

// The house number as the little enamel plate by the door: "č. p." and
// the number, in a frame.
function plate(no) {
  const full = esc(t('inspect.no.full', { no }));
  return `<span class="bi-no" role="img" title="${full}" aria-label="${full}"><small>${esc(t('inspect.no'))}</small>${no}</span>`;
}

// What a role is called, for a man or a woman (text/buildings.txt).
const roleName = (role, sex) => t(sex === 'f' && hasText(`staff.${role}.f`) ? `staff.${role}.f` : `staff.${role}`);

// Where a building is, in a line: its number, or what it is if it has none.
const whereIs = (s) => (s.no != null ? `${t('inspect.no')}\u00a0${s.no}` : nameOf(STRUCTURE_TYPES[s.type]));

// A home's families: by name in the title when one or two, else listed.
function familiesOf(s) {
  const names = (s.data.families ?? []).map((f) => familyName(f.surname));
  if (!names.length) return { title: null, list: '' };
  if (names.length <= 2) return { title: names.join(` ${t('families.and')} `), list: '' };
  return { title: null, list: `<ul class="bi-list bi-families">${names.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` };
}

// Who runs a place: a row a slot – the role, then who (and from which
// house), or that it's vacant.
function staffRows(world, s) {
  const rows = (s.data.staff ?? []).map((p) => {
    const home = p.first && world.structures.get(p.home);
    const who = p.first ? `<span><b>${esc(personName(p))}</b>${home ? ` · ${esc(whereIs(home))}` : ''}</span>` : `<span class="bi-kind">${esc(t('staff.vacant'))}</span>`;
    return `<li><span class="bi-role">${esc(roleName(p.role, p.sex ?? (ROLES[p.role] === 'f' ? 'f' : 'm')))}</span>${who}</li>`;
  });
  return rows.length ? `<ul class="bi-list bi-staff">${rows.join('')}</ul>` : '';
}

// Who from this home runs a place in town: a row each – the person, then
// the role and where.
function workRows(world, s) {
  const rows = [];
  for (const o of world.structures.values()) {
    for (const p of o.data.staff ?? []) {
      if (p.first && p.home === s.id) rows.push(`<li><span class="bi-role">${esc(roleName(p.role, p.sex))} · ${esc(whereIs(o))}</span><b>${esc(personName(p))}</b></li>`);
    }
  }
  return rows.length ? `<ul class="bi-list bi-staff">${rows.join('')}</ul>` : '';
}

function structureMenu({ world }, s) {
  const def = STRUCTURE_TYPES[s.type];

  // under its name its house number (and what it is, when the name is the
  // families'), the families when there are many, who runs what, how many
  // live there and a warning if nothing reaches it; then a row of drawings
  const people = s.ruin ? '' : residents(def);
  const families = familiesOf(s);
  const title = families.title ?? nameOf(def);
  const items = [];
  const kind = families.title ? `<span class="bi-kind">${esc(nameOf(def))}</span>` : '';
  if (s.no != null || kind) items.push({ block: `<div class="bi-row bi-head">${s.no != null ? plate(s.no) : ''}${kind}</div>` });
  // burnt down: what it is now, and only taking it down
  if (s.ruin) {
    items.push({ block: `<span class="bi-kind">${esc(t('inspect.ruin'))}</span>` });
    items.push(demolish(world, s));
    return { title, items };
  }
  if (families.list) items.push({ block: families.list });
  const work = staffRows(world, s) + workRows(world, s);
  if (work) items.push({ block: work });
  if (people) items.push({ block: people });
  if (!world.isServed(s)) items.push({ block: warning(def) });

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

  // …and taking it down (⌘Z puts it back)
  items.push(demolish(world, s));

  return { title, items };
}

function demolish(world, s) {
  return {
    icon: iconSvg('erase', 'class="icon" aria-hidden="true"', ERASE, '0 0 32 32'),
    label: t('inspect.demolish'),
    action: () => world.removeStructure(s.id),
  };
}
