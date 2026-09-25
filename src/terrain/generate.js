// Procedural environment for a fresh map. Each pass is independent, so new
// passes (hills, rivers, rock outcrops…) can be appended to generateWorld().

import { mulberry32, valueNoise2D } from '../core/random.js';

export function generateWorld(world, config) {
  const rng = mulberry32(world.seed);
  generatePonds(world, rng, config.terrain);
  generateTrees(world, rng, config.terrain);
}

function mapCenter(grid) {
  return [(grid.width - 1) / 2, (grid.height - 1) / 2];
}

function generatePonds(world, rng, opts) {
  const { grid, terrain } = world;
  const [mx, my] = mapCenter(grid);
  const wobble = valueNoise2D(world.seed + 11, 3);

  for (let p = 0; p < opts.ponds; p++) {
    let cx, cy;
    do {
      cx = 4 + rng() * (grid.width - 8);
      cy = 4 + rng() * (grid.height - 8);
    } while (Math.hypot(cx - mx, cy - my) < opts.clearRadius + 5);
    const radius = 2.2 + rng() * 2;

    for (let i = 0; i < grid.size; i++) {
      const [x, y] = grid.xy(i);
      const d = Math.hypot(x - cx, (y - cy) * 1.25);
      if (d < radius + (wobble(x, y) - 0.5) * 3) terrain.water[i] = 1;
    }
  }
}

function generateTrees(world, rng, opts) {
  if (!opts.treeDensity) return;
  const { grid, terrain } = world;
  const [mx, my] = mapCenter(grid);
  const forest = valueNoise2D(world.seed + 23, 6);
  const threshold = 0.58;

  for (let i = 0; i < grid.size; i++) {
    if (terrain.isWater(i)) continue;
    const [x, y] = grid.xy(i);
    if (Math.hypot(x - mx, y - my) < opts.clearRadius) continue;
    const n = forest(x, y);
    if (n < threshold || rng() > (n - threshold) * 3.2 * opts.treeDensity) continue;
    world.addFeature('tree', i, {
      ox: (rng() - 0.5) * 0.5,
      oy: (rng() - 0.5) * 0.5,
      variant: rng() < 0.6 ? 0 : 1,
      scale: 0.8 + rng() * 0.45,
    });
  }
}
