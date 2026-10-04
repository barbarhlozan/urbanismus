# Urbanismus

A little black-and-white isometric city builder. Plain JS, no build step.

## Running it

```
python3 serve.py
```

Then open http://localhost:8173. The city saves itself in the browser; **New map** starts over, after you pick the new town's name, lakes, forests, hills and water (none, a stream, a river, or a river with streams).

## Controls

Everything you can build is in the **Build** menu, bottom right, in the groups the planners of
the time used: Doprava (transport), Bydlení (housing), Výroba (industry, mines, farms),
Občanská vybavenost (civic amenities: shops, pubs, offices, services, school, culture – none of
it private, so there's no separate "business"), Prostranství (parks and squares) and Památky
(landmarks), plus Erase. Every building is its own thing to build: nothing upgrades into
something else. Open a group to see its tools; click a tool to pick it up and click it
again (or close its group, or **Esc**) to put it down. The **–** folds the menu into a single
Build button; picking a tool folds it too, out of the way, and it comes back when you put the
tool down. Things that come in more than one size (a house and a wide one, the three
workshops, the Národní výbor's offices and towers, station / stop, town hall…) are one tool
with a **Size** button (**Shift**). While a tool is in hand, its options (size, rotate,
another look, bend…) are buttons above the bottom edge.

Shortcuts come in two steps that follow the Build menu: the **number row** opens a group
(**1** Doprava, **2** Bydlení, **3** Občanská vybavenost, **4** Výroba, **5** Prostranství,
**6** Památky – the numbers are on the tabs), and the **letter rows** pick a tool in the
group that's open, its tiles in reading order (**Q W E R T Y U I O**, then **A S D F G H J
K**, then **Z X C V B N M , . /** – each tile shows its key). The group stays open, so **2**,
**Q** builds houses and then **W** switches to apartments; pressing the key of the tool in
hand puts it down. A few keys are always the same: **P** photo, **Backspace** erase, **L**
pause, **`** speed, **[ ]** turn the view, and while building **Tab** rotate, **Space** another
look, **Shift** size. They go by where the key sits (a US keyboard), so they work the same on
a Czech or German layout.

- **Click the map** – menu for the nearest dot (build, road from here, remove); the dots
  themselves only show while building
- **Roads**, **footpaths** (Doprava: **1 Q**, **1 E**) – click start, click end; **Tab** flips the bend
- Draw a footpath **along a road** (on it or right beside it) to make it a street with sidewalks (kerb lines on both
  sides, street lamps, zebra crossings at junctions). People only walk along streets and footpaths; cyclists and
  cars use every road. Erasing a street removes its sidewalks first.
- **Lanes** (**1 W**) – single-track roads, narrower than a road. Cars drive them slowly (and avoid
  them when a road will do); people walk and cycle on them as on a footpath, so they get no
  sidewalks. Draw a lane over a road or footpath to turn it into a lane, a road over a lane
  to widen it.
- **Railways** (**1 R**) – drawn on the dense dots like footpaths, bends at most 45° per dot; a
  staircase of bends is smoothed into one even curve, so chain them for gentle turns. They
  keep clear of buildings, cross roads and footpaths (level crossings) but can't share a
  stretch with either. Run a line off the map
  edge and trains start coming through. Cars, cyclists and pedestrians wait at a crossing while
  a train passes – see `crossing` in `src/config.js`. Every crossing has a St Andrew's cross on each
  side; on roads with a box of lights under it that flash while a train is near.
- **Stations** (**1 T**, **Shift** switches size): **Station** (3×2, a
  passing track that leaves the line and rejoins it, an island platform, a station house), **Main
  station** (4×3, two through tracks and two bay tracks ending at buffers, three platforms, a vaulted
  hall with a clock tower) or **Stop** (1×2: platform, shelter and a little waiting house). The
  extra tracks are for show – trains only use the line itself. A station brings its own straight
  piece of track along its front (**Tab** picks the side) – draw railways to its ends;
  beside an existing straight line it uses that and turns to face it. Removing a station leaves
  its track. Trains
  stop at every station they pass, and turn round at the last one when there's no other way off the
  map. With a road behind, a station gets a forecourt (or parking) towards it.
- **Bus stop** (**1 Y**, 1×1), beside a road, facing it: a shelter, the stop sign, a bench. Buses only
  come when a road leads off the map: in through an exit, a few stops (nearest next), out again.
- **Bydlení** (**2**): house / apartments / block, each also wide (**Shift**)
- **Občanská vybavenost** (**3**): Jednota, hospoda, obchodní dům, Tuzex, národní výbor, pošta,
  hotel, the services, school, house of culture, swimming pool, cemetery
- **Výroba** (**4**): workshops, works, factory and plants in their sizes, the three mines,
  farmstead / JZD / státní statek
- **Prostranství** (**5**): every park and square
- **Památky** (**6**): chapel, church, town hall (**Shift** switches small, medium, large),
  memorial, castle, tower, stadium
- **Backspace** – erase
- **P** – photo: click where to stand, aim with the pointer, click to take a picture of the
  town from street level (**Shift** lens: 28 / 42 / 80 mm);
  it opens as a print you can save as a PNG
- **Esc / right-click** – back to select; **right-click** with nothing in hand picks up
  what's under the pointer (same building, size and rotation, or the road / railway /
  footpath) to build more of it
- **Middle click** – same as **Tab** (rotate what you're placing, flip a line's bend)
- **Drag / wheel** – pan / zoom, **[ / ]** – rotate view
- **L** – pause, **`** (backtick) – speed, **Terrain** button – contour lines (off by default,
  they are the most expensive thing to draw)

On a phone it's all taps: tap once to preview, tap again to confirm. The Build menu starts
folded there and folds again once you pick a tool.

## How it works, roughly

- Every building is built as what it is – a house, apartments, a panel block, a Jednota, a
  hospoda – and stays that way; click one and **Turn into…** to rebuild it as something else
  of its group that fits there.
- Not everything needs a road. Homes, shops and offices, services, landmarks and the
  cemetery do fine with just a footpath within a dot and a half: their people walk or
  cycle, and they face the footpath. Industry, mines, farms and stations still need a road.
  Buildings without a road keep their surroundings (gardens, trees, a plaza) but never get a
  car park or garages.
- Neighbouring apartments and shops facing the same road often share a wall and form a
  street front; panel blocks join into one long block built in sections.
- The **Landmarks** group has the old town (a chapel, a church, a town hall in three sizes, a
  war memorial, a castle) and the new one (a stadium or Sokol hall, and a TV
  tower or lookout, which only goes on a hilltop). A church sometimes appears by itself in a
  big enough neighbourhood without one.
- **Občanská vybavenost** also has a house of culture and a cemetery. **Prostranství** lists
  every kind of park and square on its own – a plaza, fountain squares, a monument square, a
  market square, a grand square, a shopping precinct, a bus station, a parade square – and
  parks have era layouts among their looks: a koupaliště, a summer cinema, a sports ground, a
  forest park with a lookout.
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

## The story and the chronicle

The town comes with a story, told in a dialogue window (bottom left) as the town grows. It is
written in `story/story.txt`, a plain text file of rules and branches of dialogue:

```
if house > 5 trigger IntroDialogue

::IntroDialogue::
Grandma: So in this village there were five houses and not much else.
> Ask about the geese -> Geese
> Say goodbye -> Goodbye
::
```

How to write it, and everything a rule can count, is in [`story/README.md`](story/README.md).
Each branch is told once per town. What has been told is kept with the town. Click the window,
or press **Enter**, to go on.

The **book** beside the town's name opens the town's **chronicle**: the houses (each of the
first ten, with where it stands – by the church, by the river – then round numbers of them),
every first (the first road, the first panel block, the railway arriving), every landmark, the residents
passing round numbers, a new name, and whatever the story writes in it (`chronicle:` lines).
A dot on the book means there's something new in it. **← →** turn the pages.

## Tests

```
node --test tests/*.test.js
```

No installs needed (Node 22 or newer). They cover the story script, park entrances and walkways,
bridges, and the chronicle, on small made-up towns (`tests/helpers.js`).

## Where things live

- `structures/` – the buildings (one file per type, registered in `index.js`)
- `features/` – trees and other nature bits
- `src/config.js` – most of the numbers worth tweaking
- `src/theme.js` – colours
- `src/render/` – drawing (`painter.js` has the drawing API at the top)
- `src/sim/` – people, parking, the chronicle, the church that builds itself
- `src/story/`, `story/` – the storyteller, and the story it tells
- `tests/` – see Tests above
- `src/roads/`, `src/tools/`, `src/ui/` – what they say

**New building:** copy a definition in `structures/residential.js`, change the id/name/hotkey,
and add it to `BUILD_FAMILIES` in `structures/index.js`.
