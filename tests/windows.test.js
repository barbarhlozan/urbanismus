import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../src/render/camera.js';
import { Painter } from '../src/render/painter.js';
import { STRUCTURE_TYPES } from '../structures/index.js';

// A house drawn by the painter leaves its windows for the night, each with
// a number 0–99 (so many hundredths are lit), and the outlines of what it fills.
test('a house keeps its windows, numbered, and what it covers on screen', () => {
  const camera = new Camera({ width: 30, height: 30 });
  const g = new Painter(camera, { x: 10, y: 10, z: 0 }, 0, 42);
  g.near = true;
  STRUCTURE_TYPES.house.draw(g, { seed: 42, rotation: 0 });
  assert.ok(g.panes.length >= 2, `${g.panes.length} windows`);
  for (const w of g.panes) {
    assert.equal(w.pts.length, 4);
    assert.ok(Number.isInteger(w.n) && w.n >= 0 && w.n <= 99);
  }
  // the numbers spread over the tenths, not all the same
  assert.ok(new Set(g.panes.map((w) => w.n)).size > 1);
  // each window lies inside what the house covers
  const covers = g.covers();
  assert.ok(covers.length >= 1);
  const inside = (c, x, y) => {
    let pos = false, neg = false;
    for (let j = 0; j < c.length; j++) {
      const [ax, ay] = c[j], [bx, by] = c[(j + 1) % c.length];
      const cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      if (cr > 0) pos = true; else if (cr < 0) neg = true;
    }
    return !(pos && neg);
  };
  for (const w of g.panes) {
    const x = (w.pts[0][0] + w.pts[2][0]) / 2, y = (w.pts[0][1] + w.pts[2][1]) / 2;
    assert.ok(covers.some((c) => inside(c, x, y)), 'a window on the house');
  }
});
