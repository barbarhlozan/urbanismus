## Controls

Everything you can build is in the **Build** menu, bottom right, in the groups the planners of
the time used: Doprava (transport), Bydlení (housing), Výroba (industry, mines, farms),
Občanská vybavenost (civic amenities: shops, pubs, offices, services, school, culture – none of
it private, so there's no separate "business"), Prostranství (parks and squares) and Památky
(landmarks). Along its bottom (under the rail on a computer) stand, in this order, Zpět and
Znovu (undo, redo), Erase, Terrain and photo mode. Every building is its own thing to build: nothing upgrades into
something else. Open a group to see its tools; click a tool to pick it up and click it
again (or close its group, or **Esc**) to put it down. The **–** folds the menu into a single
Build button; picking a tool folds it too, out of the way, and it comes back when you put the
tool down. Things that come in more than one size (a house and a wide one, the three
workshops, the Národní výbor's offices and towers, station / stop, town hall…) are one tool
with a **Size** button (**Shift**). While a tool is in hand, it sits in the dock at the
bottom edge with its options (size, rotate, another look, bend…) beside it and an **×** to
put it down.

**Zpět** (Undo) takes back your last change to the town – a building, a road, a demolition, a
whole click's worth – and **Znovu** (Redo) puts it back. On a computer both stand in the box
under the Build rail, first, before Erase: **Zpět** always, struck through while there is
nothing to take back, and **Znovu** right after an undo, until you change something else. On a
phone they stand in the dock, **Zpět** beside the Build button (or before the × of the tool in
hand) and **Znovu** after an undo. Neither is shown in photo mode. **⌘Z** / **Ctrl+Z** and **⇧⌘Z** / **Ctrl+Y**
do the same. If something now stands in the way of a step, it says so and the step is dropped.

The **≡** at the top right opens the Menu: Colours, Save to a file, Open from a file, New map,
Nastavení (the Settings) and Hlavní menu (back to the main menu), each a small drawing. Point at one (or, on a phone, hold
a finger on it) and its name is written beside it; on a computer they stand in a line along the
top edge, on a phone in a column down from the ≡. These drawings, and the UI's others (the ≡
itself, photo mode's sketchbook, the chronicle book, the tool options, the New map settings…), are SVG files
of their own in `icons/ui/`, read when the game starts: replace a file to change a drawing. Its
README says how to draw one and lists them all, and `icons/ui/index.html` shows them side by side.

The Build menu offers what the story of Dědina needs and nothing more: the houses and family
houses, the výměnek (a farmer's little cottage to retire to, as Wenzlová's above the
church: a room and a kitchen, gable or eaves to the street, a fenced yard), the pub, the penzion, the chapel and the church, the bus stop, the roads and footpaths, the fields,
meadow, fence and churchyard wall, trees, benches, the pitch, the village pond, the well and the saint or kašna on the náves. No train comes
to Dědina, and the summer cinema, playground, flower beds and forest park belong to a town:
`story/unlocks.txt` locks them, and a sandbox can unlock them again.

Shortcuts come in two steps that follow the Build menu: the **number row** opens a group
(**1** Doprava, **2** Bydlení, **3** Občanská vybavenost, **4** Výroba, **5** Prostranství,
**6** Památky – the numbers are on the tabs), and the **letter rows** pick a tool in the
group that's open, its tiles in reading order (**Q W E R T Y U I O**, then **A S D F G H J
K**, then **Z X C V B N M , . /** – each tile shows its key). The group stays open, so **2**,
**Q** builds houses and then **W** switches to apartments; pressing the key of the tool in
hand puts it down. A few keys are always the same: **P** photo, **Backspace** erase, and while building **Tab** rotate, **Space** another
look, **Shift** size. They go by where the key sits (a US keyboard), so they work the same on
a Czech or German layout.

- **Click the map** – menu for the nearest dot (build, road from here, remove); the dots
  themselves only show while building
- **Roads**, **footpaths** (Doprava: **1 Q**, **1 E**) – click start, click end; **Tab** flips the bend
- Drawn **over a river**, a way gets a bridge: it crosses straight, in the direction nearest to the
  stroke, and bends back to the line on the far bank. It only fails if the way ends in the water or the
  river is too wide.
- Draw a footpath **along a road** (on it or right beside it) to make it a street with sidewalks (kerb lines on both
  sides, street lamps, zebra crossings at junctions). People only walk along streets and footpaths; cyclists and
  cars use every road. Erasing a street removes its sidewalks first.
- Roads are drawn by hand, as footpaths are, only with a steadier pen: each edge (and a street's kerb) in
  long strokes that overlap where the pen was set down again, now and then gone over twice. Footpaths
  are lighter, broken and wander in and out.
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
- **Bus stop** (**1 Y**), a small thing set right at a road's edge, facing it: a shelter, the stop sign, a bench. Buses only
  come when a road leads off the map: in through an exit, a few stops (nearest next), out again.
- **Bydlení** (**2**): house / apartments / block, each also wide (**Shift**)
- **Občanská vybavenost** (**3**): Jednota, hospoda, penzion, obchodní dům, Tuzex, národní výbor, pošta,
  hotel, the services, school, house of culture, swimming pool, cemetery
- **Výroba** (**4**): workshops, works, factory and plants in their sizes, the three mines,
  farmstead / JZD / státní statek
- **Prostranství** (**5**): every park and square
- **Fields** (a tab of their own, **Pole a pastviny**, apart from the roads and paths; the
  **Ohrada** is there too, a fence that closed all round makes a pasture, and beside it the
  **Zídka**, a churchyard wall drawn the same way, see Landmarks) – **Obilí**, **Brambory** and **Louka** (a meadow: grass and wild flowers – daisies,
  poppies, dandelions, thistles – new maps have one or two now and then) are brushes: their circle follows the pointer and
  shows how much they cover, a press paints the crop there and holding it down paints wherever
  you drag (one ⌘Z for the stroke). The field keeps the brush's uneven edge, and the crop comes
  up where it was painted, once. A new field's rows run the way the stroke went; painted on, a
  field keeps its rows. **Vymazat** takes a whole field at once: the one under the pointer shows
  its outline, and clicked, its crop sinks back into the ground from where it was touched.
  **[** and **]** make the brush smaller and bigger
- **Backspace** – erase
- **P** or the **sketchbook**, last in the Build menu's bottom row – photo mode: click where
  to stand, aim with the pointer, click to take a picture of the town from street level;
  its options are in the dock: **Draw it** (Nakreslit; on a phone the only way to take it) and **Move**. There is no
  lens to pick, and on the map only a small arrow shows which way you look: the picture is
  framed when it's taken, as a drawing is composed – the houses looked at whole in it (the
  view turned a little to have them in the middle, and up close the photographer steps back a
  few paces). Right up against a building it is a detail of it instead, looked up at, the
  walls leaning in towards the sky; a church too tall for the picture otherwise has the
  horizon lowered for it. Standing among the houses it is a picture of a house or two; the further off the
  nearest ones are, the more of the village it takes in and the wider it goes, till from out
  in the fields it is the whole village in its landscape. Anything else the picture's sides
  or top would cut through is left out, paper there instead of half a house. It opens as a
  print you can save as a PNG, drawn in before your eyes as an illustrator would: the line of the
  land first, then the houses, then their roofs and windows, the trees, the land, and last the sky.
  The photo is drawn in one pen, with the map's own brushed line (thinner at the ends,
  swelling along it): the landscape in the same ink as the houses, only lighter, lines a
  little heavier in front; the horizon a little below the middle; the ground's rises and dips
  close by flattened, so houses stand on it rather than sink behind it; the ground in short
  upright strokes, as grass, each its own and some in tufts; walls with no line along their
  foot and no shade, and no shadows on the ground; chimneys rising out of the roof's slope;
  tree crowns drawn round underneath to where the trunk goes in; windows with their bars and
  sills; in the rain short dashes falling all over the picture. It is drawn in a looser hand
  than the map – lines a little shakier, each swelling and thinning more along its length –
  with uneven clouds, and trees smaller than the map draws them, so they don't tower over the
  houses. Towards its edges the drawing thins away, as a sketch left unfinished there. Its
  lines are as fine on the print as the map's are on the screen
- **Esc / right-click** – back to select; **right-click** with nothing in hand picks up
  what's under the pointer (same building, size and rotation, or the road / railway /
  footpath) to build more of it
- **Middle click** – same as **Tab** (rotate what you're placing, flip a line's bend)
- **Drag / wheel** – pan / zoom
- **Right-button drag** – turn the view; let go and it coasts on a little and settles on
  the nearest 2° step. On a phone, twist two fingers. Buildings, their gardens and
  shadows, roads and trees are drawn from the side they face as it turns (each keeps its
  drawings for the steps either side of where the view rests, made while it rests). While it
  turns they are drawn bare – no windows, sparse roof hatching – and once it rests the pen
  draws their detail back in, from the middle of the screen out. A chimney rises out of
  its roof's slope, on the map as on a photo: behind the ridge only its top shows
- **Terrain** – contour lines: a button between Erase and the camera (under the Build rail on a computer, in
  the panel's bottom row on a phone), crossed while on; once on they stay on whatever's in
  hand, until switched off there (off by default, they are the most expensive thing to draw)

On a phone it's all taps: tap once to preview, tap again to confirm. The Build menu starts
folded there and folds again once you pick a tool.
