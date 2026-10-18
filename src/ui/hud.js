// Screen furniture: the town's name and its chronicle book (top-left),
// the Menu (top-right), the Build menu (bottom centre, or a rail on the
// right; see buildMenu.js) and, alone in the bottom-right corner, the
// camera: photo mode, one tap away. It's boxed in pen while photo mode
// is on; its options, like any tool's, are in the Build menu's dock.
// Terrain and Zpět / Znovu (undo, redo) stand in the Build menu too, beside
// Erase (tools/terrain.js); the Menu keeps what's set now and then
// (colours, files, language…).
// The name can be edited in place; the book beside it opens the chronicle.
// The Menu folds into its ≡ button: it starts folded and opens, on a wide
// screen, as a line of drawings along the top edge, left of the button
// (clear of the Build menu's rail below); narrower, as a column of them
// down from it – either way in a pen-drawn frame like the other boxes
// (main.js sketchFrames), only while open. It folds again once one is used
// or on a click elsewhere. Each item is a drawing alone, read from its own
// file in icons/ui/ (uiIcons.js), as are the ≡ and its cross, the camera,
// the book and the pencil by the name; an item's name is its title and, written
// small in the pen beside it, shows while the pointer is on it or, on a
// touch screen, after a long press, which then doesn't press it. The
// drawings stand in groups: Colours, then the files (save, open, a new
// map), then the screen and the language. Last stands the imprint, the
// app's name, version and author, small and quiet like a printer's line.

import { BuildMenu } from './buildMenu.js';
import { statIcon, cameraIcon, menuIcon } from './icons.js';
import { drawing } from './uiIcons.js';
import { resize, shrink } from './motion.js';
import { CONFIG } from '../config.js';
import { t, language, LANGUAGES } from '../core/text.js';

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
  constructor(root, { world, tools, chronicle, actions }) {
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
      <button class="photo-corner" data-act="photo" title="${t('control.photo')} (P)" aria-label="${t('control.photo')}" aria-pressed="false">${cameraIcon()}</button>`);

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

    // the camera: picks up photo mode, or puts it down (main.js)
    this.cameraEl = root.querySelector('.photo-corner');
    this.cameraEl.addEventListener('click', () => actions.photo());
    tools.onChange((tool) => {
      const on = tool.id === 'photo';
      this.cameraEl.classList.toggle('on', on);
      this.cameraEl.setAttribute('aria-pressed', String(on));
    });

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
    // a dot on the book while there's something new in it
    const unread = !!this.chronicle?.unread;
    if (unread !== this.unread) this.chronEl.classList.toggle('new', (this.unread = unread));
    // the options of the tool in hand (photo mode's too): in the dock
    this.buildMenu.dock(this.tools.actions());
  }
}
