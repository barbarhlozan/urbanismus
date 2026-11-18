# Ways and fields: more modular

Ways are lines, fields are areas, buildings are obstacles. One table says
what happens where something new meets something there.

Decided (2026-11-18): fields painted with a brush; a house put on any way
(roads too) has the way go round it; a road through a field makes two fields.

1. **Done.** Ways kept off buildings placed freely by the drawn line and
   the walls (`World.buildingsOnLine`, `wayClear`), not by the dots the
   house stands nearest; the reason a way is refused shown beside the
   cross (`OverlayKit.noteAt`).
2. **Done.** Fields as land use: a crop per square of the dense grid, painted with a
   brush (same crop next to a field joins it), erased with the eraser.
   Ways, buildings and water cut out of it when drawn; a road splits a
   field in two. Old saves: the ground closed by field edges filled in.
   (`world/crops.js`, `sim/fields.js`, `tools/cropBrush.js`)
3. One rule table (new kind, kind there) → refuse | join | gap | cut |
   go round, in place of `crossRule` and the layers' `conflicts`.
4. A house on a way: the stretch under its body replaced by a bend round
   it (`easeBends`, checked as any way), one ⌘Z step with the house;
   refused with its reason if the bend can't be laid.
