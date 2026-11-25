// How a cloud's edge is drawn, wherever a cloud is drawn – in a photo's sky
// (clouds.js) and overhead on the map (cloudsAbove.js) – so the two look
// like the same clouds by the same hand. SVG path data, which a canvas
// takes too (new Path2D(d)).

export const r2 = (n) => Math.round(n * 100) / 100;
export const P = (x, y) => `${r2(x)} ${r2(y)}`;

// A bulge from the current point a to b as a hand draws it, not a compass:
// the arc of radius r (the minor one; up – on the left going from a to b –
// with `up`, else down) as a curve whose two pulls are each a little off,
// so no two bulges are the same and none is a true circle.
export function bulge(rnd, a, b, r, up) {
  const dx = b[0] - a[0], dy = b[1] - a[1], c = Math.hypot(dx, dy) || 1e-6;
  const sag = Math.max(0, r - Math.sqrt(Math.max(0, r * r - (c * c) / 4))) * (up ? 1 : -1);
  const nx = dy / c, ny = -dx / c; // left of a → b, on the picture (y down)
  const pull = (t, k) => [a[0] + dx * t + nx * sag * k, a[1] + dy * t + ny * sag * k];
  const p1 = pull(0.04 + rnd() * 0.16, 1.15 + rnd() * 0.35), p2 = pull(0.8 + rnd() * 0.16, 1.15 + rnd() * 0.35);
  return `C${P(...p1)} ${P(...p2)} ${P(...b)}`;
}
