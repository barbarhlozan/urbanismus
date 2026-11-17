// The sheet the town is drawn on: a photographed paper (textures/paper.webp,
// its light flattened and its edges made to meet, so it tiles) multiplied
// over the map, under the UI. It is fixed to the ground, not the window:
// it slides with a pan and grows with a zoom, so the drawing stays on the
// same spot of paper.

// One tile across, in scene px (screen px at zoom 1). The photo is 1500 px
// square: 200 makes it 440 screen px at the starting zoom (2.2) and 800
// zoomed all the way in (4), where its fibres are about their own size on a
// 2× screen – finer than that further out.
export const PAPER = { tile: 100 };

export class Paper {
  constructor(el) {
    this.el = el;
    this.last = '';
  }

  frame(camera) {
    const s = PAPER.tile * camera.zoom;
    const key = `${s} ${camera.panX} ${camera.panY}`;
    if (key === this.last) return;
    this.last = key;
    // (the scene's origin, where camera.panX/Y puts it, is a tile's corner)
    this.el.style.backgroundSize = `${s}px ${s}px`;
    this.el.style.backgroundPosition = `${camera.panX}px ${camera.panY}px`;
  }
}
