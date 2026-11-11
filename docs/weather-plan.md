# Weather – plan

Hand-off notes for adding weather. Work in three steps, in order, and show
the result to the user after each one before going on.

## Where things are

- **Photo mode**: `src/render/photo.js`. `takePhoto(renderer, shot)` returns
  a standalone `<svg>` string. Its last lines build the picture:
  ```js
  `<rect class="photo-sky" .../>` + skyline(cam, groundAt, range) + `<g class="layer-objects">…</g>`
  ```
  The sky is an empty paper-coloured rect. `skyline()` (bottom of the file)
  draws the terrain's far edge as `photo-ground` (filled) + `photo-horizon`
  (line), so anything drawn *before* it gets hidden behind the hills for free.
  - The photo already has a seeded RNG: `mulberry32(... cam.ex ... cam.ey ... ^ world.seed)`
    (around line 240). Same spot gives the same picture, so use this approach
    for clouds too, with a different salt so the ground marks don't change.
  - Picture size: `PHOTO.width` × `PHOTO.height` (480 × 320).
  - Called from `src/main.js`. `src/tools/photo.js` is the tool and
    `src/ui/photoPrint.js` is the print/frame.
- **Photo styles**: `styles.css` around line 1503 (`svg.photo .photo-sky`,
  `.photo-horizon`, `.photo-hatch` …). Colours are only `var(--bg)`,
  `var(--detail)` and `var(--main)`. Never hard-code colours, because there
  are several colour schemes (`applyTheme`).
- **Pen look**: `src/render/painter.js`. Use `wobble(x, y)` and the `LOOK`
  settings so lines look hand-drawn, like the rest of the game. Ink outlines
  with paper fill, never gradients or blur.
- **Time**: `src/sim/clock.js`. `SimClock.elapsed` holds simulated seconds,
  mirrored into `world.time` each frame (`src/main.js` ~line 534) and saved.
  There is no calendar and no day/night.
- **Save**: `World.toJSON` / `World.fromJSON` in `src/core/world.js`
  (~line 1040). Older saves must still load, so give every new field a default.
- **UI words**: `text/ui.txt` (keys with `cs:` and `en:`; Czech is the
  original, see `text/README.md`). Read them with `t('key')`.
- **HUD**: `src/ui/hud.js`. **Icons**: `src/ui/icons.js`.
- **Dev pages**: `deer.html` and `gallery.html` are examples of standalone
  sketch pages (they import from `src/`, take URL params like
  `?scheme=1&seed=3`, and lay out variants side by side).
- **Tests**: `node --test tests/*.test.js`. Helpers for making small towns are
  in `tests/helpers.js`.
- **Code style**: plain ES modules, no build step. Comments are full
  sentences explaining *why*, and module header comments describe the idea.
  Tunable numbers go in an exported settings object (like `PHOTO`), not
  scattered through the code.

## Step 1 – clouds in photos (random for now)

Goal: the empty sky in photos gets pen-drawn clouds.

1. Make a dev page, `clouds.html`, like `deer.html`. It shows a grid of photo
   skies (the 480 × 320 frame with a simple fake horizon line is enough) for
   several seeds and every cloud style, so the user can choose a look. Do this
   first and let the user pick before wiring anything into the game.
2. Cloud styles to sketch:
   - **fair**: a few scattered cumulus. Bumpy closed outlines (chains of arcs)
     with paper fill and an ink outline, maybe a few short hatch strokes on
     the flat underside.
   - **cloudy**: more and wider clouds, plus a long flat layer near the horizon.
   - **overcast**: an almost continuous low layer with a ragged lower edge.
   - **rain**: like overcast but heavier (denser underside hatching), plus
     slanted rain streaks hanging from the cloud base towards the horizon.
     Try both versions: streaks over the whole sky, and a few distant showers
     only. The user especially liked the idea of distant showers.
3. Perspective without 3D: clouds higher in the frame are bigger, and clouds
   near the horizon are smaller and flatter, packed tighter. Keep everything
   above the horizon. The terrain skyline drawn afterwards covers the low ones.
4. Put the drawing code in a new module, `src/render/clouds.js`, with a
   settings object (`CLOUDS`) and a function like
   `cloudsSVG(rnd, width, height, kind)` that returns an SVG string. Draw
   with classes (`photo-cloud`, `photo-cloud-hatch`, `photo-rain`) styled in
   `styles.css` using the theme variables.
5. Wire it into `takePhoto`: insert the result between the `photo-sky` rect
   and `skyline(...)`. For now pick `kind` at random from the shot's seed.
6. Optional: let the clouds respect the camera yaw (offset them by yaw) so
   turning the camera slides the sky a little instead of drawing a new one.

## Step 2 – the weather state

Goal: the town has weather that changes slowly, and photos show it.

1. Add a small module, `src/sim/weather.js`. It holds the state:
   `{ kind: 'fair' | 'cloudy' | 'overcast' | 'rain', until }` (`until` is in
   simulated seconds). When `clock.elapsed` passes `until`, move to a
   neighbouring state (fair ↔ cloudy ↔ overcast ↔ rain, never a jump from
   fair to rain) and choose a new random duration. Make it deterministic from
   `world.seed` + time so it can be tested. Put the durations and
   probabilities in a settings object (or in `src/config.js` next to
   `config.time`).
2. Store it on the world (`world.weather`), save it in `toJSON` and load it in
   `fromJSON` with a default (`fair`) for old saves.
3. Step it from the main loop next to the other sim systems in `src/main.js`
   (they get `simDt` from `clock.step`), and give it a console command in
   `src/dev/commands.js`.
4. `takePhoto` reads `world.weather.kind` instead of picking at random. The
   cloud *shapes* still come from the shot's seed.
5. Add a test, `tests/weather.test.js`: transitions only go to neighbours,
   the same seed gives the same sequence, and the state survives a
   save/load round trip.

**Decided**: one weather for the whole map. Variety comes from distant
showers in the photos.

## Step 3 – showing it in the game

1. A weather indicator in the HUD next to the clock/speed controls: a small
   pen icon per state (add to `src/ui/icons.js`), with the state's name as a
   tooltip. Words go in `text/ui.txt` with Czech first, for example
   `weather.fair` = cs: Jasno / en: Fair, `weather.cloudy` = cs: Polojasno /
   en: Partly cloudy, `weather.overcast` = cs: Zataženo / en: Overcast,
   `weather.rain` = cs: Déšť / en: Rain. Ask the user to check the wording.
2. The user said **no special effects** for now, so no rain animation over
   the map.
3. Ideas for later. Don't do these unless the user asks: umbrellas on walkers
   (`src/render/people.js`), fewer walkers in rain, deer sheltering under
   trees (`src/sim/deer.js`), a chronicle entry for a long rainy spell.

## Don't

- Don't commit unless the user asks.
- Don't use gradients, blur, opacity fog or photo-realistic effects. It's a
  pen drawing.
- Don't change what's already in a photo (ground marks, buildings). Only add
  the sky.
