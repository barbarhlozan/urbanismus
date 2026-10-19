import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../src/render/camera.js';
import { Painter } from '../src/render/painter.js';
import { SUN, DAY } from '../src/render/shadows.js';
import { drawTree, drawShrub } from '../features/trees.js';

// A tree's shaded side follows the sun and the view; what else it draws
// must not. Each tree leaves the painter's randomness where it found it
// whatever the light, so the trees and bushes drawn after it in the same
// drawing (a building's garden) stay the same as the sun moves.
test('a tree takes the same random choices whatever the light', () => {
  const camera = new Camera({ width: 30, height: 30 });
  const saved = SUN.azimuth;
  try {
    for (const kind of ['spruce', 'sapling', 'spreading', 'shrub']) {
      for (const simple of [false, true]) {
        for (let seed = 1; seed <= 40; seed++) {
          const next = new Set();
          for (const [azimuth] of DAY.positions) {
            for (const angle of [0, Math.PI / 2, Math.PI, 4]) {
              SUN.azimuth = azimuth;
              camera.angle = angle;
              const g = new Painter(camera, { x: 0, y: 0, z: 0 }, 0, seed);
              if (kind === 'shrub') drawShrub(g, 0, 0, 0.3);
              else drawTree(g, 0, 0, kind, 1, simple);
              next.add(g.random());
            }
          }
          assert.equal(next.size, 1, `${kind}${simple ? ' (simple)' : ''}, seed ${seed}`);
        }
      }
    }
  } finally {
    SUN.azimuth = saved;
  }
});
