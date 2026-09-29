// Photo mode: stand someone on the map and take a picture of what they see.
// Click to place the photographer, move the pointer to aim, click again to
// take the photo (render/photo.js); it opens as a print (ui/photoPrint.js).
// Taking more shots from the same spot keeps the photographer where they
// are; Esc (or Move) picks them up again.

import { PHOTO } from '../render/photo.js';
import { isTouch } from '../ui/device.js';
import { keyOf } from '../ui/keys.js';

const LENSES = PHOTO.lenses;

export function createPhotoTool({ world }, { shoot }) {
  let point = null;  // pointer, world
  let spot = null;   // the photographer, world [x, y]
  let lens = 1; // 42mm

  const yaw = () => (spot && point && Math.hypot(point[0] - spot[0], point[1] - spot[1]) > 1e-3
    ? Math.atan2(point[1] - spot[1], point[0] - spot[0])
    : null);
  const cycleLens = () => { lens = (lens + 1) % LENSES.length; };

  return {
    id: 'photo',
    label: 'Photo',
    hotkey: 'p',
    toolbar: false, // its button is up top, with the map controls (hud.js)

    enter() {
      spot = null;
    },

    snap(x, y) {
      point = [x, y];
      return world.grid.nodeAt(x, y);
    },

    hint() {
      if (!spot) return isTouch() ? 'Tap where to stand' : 'Click where to stand · right-click to stop';
      return isTouch()
        ? 'Tap where to look to take the photo'
        : 'Aim with the pointer, click to take the photo · Z: lens · Esc: move';
    },

    click() {
      if (!point) return;
      if (!spot) {
        spot = point;
        return;
      }
      const a = yaw();
      if (a == null) return;
      shoot({ x: spot[0], y: spot[1], yaw: a, fov: LENSES[lens].fov, lens: LENSES[lens].label });
    },

    cancel() {
      if (!spot) return false;
      spot = null;
      return true;
    },

    key(e) {
      if (keyOf(e) === '.') cycleLens();
      else return false;
      return true;
    },

    actions: () => [
      { label: `Lens: ${LENSES[lens].label}`, key: '.', run: cycleLens },
      ...(spot ? [{ label: 'Move', run: () => { spot = null; } }] : []),
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
