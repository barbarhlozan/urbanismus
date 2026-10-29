# WebGL: the map drawn on the GPU

The plan for moving Dědina's map from SVG and full-window 2D canvases to
WebGL, so that it runs at a steady 60 fps on a sharp (Retina) screen in
Chrome **and** in Firefox / Zen (the user plays in Zen, Firefox 157 based).
Written 2026-10-21 at the end of two days of profiling; everything below was
measured, unless it says otherwise.

## Where we are

### Measured (Pupíkov: 384 buildings, 1,069 trees; 1440×900 at 2×)

| | Chrome before | Chrome now | Zen now (user's profiles) |
|---|---|---|---|
| still | 60 | 60 | ~23 by day, 4–9 at night |
| pan | 55 | 59 | ~23 |
| zoom | 26 | 44–49 | ~27 |
| settle after zoom | 8 | 30–50 | – |
| turn | 9 | 20–30 | – |
| JS heap | 869 MB | ~480 MB | |

Chrome numbers move ±20–50 % with machine load; compare only back-to-back
full runs (`tools/perf/README.md`).

### What limits it now

**Chrome:** what is left is the browser redrawing the SVG: the objects' SVG
(buildings, trees, lamps) is one raster layer, so any change in it — a
swaying tree, a building redrawn for a new level of detail, a turn's landing
batch — repaints all of it (~80 ms GPU); zoom restyles every line
(`--stroke`); a turn re-projects every road, path and railway at each angle
(they're kept on the ground, `groundLines`, but projected and written as
path data each frame).

**Firefox / Zen (macOS):** canvases are drawn on the CPU and every new
picture of one is copied to the GPU whole ("Texture uploads" ~29 ms a
frame); a full-window canvas at 2× is 21 MB. Its OS compositor makes every
canvas a surface of its own: ~600 small tile canvases cost ~25 ms a frame
(94k `SurfacePool` markers) — tiling canvases was a mistake there and was
reverted. Whole-map restyles cost ~40 ms each (35k elements): toggling
`svg.draft`, each `--ink-night` step, each day step (`setSun` rewrites
every shadow, `sunFree.js` rewrites its stylesheet). The Zen window also
pays for the user's extensions (Pocket Bird queries the DOM on a timer,
iCloud Passwords scans it after load).

WebGL removes all of these at once: the drawing stays on the GPU, a pan,
zoom or turn is a new camera matrix, nothing is restyled, rasterised or
uploaded per frame.

### Done so far (commits on main, oldest first)

- `Perf bench` — tools/perf: headless Chrome via CDP (`bench.mjs`
  variants/scenarios, `profile.mjs`).
- `Lighter motion` — sway 12 fps and still while moving; turns keep 5 steps
  ready each way (was 12; heap 911 → 480 MB); roads/paths/rails keep their
  ground lines (`groundLines`); north arrow updated by attributes (its
  innerHTML made `penMarks.js` re-measure every turn step).
- `Draft motion` — `svg.draft` while the view moves (no meadow tufts, parked
  cars, `.d2` detail, object shadows); shadows hatched back in 3 steps; a
  turn's landing redrawn a few a frame (`landFrame`).
- `Shadow canvas` — the shadows (one mask of every object's and the hills'
  over a hatch sheet) are no longer painted by the browser: `shadeCanvas.js`
  mirrors the mask DOM onto two canvases (hills; objects minus hills) drawn
  in a worker (`shadeWorker.js`), dashes cut once.
- `Parked over shadows` — parked cars in their own `#parked` svg.
- `Canvases on twos` — `follow.js`: clouds (6 fps), smoke and rain (12 fps)
  drawn now and then and moved with the map (CSS transform) in between.
- `Agent tiles`, `Night tiles` — **reverted** (`Whole canvases`), see above.
- `Canvas sharpness` — **reverted** (`Full sharpness`): the user wants all or
  nothing; moving things soft over a sharp map looks wrong.
- `Night on twos` — the night at 12 fps via Follow on a window + 96 px
  canvas, its grey and strokes kept on a sheet (`paper()`), grey in steps.

## Constraints (from the user, keep to them)

- **The look is the point.** Hand-drawn pen sketch (`LOOK` in painter.js,
  `hand-drawn-look` memory), Czechoslovak 50s–80s buildings, avoid the "AI
  look" (no bounce, blur, glow, generic shapes; read the `avoid-ai-look`
  memory before UI or motion work). Lines are thin (pens 0.5–2 css px at
  2×), wobbly, overshooting at corners, ragged-edged shadows. The WebGL map
  must look the same as the SVG one — compare screenshots side by side at
  2× before replacing anything.
- **Full sharpness everywhere**, no lower render resolution for parts.
- Plain JS, no build step, ES modules. A library is fine only as one
  vendored file or a pinned CDN ES module; prefer none (raw WebGL2).
- Work on `main` in the main checkout, no branches/worktrees; commit only
  your own files (the user edits in parallel — check `git status`, stage
  hunks; never `git stash`); commit subjects one word, three at most.
- Don't test in the user's real town in the browser pane (it autosaves); use
  saved towns via tools/perf, which seed a fresh profile.
- Keep photo mode (`photo.js`) as it is: it builds its own SVG.

## The renderer as it is (what to replace)

- `src/render/renderer.js` (~4,000 lines) owns the DOM: `#ground` (terrain),
  `#world` (meadow, lots, forest, paths, rails, roads, fences, the shadows'
  mask DOM, ...), `#parked`, `#objects` (buildings, trees, lamps, mist,
  notes, overlay). `LAYERS`, `TOP`, `placeView` (pan/zoom as a CSS
  transform of the `.view` wrappers, redrawn at rest), `turnFrame` / `land`
  / `prepareTurn` (turning), `renderObjects`, `updateLod` / `bandOf`
  (levels of detail per object), `cull`.
- The painters produce **SVG strings with classes**: `painter.js` (houses:
  walls, roofs, hatching, windows; `LOOK`), `structures/*.js`, `features/
  trees.js`, `kit.js`. Styling — colours, line widths times `--stroke`,
  detail classes `d1`/`d2`, `lv1`, `bare`, roof tiers `rh1–3`, sun classes
  `wd*`/`wl*`/`tq*` (`sunFree.js`) — lives in `styles.css`. The same strings
  can be parsed into geometry: `agentCanvas.js` already does this for
  people and vehicles (`shapesOf`, class → style table `STYLES`).
- Lines on the ground: `ink.js` (`InkLayer`: items with keys, pen draw-in
  and erase along the line, dashed lines), fed by `roadItems`, `pathItems`,
  `railItems`, `fenceItems` (world points, projected by `screenLines`).
- Projection: `camera.js` `project(x, y, z)` = lift (terrain height, a fixed
  function of x, y: `warp.js makeLift`) and warp (a fixed sideways drift,
  `makeWarp`) applied per point, then rotation by `angle` and the isometric
  projection — **linear once lift and warp are baked into each vertex**, so
  a turn is a matrix, exact over the hills.
- Pen animations: `draw.js` (stroke-dash reveal per element, fills fading
  in), `InkLayer` for lines, `sketchIntro` on opening; hover squash
  (`markHovered`), tree sway (`swayTrees`), ghosts erased (`reapGhosts`).
- Shadows: `shadows.js` `shadowMask` (shapes), `hatch.js` (the paper's
  strokes: `hatchTileLines`, tiers), `hillShadows.js`, `shadeCanvas.js` +
  `shadeWorker.js` now. Night: `nightCanvas.js` (grey, 3 hatch sets
  revealed in sweeps, lights cut out: lamps' pools, lit windows,
  headlights), `lights.js`. Clouds `cloudShadows.js`, rain `rain.js`, smoke
  `particles.js`, mist `mist.js`.
- Moving things: `agentCanvas.js` (`#agents`, `#trains-top`), drawn by
  `renderAgents`, `renderTrains`, `renderBoats`, `renderAnimals`.

## Progress

- **Steps 0–1 done** (commit `WebGL lines`, 2026-10-22): `src/render/gl/
  lines.js`, switchable in the Debug panel (off by default). Measured on
  Pupíkov, back-to-back: turn 25–28 → 35–37 fps (JS 690 → 490 ms/s),
  settle 46–49 → 51–52, the rest unchanged (lines were only part of it).
  Look: `tools/perf/imgdiff.mjs` against the SVG — no placement offset
  (any ¼ px nudge doubles the difference), dashes carried on across items
  as ink.js does, mean difference on inked pixels ~16/255 at rest, ~8
  mid-turn; what is left is how the two rasterisers smooth an edge.
- **Order changed** after that: what costs most is the objects' SVG
  (Chrome) and the moving things' and shadows' canvases (Firefox: every
  frame re-uploaded); the terrain costs little in either. So step 4
  (moving things) goes next, then 3 (hatching: shadows, night, clouds),
  then 5 (objects) and 2 (terrain).
- **Step 4, first part done** (commit `WebGL movers`): people, vehicles,
  trains, boats, animals and crossing signs drawn with WebGL
  (`src/render/gl/movers.js`, Debug panel, off by default): each frame one
  stream of filled triangles and pen segments in the 2D canvas's exact
  order, one draw call; shapes flattened and triangulated once
  (`src/render/gl/geometry.js`, written by a helper agent, 54 tests).
  Look: within ~4 % of the 2D canvas's ink (fills multisampled, not exact
  coverage). Chrome: turn 26 → 37 fps with lines and movers on, the rest
  unchanged (the per-frame stream costs ~0.5 ms of script). Smoke and rain
  still on 2D canvases.
- **Step 3 done** (commits `WebGL shadows`, `WebGL night`, `WebGL clouds`,
  each in the Debug panel, off by default): `src/render/gl/hatching.js` –
  the paper's strokes as a tile texture (the 2D patterns' raster, at a
  quarter of a doubling's zoom steps), shapes from path data as pieces
  (fills, the ragged dashed edges, the trunks' lines) sampling it in scene
  px, unioned with blending MAX; left-out parts by the stencil (shadows: the
  lamps' pools, a sun sweep's clip) or a mask drawn in order (night).
  `gl/shadows.js` reads the same mask DOM as shadeCanvas.js (no worker);
  `gl/night.js` the ground's and the objects' night in the map's wrappers;
  clouds in `cloudShadows.js` (setGl). Look against the 2D: ink 1.02
  (shadows), 0.999 (night), 0.998 (clouds). Chrome: no change. **Zen at
  night: pan 4.3 → 36 fps, zoom 4.3 → 30, idle 44 → 59, turn 4 → 8; by
  day pan 23 → 39, zoom 28 → 34.** What holds turns (7 fps) and settles
  (16–18) back now is the objects' SVG: step 5. Its ceiling, measured in
  Zen at night with all of the above on and #view-top hidden: idle and pan
  60, zoom 52, settle 35, turn 14 (the objects' turn work still runs).
- **Step 5, first part done** (commits `WebGL objects` … `Object fades`,
  Debug panel, off by default): `src/render/gl/objects.js` draws the
  buildings, trees and lamps from their own SVG (entry.g), which stays in
  the page `display: none`. Styles asked of the browser once per kind of
  element (classes from the object's group down plus inline attributes;
  ~100 kinds) on private copies in a hidden probe group, into a style table
  texture – zoom, detail, sun and night ink only update the table.
  Transforms on an object's group and its children (slides, sway, hover
  squash) are matrices in a texture; any other change rebuilds that
  object's pieces. Painter's order = Renderer.order, one draw per object.
  The pen: draw.js keeps its plan on the groups (`group.pen`, `penWatch`)
  and measures lengths through `penLength` (not laid out); the shader
  reveals strokes along their length and fades fills on the same times.
  Group fades (`group.fade`: a landed turn's old drawing, mist-under) and
  CSS opacity followed. Turn views for ±3 steps prebuilt while resting.
  Boxes for hover and the UI from the pieces (buildingBox, markHovered).
  Look: ink 1.01 at rest, the same mid-turn and mid-pen. **In mist the
  SVG objects come back** (pattern-filled mist covers, mist under the
  objects: not on the GPU yet).
  **Zen, everything on the GPU: night pan 58, zoom 41, settle 29, turn 16;
  day pan 59.5, zoom 47, settle 35, turn 13** (from 5 / 4 / 15–19 / 4–7
  this morning). Chrome turn 15 → 18.
  Left: mist on the GPU; smoke and rain; turns (each step's drawings are
  still painted as SVG strings and parsed) and settles; switch it all on by
  default once the user has seen it in Zen; then take the SVG out (step 6).
- **2026-10-22 evening: on by default** (commit `WebGL by default`,
  `Renderer.useWebGL`), after the user tried it in Zen ("runs amazing").
  The user asked to measure in Chrome only from now on (Zen just has to stay
  playable). Since: turn views prepared in idle time (`schedulePrepare`),
  rebuilds of objects spread over frames (6 ms a frame), faster path
  reading, object boxes from cached lifted corners, each object's shadow
  pieces kept, rain on the GPU (gl/movers.js segments). Tried and dropped:
  a separate probe document for styles, a cache of whole drawings' pieces
  (too many distinct drawings). Chrome now, everything on the GPU: idle/pan
  60, zoom ~49, settle ~55, unzoom ~51–56, turn ~37–40 (SVG path: turn
  ~29). Left: smoke and mist on the GPU; the renderer's own redraw at
  level-of-detail changes (updateLod, updateWoods' first findForests, the
  painters' SVG strings); taking the old paths out (step 6).
- **Step 6 (most of it), 2026-10-22 night**: the old ways taken out, at
  the user's word – `shadeCanvas.js`, `shadeWorker.js`, `nightCanvas.js`,
  `follow.js`, AgentCanvas, the SVG ink layers (ink.js keeps only the pen's
  timing), the 2D paths of rain, clouds' shadows (and their wash/pen looks)
  and smoke, the Debug panel's switches, `Renderer.useWebGL`. The GPU
  canvases are in index.html from the start (#map-gl, #shade-canvas,
  #night-ground, #night-top, #objects-gl; #agents, #trains-top, #smoke,
  #cloud-shadows, #rain hold WebGL contexts). Without WebGL 2 the opening
  cover says so and the game stops (text key `noWebGL`). Still SVG: the
  terrain, meadow, lots, forest far out, parked cars, overlay, notes, and
  the objects' SVG as the GPU's source. **The one switch left: in mist the
  objects show as SVG (glObjectsAside)** until mist is on the GPU.
  Re-reading every object's shadow costs ~9 ms (on a change of objects);
  cache pieces per element if that shows.
- **Mist on the GPU, 2026-10-22 night**: the last switch gone. The mist's
  layer is drawn by GLObjects under the objects (`watch(layer, { under })`),
  its covers as part of each object; a fill whose computed fill is a
  `url()` is filled with the paper's strokes (`setTile`: mistHatch's
  settings, tier 3, drawn per quarter-doubling of zoom), in `--bg`. The
  mist's coming and going is a pen plan (draw.js `group.pen`, marked
  `mist`): times with the end before the start take a line back / thin a
  fill away. `hatchTile`, `mistTile`, `placeInOrder` removed.

- **Terrain lines on the GPU (step 2, first part), 2026-10-29**: mid-turn
  the terrain didn't turn at all – its GL mirror canvas (makeGlMirrors)
  sat beside the <svg> that got the sheet's CSS transform – so the rivers
  and hills slid off the roads and bridges until the view rested. Now the
  contours, steep strokes, shores, banks and waves are a GLLines layer of
  their own (`#terrain-gl`, under the world's layers), in world space with
  the relief and warp in each point (`terrainItems`), so they are exact at
  any angle as the roads are; their pens and colours are styles.css's,
  asked of hidden probe paths (`terrainStyles`: scheme, level of detail,
  --stroke, night ink). The ground's mirror canvas now takes the sheet's
  transform mid-turn too. Look against the SVG at rest: mean ink
  difference 0.1–0.5/255 (contour view 2.6, ink 1.025). Still sheet-turned
  (close on flat ground, off over hills): brows, rock faces, summit marks,
  the painted schemes' water washes, hill shadows, forest, meadow.
- **Hill shadows raised on the GPU**: the hill shade's rings go to
  gl/shadows.js laid flat with each point's height (`flatPoint`, the
  path's `ground`), filled and dashed once (`Pieces.ground`); mid-turn the
  sheet's matrix turns them flat and the shader raises each point by its
  height (`rise`), so they stay on their hills. A sun sweep's copy of the
  mask still reads the path data as before.
- **Trees flickering mid-turn**: an object put in for its next step's view
  (swapIn) wasn't drawn by gl/objects.js until its pieces were built (6 ms
  of building a frame), so whole groves vanished for a frame or two (23 of
  24 objects in sight, measured). The new group now carries the one it
  replaced (`standIn`), drawn until it is built: at most 1 missing.
- **Brows and rocks on the ground**: the brows are still worked out for the
  view (visibility, browLines, on the screen), but each pencil stroke is put
  back on the ground (`browOnGround`: its column u, where along it the brow
  lies, t, carried from browLines, and the height that shows it just where
  it is drawn) and drawn by the terrain's GLLines with the rock faces and
  lips (world lines); so mid-turn they stay on their hills, and the outline
  is worked out anew where the view rests. GLLines' style tables 32 -> 48.
  Still sheet-turned: summit marks, the painted schemes' water washes.

## The plan

Each step lands on its own, switchable in the Debug panel against the SVG
it replaces until it matches, then the old path goes. After each: screenshots
side by side at 2× (`tools/perf` has the recipes: `compare`-style CDP
captures with `clip`), `node --test tests/*.test.js`, the Chrome bench, and
the Zen bench (`tools/perf/firefox.mjs`, run by the user in their terminal).

0. **The GPU map** — one full-window WebGL2 canvas (`#map-gl`) under the
   SVGs, its own module (`src/render/gl/`). A camera uniform from `Camera`
   (zoom, pan, angle; tile, zScale) so a pan/zoom/turn is a uniform change.
   Vertex positions in world space with lift and warp baked in
   (`camera.lift`, `camera.warp`, recomputed when the terrain changes).
   **A line renderer for the pen**: instanced segments with round joins and
   caps, width in css px times the map's `--stroke` and `lineWeight`
   (`Renderer.updateStroke`), antialiased in the shader (thin lines must
   look like the SVG's at 2×), dashes by distance along the line, a reveal
   uniform for the pen's draw-in / erase (as `InkLayer`/`draw.js`), colours
   from `THEME.palette` (and the night's ink mix, `--ink-night`). Fills by
   triangulation (earcut-style, write it or vendor one small file).
1. **Ground linework first** (the prototype): roads, kerbs, driveways,
   zebras, footpaths, rails and track, fences, bridges — from the items
   `roadItems`/`pathItems`/`railItems`/`fenceItems` already give (world
   points, keys, classes → styles from styles.css). Pen draw-in and erase
   per item as `InkLayer` does. Measure a turn (it re-projects all of these
   every frame now) and zoom. **Show the user the look before going on.**
2. **Terrain**: contours, water and shores, brows, steep strokes, rocks,
   meadow tufts (per chunk), the forest far out, lots and gardens.
3. **Hatching as a shader**: the paper's strokes (`hatch.js`: lattice,
   tiers, angle, pen) drawn procedurally in scene space, masked by shapes:
   object and hill shadows (with their ragged dashed edges), the night's
   three sets with their sweeps, cloud shadows, roof hatching maybe. Lights
   cut out. Replaces shadeCanvas/shadeWorker, nightCanvas, cloudShadows.
4. **Moving things**: people, vehicles, trains, boats, animals, crossing
   signs (their shapes already parse into paths), smoke, rain — instanced,
   in the same pass, so nothing is uploaded per frame.
5. **Buildings, trees, lamps** last, the hardest: per object and per turn
   step its painter SVG parsed into GPU geometry (fills and pen lines,
   classes → styles, the sun-free classes as per-vertex flags the shader
   shows or hides by the sun, levels of detail as flags too), drawn in the
   painter's order (`isoSort`, `reorder`) or with depth; per-object uniforms
   for the hover squash, sway, slide, fade; the pen's draw-in per stroke
   (`draw.js` order: ground, outlines back to front, details).
   `prepareTurn`'s views become GPU buffers per angle step (much cheaper
   than detached DOM).
6. **Take the SVG out**: what's left in it (overlay, hover tags, road
   marks, text) stays SVG or HTML over the canvas; photo mode as it is.

The user also suggested **fixed zoom levels** (stepping between a few scales
instead of a free zoom, with a designed transition): with the map on the
GPU it is a matter of how zooming should feel, not speed — worth proposing
once step 5 lands, not before.

## Tools

- `tools/perf/bench.mjs`, `profile.mjs` — Chrome (see `tools/perf/README.md`;
  `--cpu` draws without the GPU; results depend on load and scenario order).
- `tools/perf/firefox.mjs` — the same scenarios in the user's Zen over
  WebDriver BiDi, with a fresh profile; it opens a window, so it must run in
  the user's own terminal (an app sandbox can't open windows). Reached
  "game running" once; its frame numbers are still unseen. Playwright's
  Firefox doesn't start on macOS 27 (sandbox extension refused, headless
  compositor broken) — don't use it.
- `tools/perf/gecko/` — reading a Firefox profile the user records
  (profiler.firefox.com › Upload › Download, then gunzip): `threads.mjs`
  (which thread is the game's), `timeline.mjs`, `analyze.mjs`, `markers.mjs`
  ('Texture uploads', 'Styles' with elementsStyled, 'RefreshDriverTick'),
  `callers.mjs`. Format: shared stack table, `prefix = i − prefixOffset[i]`,
  `samples.threadCPUDelta` in µs.
- Towns to test with: the user's saves in ~/Downloads (`Pupíkov`,
  `Třebenice`, `Kladno`, `Zadní Újezd`…).
