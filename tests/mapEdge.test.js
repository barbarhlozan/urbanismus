// A way drawn freehand off the map stops where the hand crossed the edge:
// it ends on the edge (and so runs on off the map, World.roadExits), and
// whatever the drag does beyond is not laid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.js';
import { createNetworkTool } from '../src/tools/network.js';

const drag = (tool, pts) => {
  tool.sketch.start(...pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    for (let k = 1; k <= 40; k++) tool.sketch.move(a[0] + ((b[0] - a[0]) * k) / 40, a[1] + ((b[1] - a[1]) * k) / 40);
  }
  tool.sketch.end();
};

for (const land of ['square', 'round']) {
  test(`a road dragged off the ${land} map ends on its edge`, () => {
    const w = new World({ width: 24, height: 24, seed: 3, name: 'Testov', rockiness: 0, hilliness: 0, land });
    const tool = createNetworkTool({ world: w, config: {} }, { kind: 'road' });
    // out past the right edge, then along beyond it and back down
    drag(tool, [[11.5, 11.5], [30, 11.5], [30, 2], [30, 20]]);
    const edges = [...w.ways.edges.values()];
    assert.equal(edges.length, 1, 'one road laid');
    const pts = edges[0].pts;
    for (const p of pts) assert.ok(w.land.depth(...p) > -0.05, `${p} lies off the map`);
    const end = pts[0][0] > pts.at(-1)[0] ? pts[0] : pts.at(-1);
    assert.ok(Math.abs(w.land.depth(...end)) < 0.05, `the end ${end} is on the edge`);
    // where the drag crossed it, not slid along it
    assert.ok(Math.abs(end[1] - 11.5) < 0.6, `the end ${end} is where the hand went out`);
    assert.equal(w.roadExits().length, 1, 'it runs off the map');
  });
}

// A street run off the map: its kerbs carry on past the edge with the road,
// not round in a half circle across the sidewalk as at a dead end.
test("a street's kerbs run on off the map at an exit", async () => {
  const { streetKerbs } = await import('../src/roads/geometry.js');
  const { CONFIG } = await import('../src/config.js');
  const w = new World({ width: 24, height: 24, seed: 3, name: 'Testov', rockiness: 0, hilliness: 0 });
  const tool = createNetworkTool({ world: w, config: {} }, { kind: 'road', street: true });
  drag(tool, [[11.5, 11.5], [30, 11.5]]);
  assert.equal(w.roadExits().length, 1);
  const kinds = streetKerbs(w, CONFIG.road, CONFIG.lane).map((k) => k.kind);
  assert.ok(kinds.includes('exit'), 'kerbs carry on off the map');
  // …each as one stroke, from the edge out to where it has faded
  for (const k of streetKerbs(w, CONFIG.road, CONFIG.lane).filter((k) => k.kind === 'exit')) {
    assert.ok(w.land.depth(...k.line[0]) > -0.3 && w.land.depth(...k.line.at(-1)) < -1.5);
  }
  assert.equal(kinds.filter((k) => k === 'end').length, 1, 'only the inner dead end is walked round');
});
