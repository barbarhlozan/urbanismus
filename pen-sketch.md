# The pen sketch of buildings

Decided with the user on 2026-10-25 in `house-lab.html`, on one test piece:
the village house with its gable to the street (`house`, kind `street`,
seed 16). Every other building follows the same rules, and new drawings
should be drawn to them.

The lab draws that house from all four sides at the map's zooms (1×, 2×,
4×), with every roof and wall paint, and has the knobs live. Its "Copy
settings" gives what differs from the code.

## The hand

A steady hand, between loose and ruled (rebased 2026-10-26):

- A little wobble: `LOOK.sketch` 2.5 (was 5).
- No overshoots at the corners: `LOOK.overshoot` 0 (was 1.5).
- Houses a little askew: `LOOK.tilt` up to 8° either way (was 10°).
  Houses on a bend still turn to their road.
- No foot stroke under the walls: `LOOK.ground` 0.
- Corners can be rounded off, separately for walls, roofs and windows'
  frames (`LOOK.round`, scene px at tile 32, at most a third of an edge).
  All 0 for now, sharp; to be tried in the lab.
- All three pen schemes (Blue pen, Black pen, Countryside) draw with this
  hand. Only Watercolour is `clean`: it keeps 0.15 of the wobble and
  tilt and no overshoot (`CLEAN` in painter.js).

## The pen's line (`BRUSH` in src/render/brush.js)

Every line on the map is drawn with one brush, set in one place. That
covers buildings, trees and lamps; roads, paths, railways and fences;
people, vehicles and animals; and the pencil hatching of shadows, night
and cloud shadows. Change `BRUSH` and all of them follow; `on: false`
draws even lines everywhere.

A stroke is not even from end to end, as with a pencil:

- Each stroke runs from corner to corner. A turn sharper than 0.7 rad
  (about 40°) ends it and starts the next.
- A little thinner at its ends: `taper` 0.25 over `fade` 3 scene px.
- It swells and thins a little along its length: `swell` 0.2, about every
  4.5 scene px (9 screen px at zoom 2 in the lab).
- Each stroke is up to 20% heavier or lighter than the next (`weight`).
- Strokes are 1.2× the pen's width overall (`width`).

The terrain (contours, hill brows, rocks, steep slopes, shores, waves,
ponds), the meadow, the lots and the forest are drawn with WebGL from their
SVG too (`Renderer.makeGlMirrors`), so they take the brush as well. Not yet
brushed: the forest's hatched edge band (a clipped pattern, left to the
SVG), road marks and the build overlay, photos, the flames and the UI's
frames and icons. The lab also tried pencil grain and ragged
edges: left off for now.

## Detail

- Roof hatching 0.0225 apart (`LOOK.hatch`), thinned further out so the
  strokes stay at least 1.5 px apart on screen (`config.render.roofGap`).
- The walls turned from the sun are hatched (`SUN.strokes`), 0.04 apart,
  leaning 46°.
- Windows: ink blocks, not upright, 1.2× fewer than the bays
  (`LOOK.ink`, `tall: false`, `thin`). Close up they open into frames, with
  glazing bars from 0.6 px wide (`LOOK.open`, `LOOK.pane`).
- Windows stand at least 0.08 from a wall's corners (`LOOK.clear`), so the
  corner's line never runs into them; they spread evenly between.
- A thin eave board (`LOOK.fascia` 0.006). No storey lines, no sills.
- A gable end is one wall from the ground to the peak, with no line across
  it at the eaves. The roof doesn't overhang it, so the ridge ends exactly
  on the gable's peak and the two never drift apart (`_walls` gables in
  painter.js).

## Countryside's colours (styles.css, html.tint)

The colour is carried by the lines; the faces stay paper.

- Roofs as in a Czech village of the 60s–80s, pastel. Each is listed as
  lit / dark side:
  - r0 clay tiles (bobrovky, drážkové tašky): #c97a5c / #a95f46
  - r1 the same tiles weathered: #a87262 / #8a5a4c
  - r2 grey eternit: #9d9d9f / #7f8084
  - r3 tar paper (lepenka) on wooden buildings: #7f7770 / #655e58
- A roof's outline takes 59% of its paint, its hatching 54%. A wall's
  outline takes 36% of its paint. The rest of each is ink.
- A wall's dark side is only a little darker: 14% of #7d7488.

How common each roof is (`ROOF_OF` in painter.js, by a drawing's paint
number, 0–11): clay tiles 5 in 12, eternit 4, weathered tiles 2, tar paper 1.
Tar paper goes with timber walls, so wooden houses are rare. This applies to
Watercolour too.

No yellow or blue roofs. The watercolour scheme keeps its own colours.
