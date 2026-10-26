# Drawn buildings

Test sheets for hand-drawn buildings, tried out on drawn-lab.html (not in
the game yet). Two ways: line sheets (SVG, below; src/lab/lines.js) and
painted sheets (PNG from Procreate, colouring the faces of a building
the game already draws; src/lab/faces.js, see the page).

Line sheets: the walls and roof drawn as strokes, each pinned onto the
house as a 3D line, so it turns, gets the sun and the night, and goes into
photos.

1. Make the blank sheet: `node tools/drawn-template.mjs` writes
   `chalupa-template.svg`.
2. Copy the template to `chalupa.svg`
   and draw on it in any vector app (Inkscape, Affinity, Figma, Concepts…).
   - The house is unfolded: left side, front, right side, back in a row,
     each seen from outside, left and right as seen from the street; the
     roof seen from above sits over the front, its lower edge the front's
     eaves, the dashed line its ridge.
   - Draw inside the outlines. Strokes mostly outside every panel are
     left out (use that for notes).
   - Windows in blue: each blue stroke's bounding box becomes a window
     like the game's own (lit at night, framed in photos).
   - Any other colour is a pen line. Stroke width and colour don't carry
     over: the game draws with its own pen.
   - Don't move or resize the canvas or the outlines (the group
     `template`, which the game leaves out).
3. Reload drawn-lab.html.

The shape of the house (its width, depth, wall and roof height) is
CHALUPA in src/lab/lines.js; for now it is always a gabled
house with its gable to the street. Change the sizes and make a new
template: the old drawing won't fit any more.
