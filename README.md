# Urbanismus

A little black-and-white isometric city builder. Plain JS, no build step.

## Running it

```
python3 serve.py
```

Then open http://localhost:8173. The city saves itself in the browser; **New map** starts over, after you pick the new town's name, lakes, forests, hills and river.

## Controls

Everything you can build is in the **Build** menu, bottom right: Transport, Zones, Public and
Landmarks, plus Erase. Open a group to see its tools; click a tool to pick it up and click it
again (or close its group, or **Esc**) to put it down. The **–** folds the menu into a single
Build button; picking a tool folds it too, out of the way, and it comes back when you put the
tool down. Things that come in two sizes or kinds (parks, squares, services, industry,
station / stop, plague column / memorial) are one tool with a **Size** button (**Shift**). While a tool is in hand, its options (size, rotate,
another look, bend…) are buttons above the bottom edge.

The shortcuts follow the Build menu across the keyboard, one row per group, in menu order:
**1–6** Transport, **Q–T** Zones, **A–G** Public, **Z X C V B N M ,** Landmarks. They go by
where the key sits (a US keyboard), so they work the same on a Czech or German layout.

- **Click the map** – menu for the nearest dot (build, road from here, remove); the dots
  themselves only show while building
- **1** roads, **3** footpaths – click start, click end; **Tab** flips the bend
- Draw a footpath **along a road** (on it or right beside it) to make it a street with sidewalks (kerb lines on both
  sides, street lamps, zebra crossings at junctions). People only walk along streets and footpaths; cyclists and
  cars use every road. Erasing a street removes its sidewalks first.
- **2** lanes – single-track roads, narrower than a road. Cars drive them slowly (and avoid
  them when a road will do); people walk and cycle on them as on a footpath, so they get no
  sidewalks. Draw a lane over a road or footpath to turn it into a lane, a road over a lane
  to widen it.
- **4** railways – drawn on the dense dots like footpaths, bends at most 45° per dot; a
  staircase of bends is smoothed into one even curve, so chain them for gentle turns. They
  keep clear of buildings, cross roads and footpaths (level crossings) but can't share a
  stretch with either. Run a line off the map
  edge and trains start coming through. Cars, cyclists and pedestrians wait at a crossing while
  a train passes (barriers come down across roads) – see `crossing` in `src/config.js`.
- **5** – stations, beside a straight stretch of track (**Shift** switches size): **Station** (3×2, a
  passing track that leaves the line and rejoins it, an island platform, a station house), **Main
  station** (4×3, two through tracks and two bay tracks ending at buffers, three platforms, a vaulted
  hall with a clock tower) or **Stop** (1×2: platform, shelter and a little waiting house). The
  extra tracks are for show – trains only use the line itself. They turn to face the track. Trains
  stop at every station they pass, and turn round at the last one when there's no other way off the
  map. With a road behind, a station gets a forecourt (or parking) towards it.
- **6** – bus stop (1×1), beside a road, facing it: a shelter, the stop sign, a bench. Buses only
  come when a road leads off the map: in through an exit, a few stops (nearest next), out again.
- **Q W E** – residential / business / industrial (**Tab** rotates, **.** tries another look;
  **Shift** switches industry to its small 1×1 size)
- **R** – coal mine (pit → colliery → deep mine), **T** – farm (farmstead → JZD → cooperative)
- **A S D** – parks, squares, services, small and large (**Shift** switches size); **F** –
  cemetery, **G** – house of culture
- **Z X C V B N M ,** – landmarks: chapel, church, town hall, plague column, gate tower,
  castle, tower, stadium
- **Backspace** – erase
- **P** – photo: click where to stand, aim with the pointer, click to take a picture of the
  town from street level (**.** lens: 28 / 42 / 80 mm);
  it opens as a print you can save as a PNG
- **Esc / right-click** – back to select; **right-click** with nothing in hand picks up
  what's under the pointer (same building, size and rotation, or the road / railway /
  footpath) to build more of it
- **Middle click** – same as **Tab** (rotate what you're placing, flip a line's bend)
- **Drag / wheel** – pan / zoom, **[ / ]** – rotate view
- **Space** – pause, **`** (backtick) – speed, **Terrain** button – contour lines (off by default,
  they are the most expensive thing to draw)

On a phone it's all taps: tap once to preview, tap again to confirm. The Build menu starts
folded there and folds again once you pick a tool.

## How it works, roughly

- Buildings have three levels and grow on their own when their surroundings are right
  (enough neighbours, a park nearby, service coverage…). Click one to see what it's missing.
- Not everything needs a road. Homes, shops and offices, services, landmarks and the
  cemetery do fine with just a footpath within a dot and a half: their people walk or
  cycle, and they face the footpath. Industry, mines, farms and stations still need a road.
  Buildings without a road keep their surroundings (gardens, trees, a plaza) but never get a
  car park or garages.
- Neighbouring apartments and shops facing the same road often share a wall and form a
  street front; panel blocks join into one long block built in sections.
- The **Landmarks** group has the old town (a chapel, a church, a town hall, a plague column or
  war memorial, a gate tower, a castle) and the new one (a stadium or Sokol hall, and a TV
  tower or lookout, which only goes on a hilltop). They make nearby apartments
  and offices grow faster, and a church sometimes appears by itself in a big enough
  neighbourhood without one.
- **Public** also has a house of culture and a cemetery. Parks
  and squares have era layouts among their looks: a koupaliště, a summer cinema, a sports
  ground, a forest park with a lookout, a shopping precinct, a bus station, a parade square.
- A park only gets walkways where people can come in: a footpath reaching it, a street
  (sidewalks) or lane along it, or a neighbouring park that has a way in. One way in runs to
  a loop, two curve into each other, more meet at a little plaza; with none it stays a plain
  green. People walk the walkways as drawn.
- Each building gets a random seed, so it always looks the same, but **C** / **Change look**
  rerolls it.
- People walk, cycle or drive, depending on distance. Cyclists use footpaths and roads and take
  about a third of the trips that would otherwise be by car (`bike` in `src/config.js`).
  Roads that hit the map edge let people leave and visitors come in.
- Trucks (a cab and a trailer) belong to industrial buildings: most runs export goods off the
  map through a road exit and come back later, the rest are service runs to businesses and
  other industry. Delivery trucks also drive in from outside. See `trucks` in `src/config.js`.
- Buses (one long box) call at up to four bus stops, wait a few seconds at each, turn round at a
  dead end and leave the map. See `buses` in `src/config.js`.
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
