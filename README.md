# Urbanismus

A little black-and-white isometric city builder. Plain JS, no build step.

## Running it

```
python3 serve.py
```

Then open http://localhost:8173. The city saves itself in the browser; **New map** starts over.

## Controls

Everything you can build is in the **Build** menu, bottom right: Transport, Zones, Public and
Landmarks, plus Erase. Open a group to see its tools; click a tool to pick it up and click it
again (or close its group, or **Esc**) to put it down. The **–** folds the menu into a single
Build button. Things that come in two sizes (parks, squares, services, industry, station / stop)
are one tool with a **Size** button (**S**). While a tool is in hand, its options (size, rotate,
another look, bend…) are buttons above the bottom edge.

- **Click the map** – menu for the nearest dot (build, road from here, remove); the dots
  themselves only show while building
- **R** roads, **F** footpaths – click start, click end; **Tab** flips the bend
- Draw a footpath **along a road** (on it or right beside it) to make it a street with sidewalks (kerb lines on both
  sides). People only walk along streets and footpaths; cyclists and cars use every road.
  Erasing a street removes its sidewalks first.
- **L** railways – drawn like roads, but bends can be at most 45° per dot. They cross roads
  and footpaths (level crossings) but can't share a stretch with a road. Run a line off the map
  edge and trains start coming through. Cars, cyclists and pedestrians wait at a crossing while
  a train passes (barriers come down across roads) – see `crossing` in `src/config.js`.
- **0** – stations, beside a straight stretch of track (**S** switches size): **Station** (3×2, a
  passing track that leaves the line and rejoins it, an island platform, a station house), **Main
  station** (4×3, two through tracks and two bay tracks ending at buffers, three platforms, a vaulted
  hall with a clock tower) or **Stop** (1×2: platform, shelter and a little waiting house). The
  extra tracks are for show – trains only use the line itself. They turn to face the track. Trains
  stop at every station they pass, and turn round at the last one when there's no other way off the
  map. With a road behind, a station gets a forecourt (or parking) towards it.
- **1 2 3** – residential / business / industrial (**Tab** rotates, **C** tries another look)
- **I** – small (1×1) industry (the industry tool's small size)
- **4–9** – parks, squares, services, small and large (**S** switches size)
- **X** – erase
- **V / Esc / right-click** – back to select; **right-click** with nothing in hand opens the
  Build menu with the last thing you built picked up again
- **Middle click** – same as **Tab** (rotate what you're placing, flip a line's bend)
- **Drag / wheel** – pan / zoom, **Q / E** – rotate view
- **Space** – pause, **T** – speed, **Terrain** button – contour lines (off by default,
  they are the most expensive thing to draw)

On a phone it's all taps: tap once to preview, tap again to confirm. The Build menu starts
folded there and folds again once you pick a tool.

## How it works, roughly

- Buildings have three levels and grow on their own when their surroundings are right
  (enough neighbours, a park nearby, service coverage…). Click one to see what it's missing.
- Neighbouring apartments and shops facing the same road often share a wall and form a
  street front; panel blocks join into one long block built in sections.
- The **Landmarks** group has a chapel, a church, a town hall and a plague column. They make
  nearby apartments and offices grow faster, and a church sometimes appears by itself in a
  big enough neighbourhood without one.
- Each building gets a random seed, so it always looks the same, but **C** / **Change look**
  rerolls it.
- People walk, cycle or drive, depending on distance. Cyclists use footpaths and roads and take
  about a third of the trips that would otherwise be by car (`bike` in `src/config.js`).
  Roads that hit the map edge let people leave and visitors come in.
- Trucks (a cab and a trailer) belong to industrial buildings: most runs export goods off the
  map through a road exit and come back later, the rest are service runs to businesses and
  other industry. Delivery trucks also drive in from outside. See `trucks` in `src/config.js`.
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
