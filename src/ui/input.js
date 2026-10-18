// Pointer input on the map (the #input box over it, see styles.css): left click / tap = tool click, drag (left
// or middle button, one finger) = pan, right-button drag = turn the view
// (across the screen; it coasts on a little when let go), two fingers =
// pinch zoom + pan, and twisting them turns the view, right click =
// cancel, middle click = the tool's Tab (rotate / flip the bend), wheel =
// zoom around the cursor.
//
// Touch has no hover: the hover position only moves on a tap (not while
// panning), and stays where it was when the finger lifts.

import { notePointer } from './device.js';
import { Camera } from '../render/camera.js';

const DRAG_THRESHOLD = { mouse: 5, touch: 10 };

export function attachInput(el, { camera, onPointer, onClick, onCancel, onMiddle }) {
  let drag = null;
  const touches = new Map(); // pointerId -> [x, y], for pinch
  let pinch = null;

  // The map fills the window, so window coordinates are map coordinates
  // (the SVG's own box is stretched mid-zoom, see Renderer.placeView).
  const local = (e) => [e.clientX, e.clientY];

  // World position under the pointer (on the ground plane).
  const pick = (e) => camera.unproject(...camera.clientToScene(...local(e)));

  const pinchState = () => {
    const [[ax, ay], [bx, by]] = [...touches.values()];
    return { mid: [(ax + bx) / 2, (ay + by) / 2], dist: Math.hypot(bx - ax, by - ay) || 1, angle: Math.atan2(by - ay, bx - ax) };
  };

  // A turn by `da` radians around the screen point `at` at time `t` (ms),
  // keeping its pace for letting go (`turning`: { v, t, acc }). The pace is
  // taken over at least a frame's time: two fingers' moves come in pairs.
  const turn = (turning, at, da, t) => {
    camera.turnAt(...at, da);
    if (!turning.t) return Object.assign(turning, { t, acc: 0, v: 0 });
    turning.acc += da;
    turning.last = t;
    const dt = t - turning.t;
    if (dt < 16) return;
    const v = (turning.acc / dt) * 1000;
    turning.v = turning.v ? turning.v * 0.5 + v * 0.5 : v;
    Object.assign(turning, { t, acc: 0 });
  };
  // ...and letting it go: it coasts on only if it was still turning just now
  const letGo = (turning, at, t) => {
    if (turning?.last && t - turning.last < 80) camera.letGo(at, turning.v);
  };
  const middle = () => [innerWidth / 2, innerHeight / 2];

  el.addEventListener('contextmenu', (e) => e.preventDefault());
  // no autoscroll / paste on middle click
  el.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  el.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

  el.addEventListener('pointerdown', (e) => {
    notePointer(e);
    camera.spin = null; // a hand on the map stops it turning
    try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    if (e.pointerType !== 'mouse') {
      touches.set(e.pointerId, local(e));
      if (touches.size === 2) {
        // second finger: stop the one-finger pan / tap, start pinching
        drag = null;
        pinch = { ...pinchState(), twist: 0, turning: {} };
        return;
      }
      if (touches.size > 2) return;
    }
    drag = { id: e.pointerId, type: e.pointerType, button: e.button, x: e.clientX, y: e.clientY, last: null, moved: false };
  });

  el.addEventListener('pointermove', (e) => {
    const isMouse = e.pointerType === 'mouse';
    if (!isMouse && touches.has(e.pointerId)) {
      touches.set(e.pointerId, local(e));
      if (pinch && touches.size === 2) {
        const next = pinchState();
        camera.pan(next.mid[0] - pinch.mid[0], next.mid[1] - pinch.mid[1]);
        camera.zoomAt(...next.mid, next.dist / pinch.dist);
        // the fingers' turn on screen, the same way round on the ground
        const da = Math.atan2(Math.sin(next.angle - pinch.angle), Math.cos(next.angle - pinch.angle));
        if (Math.abs(pinch.twist) < Camera.TURN.dead) pinch.twist += da;
        else turn(pinch.turning, next.mid, da, e.timeStamp);
        pinch = { ...next, twist: pinch.twist, turning: pinch.turning };
        return;
      }
    }
    if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      const threshold = isMouse ? DRAG_THRESHOLD.mouse : DRAG_THRESHOLD.touch;
      if (!drag.moved && Math.hypot(dx, dy) > threshold) {
        drag.moved = true;
        drag.last = [drag.x, drag.y];
        el.classList.add('panning');
      }
      // step by step: past the edge of the map the drag gets heavier
      // (Camera.pan). The right button turns the view instead, around the
      // middle of the screen: dragging right carries the near side right.
      if (drag.moved && drag.button === 2 && isMouse) {
        drag.turning ??= {};
        turn(drag.turning, middle(), -(e.clientX - drag.last[0]) * Camera.TURN.px, e.timeStamp);
        drag.last = [e.clientX, e.clientY];
      } else if (drag.moved) {
        camera.pan(e.clientX - drag.last[0], e.clientY - drag.last[1]);
        drag.last = [e.clientX, e.clientY];
      }
    }
    if (isMouse) onPointer(...pick(e));
  });

  const release = (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2 && pinch) {
      letGo(pinch.turning, pinch.mid, e.timeStamp);
      pinch = null;
    }
  };

  el.addEventListener('pointerup', (e) => {
    release(e);
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    el.classList.remove('panning');
    if (d.moved) return letGo(d.turning, middle(), e.timeStamp);
    onPointer(...pick(e));
    if (d.button === 0) onClick(e);
    else if (d.button === 2) onCancel();
    else if (d.button === 1) onMiddle?.();
  });

  el.addEventListener('pointercancel', (e) => {
    release(e);
    drag = null;
    el.classList.remove('panning');
  });

  el.addEventListener('pointerleave', (e) => {
    if (!drag && e.pointerType === 'mouse') onPointer(null);
  });

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.zoomAt(...local(e), Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
}
