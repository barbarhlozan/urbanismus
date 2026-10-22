// The moving things – people, cyclists, cars, trucks, trains – are drawn
// with WebGL (gl/movers.js) between the map and the buildings, not as SVG
// elements: hundreds of them move every frame, and moving an SVG element
// restyles it and repaints the map's whole layer under it.
//
// They are drawn from the same SVG snippets as the photos' (vehicles.js,
// people.js), read once into shapes, and styled here to match styles.css:
// the colours from the scheme, and the line widths times the map's --stroke
// (Renderer.updateStroke), so a car's outline is as heavy as the road line
// beside it on any screen and at any zoom.

// The map's pens (--pen-1…5 in styles.css), px of line width.
export const PEN = [0, 0.5, 0.7, 1, 1.4, 2];

// Per class (the snippets' classes, and the plain marks further out): fill
// and stroke as palette names, stroke width as in styles.css (before --stroke).
const STYLES = {
  vb: { fill: 'bg', stroke: 'main', width: PEN[3] },
  vi: { fill: 'main', stroke: 'main', width: PEN[1] },
  'fig-body': { fill: 'bg', stroke: 'main', width: PEN[3] },
  'fig-head': { stroke: 'main', width: PEN[2] },
  'fig-wheel': { stroke: 'main', width: PEN[2] },
  'fig-line': { stroke: 'main', width: PEN[2] },
  'fig-ink': { fill: 'main', stroke: 'main', width: PEN[1] },
  car: { fill: 'main' },
  walker: { fill: 'main' },
  cyclist: { fill: 'main', stroke: 'main', width: PEN[1] },
  truck: { fill: 'main', stroke: 'main', width: PEN[3] },
  train: { fill: 'main', stroke: 'main', width: PEN[3] },
  sgl: { stroke: 'main', width: PEN[3] },   // a crossing sign's pole (crossings.js)
  flash: { stroke: 'main', width: PEN[3] }, // its lights flashing
};

const parsed = new Map();

// An SVG snippet (<path class="…" d="…"/>…) as [{ style, d }]. Cached:
// the snippets come from caches themselves, so there are only so many.
export function shapesOf(svg) {
  let shapes = parsed.get(svg);
  if (!shapes) {
    shapes = [...svg.matchAll(/<path class="([^"]*)" d="([^"]*)"\s*\/>/g)].map((m) => shape(m[1], m[2]));
    parsed.set(svg, shapes);
  }
  return shapes;
}

// One shape: a path `d` in style `cls`.
export function shape(cls, d) {
  return { style: STYLES[cls] ?? STYLES.car, d };
}

export { STYLES as AGENT_STYLES };
