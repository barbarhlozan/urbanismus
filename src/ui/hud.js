// Screen furniture: the town's name and its chronicle book (top-left),
// the Menu (top-right), the Build menu (bottom centre, or a rail on the
// right; see buildMenu.js). Zpět / Znovu (undo, redo), Terrain
// (tools/terrain.js) and the camera (photo mode) stand in the Build menu,
// beside Erase; the Menu keeps what's set now and then (colours, files,
// language…).
// The name can be edited in place; the book beside it opens the chronicle.
// The Menu folds into its ≡ button: it starts folded and opens, on a wide
// screen, as a line of drawings along the top edge, left of the button
// (clear of the Build menu's rail below); narrower, as a column of them
// down from it – either way in a pen-drawn frame like the other boxes
// (main.js sketchFrames), only while open. It folds again once one is used
// or on a click elsewhere. Each item is a drawing alone, read from its own
// file in icons/ui/ (uiIcons.js), as are the ≡ and its cross,
// the book and the pencil by the name; an item's name is its title and, written
// small in the pen beside it, shows while the pointer is on it or, on a
// touch screen, after a long press, which then doesn't press it. The
// drawings stand in groups: Colours, then the files (save, open, a new
// map), then the screen and the language. Last stands the imprint, the
// app's name, version and author, small and quiet like a printer's line.
// In the bottom-left corner, as in a map's margin, the north arrow: drawn by
// pen, it points where the map's north lies on screen as the view is
// turned, and a click on it turns the view back, north up.

import { BuildMenu } from './buildMenu.js';
import { statIcon, menuIcon } from './icons.js';
import { drawing } from './uiIcons.js';
import { resize, shrink } from './motion.js';
import { CONFIG } from '../config.js';
import { t, language, LANGUAGES } from '../core/text.js';
import { sketchLine } from '../render/sketch.js';

// The north arrow, pen-drawn: a needle pointing where the map's north (-y)
// lies on screen at the view's turn, half its head filled, the letter
// beyond it. 40px square; the same strokes each time (fixed seeds), only
// turned.
function northArrow(camera) {
  const [x0, y0] = camera.project(camera.cx, camera.cy, 0);
  const [x1, y1] = camera.project(camera.cx, camera.cy - 1, 0);
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const [ux, uy] = [(x1 - x0) / len, (y1 - y0) / len];
  const at = (k, side = 0) => [20 + ux * k - uy * side, 20 + uy * k + ux * side];
  const head = at(9), tail = at(-11), barb = at(2, 3.5), back = at(2, -3.5);
  const p = (pt) => pt.map((n) => Math.round(n * 10) / 10).join(' ');
  return `<svg class="north" viewBox="0 0 40 40" aria-hidden="true">
    <path class="needle" d="${sketchLine(tail, head, 7, { over: 1 })}${sketchLine(head, barb, 8)}${sketchLine(head, back, 9)}"/>
    <path class="half" d="M${p(head)}L${p(barb)}L${p(at(0))}Z"/>
    <text x="${at(16)[0].toFixed(1)}" y="${(at(16)[1] + 3.5).toFixed(1)}" text-anchor="middle">${t('north')}</text></svg>`;
}

// The Menu button's drawing: ≡ while it's folded, a cross while it's open
// (styles.css shows one), icons/ui/menu.svg and menu-close.svg. The two
// share the button's box, the ≡'s file's viewBox.
const menuButtonIcon = () => {
  const bars = drawing('menu', '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>');
  const cross = drawing('menu-close', '<path d="M4 4l8 8M12 4l-8 8"/>');
  const part = (d, cls) => (d.file ? `<g class="${cls}">${d.art}</g>` : d.art.replace('<path', `<path class="${cls}"`));
  return `<svg class="icon menu-icon" viewBox="${bars.viewBox}" aria-hidden="true">${part(bars, 'bars')}${part(cross, 'cross')}</svg>`;
};

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
// a button in the Menu: its drawing, and its name (control.<act>) as its
// title and as the word written beside it while pointed at or held
const control = (act, title = t(`control.${act}`), label = title, icon = act) =>
  `<button data-act="${act}" title="${title}" aria-label="${title}">${menuIcon(icon)}<span class="label" aria-hidden="true">${label}</span></button>`;

// ms a finger rests on a Menu drawing before its name is written beside it,
// and how long the name then stays
const LONG_PRESS = 450;
const TOLD = 1600;

// The language button names the language it switches to (not the one in use),
// with that language's flag.
const otherLanguage = () => Object.keys(LANGUAGES).find((code) => code !== language());

export class Hud {
  constructor(root, { world, camera, tools, chronicle, actions }) {
    this.chronicle = chronicle;
    this.tools = tools;

    root.insertAdjacentHTML('beforeend', `
      <div class="hud">
        <div class="title"><label class="name-label"><span class="name-box"><input class="name" value="${esc(world.name)}" maxlength="40" spellcheck="false" autocomplete="off" aria-label="${t('town.name')}"><span class="name sizer" aria-hidden="true"></span></span>${statIcon('pen')}</label><button class="close chron" title="${t('hud.chronicle')}">${statIcon('book')}</button></div>
      </div>
      <div class="controls">
        ${control('colors')}
        ${control('export')}
        ${control('import')}
        ${control('newMap')}
        ${control('fullscreen', t('fullscreen'), t('fullscreen'))}
        ${control('language', `${t('control.language')}: ${LANGUAGES[otherLanguage()]}`, LANGUAGES[otherLanguage()], `flag${otherLanguage()}`)}
        <span class="imprint"><span>${CONFIG.app.name} v${CONFIG.app.version}</span> <span>${CONFIG.app.author}</span></span>
        <button class="close menu-toggle" aria-expanded="true">${menuButtonIcon()}</button>
      </div>
      <button class="north-box" title="${t('north.up')}" aria-label="${t('north.up')}"><span class="north-art"></span></button>`);
    this.camera = camera;
    this.northEl = root.querySelector('.north-box .north-art');
    root.querySelector('.north-box').addEventListener('click', () => actions.northUp());

    this.chronEl = root.querySelector('.hud .chron');
    this.chronEl.addEventListener('click', () => actions.chronicle());

    // the town's name: typed over in place, kept in the save
    const nameEl = root.querySelector('.hud input.name');
    // an invisible copy of the text sets the box's width: inputs can't hug their text
    const sizerEl = root.querySelector('.hud .sizer');
    const fitName = () => { sizerEl.textContent = nameEl.value || ' '; };
    nameEl.addEventListener('input', fitName);
    const showName = () => {
      fitName();
      document.title = `${world.name} · ${CONFIG.app.name}`;
    };
    const commit = () => {
      world.rename(nameEl.value);
      nameEl.value = world.name; // an empty name puts the old one back
      showName();
    };
    nameEl.addEventListener('change', commit);
    nameEl.addEventListener('keydown', (e) => {
      e.stopPropagation(); // no hotkeys while typing
      if (e.key === 'Enter') nameEl.blur();
      if (e.key === 'Escape') { nameEl.value = world.name; fitName(); nameEl.blur(); }
    });
    nameEl.addEventListener('focus', () => nameEl.select());
    showName();

    const controlsEl = root.querySelector('.controls');
    const menuBtn = controlsEl.querySelector('.menu-toggle');
    const fold = (folded, animate = true) => {
      const apply = () => controlsEl.classList.toggle('folded', folded);
      // folding: the buttons fade while the bar shrinks to its menu button;
      // unfolding: the bar grows back out of it
      if (!animate || folded === controlsEl.classList.contains('folded')) apply();
      else if (folded) shrink(controlsEl, apply);
      else resize(controlsEl, apply);
      menuBtn.setAttribute('aria-expanded', String(!folded));
      menuBtn.title = t(folded ? 'controls.unfold' : 'controls.fold');
    };
    fold(true, false);
    controlsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn === menuBtn) return fold(!controlsEl.classList.contains('folded'));
      const act = btn?.dataset.act;
      if (!act) return;
      fold(true); // the list would cover the panel it opens
      actions[act]?.();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!controlsEl.contains(e.target)) fold(true);
    }, true);

    // a finger held on a drawing: its name is written beside it a while,
    // and lifting the finger then doesn't press it
    let timer = 0, told = null, unsay = 0;
    controlsEl.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('button[data-act]');
      clearTimeout(timer);
      told = null;
      if (e.pointerType !== 'touch' || !btn) return;
      timer = setTimeout(() => {
        told = btn;
        for (const b of controlsEl.querySelectorAll('.telling')) b.classList.remove('telling');
        btn.classList.add('telling');
        clearTimeout(unsay);
        unsay = setTimeout(() => btn.classList.remove('telling'), TOLD);
      }, LONG_PRESS);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) controlsEl.addEventListener(type, () => clearTimeout(timer));
    controlsEl.addEventListener('contextmenu', (e) => e.preventDefault()); // (a long press on Android)
    controlsEl.addEventListener('click', (e) => {
      if (told && e.target.closest('button') === told) {
        told = null;
        e.stopImmediatePropagation();
      }
    }, true);

    this.buildMenu = new BuildMenu(root, tools, actions, world.history);
  }

  update() {
    // the north arrow follows the view as it's turned (redrawn by the half
    // degree, not every frame)
    const turn = Math.round((this.camera.angle * 360) / Math.PI);
    if (turn !== this.northTurn) {
      this.northTurn = turn;
      this.northEl.innerHTML = northArrow(this.camera);
    }
    // a dot on the book while there's something new in it
    const unread = !!this.chronicle?.unread;
    if (unread !== this.unread) this.chronEl.classList.toggle('new', (this.unread = unread));
    // the options of the tool in hand (photo mode's too): in the dock
    this.buildMenu.dock(this.tools.actions());
  }
}
