# The UI's drawings

One file for each drawing on the game's buttons and panels. The game reads them all when it
starts (`src/ui/uiIcons.js`, before any of the UI is built), so replacing a file and reloading
is all it takes to change a drawing. A file that's missing or isn't an SVG leaves its place the
drawing written in the code, the one each file was first exported from.

`index.html` here shows every file at 24 px and at 96 px with where it's used: with
`python3 serve.py` running, open <http://localhost:8173/icons/ui/>.

## How to draw one

- **The box.** Each file keeps the `viewBox` of the drawing it was exported from, and the game
  draws a file in its own `viewBox`, at the size that place gives its drawings. The Menu's
  items are on `0 0 24 24`, most of the others on `0 0 16 16`, the camera on `0 0 32 32` and
  the dialogue's › on `0 0 10 16` (it stands taller than wide). A new drawing may keep its file's
  box or use `0 0 24 24`; keep it inside the box, about an eighth of it from the edge.
- **Lines only**, no fills: `fill="none"` and `stroke="currentColor"` on the `<svg>`. The
  one exception is the die (`dice.svg`), whose five pips are dots of ink.
- **The Build menu's tabs** (`tab-….svg`) are little sprites rather than single drawings:
  each group shown by one building seen from the front, on a `0 0 24 24` box with the ground
  at y = 21. They may use three classes: `class="ink"` for a shape filled with the pen (the
  windows), `class="h"` for the finer pen (hatching, small detail) and `class="p"` for a shape
  filled with the paper and no line, to hide what's behind something standing in front.
  Everything else is a line in the tab's pen.
- **Only what's inside the `<svg>` reaches the game.** The attributes on the `<svg>` itself
  (`fill`, `stroke`, `stroke-width`…) are only for looking at the file on its own. In the game
  each line is drawn in the colour scheme in use and at the pen's weight of its place
  (styles.css), whatever width the file gives it. So keep to plain lines (`path`, `line`,
  `polyline`, `circle`…), not filled shapes or thick strokes. A circle is drawn over the
  paper in most places (it hides what's behind it), a path never is.
- **Drawn by hand**: lines a little uneven, running a touch past the corners. The Menu's
  items and the Build menu's tabs and `tool-…` tiles are rounder, like a marker doodle (soft corners, few
  strokes, dots for windows), drawn in the game in the pen of the UI's frames. Simple enough to read at 16 px, where most of them are shown.
- **No text** in a drawing: the button's name is its title and, in the Menu, is written beside
  it when it's pointed at or held.
- A drawing that changes with what's going on has a file for each look: `menu.svg` and
  `menu-close.svg`, `fullscreen.svg` and `fullscreen-exit.svg`, `bend-diagonal.svg` and
  `bend-straight.svg`, `sound.svg` and `sound-off.svg`, `lang-cs.svg` and `lang-en.svg`. The Menu button's two share one box,
  `menu.svg`'s.
- `more.svg`, the dialogue's ›, is drawn in by the pen each time it shows, line by line.

## The files

| file | where it's used |
| --- | --- |
| `menu.svg` | Menu button, top right: ≡ while the Menu is folded |
| `menu-close.svg` | Menu button, top right: the cross while the Menu is open |
| `colors.svg` | Menu: Barvy / Colours (a painter's palette with three dabs of paint) |
| `export.svg` | Menu: Uložit do souboru / Save to a file (an arrow coming up out of a box) |
| `import.svg` | Menu: Otevřít ze souboru / Open from a file (an arrow going down into a box) |
| `newmap.svg` | Menu: Nová mapa / New map (a blank sheet with a plus) |
| `fullscreen.svg` | Menu: Celá obrazovka / Full screen, going in (four corners pointing out) |
| `fullscreen-exit.svg` | Menu: Full screen, coming back (four corners pointing in) |
| `sound.svg` | Menu: Zvuk / Sound, while it's on (the village loudspeaker calling out) |
| `sound-off.svg` | Menu: Zvuk / Sound, while it's off (the loudspeaker silent) |
| `lang-cs.svg` | Menu: Čeština (the Czech flag), shown while the game is in English |
| `lang-en.svg` | Menu: English (the Union Jack), shown while the game is in Czech |
| `rename.svg` | Top left: the pencil beside the town's name, to rename it |
| `chronicle.svg` | Top left: the chronicle book, beside the town's name |
| `camera.svg` | Build menu, last in the row under the rail (on a phone, the panel's bottom row): photo mode, **P**; and the dock while it's on |
| `rotate.svg` | Tool dock: rotate option, **Tab** |
| `bend-diagonal.svg` | Tool dock: a line's bend, diagonal first, **Tab** |
| `bend-straight.svg` | Tool dock: a line's bend, straight first, **Tab** |
| `another-look.svg` | Tool dock: another look, **Space**; and the Building card: Jiná podoba / Another look |
| `terrain.svg` | Build menu, after Erase, before the camera: Terén / Terrain (the contour lines), a range of mountains |
| `undo.svg` | Build menu, first in the row, before Erase, and the dock on a phone: Zpět / Undo, **⌘Z** |
| `redo.svg` | Build menu, right after Zpět, and the dock on a phone: Znovu / Redo |
| `erase.svg` | Building card: Zbourat / Demolish, last in the row of drawings (the Erase tool's eraser) |
| `person.svg` | Building card: beside the number of people who live there (one of the town's people, as `src/render/people.js` draws them) |
| `yard.svg` | Building card: Okolí / Surroundings, beside Jiná podoba (a fence and a shrub) |
| `no-road.svg` | Building card: the warning that no road or path reaches it |
| `dice.svg` | New map: Jiné jméno / Another name, beside the town's name |
| `hills.svg` | New map: Krajina / Land (the hills) |
| `lakes.svg` | New map: Jezera / Lakes |
| `forest.svg` | New map: Lesy / Forests |
| `river.svg` | New map: Řeka / River |
| `more.svg` | Dialogue: › to go on, once the line is all written |
| `tab-transport.svg` | Build menu tab: Doprava / Transport (a road going away) |
| `tab-housing.svg` | Build menu tab: Bydlení / Housing (the cube house) |
| `tab-amenities.svg` | Build menu tab: Občanská vybavenost / Amenities (the Jednota shop) |
| `tab-work.svg` | Build menu tab: Výroba / Work (the textile mill's sawtooth roof) |
| `tab-farming.svg` | Build menu tab: Zemědělství / Farming (the JZD cowshed and silo) |
| `tab-spaces.svg` | Build menu tab: Prostranství / Spaces (a tree, a bush) |
| `tab-heritage.svg` | Build menu tab: Památky / Heritage (the chapel) |
| `tool-road.svg` | Build menu tile: Silnice / Road (a stretch of road, its middle dashed) |
| `tool-lane.svg` | Build menu tile: Úzká silnice / Narrow road |
| `tool-path.svg` | Build menu tile: Pěšina / Footpath (a path winding in short dashes) |
| `tool-rail.svg` | Build menu tile: Železnice / Railway (two rails on their sleepers) |
| `tool-fence.svg` | Build menu tile: Ohrada / Fence (posts and two rails) |
| `tool-erase.svg` | Build menu: Vymazat / Erase (a rubber and its smudge) |

The list is the loader's own (`ICONS` in `src/ui/uiIcons.js`): a new file is only read once
it's added there.

## Not here

- **The Build menu's tiles for buildings**: each is drawn from the building's own draw code
  (`src/ui/icons.js` structureIcon), so it always matches what gets built, in a looser, rounder
  hand than the map's (`DOODLE` there, `.icon.doodle` in styles.css).
- **The map's own marks**: the photographer's camera on the map, the cursor's crosses and
  signs, the road marks (`src/render/`).
- **Pen frames and marks drawn to size**: the boxes round the panels (`sketchFrame.js`), what
  a button is doing (`penMarks.js`), the chronicle book's tabs, ribbon, corners and rules,
  the ledger's lines, the intro's underline.
- **Signs set in type**: the × that closes a panel or puts a tool down, the – that folds the
  Build menu, the + of the Build button and the book's ‹ › are letters of the UI's font, not
  drawings.
