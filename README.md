# Urbanismus

Minimal isometric city builder. Black and white, line-drawn, no build step.

## Run

```
python3 serve.py
```

Open http://localhost:8173. The city autosaves to localStorage; **New map** discards it.

## Controls

| Input | Action |
|---|---|
| Click a dot | Context menu (build, road from here, remove) |
| `R` | Road tool: click start, click end. Chains from the end point. `Tab` flips the bend |
| `F` | Footpath tool, same as roads but on a grid twice as dense (fits between buildings) |
| `1` `2` `3` | Zones: residential / business / industrial. `Tab` rotates, `C` another look |
| `4` – `9` | Civic: park, large park, square, large square, services, large services |
| `X` | Demolish |
| `V` / `Esc` / right-click | Back to select, cancel |
| Drag · wheel | Pan · zoom |
| `Q` / `E` | Rotate view 90° |
| `P` / space | Pause the simulation |
| `T` | Switch simulation speed (Normal / Slow) |

**Touch (phones, tablets):** tap a dot for the menu (a sheet along the bottom on narrow screens),
drag to pan, pinch to zoom. Roads, buildings and demolish work with two taps: the first shows
the preview, a second tap on the same dot confirms. The keyboard-only actions (rotate, another
look, flip the bend, stop / done) show up as buttons above the toolbar while a tool is active,
and the toolbar scrolls sideways. Tap the stats box to fold it away.

## Layout

```
structures/        building definitions + index.js registry; kit.js (props), yards.js (surroundings)
features/          environment objects (trees…) – same pattern
src/
  config.js        tunables (grid size, speeds, road curvature…)
  theme.js         palette – all colors live here
  core/            world state, grid, events, rng
  terrain/         height + water layers, map generator
  roads/           network layers (roads, footpaths), routing, curves, pathfinding
  render/          iso camera, painter (the drawing API), SVG renderer, overlay helpers
  sim/             moving agents, building growth
  tools/           one file per tool + manager
  ui/              HUD, toolbar, popup, input
```

## Buildings, levels and growth

Every building type has three levels (low / medium / high), each with its own drawing, stats,
number of moving dots and `grow` conditions (e.g. "3 residential within 2 dots"; high levels also
need medium-level neighbours, so a city develops in stages). Buildings that keep meeting the next
level's conditions level up after about 1 minute (medium) / 2.5 minutes (high) at normal speed;
ones that lose them slowly decline. Clicking a building shows what it still needs. Upgrading or downgrading by
hand locks it at that level until you choose "Let it grow on its own". Tunables: `growth` in
`src/config.js`, rules in each structure file, logic in `src/sim/growth.js`.

Buildings fill the ground between themselves and their road with **surroundings** – gardens,
tree rows, parking, plazas, industrial yards – picked by type and level (`yards` in each level),
or set by hand via **Surroundings** in the click menu. Without surroundings a plain driveway is drawn.

**Civic** buildings (second toolbar tab): parks and squares (1×1 and 2×2, reachable by road or
footpath) make nearby homes / businesses grow faster and attract strolls; services (1×1 and 2×2)
cover a radius that grows with their level, and the top level of homes, businesses and industry
needs to be inside some service coverage. Rule parts: `requires`, `avoid`, `coveredBy`, `boost`
(see `src/sim/growth.js`); rules can name a structure id or a tag (`park`, `square`, `services`).

Every building has a random `seed` (saved with it) that picks its variant: shape, size, roof,
height, chimneys, silos… Drawings use `g.pick`, `g.range`, `g.int`, `g.chance` for this, so a
building always looks the same, and each level gets its own look. Single-dot buildings turn their
front (the -y side) towards their road. **C** while placing tries another look (the preview shows
exactly what you'll get); **Change look** in the click menu re-rolls an existing building.

Around the rest of the building, its **plot** (halfway to the neighbouring dots) gets props by
type – back gardens with trees and sheds, bins, crates and containers – and sometimes a boundary
fence or hedge (`plot` in structure files, styles in `structures/plots.js`). **Footpaths have
priority**: fences and hedges get gaps, props, parking spaces and paving keep clear of them.

## Rendering and performance

Each building is drawn into its own group, and a change redraws only the buildings next to it.
Everything drawn has a detail level: facade lines, fences, small props and paving patterns hide
below zoom 0.9, lots and parked cars below 0.55 (`render.lod` in `src/config.js`).

## Visual style

The **Style** button (top right) opens live toggles, remembered per browser (`src/render/style.js`):
**pixels** – size in real screen pixels (1 = sharp vector drawing), line weight and detail: the
scene and the overlay are rasterised off-screen at low resolution, thresholded to pure
black/white and scaled up without smoothing, while moving dots are plotted straight onto the pixel
grid; UI borders follow the pixel size (`src/render/pixel.js`),
map warp and line tremor (a seeded distortion applied to everything as it's projected –
`src/render/warp.js`), aliased lines, broken lines, glow on moving dots, a map frame with
coordinates, CRT scanlines (`src/ui/crt.js`), and annotations – hover tags and an event
log (`src/ui/annotations.js`; systems report events with
`annotations.log(text, [x, y])`).

## People

Every trip is on foot or by car. Pedestrians (small dots) use footpaths and walk along roads
(pavements, slightly less preferred); where a footpath meets a road they can cross or switch.
Short trips are walked, long ones driven; residents also go for strolls along footpaths.
Everyone keeps to the right of their line.
**Map exits:** a road that ends at the edge of the map continues off it (drawn fading out).
Residents sometimes drive out of the city and come back later (`sim.leaveChance`), and visitors
arrive through exits, park at a shop, office, factory, park, square or service building, stay a
while and leave through a random exit (`visitors` in `src/config.js`).

Parking lots show parked cars as hollow dots. Nobody owns a car: driving off from a building with
a lot takes one of its parked cars (if any), arriving parks one (if there's space) –
`src/sim/parking.js`. Tunables: `walk` and `sim` in `src/config.js`,
`strollChance` in structure files, walking graph in `src/sim/walking.js`, trip choice in
`src/sim/agents.js`.

## Extending

**New building:** copy `structures/residential.js`, change `id`, `name`, `hotkey`, `levels`,
then add it to `structures/index.js`. The toolbar, the menu, the hotkey and the agents pick it up.
The drawing API (`box`, `gable`, `prism`, `face`, `line`, `disc`, `shape`) is documented at the top
of `src/render/painter.js`. Drawings are in 3D local coordinates, so they work in all four rotations.

**Bigger buildings / parks:** set `footprint` to several offsets, e.g. `[[0,0],[1,0],[0,1],[1,1]]`
(industrial is 2×2). Rectangles work too; the build tool rotates them with `Tab`.

**New network type** (tram, rail…): add a `NetworkLayer` to `world.networks` in `src/core/world.js`,
a style in the renderer, and register `createNetworkTool` for it in `src/main.js`.

**Environment:** new natural objects go in `features/`; new terrain data (hills, rivers, soil)
goes in `src/terrain/terrain.js` as a per-node layer; generation passes go in `src/terrain/generate.js`.
Height is already honoured by all projection, so hills only need data plus contour drawing.

**New tool:** write a factory in `src/tools/` (hook list in `src/tools/manager.js`) and register it in `src/main.js`.

**New system** (economy, traffic, sound…): subscribe to `world.events` (list in `src/core/events.js`)
and tick it from the loop in `src/main.js`.

**Colors:** add names to `THEME.palette` and use them as `fill`/`stroke` in drawings.
