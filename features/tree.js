// Trees. Instance fields: variant (0 = conifer, 1 = broadleaf), scale.
// Uses screen-facing shapes, like the small glyphs on a paper map.

export default {
  id: 'tree',
  name: 'Trees',
  clearable: true,
  blocksRoad: false,

  draw(g, f) {
    const s = f.scale ?? 1;
    if (f.variant === 1) {
      g.line([[0, 0, 0], [0, 0, 0.16 * s]]);
      g.disc(0, 0, 0.27 * s, 0.13 * s);
    } else {
      g.line([[0, 0, 0], [0, 0, 0.1 * s]]);
      g.shape(0, 0, 0.06 * s, [[-0.12 * s, 0], [0.12 * s, 0], [0, 0.4 * s]]);
    }
  },
};
