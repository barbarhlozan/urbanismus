# Free placement: buildings and roads off the grid

The plan for taking Dědina's buildings and roads off the dot grid, so a
village can grow the way real ones do – houses set back unevenly along a
road that follows the ground, not standing in rows on a lattice. Written
2026-11-14, before any code changed; what's described as "now" was read
in the code that day.

## Decisions already made

- **Option 3, all the way.** We looked at hiding the grid (1), a finer grid
  (2) and no grid (3). Without old saves to carry over, (2) costs nearly
  as much as (3) – the work is the same: separating "which dot is it on"
  from "where is it and what does it touch" – and would be thrown away
  after. So we go straight to (3).
- **No old saves.** A save from before is not converted. When the game
  finds one (in the browser, or opened from a file), it says so –
  *"This town was made in an older version of Dědina. Start a new
  world."* – and opens New map. `src/core/legacy.js` and its tests go.
- **The world's units stay.** One unit is what one dot step is now (a
  house's plot). Every drawing in `structures/` and `features/`, every
  distance and speed in `src/config.js`, the people and vehicles all keep
  their sizes – only positions stop being whole numbers.
- **The terrain keeps a raster.** Water, height, rock and slope are
  sampled data the player never places by hand. They stay on a grid of
  their own (the present one), read by position (`waterAt(x, y)`) instead
  of by the dot a building stands on.
- **Quarter-turn views stay.** The camera still turns by 90°. Buildings at
  any angle already draw right (the Painter's `setTilt`, up to 45° today
  for houses on a bend).

## Where we are

Two grids (`src/core/world.js`): the main dots for buildings and roads,
and dots twice as dense (`fine`) for footpaths, railways and fences.

- **Buildings and roads take turns on the main dots.** A building owns the
  dots of its footprint (`structureAtNode`); a road can't use them
  (`isRoadBlocked`), and a building can't stand on a road dot
  (`dotBlocked`). A building's road is the road dot next to it
  (`accessFor`), its front faces that dot (`frontFor`, `facingRotation`),
  and how a single-dot house leans to a bend is worked out from the road's
  neighbouring dots (`roadFront`, `tiltOf` in `structures/index.js`).
- **Roads are a graph of dots** (`src/roads/network.js`: node = dot
  index, edge = two neighbouring dots). Streets, lanes and kerbs are keyed
  by `edgeKey(a, b)` (`world.sidewalks`, `lanes`, `laneWalks`). Curves are
  only drawn: `src/roads/geometry.js` rounds the corners of the dot
  polyline, and people follow the same rounded line
  (`agents.js` `smoothPolyline`).
- **Network layers already abstract a little.** `NetworkLayer`
  (`src/roads/layer.js`) has a `scale` and a `pos(n)`, which is how
  footpaths and railways live on the dense dots and footpaths wander off
  them (`src/roads/meander.js`). Routing (`routing.js`, `pathfinding.js`)
  works on layers, not on the main grid directly.
- **Parks and squares** (`site` structures) take their outline from the
  dots round them (`siteArea`, `siteExits`), fitted to the drawn roads in
  `src/render/lots.js`.
- **Shared walls and courts** (`join`, `structures/courts.js`) come from
  two buildings standing on neighbouring dots in the same row.
- **Trees and other features** already have an offset within their dot
  (`ox`, `oy`), but are found by dot (`featureAtNode`).
- **The town by itself:** a church appears by a road (`src/sim/growth.js`);
  a new map's river, lakes and trees are laid on the dots
  (`src/terrain/generate.js`).
- **The story** finds buildings by house number and by distance between
  their centres (`Storyteller.pick`), which carries over unchanged.

How much leans on the dots: about 110 `grid.xy`, 80 `.node`, 30 road-dot
lookups (`hasRoad`, `roads.hasNode / neighbors / hasEdge`) – most in
`world.js` (~70), `agents.js` (~40) and `renderer.js` (~30), the rest in
the sim, tools, stations and terrain generation. 47 test files; most touch
the world model.

*Since this was written, `world.js`, `agents.js` and `renderer.js` have
been split into topic files (`src/core/world/`, `src/sim/agents/`,
`src/render/renderer/`); counts above are from before the split.*

## The new model

### Positions and the spatial index

Everything placed has a position in world units (floats). A new
`SpatialIndex` (`src/core/spatial.js`) buckets items into cells one unit
square and answers:

- `at(x, y)` – what's under a point (clicking, the pointer, `inspect`)
- `near(x, y, r)` – what's within reach (access, fires spreading, the story's
  `nearest`, trains and paths keeping clear)
- `overlapping(polygon)` – what an outline would collide with (placement)

There's one index each for structures, features and network segments,
kept up to date by World's mutations (as `structureAtNode` is now).

### Buildings

```
{ id, no, type, x, y, angle, seed, data }
```

- `x, y` – the middle of the footprint; `angle` – radians, the way its
  front (local -y) looks. `rotation` and `node` go.
- **Outline:** the footprint's dots become a rectangle (a 1×1 house is a
  1×1 square round its middle, a 2×1 two by one…) turned by `angle`. A
  type may give a tighter `body` (the walls) inside its `plot` (what it
  keeps clear), so neighbours can come closer than the plots' edges.
- **Placing:** the pointer drags the outline. Near a road it snaps:
  its front turns to the road's direction at the nearest point, and it
  stands back from the road's edge by the type's setback (plus a little
  variation, seeded, so a row isn't ruled). Tab still turns it a quarter
  (side or back to the road); with Alt (or off-road) it turns freely.
- **Valid when** its plot overlaps no other plot (a small gap allowed),
  no road, railway or footpath corridor (the way's width plus its
  kerb), no water (sampled under the outline), and the ground under its
  body isn't too steep (sampled likewise). A type's own rule
  (`def.canPlace`, e.g. a station's track) stays, given the outline.
- **Access:** the road point nearest its front, within reach
  (`CONFIG.access.reach`, ~0.8): `{ edge, t, point }`. No road: the nearest
  footpath within 1.5, as now.
- **Facing** is set when built (as `faceOnce` now) and kept – a road laid
  past it later doesn't turn it.
- **Shared walls:** two buildings of the same `join` group join when they
  stand side by side – angles within a few degrees, fronts in line, the gap
  between their bodies under ~0.1 – found with `near`. The second snaps
  to the first's side as it's placed. Courts (`courts.js`) between them as
  now, given the two outlines instead of two dots.
- **Sites (parks, squares):** placed as rectangles with an angle like any
  building, sized in whole units as now; their ground is fitted to the
  roads round them by `lots.js` as it is today. (Drawing a site's outline
  freely can come later.)

### Networks: roads, lanes, footpaths, railways, fences

One structure for every network, replacing the dot graph:

```
nodes: id -> { x, y }                    junctions, ends, and where a way
                                         changes (street starts, a bridge)
edges: id -> { a, b, kind, pts, ... }    kind: road | lane | path | rail | fence
                                         pts: the centreline's control points
```

- **Drawing a way:** click a start, click points along, double-click (or
  click the last point again) to finish. The points become a smooth curve
  (centripetal Catmull-Rom, resampled for drawing and travel). Each kind
  has a tightest bend (a railway's far wider than a lane's) and the curve
  is eased until it holds; where it can't, the point is refused, as a too
  sharp railway bend is now.
- **Snapping:** a click near a node joins it; near an edge, it splits the
  edge there and makes a junction. Ways meeting at less than a minimum
  angle are refused. A light angle snap (to the way it leaves, and 90° off
  it) makes tidy junctions easy without forcing them.
- **Crossings** are found by intersecting curves: road × road makes a
  junction; road × railway a level crossing; path × road joins the
  sidewalks or crosses (as `pathJoins` now); fence × anything leaves a
  gap. Railway and road may not run along each other (as now).
- **Edge attributes** replace the `edgeKey` sets: `street` (sidewalks:
  which sides), `lane`, `bridge` (the stretch over water), each on the
  edge itself. A street made by drawing a footpath along a road becomes
  "this road edge gets sidewalks", found by the path's curve lying within
  the road's corridor.
- **Water and slope:** checked along the curve by sampling (as `grade`
  already does), not dot by dot. Bridges: the stretch over water, as long
  as the type allows (`span` in units).
- **Routing:** A* over nodes and edges with the edge's length (and a
  lane's slowness) as cost – the present `findPath`, on ids instead of
  dots. A trip is a list of edges, travelled by arc length along their
  curves (`pointAt`, `subPolyline` in `geometry.js` already do this).
- **Map exits:** an edge ending within a step of the map's edge.
- **Footpaths' wander** (`meander.js`) moves into the curve itself – it's
  just a looser curve now.

### Terrain, trees and the rest

- `terrain.waterAt(x, y)` / `riverAt(x, y)` (nearest raster cell), slope
  and rock by position (they already are, inside `relief()`).
- Trees and other features: `{ id, type, x, y, variant, scale }`, found
  through their index; a road or building clears the trees under its
  corridor or plot, as now.
- Forests drawn far out keep their raster outline (`forest.js`), built
  from the features' positions.
- **New map generation** (`generate.js`) lays river, lakes and trees as it
  does, then places features at positions.
- **Growth** (`growth.js`): a church looks for room along a road with the
  same placement rule the player uses.

### Saves

`SAVE_VERSION` goes to 11. The save holds structures and features as
above, the networks' nodes and edges with their attributes, the terrain's
raster, the story, the chronicle, the time and weather. Anything older →
the message and New map. Undo (`history.js`) keeps working on snapshots,
diffing structures, features, nodes and edges by id instead of dots and
`edgeKey`s.

### The story

Unchanged in the file format. `pick … nearest` uses `near`. It also gets
what the bubble concepts (`bubbles-lab.html`) need: each building type can
name **spots** in its own coordinates (door, gate, tower ledge, belfry),
and story figures can walk to a spot and do something there – easier now,
when positions are plain points.

## What changes where

| Module | Change |
|---|---|
| `src/core/world.js`, `world/structures.js`, `placement.js`, `access.js`, `networks.js` | the model above: structures by position, network layers by node/edge ids, placement and access by outline; dot queries go |
| `src/core/spatial.js` | **new** – the spatial index |
| `src/core/grid.js` | stays for the terrain raster only |
| `src/roads/network.js`, `layer.js` | nodes with positions, edges with curves and attributes |
| `src/roads/routing.js` | validating a drawn curve (bends, angles, water, slope, crossings) instead of a dot route |
| `src/roads/pathfinding.js` | A* over ids |
| `src/roads/geometry.js` | curves come from the edges; kerbs, joins, edges reuse the offsetting code |
| `src/roads/meander.js`, `siteWalks.js`, `furniture.js` | from curves |
| `src/tools/network.js` | drawing ways with points and snapping |
| `src/tools/build.js`, `erase.js`, `bulldoze.js`, `inspect.js` | outline placement and snapping; picking by index |
| `src/render/overlay.js` | no dots: the outline (and why it can't go there), a way's curve as it's drawn |
| `src/render/renderer.js`, `renderer/*`, `lots.js` | caches keyed by ids; buildings drawn at `x, y, angle` |
| `structures/index.js` | footprint → outline; `tiltOf` / `roadFront` replaced by the snap; `join` by side-by-side test |
| `structures/courts.js`, `yards.js`, `plots.js`, `station.js` | outlines instead of neighbouring dots |
| `src/sim/agents.js`, `agents/*`, `walking.js`, `parking.js`, `fire.js`, `trains.js` | trips as edge lists along curves; homes and doors by access point |
| `src/sim/growth.js`, `src/terrain/generate.js` | placement by position |
| `src/core/history.js` | diffs by id |
| `src/core/legacy.js` | **removed** |
| `src/ui/saveFile.js`, `src/main.js` | the old-save message, New map |
| `tests/` | most rewritten around the new model (see below) |

## Order of work

On a branch of its own (`free-placement`). Each stage ends with the game
running and its tests passing; we look at it in the browser before the
next.

**A. Foundations.** `SAVE_VERSION` 11 and the old-save message;
`legacy.js` out. The spatial index. Structures and features get `x, y,
angle`, set from their dots for now, and every reader moves from `node` /
`rotation` to position and angle. Dots still decide where things may go.
*Done when:* the game plays as before, and nothing outside the placement
rules reads a structure's `node`.

**B. Buildings off the dots.** Outlines, the placement rule, access and
facing by nearest road point, snapping along a road with seeded setback,
shared walls side by side, courts and yards from outlines. Roads are still
on dots (their curves are what buildings snap to). The pointer shows the
outline, not dots.
*Done when:* a village street built by hand looks irregular and right; a
row of joined houses still shares its walls.

**C. Ways off the dots.** The node/edge networks with curves; drawing with
points and snapping; junctions, splitting, crossings, bridges; streets,
lanes and kerbs as edge attributes; erase. Footpaths, railways and fences
move with roads – they share the code, and leaving them on dots would mean
keeping both systems.
*Done when:* every kind of way can be drawn, joined, crossed and erased,
and draws as well as today.

**D. People and traffic on the new ways.** Routing by ids, trips along
curves, parking, buses and trains, level crossings, the fire brigade,
people meeting for a chat, walks in parks.
*Done when:* a busy town runs as it does today – the perf runs
(`tools/perf/`) no worse.

**E. The rest and tidying.** Growth and new map generation by position;
sites fitted to free roads; remove the dot code that's left; README and
`story/README.md` updated; the help in the Build menu.

## Chunks for parallel chats

The stages run one after another; inside a stage the work splits once
one chat has laid down what the others build on. **Opus** takes the
chunks that need judgement (the model, placement and snapping feel,
networks, agents); **Sonnet** the mechanical ones (moving readers to the
new fields, drawing from what's there, tidying). Counts are reads of a
structure's `.node` / `.rotation` or `grid.xy`, taken 2026-11-14.

How they run:

- Each chat that writes code works in a worktree of its own, branched
  from `free-placement`, and touches only its chunk's files. (An
  exception to working on main, for this branch only.)
- The coordinating chat merges finished chunks into `free-placement`,
  runs the tests and looks in the browser before the next gate.
- Two chats at a time at most; each starts cold and reads its way in, so
  parallel isn't cheaper – just sooner.
- A chunk is done when its files no longer read what it replaces, the
  tests pass, and it says what it couldn't check.

### Stage A

1. **A1 – Opus, alone, first.** `src/core/spatial.js` and its tests;
   structures and features get `x, y, angle` from their dots
   (`world/structures.js`, `world.js`), with the accessors the other
   chunks use; `SAVE_VERSION` 11, the old-save message and New map
   (`saveFile.js`, `main.js`); `legacy.js` and its test removed. Writes
   down the new fields at the top of `world/structures.js` for the rest.
2. After A1, in parallel:

| Chunk | Model | Files | Reads |
|---|---|---|---|
| A2 drawing | Sonnet | `render/renderer/*`, `renderer.js`, `painter.js`, `overlay.js`, `photo.js`, `lots.js`, `forest.js`, `perspective.js` | ~35 |
| A3 people | Sonnet | `sim/agents/leisure.js`, `movement.js`, `trips.js`, `agents.js`, `walking.js`, `deer.js`, `fire.js`, `pastures.js` | ~30 |
| A4 trains and stations | Opus | `sim/trains.js`, `sim/agents/transit.js`, `structures/station.js` | ~28 |
| A5 tools and the rest | Sonnet | `tools/*`, `sim/growth.js`, `core/history.js`, `dev/commands.js`, `structures/index.js`, `landmarks.js` | ~15 |
| A6 new map | Sonnet | `terrain/generate.js` | ~20 |

3. **Gate – coordinating chat.** Nothing outside the placement rules
   (`world/placement.js`, `access.js`) reads `node`; tests pass; the game
   plays as before in the browser.

**Stage A done (2026-11-14).** Buildings and trees are read by `x, y,
angle` (and `World.anchorOf` for a building's own coordinates). What
still reads a building's dot or turn, on purpose:

- placing and converting (`world/placement.js`, `canConvert`, the build
  tool's pick in `main.js`) – stage B
- facing to the road on a bend and joined walls (`roadFront`, `tiltOf`,
  `joinedNeighbour` in `structures/index.js`), sites' ground
  (`siteArea`) – stage B
- a station's track along its front and the stop dot trains look it up
  by (`station.js`, `trains.js`), track keys in `renderer/networks.js` –
  stage C

### Stage B

- **B1 – Opus.** Outlines (`plot`, `body`), the placement rule, access
  and facing by nearest road point.
  *Started 2026-11-14:* `fitsOutline`, `freePlacement` (facing the
  nearest road, seeded setback), `placeStructureAt` (`s.free`), the
  build tool placing buildings freely (wider ones too, their anchor
  turned about the middle: `freeAnchor`), front yards from the pose,
  `cmd.place`. Still to do: sites (parks, squares) and stations free, a
  tighter `body` inside the `plot`, plots spreading by outline,
  access by the road point (now the nearest dot's). (Ways are kept off
  free buildings by outline: `freeBuildingOn`.)
- **B2 – Opus, after B1.** Snapping along a road with seeded setback,
  quarter turns and free turning; joined walls side by side. Tuned in the
  browser.
  *2026-11-14:* joined walls between free houses (`freeSideBy`: a width
  along the side, the same turn) and the snap flush to a neighbour's side
  (`joinSnap`, within 0.45). Still to do: free turning with Alt.
- **B3 – Sonnet, after B1.** Courts, yards and plots from outlines
  (`courts.js`, `yards.js`, `plots.js`).
- **B4 – Sonnet, after B1.** The pointer draws the outline and why it
  can't go there (`overlay.js`); picking by index in `inspect` / `erase`
  / `bulldoze`.

### Stage C

- **C1 – Opus.** Nodes and edges with curves, edge attributes, A* over
  ids (`network.js`, `layer.js`, `pathfinding.js`); validating a drawn
  curve – bends, angles, water, slope, crossings (`routing.js`).
- **C2 – Opus, after C1.** Drawing ways with points and snapping, splits
  and junctions, bridges (`tools/network.js`); undo across a split edge.
- **C3 – Sonnet, after C1.** Drawing from curves: kerbs, joins, street
  furniture, footpaths' wander, park walks (`geometry.js`,
  `furniture.js`, `meander.js`, `siteWalks.js`, `renderer/networks.js`).
- **C4 – Sonnet, after C2.** Erase for ways; the phone's way of drawing
  to try.

### Stage D

- **D1 – Opus.** Trips as edge lists along curves; homes and doors by
  access point (`agents/*`, `walking.js`).
- **D2 – Opus, after D1.** Parking, buses, trains and level crossings,
  the brigade (`parking.js`, `transit.js`, `trains.js`, `fire.js`).
- **D3 – Sonnet, after D2.** Perf runs (`tools/perf/`) against today's
  numbers; report, don't tune.

### Stage E

- **E1 – Opus.** Growth and new-map generation by position; sites fitted
  to free roads.
- **E2 – Sonnet.** Remove the dot code that's left; README,
  `story/README.md`, the help in the Build menu.

## Tests

Kept with small changes: anything about drawing, shadows, hatching, the
story's script and conditions, text, numbers, weather, livestock and deer
on their own.

Rewritten: the world model and placement (`bounds`, `sites`, `lone`,
`yard`, `windows`), networks and routing (`rails`, `bridges`, `meander`,
`traffic`, `commute`), fire, history, families, storyteller
(its town set-up). `legacy.test.js` goes. New: the spatial index, curve
validation (bends, angles, crossings), snapping, outline placement, shared
walls.

## Risks and open questions

- **People and traffic (D) is the riskiest part.** `agents.js` is ~1,900
  lines grown around dots. It mostly follows polylines already, which
  helps; parking, bus stops and the people at fires are where the dots go
  deepest.
- **Speed.** Dot lookups are a Map read; outline tests and curve
  intersections cost more. The index keeps them local, and placement
  only runs as the pointer moves; the town ticking (agents) shouldn't need
  them at all.
- **Drawing on a phone.** Placing points for a curve with a finger needs
  its own feel (drag to draw, lift to finish?). To be tried in C.
- **Snapping feel.** Too strong and it's a grid again; too weak and rows
  look careless. Setback variation and the angle snap need tuning in the
  browser.
- **Joined houses** have to be easy to make on purpose – the snap to a
  neighbour's side is what carries the village's terraced look.
- **Stations** bring a straight piece of track along their front; with
  free railways that's a straight edge at the station's angle, joined by
  snapping.
- **Undo across a split edge**: drawing a way that splits another must
  come back whole – the snapshot diff by id should do it; it needs tests.

## Not now

- Freely drawn outlines for parks, squares and pastures (rectangles and
  fences, as now).
- Curved buildings, or buildings following a curve.
- Free camera rotation.
