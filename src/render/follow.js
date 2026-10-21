// A canvas over the map drawn only a few times a second – stop-motion, as
// a drawn animation's twos – and in between moved with the map on the GPU,
// as the map's own SVGs are while the view moves (Renderer.placeView): each
// drawing of a full-window canvas is a whole new picture for the browser to
// take in, and Firefox copies every one of them to the GPU anew, so a
// canvas drawn every frame costs it far more than its drawing.
//
//   const f = new Follow(canvas, fps)
//   if (f.due(camera)) { …draw at the camera…; f.drawn(camera); } else f.place(camera);

export class Follow {
  constructor(canvas, fps) {
    this.canvas = canvas;
    this.fps = fps;
    this.at = -Infinity; // when it was last drawn (ms)
    this.view = null;    // the camera it was drawn at
    this.placed = '';
    Object.assign(canvas.style, { transformOrigin: '0 0', willChange: 'transform' });
  }

  // Time for a new drawing (or the view turned: a turn can't be followed).
  due(camera, now = performance.now()) {
    return !this.view || camera.angle !== this.view.angle || now - this.at >= 1000 / this.fps - 2;
  }

  drawn(camera, now = performance.now()) {
    this.at = now;
    this.view = { zoom: camera.zoom, panX: camera.panX, panY: camera.panY, angle: camera.angle };
    this.set('');
  }

  // The last drawing moved to where the map now is: a scene point at
  // pan + zoom · p then is at pan′ + zoom′ · p now.
  place(camera) {
    const v = this.view;
    if (!v) return;
    const k = camera.zoom / v.zoom;
    const tx = camera.panX - k * v.panX, ty = camera.panY - k * v.panY;
    this.set(k === 1 && !tx && !ty ? '' : `translate(${tx}px, ${ty}px) scale(${k})`);
  }

  set(t) {
    if (t === this.placed) return;
    this.placed = t;
    this.canvas.style.transform = t;
  }
}
