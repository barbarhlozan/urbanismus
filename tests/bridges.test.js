// Bridges: where networks may cross water (roads/routing.js), and how they
// are found and drawn (render/bridges.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road, river, run } from './helpers.js';
import { findBridges, bridgeLines, makeDeck, BRIDGE_STYLES } from '../src/render/bridges.js';
import { RIVER_SIZES, riverField } from '../src/terrain/rivers.js';

test('a road crosses a narrow river on a bridge', () => {
  const w = flatWorld();
  river(w, 10);
  assert.equal(road(w, [7, 5], [13, 5]).ok, true);
  const [b, ...rest] = findBridges(w);
  assert.equal(rest.length, 0);
  assert.equal(b.kind, 'road');
  assert.deepEqual([b.a, b.b].sort((p, q) => p[0] - q[0]), [[9, 5], [11, 5]]);
  assert.ok(BRIDGE_STYLES.road.includes(b.style));
  // the same crossing always gets the same style
  assert.equal(findBridges(w)[0].style, b.style);
});

test('what is not bridged', () => {
  const wide = flatWorld();
  river(wide, 10, 3);
  assert.match(road(wide, [7, 5], [15, 5]).reason, /Too wide/);

  const lake = flatWorld();
  for (let y = 0; y < 20; y++) lake.terrain.water[lake.grid.index(10, y)] = 1;
  assert.match(road(lake, [7, 5], [13, 5]).reason, /only cross rivers/);

  const bent = flatWorld();
  river(bent, 10, 2);
  const nodes = [...run(bent, [8, 5], [9, 5]), ...run(bent, [10, 5], [11, 6]), ...run(bent, [12, 6], [13, 6])];
  assert.match(bent.buildNetwork('road', nodes).reason, /straight/);
});

test('every style draws, and leaves out what the deck hides on the far side', () => {
  const piers = [[1, 0], [2, 0]];
  for (const [kind, styles] of Object.entries(BRIDGE_STYLES)) {
    for (const style of styles) {
      const br = { kind, a: [0, 0], b: [3, 0], piers: kind === 'road' ? piers : [[0.5, 0], [1, 0], [1.5, 0], [2, 0], [2.5, 0]], half: 0.1, style };
      const deck = makeDeck([br], null);
      const all = bridgeLines(br, deck);
      assert.ok(all.length > 4, `${kind} ${style} draws`);
      for (const { line } of all) for (const p of line) assert.ok(p.every(Number.isFinite), `${kind} ${style}: a point is not a number`);
      // seen from one side only: fewer lines under the deck
      const seen = bridgeLines(br, deck, ([x, y]) => x + y > 0);
      assert.ok(seen.length < all.length, `${kind} ${style} hides its far side`);
      const below = (lines) => lines.filter(({ line }) => line.some(([x, y, z]) => z < deck(x === 0 ? 1.5 : x, 0) - 0.06)).length;
      assert.ok(below(seen) <= below(all));
    }
  }
});

// A straight river (or stream) down the map at x = 10, its water dots from
// its field, on level ground (no valley).
function laidRiver(size) {
  const w = flatWorld();
  const { width, vary, bend, wet, wall, reach } = RIVER_SIZES[size];
  w.terrain.rivers = [{ points: [[10, -4], [10, 24]], z: [0, 0], width, vary, bend, wet, wall, reach }];
  const field = riverField(w.terrain.rivers);
  w._relief = { rivers: w.terrain.rivers, field, elevation: () => 0, rock: () => 0 };
  for (let i = 0; i < w.grid.size; i++) if (field.wet(...w.grid.xy(i)) > 0) w.terrain.water[i] = 2;
  return w;
}

test('a bridge reaches from bank to bank: shorter and lower over a stream', () => {
  const deckOf = (size) => {
    const w = laidRiver(size);
    assert.equal(road(w, [6, 5], [14, 5]).ok, true);
    const [b] = findBridges(w);
    const len = Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]);
    return { length: (b.to - b.from) * len, clearance: b.clearance, piers: b.piers.length, deck: makeDeck([b], null) };
  };
  const river = deckOf('river'), stream = deckOf('stream');
  assert.ok(stream.length < river.length, `stream ${stream.length} vs river ${river.length}`);
  assert.ok(stream.length < 1);
  assert.ok(stream.clearance < river.clearance);
  assert.equal(stream.piers, 0);
  // over the water the deck is up, on the land dots either side it is down
  assert.ok(stream.deck(10, 5) > 0);
  assert.equal(stream.deck(9.4, 5), 0);
});

// A way drawn freehand across a river, pressed on one bank and let go on
// the other: the bridge stands where the drawn line crosses the water, not
// between the grid dots beside it.
test('a road sketched over a river has its bridge on the road', async () => {
  const { createNetworkTool } = await import('../src/tools/network.js');
  const w = flatWorld();
  river(w, 10);
  const tool = createNetworkTool({ world: w, config: {} }, { kind: 'road' });
  const a = [6.3, 5.4], b = [14.2, 5.45];
  tool.sketch.start(...a);
  for (let i = 1; i <= 60; i++) tool.sketch.move(a[0] + ((b[0] - a[0]) * i) / 60, a[1] + ((b[1] - a[1]) * i) / 60);
  tool.sketch.end();
  const [edge] = [...w.ways.edges.values()];
  assert.ok(edge, 'the road is laid');
  const [br] = findBridges(w);
  assert.ok(br, 'it has a bridge');
  // both ends of the bridge on the drawn line
  const off = ([x, y]) => {
    let best = Infinity;
    for (let i = 1; i < edge.pts.length; i++) {
      const [p, q] = [edge.pts[i - 1], edge.pts[i]], vx = q[0] - p[0], vy = q[1] - p[1];
      const t = Math.max(0, Math.min(1, ((x - p[0]) * vx + (y - p[1]) * vy) / (vx * vx + vy * vy)));
      best = Math.min(best, Math.hypot(p[0] + vx * t - x, p[1] + vy * t - y));
    }
    return best;
  };
  assert.ok(off(br.a) < 1e-3 && off(br.b) < 1e-3, `bridge ${br.a} – ${br.b} off the road`);
  // and the road over the water is up on its deck
  const deck = makeDeck([br], null);
  const y = edge.pts[0][1] + ((edge.pts.at(-1)[1] - edge.pts[0][1]) * (10 - edge.pts[0][0])) / (edge.pts.at(-1)[0] - edge.pts[0][0]);
  assert.ok(deck(10, y) > 0);
});

// Drawn at a slant over a river, a way's crossing isn't a straight run of
// dots: the tool sets it straight in the nearest grid direction, so the
// bridge is built roughly as drawn rather than refused.
test('a way sketched slantwise over a river still gets its bridge', async () => {
  const { createNetworkTool } = await import('../src/tools/network.js');
  for (const [kind, ang, wide] of [['path', 20, 1], ['path', 35, 2], ['path', -15, 2], ['road', 10, 1], ['road', 25, 2]]) {
    const w = flatWorld();
    river(w, 10, wide);
    const tool = createNetworkTool({ world: w, config: {} }, { kind });
    const r = (ang * Math.PI) / 180, c = [10.3 + wide / 2, 9.7];
    const a = [c[0] - Math.cos(r) * 4.5, c[1] - Math.sin(r) * 4.5], b = [c[0] + Math.cos(r) * 4.5, c[1] + Math.sin(r) * 4.5];
    // the plain line can't be bridged
    assert.equal(w.checkWay(kind, [a, b]).reason, 'A bridge has to be straight', `${kind} ${ang}°`);
    tool.sketch.start(...a);
    for (let i = 1; i <= 60; i++) tool.sketch.move(a[0] + ((b[0] - a[0]) * i) / 60, a[1] + ((b[1] - a[1]) * i) / 60);
    tool.sketch.end();
    assert.ok(w.ways.edges.size, `${kind} ${ang}° over ${wide}: laid`);
    assert.equal(findBridges(w).length, 1, `${kind} ${ang}° over ${wide}: one bridge`);
  }
});

// The dense dots count as water just past the water itself, not a whole
// main step either side of it: a footbridge over a stream is short, and
// still no step between dense dots slips across without one.
test('a stream is narrow water for footpaths, with no gap in it', () => {
  for (const size of ['stream', 'river']) {
    const w = laidRiver(size);
    const { fine } = w;
    const water = (f) => w.networks.path.bridge.water(f);
    // across the stream at y = 5: only the dots by the water itself
    const row = [];
    for (let x = 14; x <= 26; x++) if (water(fine.index(x, 10))) row.push(x / 2);
    assert.ok(row.length >= 1, `${size}: ${row}`);
    if (size === 'stream') assert.ok(row.every((x) => Math.abs(x - 10) <= 0.5), `stream water dots at ${row}`);
    // no step from one bank to the other between dry dots
    for (let f = 0; f < fine.size; f++) {
      if (water(f)) continue;
      const [x] = fine.xy(f);
      for (const [dx, dy] of [[1, 0], [1, 1], [1, -1]]) {
        const g = fine.offset(f, dx, dy);
        if (g < 0 || water(g)) continue;
        assert.ok(!((x / 2 < 10) && ((x + dx) / 2 > 10)), `${size}: a step across at ${fine.xy(f)}`);
      }
    }
  }
});
