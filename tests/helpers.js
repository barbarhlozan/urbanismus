// Small towns for the tests: a flat, empty map (no generated terrain), and
// ways to lay roads, streets, footpaths and water on it by grid position.
import { World } from '../src/core/world.js';

export function flatWorld(width = 20, height = 20) {
  return new World({ width, height, seed: 1, name: 'Testov', rockiness: 0 }); // (rock would put cliffs where tests build)
}

// A run of main dots, [x, y] to [x, y] in a straight line (or diagonal).
export function run(world, [x0, y0], [x1, y1]) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  return Array.from({ length: n + 1 }, (_, i) => world.grid.index(x0 + Math.sign(x1 - x0) * i, y0 + Math.sign(y1 - y0) * i));
}

// The same on the dense dots (half steps; positions in main-dot units).
export function fineRun(world, [x0, y0], [x1, y1]) {
  const n = Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2);
  return Array.from({ length: n + 1 }, (_, i) => world.fine.index(Math.round(2 * x0 + Math.sign(x1 - x0) * i), Math.round(2 * y0 + Math.sign(y1 - y0) * i)));
}

export const road = (world, a, b) => world.buildNetwork('road', run(world, a, b));
export const path = (world, a, b) => world.buildNetwork('path', fineRun(world, a, b));
export const rail = (world, a, b) => world.buildNetwork('rail', fineRun(world, a, b));
// a road with a footpath drawn along it: a street with sidewalks
export const street = (world, a, b) => {
  road(world, a, b);
  return path(world, a, b);
};

// A river across the map at column x (`width` columns wide).
export function river(world, x, width = 1) {
  for (let y = 0; y < world.grid.height; y++) {
    for (let k = 0; k < width; k++) world.terrain.water[world.grid.index(x + k, y)] = 2;
  }
}
