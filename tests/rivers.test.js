// Rivers and their tributaries (terrain/generate.js, terrain/rivers.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.js';
import { generateWorld } from '../src/terrain/generate.js';
import { CONFIG } from '../src/config.js';

const SEEDS = [4242, 1, 2, 77];
const withTributaries = (seed, size = 'river') => {
  const world = new World({ ...CONFIG.grid, seed });
  generateWorld(world, { ...CONFIG, terrain: { ...CONFIG.terrain, riverChance: 1, riverSize: size, tributaries: 2 } });
  return world;
};

// nearest point on a river's line to p: { d, z }
function nearest({ points, z }, [x, y]) {
  let best = { d: Infinity, z: 0 };
  for (let s = 1; s < points.length; s++) {
    const [ax, ay] = points[s - 1], [bx, by] = points[s];
    const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy || 1e-9;
    const t = Math.min(Math.max(((x - ax) * vx + (y - ay) * vy) / len2, 0), 1);
    const d = Math.hypot(ax + vx * t - x, ay + vy * t - y);
    if (d < best.d) best = { d, z: z[s - 1] + (z[s] - z[s - 1]) * t };
  }
  return best;
}

test('tributaries run into another river, their water falling all the way to its level', () => {
  for (const seed of SEEDS) {
    const { terrain } = withTributaries(seed, seed % 2 ? 'stream' : 'river');
    assert.ok(terrain.rivers.length > 1, `seed ${seed}: no tributary`);
    terrain.rivers.slice(1).forEach((trib, k) => {
      const mouth = trib.points.at(-1);
      const into = terrain.rivers.slice(0, k + 1).map((r) => nearest(r, mouth)).sort((a, b) => a.d - b.d)[0];
      assert.ok(into.d < 1e-6, `seed ${seed}: tributary ${k} ends ${into.d} off a river`);
      assert.ok(Math.abs(trib.z.at(-1) - into.z) < 1e-6, `seed ${seed}: levels differ at the junction`);
      for (let j = 1; j < trib.z.length; j++) assert.ok(trib.z[j] <= trib.z[j - 1] + 1e-9, `seed ${seed}: water rises along tributary ${k}`);
    });
  }
});

test('the river and its tributaries are one body of water', () => {
  for (const seed of SEEDS) {
    const { grid, terrain } = withTributaries(seed);
    const river = [];
    for (let i = 0; i < grid.size; i++) if (terrain.isRiver(i)) river.push(i);
    const seen = new Set([river[0]]), stack = [river[0]];
    while (stack.length) for (const m of grid.neighbors(stack.pop())) if (terrain.isRiver(m) && !seen.has(m)) { seen.add(m); stack.push(m); }
    assert.equal(seen.size, river.length, `seed ${seed}: the water dots fall apart`);
  }
});

test('where a stream meets the river the channels merge', () => {
  const world = withTributaries(4242);
  const field = world.riverField;
  for (const trib of world.terrain.rivers.slice(1)) {
    // all along its last grid steps, the water is unbroken
    const n = trib.points.length;
    for (let j = Math.max(0, n - 20); j < n; j++) assert.ok(field.depth(...trib.points[j]) > 0);
  }
});
