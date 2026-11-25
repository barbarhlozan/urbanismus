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
  vw: { stroke: 'main', width: PEN[2] }, // (glass: drawn round, not inked)
  vo: { stroke: 'main', width: PEN[4] * 2 }, // a doodled part's outline, under…
  vf: { fill: 'bg', stroke: 'bg', width: PEN[1] }, // …its faces in paper
  vr: { fill: 'bg', stroke: 'main', width: PEN[4] }, // doodled wheels
  vh: { stroke: 'main', width: PEN[1] }, // a car's glass hatched
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

// The same figure in another hand (0…hands-1), for those drawn in only one
// (people, cyclists, canoes, animals): every point moved a little, as one
// drawing of a cartoon differs from the next. Moved by one smooth sway over
// the whole figure, so a point shared by two parts stays shared and a curve
// stays a curve; `share` of the figure's size at most. Cached per figure.
const boiledOf = new WeakMap();
export function boiled(shapes, hand, share = 0.03) {
  let hands = boiledOf.get(shapes);
  if (!hands) boiledOf.set(shapes, hands = []);
  if (hands[hand]) return hands[hand];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) eachPoint(s.d, (x, y) => {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    return [x, y];
  });
  const size = Math.max(x1 - x0, y1 - y0, 1e-6), amp = size * share, f = (Math.PI * 3) / size;
  const p = [1.3, 4.1, 2.7, 5.9].map((k) => k * (hand + 1));
  const sway = (x, y) => [
    x + amp * 0.5 * (Math.sin(x * f + p[0]) + Math.sin(y * f * 1.3 + p[1])),
    y + amp * 0.5 * (Math.sin(y * f + p[2]) + Math.sin(x * f * 1.3 + p[3])),
  ];
  return (hands[hand] = shapes.map((s) => ({ style: s.style, d: eachPoint(s.d, sway) })));
}

// A path with each of its points through `fn` (an arc's radii left alone).
function eachPoint(d, fn) {
  const r = (n) => Math.round(n * 100) / 100;
  return d.replace(/([MLCQA])([^MLCQAZz]*)/g, (all, cmd, args) => {
    const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const step = cmd === 'A' ? 7 : 2;
    for (let i = 0; i + step <= n.length; i += step) {
      const k = cmd === 'A' ? i + 5 : i;
      [n[k], n[k + 1]] = fn(n[k], n[k + 1]);
    }
    return cmd + n.map(r).join(' ');
  });
}
