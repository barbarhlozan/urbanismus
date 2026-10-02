// The map's look, fixed: thin white vector lines on black, like an
// instrument approach chart. Line widths live in styles.css and stay the same
// on screen at every zoom (non-scaling strokes), so the drawing reads the same
// close up and far out.

export const STYLE = {
  relief: 3,       // grid steps the map rises from the lowest to the highest
                   // ground, following the contour lines (render/warp.js)
  warp: 0,         // 0–1 slow sideways bending, unrelated to the terrain
  tremor: 0,       // 0–1 fine wobble on top of it
  contours: false, // terrain contour lines at the start (the Terrain button switches
                   // them; they cost the most to draw, so they start off)
  hoverTags: true, // leader line + boxed label on whatever is under the pointer
};
