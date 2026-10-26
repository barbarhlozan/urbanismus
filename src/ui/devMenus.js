// TEMPORARY: two drawings beside the chronicle book, for trying things out
// – on a phone too – without the Debug panel or the console. Each opens a
// menu in the game's card (ui/popup.js; a sheet on a phone) that stays
// open while it's used, and runs the console's own commands
// (src/dev/commands.js):
//
//   clock   Čas: ‹ the hour › – an hour earlier or later holds the day
//           there, the hour itself lets it go on again (cmd.day)
//   flame   Oheň: on the building whose card was opened last (č. p. n),
//           Zapálit (burns until put out or burnt down), Zapálit na 2 min
//           (burns down by itself then), Uhasit, Shořet –
//           cmd.ignite / putOut / burn
//
// Remove it (its lines in main.js and tools/inspect.js, the dev.* words,
// icons/ui/dev-*.svg) once the time and the fires have their own controls.

import { DAY, hourAt } from '../render/shadows.js';
import { t } from '../core/text.js';
import { iconSvg } from './uiIcons.js';

const TIMED = 2; // minutes the second Zapálit burns for

// stand-ins for icons/ui/dev-time.svg and dev-fire.svg
const CLOCK = '<path d="M8.3 2.3 C11.4 2.3 13.8 4.8 13.7 8.1 C13.6 11.3 11.1 13.8 7.9 13.7 C4.7 13.6 2.3 11.1 2.3 7.9 C2.4 4.9 4.8 2.5 7.6 2.2 L9.1 2.4"/><path d="M8 4.9 V8.2 L10.3 9.7"/>';
const FLAME = '<path d="M8 14 C5.1 14 3.4 11.9 3.8 9.3 C4.2 6.9 6.2 5.7 6.4 3.1 C8.4 4.5 9.1 6.3 8.6 8 C9.4 7.4 9.8 6.6 9.8 5.6 C11.6 7 12.6 8.8 12.2 10.8 C11.8 12.8 10.2 14 8 14"/><path d="M8 13.9 C6.9 13.7 6.3 12.6 6.7 11.4 C7 10.5 7.8 10 8 9.2 C9 10.2 9.6 11.2 9.3 12.3 C9.1 13.2 8.6 13.8 8 13.9"/>';

const clockTime = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;

export class DevMenus {
  constructor(root, { world, cmd, popup }) {
    this.world = world;
    this.target = null; // the building whose card was opened last

    const book = root.querySelector('.hud .chron');
    book.insertAdjacentHTML('afterend',
      `<button class="close dev-menu" data-dev="time" title="${t('dev.time')}" aria-label="${t('dev.time')}">${iconSvg('dev-time', 'class="icon stat-icon" aria-hidden="true"', CLOCK)}</button>` +
      `<button class="close dev-menu" data-dev="fire" title="${t('dev.fire')}" aria-label="${t('dev.fire')}">${iconSvg('dev-fire', 'class="icon stat-icon" aria-hidden="true"', FLAME)}</button>`);

    // the hour `step` hours from the one shown now (0: this one), whole, 0…23
    const hourFrom = (step) => (((Math.floor(DAY.held ?? hourAt(world.time)) + step) % 24) + 24) % 24;
    const keep = (label, action, more = {}) => ({ label, action, keepOpen: true, ...more });

    // one row: ‹ the hour › (the card's row of drawings, ui/popup.js); the
    // hour underlined while it's held there
    const timeMenu = () => {
      const held = DAY.held != null;
      const time = clockTime(DAY.held ?? hourAt(world.time));
      return {
        title: t('dev.time'),
        items: [
          keep(t('dev.earlier'), () => cmd.day(hourFrom(-1)), { icon: '<span class="dev-arrow" aria-hidden="true">‹</span>' }),
          keep(`${time} – ${t(held ? 'dev.hour.held' : 'dev.hour.running')}`, () => held && cmd.day(), { icon: `<span class="dev-hour${held ? ' held' : ''}">${time}</span>` }),
          keep(t('dev.later'), () => cmd.day(hourFrom(1)), { icon: '<span class="dev-arrow" aria-hidden="true">›</span>' }),
        ],
      };
    };

    const fireMenu = () => {
      let s = this.target;
      if (s && world.structures.get(s.id) !== s) s = this.target = null; // (gone)
      const title = s ? `${t('dev.fire')} · ${t('inspect.no')} ${s.no}` : t('dev.fire');
      if (!s) return { title, items: [{ label: t('dev.pick'), info: true }] };
      const canLight = !s.ruin && !s.burning;
      return {
        title,
        items: [
          keep(t('dev.ignite'), () => cmd.ignite(s.no), { disabled: !canLight }),
          keep(t('dev.ignite.timed', { n: TIMED }), () => cmd.ignite(s.no, TIMED), { disabled: !canLight }),
          keep(t('dev.put-out'), () => cmd.putOut(s.no), { disabled: !s.burning }),
          keep(t('dev.burn'), () => cmd.burn(s.no), { disabled: !!s.ruin }),
        ],
      };
    };

    const open = (btn, menu) => {
      const { title, items } = menu();
      const r = btn.getBoundingClientRect();
      popup.show(r.left, r.bottom, title, items, menu, { left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    };
    root.querySelector('.hud [data-dev="time"]').addEventListener('click', (e) => open(e.currentTarget, timeMenu));
    root.querySelector('.hud [data-dev="fire"]').addEventListener('click', (e) => open(e.currentTarget, fireMenu));
  }

  // A building's card was opened: the fire menu acts on it.
  pick(s) {
    this.target = s.no != null ? s : null;
  }
}
