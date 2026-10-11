// Picking: Camera.unproject finds the ground under a screen point, even on
// slopes steep enough to hide the ground behind them (render/camera.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../src/render/camera.js';
import { Grid, rotateQuarter } from '../src/core/grid.js';
import { makeLift } from '../src/render/warp.js';

// A steep ridge across the map: up to 6 grid steps of lift, rising up to
// ~2.4 per step – far past where undoing the lift step by step converges.
function steepCamera(rotation) {
  const camera = new Camera(new Grid(20, 20));
  camera.rotation = rotation;
  const ridge = (x, y) => 100 / (1 + ((x + y - 20) / 4) ** 2) + 10 * Math.sin(x * 0.7);
  camera.lift = makeLift(ridge, 100, 6, [0, 0, 19, 19]);
  return camera;
}

// How (x, y) shows: 'seen', 'hidden' (nearer ground covers it) or 'grazed'
// (on a ridge's outline – the line of sight towards the viewer only just
// clears the ground, so either side of the outline is a fair pick).
function visibility(camera, x, y) {
  const [, sy] = camera.project(x, y);
  const [dx, dy] = rotateQuarter(1, 1, -camera.rotation); // towards the viewer
  let gap = Infinity;
  for (let s = 0.05; s < 10; s += 0.01) gap = Math.min(gap, camera.project(x + dx * s, y + dy * s)[1] - sy);
  return gap > 0.5 ? 'seen' : gap < -0.5 ? 'hidden' : 'grazed';
}

for (const rotation of [0, 1, 2, 3]) {
  test(`picks the nearest ground under the cursor on a steep ridge (rotation ${rotation})`, () => {
    const camera = steepCamera(rotation);
    const count = { seen: 0, hidden: 0, grazed: 0 };
    for (let y = 2; y < 18; y += 0.29) {
      for (let x = 2; x < 18; x += 0.29) {
        const [sx, sy] = camera.project(x, y);
        const p = camera.unproject(sx, sy);
        const [qx, qy] = camera.project(...p);
        assert.ok(Math.hypot(qx - sx, qy - sy) < 0.01, `not under the cursor at ${x}, ${y}`);
        const v = visibility(camera, x, y);
        count[v]++;
        if (v === 'seen') assert.ok(Math.hypot(p[0] - x, p[1] - y) < 0.02, `missed ${x}, ${y}`);
        if (v === 'hidden') assert.ok(camera.depth(...p) > camera.depth(x, y), `picked behind ${x}, ${y}`);
      }
    }
    assert.ok(count.seen > count.hidden, JSON.stringify(count)); // the test still sees the ridge
  });
}

// Keeping the map in view: the middle of the screen goes no further than a
// strip of paper past the edge, in every rotation and at every zoom, and
// the drag slows to that stop instead of hitting it.
for (const rotation of [0, 1, 2, 3]) {
  test(`panning stops a little past the edge of the map (rotation ${rotation})`, () => {
    for (const zoom of [0.55, 1, 2.2, 4]) {
      const camera = new Camera(new Grid(70, 70), { tile: 34, zoom, minZoom: 0.55 });
      camera.rotation = rotation;
      camera.setViewport(1024, 768);
      camera.centerOn(camera.cx, camera.cy, 1024, 768);
      const [free, most] = camera.margins();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
        camera.centerOn(camera.cx, camera.cy, 1024, 768);
        let last = Infinity;
        for (let k = 0; k < 400; k++) {
          const before = camera.middle();
          camera.pan(dx * 30, dy * 30);
          const after = camera.middle();
          const moved = Math.hypot(after[0] - before[0], after[1] - before[1]);
          const out = Math.max(-after[0], -after[1], after[0] - 69, after[1] - 69);
          if (out > free) {
            assert.ok(moved <= last + 1e-9, 'it slows down past the free strip');
            last = moved;
          }
          assert.ok(out <= most + 1e-9, `too far out at zoom ${zoom}: ${after}`);
        }
        const [x, y] = camera.middle();
        const out = Math.max(-x, -y, x - 69, y - 69);
        assert.ok(out > free && out > most - 0.05, `the edge stays within reach at zoom ${zoom}`);
      }
    }
  });
}

test('the same drag ends in the same place however it is split', () => {
  const run = (step) => {
    const camera = new Camera(new Grid(40, 40), { tile: 34, zoom: 1 });
    camera.setViewport(800, 600);
    camera.centerOn(camera.cx, camera.cy, 800, 600);
    for (let moved = 0; moved < 1500; moved += step) camera.pan(step, 0);
    return camera.middle();
  };
  const [a, b] = [run(5), run(50)];
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6, `${a} vs ${b}`);
});

test('zooming and resizing keep the map in view', () => {
  const camera = new Camera(new Grid(70, 70), { tile: 34, zoom: 4, minZoom: 0.55 });
  camera.setViewport(1024, 768);
  for (let k = 0; k < 100; k++) camera.pan(300, 0);
  for (let k = 0; k < 40; k++) camera.zoomAt(10, 10, 0.9); // zoom out at the corner of the screen
  const check = () => {
    const [, most] = camera.margins();
    for (const v of camera.middle()) assert.ok(v >= -most - 1e-9 && v <= 69 + most + 1e-9, `${camera.middle()}`);
  };
  check();
  for (let k = 0; k < 40; k++) camera.zoomAt(1000, 760, 1.1);
  check();
  camera.setViewport(375, 812);
  check();
});
