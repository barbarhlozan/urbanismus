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
