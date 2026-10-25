// TEMPORARY: buttons for trying things out, always on screen (top middle)
// and big enough for a finger, so the time and the fires can be worked from
// a phone without the Debug panel or the console. Each runs the console's
// own command (src/dev/commands.js):
//
//   time    ⏸ / ▶ (cmd.time), the speed, +1 min (cmd.jump), and the hour:
//           ‹ › step it and hold the day there, the hour itself lets the
//           day go on again (cmd.day)
//   fire    on the building whose card was opened last (č. p. n): Zapálit
//           (burns until put out or burnt down), Zapálit na 2 min (burns
//           down by itself then), Uhasit, Shořet – cmd.ignite / putOut / burn
//
// Remove it (and its lines in main.js, tools/inspect.js and styles.css)
// once the fires and the time have their own controls.

import { DAY, hourAt } from '../render/shadows.js';
import { t } from '../core/text.js';

const TIMED = 2; // minutes the second Zapálit burns for

export class DevStrip {
  constructor(root, { world, clock, cmd }) {
    this.world = world;
    this.clock = clock;
    this.cmd = cmd;
    this.target = null; // the building whose card was opened last
    this.el = document.createElement('div');
    this.el.className = 'dev-strip';
    this.el.innerHTML =
      '<div class="dev-row">' +
        '<button data-dev="play"></button><button data-dev="speed"></button>' +
        `<button data-dev="jump">${t('dev.jump')}</button>` +
        '<button data-dev="earlier" aria-label="−1 h">‹</button><button data-dev="hour"></button><button data-dev="later" aria-label="+1 h">›</button>' +
      '</div>' +
      '<div class="dev-row">' +
        '<span class="dev-target"></span>' +
        `<button data-dev="ignite">${t('dev.ignite')}</button>` +
        `<button data-dev="igniteTimed">${t('dev.ignite.timed', { n: TIMED })}</button>` +
        `<button data-dev="putOut">${t('dev.put-out')}</button>` +
        `<button data-dev="burn">${t('dev.burn')}</button>` +
      '</div>';
    root.appendChild(this.el);

    const act = {
      play: () => cmd.time(clock.paused ? 'play' : 'pause'),
      speed: () => cmd.time((clock.index + 1) % clock.speeds.length),
      jump: () => cmd.jump(1),
      earlier: () => cmd.day(this.hour(-1)),
      later: () => cmd.day(this.hour(1)),
      hour: () => (DAY.held != null ? cmd.day() : cmd.day(this.hour(0))),
      ignite: () => cmd.ignite(this.target.no),
      igniteTimed: () => cmd.ignite(this.target.no, TIMED),
      putOut: () => cmd.putOut(this.target.no),
      burn: () => cmd.burn(this.target.no),
    };
    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-dev]');
      if (!btn || btn.disabled) return;
      act[btn.dataset.dev]();
      this.refresh();
    });
    for (const type of ['structure:changed', 'structure:removed']) world.events.on(type, () => this.refresh());
    // the hour moves on by itself
    setInterval(() => this.refresh(), 1000);
    this.refresh();
  }

  // The whole hour `step` hours from the one shown now (0: this one), 0…23.
  hour(step) {
    const now = DAY.held ?? hourAt(this.world.time);
    return (((Math.floor(now) + step) % 24) + 24) % 24;
  }

  // A building's card was opened.
  pick(s) {
    this.target = s.no != null ? s : null;
    this.refresh();
  }

  refresh() {
    const q = (k) => this.el.querySelector(`[data-dev="${k}"]`);
    const { clock } = this;
    q('play').textContent = clock.paused ? '▶' : '⏸';
    q('speed').textContent = `${clock.speed.scale}×`;
    const h = DAY.held ?? hourAt(this.world.time);
    q('hour').textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    q('hour').classList.toggle('held', DAY.held != null);

    let s = this.target;
    if (s && this.world.structures.get(s.id) !== s) s = this.target = null; // (gone)
    this.el.querySelector('.dev-target').textContent = s ? `${t('inspect.no')} ${s.no}` : t('dev.pick');
    q('ignite').disabled = q('igniteTimed').disabled = !s || s.ruin || !!s.burning;
    q('putOut').disabled = !s?.burning;
    q('burn').disabled = !s || !!s.ruin;
  }
}
