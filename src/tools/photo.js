// Photo mode: stand someone on the map and take a picture of what they see.
// Click to place the photographer, move the pointer to aim, click again to
// take the photo (render/photo.js); it opens as a print (ui/photoPrint.js).
// Taking more shots from the same spot keeps the photographer where they
// are; Esc (or Move) picks them up again.
//
// Touch has no hover to aim with: a tap places the photographer, a second
// tap sets where they look (the cone stays there, tap again to turn), and
// the Take photo button shoots.

import { PHOTO } from '../render/photo.js';
import { isTouch } from '../ui/device.js';
import { t } from '../core/text.js';

const LENSES = PHOTO.lenses;

export function createPhotoTool({ world }, { shoot }) {
  let point = null;  // pointer, world
  let spot = null;   // the photographer, world [x, y]
  let aim = null;    // touch: where they look, world [x, y] (null: at the pointer)
  let lens = 1; // 42mm

  const yaw = () => {
    const at = aim ?? point;
    return spot && at && Math.hypot(at[0] - spot[0], at[1] - spot[1]) > 1e-3
      ? Math.atan2(at[1] - spot[1], at[0] - spot[0])
      : null;
  };
  const cycleLens = () => { lens = (lens + 1) % LENSES.length; };
  const place = (at) => { spot = at; aim = null; };
  const take = () => {
    const a = yaw();
    if (a != null) shoot({ x: spot[0], y: spot[1], yaw: a, fov: LENSES[lens].fov, lens: LENSES[lens].label });
  };

  return {
    id: 'photo',
    label: t('control.photo'),
    hotkey: 'p',
    toolbar: false, // its button is up top, with the map controls (hud.js)

    enter() {
      place(null);
    },

    snap(x, y) {
      point = [x, y];
      return world.grid.nodeAt(x, y);
    },

    hint() {
      if (!spot) return isTouch() ? t('photo.tap.stand') : `${t('photo.click.stand')} · ${t('right-click.stop')}`;
      if (isTouch()) return t(aim ? 'photo.tap.take' : 'photo.tap.look');
      return `${t('photo.aim')} · Shift: ${t('photo.lens').toLowerCase()} · Esc: ${t('photo.move').toLowerCase()}`;
    },

    click(node, e) {
      if (!point) return;
      if (!spot) return place(point);
      // a tap only aims (Take photo shoots); a click aims and shoots at once
      if (e?.pointerType && e.pointerType !== 'mouse') {
        if (Math.hypot(point[0] - spot[0], point[1] - spot[1]) > 1e-3) aim = point;
        return;
      }
      aim = null;
      take();
    },

    cancel() {
      if (!spot) return false;
      place(null);
      return true;
    },

    key(e) {
      if (e.key === 'Shift' && !e.repeat) cycleLens(); // like Size while building
      else if (e.key === 'Enter' && aim) take();
      else return false;
      return true;
    },

    actions: () => [
      ...(aim ? [{ label: t('photo.take'), key: 'Enter', run: take }] : []),
      { label: `${t('photo.lens')}: ${LENSES[lens].label}`, key: 'Shift', run: cycleLens },
      ...(spot ? [{ label: t('photo.move'), run: () => place(null) }] : []),
    ],

    cursor() {
      return '';
    },

    overlay(kit) {
      if (spot) return kit.photographer(...spot, yaw(), LENSES[lens].fov, 3);
      return point ? kit.photographer(...point) : '';
    },
  };
}
