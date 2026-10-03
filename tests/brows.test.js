// The brows and what the camera sees of the ground (render/brows.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../src/render/camera.js';
import { Grid } from '../src/core/grid.js';
import { visibility, browLines } from '../src/render/brows.js';

const BOX = [0, 0, 19, 19];

// a round hill in the middle of the map, `k` grid units high: the higher,
// the more steeply its back falls away from the viewer
function ridgeCamera(rotation = 0) {
  const camera = new Camera(new Grid(20, 20));
  camera.rotation = rotation;
  return camera;
}
const ridge = (k) => (x, y) => k / (1 + ((x - 9.5) ** 2 + (y - 9.5) ** 2) / 9);

test('a gentle hill hides nothing and gets no brow', () => {
  const camera = ridgeCamera();
  const vis = visibility(camera, ridge(0.3), BOX);
  assert.ok(vis.columns.every((c) => !c.hidden.length));
  assert.equal(browLines(vis, camera).length, 0);
});

test('a steep hill hides the ground behind it and is outlined', () => {
  for (const rotation of [0, 1, 2, 3]) {
    const camera = ridgeCamera(rotation);
    const vis = visibility(camera, ridge(4), BOX);
    assert.ok(vis.columns.some((c) => c.hidden.length), `rotation ${rotation}: hidden ground`);
    const lines = browLines(vis, camera);
    assert.ok(lines.length >= 1, `rotation ${rotation}: a brow`);
    assert.ok(lines.some((l) => Math.max(...l.s) >= 1), `rotation ${rotation}: drawn as the outline`);
  }
});

test('a middling slope gets a light brow, not an outline', () => {
  const camera = ridgeCamera();
  const lines = browLines(visibility(camera, ridge(1.2), BOX), camera);
  assert.ok(lines.length >= 1);
  assert.ok(lines.every((l) => Math.max(...l.s) < 1));
});
