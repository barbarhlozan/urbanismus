# Urbanismus

A little black-and-white isometric city builder. Plain JS, no build step.

## Running it

```
python3 serve.py
```

Then open http://localhost:8173. The city saves itself in the browser; **New map** starts over.

## Controls

- **Click the map** – menu for the nearest dot (build, road from here, remove); the dots
  themselves only show while building
- **R** roads, **F** footpaths – click start, click end; **Tab** flips the bend
- Draw a footpath **along a road** (on it or right beside it) to make it a street with sidewalks (kerb lines on both
  sides). People only walk along streets and footpaths; cyclists and cars use every road.
  Demolish on a street removes its sidewalks first.
- **L** railways – drawn like roads, but bends can be at most 45° per dot. They cross roads
  and footpaths (level crossings) but can't share a stretch with a road. Run a line off the map
  edge and trains start coming through. Cars, cyclists and pedestrians wait at a crossing while
  a train passes (barriers come down across roads) – see `crossing` in `src/config.js`.
- **0** – station (1×3 station house) or **Stop** (1×2 platform with a shelter), beside a straight
  stretch of track; they turn to face it. Trains stop at every station they pass, and turn round
  at the last one when there's no other way off the map. With a road behind, a station gets a
  forecourt (or parking) towards it.
- **1 2 3** – residential / business / industrial (**Tab** rotates, **C** tries another look)
- **I** – small (1×1) industry
- **4–9** – parks, squares, services
- **X** – demolish
- **V / Esc / right-click** – back to select
- **Drag / wheel** – pan / zoom, **Q / E** – rotate view
- **Space** – pause, **T** – speed, **Terrain** button – contour lines (off by default,
  they are the most expensive thing to draw)

On a phone it's all taps: tap once to preview, tap again to confirm.

## How it works, roughly

- Buildings have three levels and grow on their own when their surroundings are right
  (enough neighbours, a park nearby, service coverage…). Click one to see what it's missing.
- Neighbouring apartments and shops facing the same road often share a wall and form a
  street front; panel blocks join into one long block built in sections.
- The **Heritage** tab has a chapel, a church, a town hall and a plague column. They make
  nearby apartments and offices grow faster, and a church sometimes appears by itself in a
  big enough neighbourhood without one.
- Each building gets a random seed, so it always looks the same, but **C** / **Change look**
  rerolls it.
- People walk, cycle or drive, depending on distance. Cyclists use footpaths and roads and take
  about a third of the trips that would otherwise be by car (`bike` in `src/config.js`).
  Roads that hit the map edge let people leave and visitors come in.
- Cars slow down on crowded roads (`traffic` in `src/config.js`). Pedestrians and cyclists
  aren't affected. The stats panel shows how well traffic flows.
- The look is fixed, modelled on instrument approach charts: thin white lines that keep
  their width at every zoom. The map warp and annotations are set in `src/render/style.js`.

## Where things live

- `structures/` – the buildings (one file per type, registered in `index.js`)
- `features/` – trees and other nature bits
- `src/config.js` – most of the numbers worth tweaking
- `src/theme.js` – colours
- `src/render/` – drawing (`painter.js` has the drawing API at the top)
- `src/sim/` – growth, people, parking
- `src/roads/`, `src/tools/`, `src/ui/` – what they say

**New building:** copy `structures/residential.js`, change the id/name/hotkey, and add it
to `structures/index.js`.
