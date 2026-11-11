# Visual review – 2026-10-10

Played in a private headless Chrome on port 8199, on copies of the Pupíkov and
Třebenice saves from ~/Downloads (the real town in the pane was not touched).
Checked at zooms 0.4–4, both view rotations, all five weathers, photo mode,
and at devicePixelRatio 1 and 2.

## What works

- Zoom 2.5–4 is the game at its best: hatched roofs, ink windows, grey trees
  and blue buildings read as one drawing. Rotating the view keeps it.
- The village scale (Třebenice): houses, gardens, the winding road and stream
  have the cute "dědina" feel. Paneláky and the sorela tower look right next to
  it, as a contrast.
- Building sizes are believable. At about 24.5 m per grid step the houses,
  cars (Škoda 120 ≈ 4.2 m) and the lokálka are all in proportion.
- Village photos are charming: a skyline of gables, a road running off, the
  clouds behind.
- Cloudy, rain and storm each look different: cloud shadows, rain strokes,
  wind.

## Bugs (not about the style)

1. **Moving things are drawn heavier than the map on Retina.** The map's line
   widths are divided by devicePixelRatio and multiplied by
   `render.lineWeight` (renderer.js:1116). `AgentCanvas.paint`
   (agentCanvas.js:136) does neither. At dpr 2 a car's outline is about 2×
   the road line beside it; at dpr 1 it is 0.83×. Fix: use the same factor.
2. **Grey skies grey out the ink.** `#gloom` is a flat grey layer *over*
   everything, so the blue ink turns mauve and the drawing loses contrast.
   This is most of why overcast looks "mushy". Fix: darken or cool the paper
   (`--bg`) instead and keep the ink as it is.
3. **Cyclists ride through cars.** Bikes keep 0.077 to the right of a road's
   centre. Cars keep 0.044 and are 0.036 half-wide, so they overlap.
4. **Photo, close to the camera:** anything just past `PHOTO.clear` (0.3) fills
   the frame: huge crown blobs and window slabs. Meadow tufts near the camera
   become big "V"s. Garden beds and benches float as flat rectangles. Fix: a
   larger `clear` for trees and shrubs, cap how big a tuft can get, and drop lot
   details closer than about 1 step.
5. **Layering (not checked frame by frame):** everything that moves is drawn
   under `#objects`. That's right for buildings behind them, but a person in
   front of a statue, or a car under a bridge's far railing, is hidden.
6. Small things: the station's bike rack seems to float on its roof. Rain
   keeps falling over the blank paper past the map's edge.

## Things to polish

### Line weights: one pen set
The map uses **17 different stroke widths** (0.3 → 3.6 px) in styles.css, plus
the canvas ones. I'd use the ISO technical-pen series (√2 steps), the one on
Koh-i-noor Rapidographs, which is right for the period and the place:

| pen | px  | for |
|-----|-----|-----|
| 1   | 0.5 | texture: grass, shadows, rock faces, rain |
| 2   | 0.7 | detail: hatching, windows, paving, contours |
| 3   | 1.0 | lines: fences, footpaths, kerbs, trees, figures |
| 4   | 1.4 | structure: building outlines, roads, the foot stroke |
| 5   | 2.0 | accents: zebra, thick trunks, buffers |

The rail symbol stays its own thing. Put them in `--pen-1…5` and map the
current values to the nearest pen. The wobble keeps it from looking
mechanical. Break the set on purpose in one or two
places (the town name, the rail symbol).

### Roads
- Roads are drawn 0.176 steps wide, about 4.3 m. A car takes up almost half of
  it, so roads look thin next to the plazas. Try `road.edge` 0.088 → about
  0.11, `kerb` 0.154 → about 0.19, `sim.laneOffset` 0.044 → 0.055.
  (`lots.js` ROAD_GAP has to follow.) Lanes can stay narrow: the difference
  between them is nice.

### Movement
- Speeds per second: car 0.77, bike 0.52, walk 0.28 steps. That's 68, 46 and
  25 km/h. Cars are only 2.75× as fast as walkers (in a real village it's
  about 10×), so people dash and cars crawl. Suggestion for a village pace:
  walk about 0.12, bike about 0.3, car 0.55–0.6. Slower walkers also look
  calmer up close.
- Cars snap between 32 headings. Fine at zoom 2, but they visibly pop on
  curves at 4. Try 48–64 headings, or ease the heading.

### Rails
- At every zoom a railway is the map symbol: a thick line with white dashes, 4
  px. Close up, the 3D lokálka (about 22 px) rides on a ribbon thinner than
  itself, and the station platforms beside it are 3D. Proposal: from about the
  zoom where cars become models (1.6), draw the track as a thing: two thin
  ballast edges (like a road), two rails, and sleepers as short hatching in the
  detail pen. Keep the symbol further out, where it reads as a map.
- The station switches read as sharp kinks; a longer S-curve would help.

### Detail levels
- At zoom 0.9 everything changes at once: windows disappear and buildings turn
  into dark boxes, and woods turn into hatched shapes. Make the far look
  *lighter*, not darker: outlines with sparser roof hatching. Hatching is
  spaced in scene units, so it gets denser as you zoom out until it's a solid
  tone. Keep its spacing on screen above about 3 px.
- Far out, woods are angular, flat grey shapes that look like GIS polygons,
  the least hand-drawn thing in the game. Rounder, broken outlines and loose
  hatching (or tree signs only) would match the old-map reference.

### Weather
- Overcast: besides fixing bug 2, give it something of its own. Ideas:
  **mist**, where the paper takes over: the detail pen fades in low ground and
  far out, valleys go blank and hilltops stay drawn (Czech inversion fog). Or
  low cloud: a few pencil-washed bands drifting slowly. Or keep overcast as a
  short in-between state, so most of the time is fair, cloudy or rain.
- Rain could be longer, straighter lines at one angle, like Hiroshige's, and
  sparser.

### Photo mode
- Line weight should follow distance: heavy in front, hairline far away.
  That's what makes a pen perspective sketch read as deep. Today every line is
  the same weight.
- Keep the spacing of hatching and windows on screen, so near walls get more
  strokes and not bigger ones. Up close, a window could be an outlined frame
  with glazing bars, not a solid ink slab.
- The ground: add a little in the foreground (kerbs, cobble arcs, a few
  pebbles) and leave the rest blank.
- People and cars in the picture, where the map has them, would help a lot.

## References

- **Gordon Cullen, *Townscape* (1961)**: serial-vision pen sketches. The best
  model for photo mode: line weight by depth and blank foregrounds.
- **Koh-i-noor Rapidograph / ISO 128 line sets**: the pen set above.
- **Czechoslovak 70s–80s architectural perspectives** (Architektura ČSSR,
  Stavba): how buildings, cars and people were drawn in that era.
- **Hiroshige, *Sudden Shower over Shin-Ōhashi*** for rain;
  **Hasegawa Tōhaku, *Pine Trees*** for mist as missing paper.
- **Old topographic maps (Czech military 1:25 000)**: rail and forest
  symbols for the far zoom.
- Games: **Pentiment** (a pen world, hatching, weight hierarchy), **Townscaper**
  and **Dorfromantik** (village scale and calm motion), **Return of the Obra
  Dinn** (weather and mood with a limited palette).
