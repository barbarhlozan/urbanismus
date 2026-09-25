// Pointer input on the world SVG: left click / tap = tool click, drag (any
// button, one finger) = pan, two fingers = pinch zoom + pan, right click =
// cancel, wheel = zoom around the cursor.
//
// Touch has no hover: the hover position only moves on a tap (not while
// panning), and stays where it was when the finger lifts.

import { notePointer } from './device.js';

const DRAG_THRESHOLD = { mouse: 5, touch: 10 };

export function attachInput(svg, { camera, onPointer, onClick, onCancel }) {
  let drag = null;
  const touches = new Map(); // pointerId -> [x, y], for pinch
  let pinch = null;

  const local = (e) => {
    const rect = svg.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  // World position under the pointer (on the ground plane).
  const pick = (e) => camera.unproject(...camera.clientToScene(...local(e)));

  const pinchState = () => {
    const [[ax, ay], [bx, by]] = [...touches.values()];
    return { mid: [(ax + bx) / 2, (ay + by) / 2], dist: Math.hypot(bx - ax, by - ay) || 1 };
  };

  svg.addEventListener('contextmenu', (e) => e.preventDefault());

  svg.addEventListener('pointerdown', (e) => {
    notePointer(e);
    try { svg.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    if (e.pointerType !== 'mouse') {
      touches.set(e.pointerId, local(e));
      if (touches.size === 2) {
        // second finger: stop the one-finger pan / tap, start pinching
        drag = null;
        pinch = pinchState();
        return;
      }
      if (touches.size > 2) return;
    }
    drag = { id: e.pointerId, type: e.pointerType, button: e.button, x: e.clientX, y: e.clientY, panX: camera.panX, panY: camera.panY, moved: false };
  });

  svg.addEventListener('pointermove', (e) => {
    const isMouse = e.pointerType === 'mouse';
    if (!isMouse && touches.has(e.pointerId)) {
      touches.set(e.pointerId, local(e));
      if (pinch && touches.size === 2) {
        const next = pinchState();
        camera.panX += next.mid[0] - pinch.mid[0];
        camera.panY += next.mid[1] - pinch.mid[1];
        camera.zoomAt(...next.mid, next.dist / pinch.dist);
        pinch = next;
        return;
      }
    }
    if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      const threshold = isMouse ? DRAG_THRESHOLD.mouse : DRAG_THRESHOLD.touch;
      if (!drag.moved && Math.hypot(dx, dy) > threshold) {
        drag.moved = true;
        svg.classList.add('panning');
      }
      if (drag.moved) {
        camera.panX = drag.panX + dx;
        camera.panY = drag.panY + dy;
      }
    }
    if (isMouse) onPointer(...pick(e));
  });

  const release = (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
  };

  svg.addEventListener('pointerup', (e) => {
    release(e);
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    svg.classList.remove('panning');
    if (d.moved) return;
    onPointer(...pick(e));
    if (d.button === 0) onClick(e);
    else if (d.button === 2) onCancel();
  });

  svg.addEventListener('pointercancel', (e) => {
    release(e);
    drag = null;
    svg.classList.remove('panning');
  });

  svg.addEventListener('pointerleave', (e) => {
    if (!drag && e.pointerType === 'mouse') onPointer(null);
  });

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.zoomAt(...local(e), Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
}
