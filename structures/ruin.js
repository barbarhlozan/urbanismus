// What is left of a building that burnt down (World.burnStructure), drawn
// in place of it (Renderer.paintStructure): the walls down to stumps,
// broken off at different heights with gaps where they fell, one end wall
// still standing higher, the chimney standing on its own, charred beams
// leaning in, and rubble on the floor. One drawing for every building,
// sized to its footprint; it keeps its seed, so each ruin stays the same.

const T = 0.022; // wall thickness

export function drawRuin(g, def) {
  const xs = def.footprint.map(([x]) => x), ys = def.footprint.map(([, y]) => y);
  const x0 = Math.min(...xs) - g.range(0.17, 0.21), x1 = Math.max(...xs) + g.range(0.17, 0.21);
  const y0 = Math.min(...ys) - g.range(0.17, 0.21), y1 = Math.max(...ys) + g.range(0.17, 0.21);
  const k = 1 + 0.35 * (Math.sqrt(def.footprint.length) - 1); // bigger buildings, taller stumps
  const along = (x1 - x0 >= y1 - y0) ? 'x' : 'y';

  // one end wall stands higher: a short side, a stretch of it
  const ends = along === 'x' ? ['left', 'right'] : ['front', 'back'];
  const standing = g.pick(ends);

  // the four walls, each a run of stumps and gaps; the front has its
  // doorway (a wider gap round the middle)
  const side = (name, a0, a1, place) => {
    const len = a1 - a0, door = name === 'front' ? [a0 + len * 0.4, a0 + len * 0.6] : null;
    let a = a0 + (g.chance(0.4) ? g.range(0.01, 0.05) : 0);
    while (a < a1 - 0.03) {
      let b = Math.min(a1, a + g.range(0.06, 0.17) * k);
      if (door && b > door[0] && a < door[1]) {
        if (a < door[0] - 0.03) b = door[0];
        else { a = door[1]; continue; }
      }
      let h = g.range(0.02, 0.09) * k;
      if (name === standing && a > a0 + len * 0.15 && a < a0 + len * 0.6) h = g.range(0.15, 0.2) * k;
      // broken off unevenly: a stretch is a few steps of masonry
      const steps = b - a > 0.07 ? g.int(2, 3) : 1;
      for (let i = 0; i < steps; i++) {
        const s0 = a + ((b - a) * i) / steps, s1 = a + ((b - a) * (i + 1)) / steps;
        place(s0, s1 - s0, h * (i === 0 ? 1 : g.range(0.45, 1.25)));
      }
      a = b + g.range(0.015, 0.07);
    }
  };
  side('front', x0, x1, (a, w, h) => g.box(a, y0, 0, w, T, h));
  side('back', x0, x1, (a, w, h) => g.box(a, y1 - T, 0, w, T, h));
  side('left', y0 + T, y1 - T, (a, w, h) => g.box(x0, a, 0, T, w, h));
  side('right', y0 + T, y1 - T, (a, w, h) => g.box(x1 - T, a, 0, T, w, h));

  // the chimney, on its own in the middle of it all
  const cx = g.range(x0 + 0.08, x1 - 0.08), cy = g.range(y0 + 0.08, y1 - 0.08);
  const s = 0.045 * Math.min(1.4, k);
  g.box(cx - s / 2, cy - s / 2, 0, s, s, g.range(0.22, 0.3) * k);

  // beams fallen in: from a wall's top down to the floor inside
  g.solid((x0 + x1) / 2, (y0 + y1) / 2, 0);
  for (let i = g.int(2, 4); i > 0; i--) {
    const fromX = g.chance(0.5);
    const top = fromX ? [g.pick([x0, x1]), g.range(y0, y1), g.range(0.04, 0.1) * k] : [g.range(x0, x1), g.pick([y0, y1]), g.range(0.04, 0.1) * k];
    const foot = [g.range(x0 + 0.05, x1 - 0.05), g.range(y0 + 0.05, y1 - 0.05), 0];
    g.line([top, foot]);
  }

  // rubble: short broken strokes on the floor
  for (let i = g.int(4, 7) * Math.ceil(k); i > 0; i--) {
    const x = g.range(x0 + 0.04, x1 - 0.06), y = g.range(y0 + 0.04, y1 - 0.04), w = g.range(0.02, 0.05);
    g.groundLine([[x, y], [x + w * 0.4, y + g.range(-0.012, 0.012)], [x + w, y + g.range(-0.015, 0.015)]], { lod: 1 });
  }
}
