// Photo mode: stand someone on the map and take a picture of what they see.
// Click to place the photographer, move the pointer to aim, click again to
// take the photo (render/photo.js); it opens as a print (ui/photoPrint.js).
// Taking more shots from the same spot keeps the photographer where they
// are; Esc (or Move) picks them up again. There is no lens to pick: on the
// map a small arrow shows only which way they look, and the picture is
// framed when it is taken, by what is aimed at (render/photo.js
// framePhoto) – the lens, a slight turn, a step or two back to have the
// houses whole.
//
// It's picked up with the camera at the end of the Build menu's bottom row
// (ui/buildMenu.js) or P; its options – Take, Move – and the × that puts it
// down are in the Build menu's dock, as a building's are.
//
// Touch has no hover to aim with: a tap places the photographer, a second
// tap sets where they look (the cone stays there, tap again to turn), and
// the Take photo button shoots.

import { t } from '../core/text.js';

export function createPhotoTool({ world }, { shoot }) {
  let point = null;  // pointer, world
  let spot = null;   // the photographer, world [x, y]
  let aim = null;    // touch: where they look, world [x, y] (null: at the pointer)

  const yaw = () => {
    const at = aim ?? point;
    return spot && at && Math.hypot(at[0] - spot[0], at[1] - spot[1]) > 1e-3
      ? Math.atan2(at[1] - spot[1], at[0] - spot[0])
      : null;
  };
  const place = (at) => { spot = at; aim = null; };
  const shot = () => {
    const a = yaw();
    return a == null ? null : { x: spot[0], y: spot[1], yaw: a, at: aim ?? point };
  };
  const take = () => {
    const s = shot();
    if (s) shoot(s);
  };

  return {
    id: 'photo',
    label: t('control.photo'),
    hotkey: 'p',
    toolbar: false, // not a tile: its button is the camera at the end of the Build menu's bottom row

    enter() {
      place(null);
    },

    snap(x, y) {
      point = [x, y];
      return world.grid.nodeAt(x, y);
    },

    click(node, e) {
      if (!point) return;
      if (!spot) return place(point);
      // a tap only aims (the dock's Draw it, or Enter, takes the picture); a click aims and shoots at once
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
      if (e.key === 'Enter' && aim) take();
      else return false;
      return true;
    },

    // the dock's first cell, in place of the tool's drawing and name: what
    // it's for, in words, and pressing it takes the picture (BuildMenu)
    lead: { label: t('photo.take'), run: take },

    actions: () => [
      ...(spot ? [{ label: t('photo.move'), run: () => place(null) }] : []),
    ],

    cursor() {
      return '';
    },

    overlay(kit) {
      if (spot) return kit.photographer(...spot, yaw());
      return point ? kit.photographer(...point) : '';
    },
  };
}
