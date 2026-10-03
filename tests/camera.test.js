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
