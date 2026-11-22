# Dědina

A little black-and-white isometric city builder. Plain JS, no build step.

## Running it

```
python3 serve.py
```

Then open http://localhost:8173. The city saves itself in the browser; **New map** starts over, after you pick the new town's name, lakes, forests, hills and water (none, a stream, a river, or a river with streams).

The game opens on the **main menu** (`src/ui/mainMenu.js`): the game's name underlined by the
pen, as on the cover, and a column of words at the left (at the bottom on a phone) over the map,
which drifts slowly behind it – the saved town (nothing is built and nothing burns while it's
up; its people go about as ever), or on a first visit a little village with a church put up for
the picture (never saved). **Pokračovat** goes back into the saved town (its name written under
it), **Nová hra** opens the New map dialog, **Otevřít ze souboru** opens a town from a file,
**Nastavení** opens the Settings in the column's place, and **Poděkování** the credits. **↑ ↓**
go from word to word, **Enter** picks one. From the town, **Hlavní menu** in the Menu (≡), or
**Esc** with nothing left to put away, goes back to it. A new map, a town opened from a file and
another language picked in the town go straight into the town; another language picked in the
main menu comes back to its Settings. With **`?testing`** in the address
(http://localhost:8173/?testing) the main menu is skipped altogether and the game opens straight
in the town, as it did before there was one (a first visit plays the new map at once); Hlavní
menu in the Menu still opens it.

**Settings** (`src/ui/settingsPanel.js`) is one panel, in the main menu or under the Menu's
Nastavení in the town: the sound's three levels (all of it – down to nothing, the sound off –
the nature, the pencil and buttons; pen-drawn sliders, as in New map), the language, the colour
schemes and full screen.

The UI's boxes and controls are built from shared pieces, so a change in one place reaches them
all: boxes come and go with `src/ui/motion.js`, have pen frames from `sketchFrame.js` and marks
on their controls from `penMarks.js` (underlined when pointed at, crop marks in keyboard focus,
`.choice` ticked when picked, `.toggle` boxed and crossed while on); a box of settings is a
`.panel` with a `.panel-head`, `.setting-row`s and a `.panel-foot` (`styles.css`, Panels), its
sliders `sketchSlider.js`.

## Controls

Full list of tools, keys and gestures: [docs/controls.md](docs/controls.md). In short: everything
you can build is in the **Build** menu (bottom right, groups as the planners of the time had
them); pick a tool, click to place it, Esc puts it down. Zpět/Znovu, Erase, Terrain and the
camera sit along its bottom. On a phone, tap once to preview and again to confirm.

## How it works, roughly

- Every building is built as what it is – a house, apartments, a panel block, a Jednota, a
  hospoda – and stays that way; to have something else there, take it down and build anew.
  Clicking a building opens its card: its name, a row of drawings – another look, its
  surroundings, an eraser to take it down – and how many live there, a number by a little
  figure. Clicking a road, path, railway, fence, wall or trees does nothing: Erase
  removes them, and ⌘Z brings back what was removed.
- Not everything needs a road. Homes, shops and offices, services, landmarks and the
  cemetery do fine with just a footpath within a dot and a half: their people walk or
  cycle, and they face the footpath. Industry, mines, farms and stations still need a road.
  Buildings without a road keep their surroundings (gardens, trees, a plaza) but never get a
  car park or garages.
- A building nothing reaches (no road, or for those above no footpath either) gets a planner's
  pencil note on the map: a short stub of road from its door that breaks off into nothing.
  It's faint all the time and firmer while a building or road tool is in hand; it goes when a
  road (or footpath) reaches the building, and never shows in a photo. `cmd.roadMark('query')`
  or `'cross'` switches to the other hands tried (`src/render/roadMarks.js`).
- Neighbouring apartments and shops facing the same road often share a wall and form a
  street front; panel blocks join into one long block built in sections.
- **Small things** – the boží muka and crosses, the well and the bus stop – have no plot or
  garden: each takes only the ground it's drawn on, so it goes right up to a house, a wall or
  a road's edge (facing the road), and gets no house number. Lime trees, a bench round it are
  the player's to add.
- **Boží muka a křížek** (Památky, beside the chapel): **Space** steps through a granite boží
  muka with its niches, a cast-iron cross on a stone plinth and a wooden cross under a little
  tin roof.
- The **Landmarks** group has the old town (a chapel, a church, a town hall in three sizes, a
  war memorial, a castle) and the new one (a stadium or Sokol hall, and a TV
  tower or lookout, which only goes on a hilltop). A church sometimes appears by itself in a
  big enough neighbourhood without one. A church stands on its own, a path from its door and
  nothing round it: its churchyard is yours to build. The **Zídka** (in **Pole a pastviny**,
  beside the Ohrada) is a low plastered wall under a capping, drawn as the fence is; closed all
  round, the ground inside becomes a hřbitov: rows of graves with headstones and crosses, a
  place left empty here and there, kept off the footpaths, the church and the trees. A footpath
  through the wall gets an arched gateway; a road through it opens it, and the graves go.
- **Občanská vybavenost** also has a house of culture and a cemetery. **Prostranství** has
  each kind of park and square as its own tool, in its sizes (**Shift**) and looks (**Space**):
  greenery, a playground, a sports ground, a garden, a forest park with a lookout, a park by a
  pond, a village well (a small thing: a rumpál, or a pump on a concrete ring or a stone slab;
  people stop by it a moment), a summer cinema; a plaza, a fountain square, a monument square, a market square, a
  shopping precinct, a parade square. The ČSAD bus station is in **Doprava**.
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

The **book** beside the town's name opens the town's **chronicle**. Three thumb tabs on its
edge (along the top on a phone) open its parts:

- **Kronika** – the houses (each of the first ten, with where it stands – by the church, by the
  river – then round numbers of them), every first (the first road, the first panel block, the
  railway arriving), every landmark, the residents passing round numbers, a new name, whatever
  the story writes in it (`chronicle:` lines, set as paragraphs), and the last five photos taken
  (`chronicle.photos` in the config; older ones go, prints and all), pasted in with corner mounts
  under their day. A ribbon lies in the newest pages.
- **Fotografie** – the photos again, two to a page, each captioned with the village's name. The
  prints are kept in the browser's IndexedDB, apart from the save (`src/ui/prints.js`); a
  downloaded city carries them along.
- **Stav obce** – the ledger: the town as it stands today, written out by hand as a municipal
  register would have it – a rubric in the ruled margin and the number in words ("Lidé –
  šedesát", "Domy – padesát šest", "Práce – sedm"), then what stands in the village, one thing
  a line ("dva kostely", "škola"). Noughts are left out unless they are the news. It is counted
  afresh each time (`src/ui/ledger.js`) and never saved.

The book opens on the tab last open, or on the newest pages of Kronika when something was
written since it was last read; a dot on the book says so, and a pencil stroke in the margin
marks what is new. **← →** turn the pages; the page numbers stand in the outer corners.
The Building card writes its numbers in words too (`src/core/numberWords.js`).

## Free placement

Buildings and ways stand anywhere, not on a dot grid. Positions are floats in world units (one
unit = a house's plot); terrain (water, height, rock, slope) stays a raster read by position.
`src/core/spatial.js` (`SpatialIndex`) answers `at(x, y)`, `near(x, y, r)` and
`overlapping(polygon)` for structures, features and network segments.

- A building is `{ id, no, type, x, y, angle, seed, data }`; its outline is the footprint
  rectangle turned by `angle`. Near a road it snaps: front to the road's direction, set back by
  the type's setback plus a little seeded variation; a small thing (`small`) has no plot, its
  outline is its body, and it stands right at the road's edge. Tab turns a quarter, Alt turns freely.
- Valid when its plot touches no other plot, way corridor or water, and the ground under its
  body isn't too steep; a bus stop (`needsRoad`) only where a road takes it. Only types with a
  `canPlace` rule of their own (stations, the TV tower) still stand on the dots. Access is the road point nearest
  its front within `CONFIG.access.reach`; facing is set once when built.
- Same-`join` buildings side by side (angles within a few degrees, gap under ~0.1) share a wall.
- Ways (`src/roads/ways.js`, `curves.js`) are drawn point by point; people walk them via
  `src/sim/wayGraph.js`. Parks and squares are rectangles fitted to the roads by `lots.js`.
- Saves from before free placement aren't converted: the game says so and opens New map.

## Tests

```
npm test
```

(the same as `node --test tests/*.test.js`). No installs needed (Node 22 or newer). They cover the story script, park entrances and walkways,
bridges, the chronicle and its ledger, numbers in words, on small made-up towns (`tests/helpers.js`).

## Where things live

- `structures/` – the buildings (one file per type, registered in `index.js`)
- `features/` – trees and other nature bits
- `src/config.js` – most of the numbers worth tweaking
- `src/theme.js` – colours
- `src/render/` – drawing (`painter.js` has the drawing API at the top)
  - `renderer.js` – the map's set-up and frame loop; its methods by topic in `renderer/`
    (terrain, networks, objects, plots, light, nature, movers, view)
- `src/sim/` – people, parking, the chronicle, the church that builds itself
  - `agents.js` – the people and vehicles; its methods by topic in `agents/`
    (leisure, transit, trips, movement)
- `src/core/world.js` – the town itself; its methods by topic in `world/` (networks,
  placement, access, structures)
- `src/story/`, `story/` – the storyteller, and the story it tells
- `tests/` – see Tests above
- `docs/` – design notes and plans (the pen sketch, WebGL, weather, reviews)
- `src/roads/`, `src/tools/`, `src/ui/` – what they say

**New building:** copy a definition in `structures/residential.js`, change the id/name/hotkey,
and add it to `BUILD_FAMILIES` in `structures/index.js`.
