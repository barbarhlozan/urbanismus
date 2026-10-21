// How sharp the canvases over the map are drawn: canvas px per css px. The
// screen's own (devicePixelRatio, 2 on a sharp screen) unless capped
// (`PIXELS.most`, the Debug panel): a canvas at 1 on such a screen has a
// quarter of the pixels to draw, and to copy to the GPU each time it is
// drawn (Firefox copies every new picture whole), its lines a little soft.
// The map's SVGs are drawn by the browser, at the screen's own; so are the
// shadows' canvases (shadeCanvas.js), drawn only when they change.
export const PIXELS = { most: null };

export const canvasRatio = () => {
  const d = devicePixelRatio || 1;
  return PIXELS.most ? Math.min(d, PIXELS.most) : d;
};
