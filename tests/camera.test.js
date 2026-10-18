// Picking: Camera.unproject finds the ground under a screen point, even on
// slopes steep enough to hide the ground behind them (render/camera.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../src/render/camera.js';
import { Grid, rotateQuarter } from '../src/core/grid.js';
import { makeLift } from '../src/render/warp.js';
import { isoSort } from '../src/render/order.js';

// The view's four quarter turns, and some turns between them (radians).
const TURNS = [0, 1, 2, 3].map((r) => (r * Math.PI) / 2).concat([0.4, 2.2, 3.9, 5.5]);

// A steep ridge across the map: up to 6 grid steps of lift, rising up to
// ~2.4 per step – far past where undoing the lift step by step converges.
function steepCamera(angle) {
  const camera = new Camera(new Grid(20, 20));
  camera.angle = angle;
  const ridge = (x, y) => 100 / (1 + ((x + y - 20) / 4) ** 2) + 10 * Math.sin(x * 0.7);
  camera.lift = makeLift(ridge, 100, 6, [0, 0, 19, 19]);
  return camera;
}

// How (x, y) shows: 'seen', 'hidden' (nearer ground covers it) or 'grazed'
// (on a ridge's outline – the line of sight towards the viewer only just
// clears the ground, so either side of the outline is a fair pick).
function visibility(camera, x, y) {
  const [, sy] = camera.project(x, y);
  const [dx, dy] = camera.toWorld(1, 1); // towards the viewer
  let gap = Infinity;
  for (let s = 0.05; s < 10; s += 0.01) gap = Math.min(gap, camera.project(x + dx * s, y + dy * s)[1] - sy);
  return gap > 0.5 ? 'seen' : gap < -0.5 ? 'hidden' : 'grazed';
}

for (const angle of TURNS) {
  test(`picks the nearest ground under the cursor on a steep ridge (turned ${angle.toFixed(2)})`, () => {
    const camera = steepCamera(angle);
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
// strip of paper past the edge, at every turn of the view and every zoom,
// and the drag slows to that stop instead of hitting it.
for (const angle of TURNS) {
  test(`panning stops a little past the edge of the map (turned ${angle.toFixed(2)})`, () => {
    for (const zoom of [0.55, 1, 2.2, 4]) {
      const camera = new Camera(new Grid(70, 70), { tile: 34, zoom, minZoom: 0.55 });
      camera.angle = angle;
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

test('the quarter turns are exact, and the nearest one is the rotation', () => {
  const camera = new Camera(new Grid(20, 20));
  for (const r of [0, 1, 2, 3]) {
    camera.rotation = r;
    assert.equal(camera.rotation, r);
    assert.equal(camera.skew, 0);
    for (const [x, y] of [[1, 0], [0, 1], [3, -2]]) {
      const [a, b] = camera.toView(x, y), [c, d] = rotateQuarter(x, y, r);
      assert.ok(a === c && b === d, `${[a, b]} vs ${[c, d]}`); // (exactly, -0 or not)
    }
  }
  camera.angle = Math.PI / 2 + 0.6; // past a quarter, short of halfway to the next
  assert.equal(camera.rotation, 1);
  camera.angle = Math.PI / 2 + 0.9;
  assert.equal(camera.rotation, 2);
  assert.ok(Math.abs(camera.skew - (0.9 - Math.PI / 2)) < 1e-12);
  camera.angle = -0.1; // all the way round
  assert.equal(camera.rotation, 0);
  assert.ok(camera.angle > 6);
});

test('turning keeps the ground under the pivot in place, and turns back', () => {
  const camera = new Camera(new Grid(40, 40), { tile: 34 });
  camera.setViewport(800, 600);
  camera.centerOn(18, 22, 800, 600);
  const under = (px, py) => camera.unprojectFlat(...camera.clientToScene(px, py));
  const before = under(300, 200);
  for (const da of [0.3, 1.2, -2.5]) {
    camera.turnAt(300, 200, da);
    const p = under(300, 200);
    assert.ok(Math.hypot(p[0] - before[0], p[1] - before[1]) < 1e-9, `${p} vs ${before}`);
  }
  camera.turnAt(300, 200, 1);
  assert.ok(Math.abs(camera.angle - 0) < 1e-9 || Math.abs(camera.angle - Math.PI * 2) < 1e-9);
});

test('a turn let go coasts to a stop, the way it went, on a step of the turn', () => {
  const camera = new Camera(new Grid(40, 40), { tile: 34 });
  camera.setViewport(800, 600);
  camera.angle = 0.013; // (between steps)
  camera.letGo([400, 300], 2);
  let last = 0, steps = 0;
  while (camera.spin && steps++ < 1000) {
    const before = camera.angle;
    camera.coast(1 / 60);
    const moved = camera.angle - before;
    assert.ok(moved > 0, 'never turns back');
    // (slower every frame, but for the last hair of the way)
    if (last && camera.spin) assert.ok(moved < last, 'slows down');
    last = moved;
  }
  assert.ok(steps < 150, `stops within two and a half seconds (${steps})`);
  assert.ok(camera.angle > 0.3 && camera.angle < 0.6, `${camera.angle}`);
  assert.notEqual(camera.step(), null, 'rests on a step');
  // let go without a flick, it settles on the nearest step
  camera.angle = 3 * Camera.STEP + 0.004;
  camera.letGo([400, 300], 0);
  while (camera.spin) camera.coast(1 / 60);
  assert.equal(camera.step(), 3);
});

// Two buildings, one just behind the other along a grid line, stay in that
// order however the view is turned (their boxes in Camera.quarter axes).
test('the painter keeps the one behind behind, at any turn', () => {
  let overlapping = 0;
  for (const angle of TURNS) {
    const camera = new Camera(new Grid(20, 20));
    camera.angle = angle;
    const box = (x0, y0, x1, y1, name) => {
      const pts = [[x0, y0], [x1, y1], [x0, y1], [x1, y0]].map(([x, y]) => camera.quarter(x, y));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return { name, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    };
    // a long barn and a shed beside its end, further along x: the shed is
    // nearer when the viewer looks from further along x, and drawn later
    // then, though its middle may be further off than the barn's
    const barn = box(5, 5, 6, 12, 'barn'), shed = box(6.2, 11, 7, 12, 'shed');
    const order = isoSort([barn, shed], camera.quarterView()).map((it) => it.name);
    // (side by side on screen, either order looks the same)
    if (barn.right <= shed.left || shed.right <= barn.left) continue;
    overlapping++;
    const nearer = camera.toWorld(1, 1)[0] > 0 ? 'shed' : 'barn';
    assert.equal(order[1], nearer, `turned ${angle.toFixed(2)}: ${order}`);
  }
  assert.ok(overlapping >= 4, `${overlapping}`); // (the test still tests something)
});
