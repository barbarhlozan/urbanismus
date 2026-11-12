// The map's fill patterns, by id: the drawings of ponds, pools and a
// mine's pit fill their water with url(#hatch-water) (structures/). Put
// into the map's <svg> by renderer.js, and into the lab pages that draw
// them (src/lab/page.js).
export const MAP_PATTERNS = `<pattern id="hatch-water" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(-40)">
  <line class="hatch" x1="0" y1="2.5" x2="5" y2="2.5"/>
</pattern>`;
