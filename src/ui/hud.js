// Screen furniture: the town's name and its chronicle book (top-left),
// controls (top-right) and the Build menu (bottom centre, see buildMenu.js)
// with photo mode's options just above it.
// Photo and Terrain sit in the Build menu, under Erase; the controls keep
// what's set now and then (colours, files, language…).
// The name can be edited in place; the book beside it opens the chronicle.
// The controls fold into their menu button: they start folded and open,
// on a wide screen, as a line of words along the top edge, left of the
// button (clear of the Build menu's rail below); narrower, as a list of
// named rows down from it – either way in a pen-drawn frame like the other
// boxes (main.js sketchFrames), only while open. They fold again once one
// is used or on a click elsewhere. Last in them stands the imprint, the
// app's name, version and author, small and quiet like a printer's line.

import { BuildMenu } from './buildMenu.js';
import { statIcon, controlIcon } from './icons.js';
import { resize, shrink } from './motion.js';
import { CONFIG } from '../config.js';
import { t, language, LANGUAGES } from '../core/text.js';

const MENU_ICON = `<svg class="icon menu-icon" viewBox="0 0 16 16" aria-hidden="true">
  <path class="bars" d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/><path class="cross" d="M4 4l8 8M12 4l-8 8"/></svg>`;

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
// a button in the controls: its drawing and its name (control.<act>), also
// on hover for when the name is hidden (narrow screens)
const control = (act, title = t(`control.${act}`), label = title) =>
  `<button data-act="${act}" title="${title}">${controlIcon(act)}<span class="label">${label}</span></button>`;

export class Hud {
  constructor(root, { world, tools, chronicle, actions }) {
    this.chronicle = chronicle;
    this.tools = tools;

    root.insertAdjacentHTML('beforeend', `
      <div class="hud">
        <div class="title"><label class="name-label"><span class="name-box"><input class="name" value="${esc(world.name)}" maxlength="40" spellcheck="false" autocomplete="off" aria-label="${t('town.name')}"><span class="name sizer" aria-hidden="true"></span></span>${statIcon('pen')}</label><button class="close chron" title="${t('hud.chronicle')}">${statIcon('book')}</button></div>
      </div>
      <div class="controls">
        <button data-act="colors" title="${t('control.colors')}" data-label="${t('control.colors')}"></button>
        ${control('export')}
        ${control('import')}
        ${control('newMap')}
        ${control('fullscreen', t('fullscreen'), t('fullscreen'))}
        ${control('language', `${t('control.language')}: ${LANGUAGES[language()]}`, LANGUAGES[language()])}
        <span class="imprint">${CONFIG.app.name} v${CONFIG.app.version} · ${CONFIG.app.author}</span>
        <button class="close menu-toggle" aria-expanded="true">${MENU_ICON}</button>
      </div>
      <div class="bottom">
        <div class="actions hidden"></div>
      </div>`);

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

    this.actionsEl = root.querySelector('.actions');
    this.actionsEl.addEventListener('click', (e) => {
      const i = e.target.closest('button')?.dataset.i;
      if (i != null) {
        tools.runAction(Number(i));
        this.lastActions = null;
      }
    });

    // let other panels (event log) sit above the bottom bar, whatever its height
    const bottomEl = root.querySelector('.bottom');
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--bottom-h', `${bottomEl.offsetHeight}px`);
    }).observe(bottomEl);

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

    this.buildMenu = new BuildMenu(root, tools, actions);
  }

  update() {
    // a dot on the book while there's something new in it
    const unread = !!this.chronicle?.unread;
    if (unread !== this.unread) this.chronEl.classList.toggle('new', (this.unread = unread));
    // a Build menu tool's options sit beside it in the folded menu's dock;
    // anything else's (photo mode), or with the menu open, in the bar here
    let actions = this.tools.actions();
    if (this.buildMenu.dock(actions)) actions = [];
    const actionsKey = actions.map((a) => `${a.label}${a.on ? '+' : ''}`).join('|');
    if (actionsKey !== this.lastActions) {
      this.lastActions = actionsKey;
      this.actionsEl.classList.toggle('hidden', !actions.length);
      this.actionsEl.innerHTML = actions
        .map((a, i) => `<button data-i="${i}"${a.on != null ? ` aria-pressed="${a.on}"${a.on ? ' class="on"' : ''}` : ''}>${a.key ? `<span class="key">${a.key}</span>` : ''}${a.label}</button>`)
        .join('');
    }
  }
}
