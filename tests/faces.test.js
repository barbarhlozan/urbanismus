import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING, facesOf, readSheet, meshOf, WINDOW } from '../src/lab/faces.js';

const model = facesOf(BUILDING);

test("the house's own faces, one panel per plane, named as the street sees them", () => {
  const labels = model.panels.map((p) => p.label);
  for (const l of ['House · front', 'House · back', 'House · left side', 'House · right side', 'House · roof, left slope', 'House · roof, right slope', 'Chimney · top']) {
    assert.ok(labels.includes(l), l);
  }
  // the front wall and the gable over it are one panel (one face since
  // "Whole gables"), from the ground to the peak, taller than wide
  const front = model.panels.find((p) => p.label === 'House · front');
  const zs = front.faces.flat().map((q) => q[2]);
  assert.ok(Math.min(...zs) === 0 && Math.max(...zs) > 0.4 && front.h > front.w);
  // the eave boards under the roof's edges are their own, not more walls
  assert.ok(labels.includes('House · left eave') && labels.includes('House · right eave'));
  // laid out without overlapping
  for (const a of model.panels) for (const b of model.panels) {
    if (a === b) continue;
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.label} / ${b.label}`);
  }
});

test('a panel laid flat goes back onto its face', () => {
  for (const p of model.panels) {
    const [x, y] = p.flat[0][0], back = p.to3D(x, y), was = p.faces[0][0];
    assert.ok(back.every((v, i) => Math.abs(v - was[i]) < 1e-6), p.label);
  }
});

// A painting: every panel filled; on the front a magenta square.
function painting() {
  const { width, height } = model;
  const data = new Uint8ClampedArray(width * height * 4);
  const front = model.panels.find((p) => p.label === 'House · front');
  for (const p of model.panels) {
    if (p.label === 'House · roof, right slope') continue;
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const i = ((p.y + y) * width + p.x + x) * 4;
      data.set([200, 190, 170, 255], i);
    }
  }
  const sq = [front.x + 100, front.y + front.h - 220, 80, 110];
  for (let y = sq[1]; y < sq[1] + sq[3]; y++) for (let x = sq[0]; x < sq[0] + sq[2]; x++) {
    if (x - sq[0] < 8 || sq[0] + sq[2] - x <= 8 || y - sq[1] < 8 || sq[1] + sq[3] - y <= 8) data.set([...WINDOW, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

test('paint per panel, a window where it is squared in magenta', () => {
  const sheet = readSheet(painting(), model);
  const id = (l) => model.panels.find((p) => p.label === l).id;
  assert.equal(sheet.panels[id('House · front')].painted, true);
  assert.equal(sheet.panels[id('House · roof, right slope')].painted, false);
  assert.equal(sheet.panels[id('House · front')].windows.length, 1);
  const mesh = meshOf(model, sheet);
  assert.equal(mesh.windows.length, 1);
  // the window is on the front wall (y at the front, facing the street)
  const w = mesh.windows[0];
  assert.ok(w.n[1] < -0.99 && w.pts.every((q) => Math.abs(q[1] - w.pts[0][1]) < 1e-9));
});

test('a painting of another size says so', () => {
  assert.throws(() => readSheet({ width: 100, height: 300, data: new Uint8ClampedArray(100 * 300 * 4) }, model), /blueprint/);
});
