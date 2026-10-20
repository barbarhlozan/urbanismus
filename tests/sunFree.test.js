import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUN, sunFor, strokeShare, hash } from '../src/render/shadows.js';
import { SUN_FREE, wallDir, strokeLevel, sectorLight, lightSector, sunStyle } from '../src/render/sunFree.js';
import { Camera } from '../src/render/camera.js';
import { Painter } from '../src/render/painter.js';
import { STRUCTURE_TYPES } from '../structures/index.js';
import { drawTree } from '../features/trees.js';

test('the stylesheet shows the walls turned from the sun, as many of their strokes as the sun would', () => {
  const sun = sunFor({ angle: 0 }, { ...SUN, azimuth: 0, length: 1 }); // shadows along +x
  const { shown } = sunStyle(sun, 0);
  const away = wallDir(1, 0), facing = wallDir(-1, 0), side = wallDir(0, 1);
  assert.ok(shown.some((s) => s.includes(`.wd${away}.wl${SUN_FREE.levels - 1}`)), 'a wall turned away: all of it');
  assert.ok(!shown.some((s) => s.includes(`.wd${facing}.`)), 'a lit wall: none');
  assert.ok(!shown.some((s) => s.includes(`.wd${side}.wl${SUN_FREE.levels - 1}`)), 'side on: not all');
  // no sun, no strokes
  assert.ok(!sunStyle({ ...sun, on: false }, 0).shown.some((s) => s.includes('.wd')));
});

test('a stroke shows from about the share at which the sun would keep it', () => {
  let agree = 0, all = 0;
  for (let k = 0; k < 400; k++) {
    for (const share of [0.2, 0.5, 0.8]) {
      const kept = hash(k, 0.5 + 3.1) < share, shown = share > (strokeLevel(k, 3.1) + 0.5) / SUN_FREE.levels;
      all++;
      if (kept === shown) agree++;
    }
  }
  assert.ok(agree / all > 0.75, `${agree} of ${all}`);
});

test('the light sectors go round, and a light finds its own', () => {
  for (let s = 0; s < SUN_FREE.sectors; s++) assert.equal(lightSector(sectorLight(s)), s);
  assert.equal(lightSector([0, 1]), 0); // straight above
  // whatever the sector, the stylesheet shows one that is drawn
  for (let s = 0; s < SUN_FREE.sectors; s++) {
    const tq = sunStyle({ on: false }, s).shown.at(-1);
    assert.ok(SUN_FREE.drawn.some((d) => tq === `.tq${d}`), tq);
  }
});

test('sun-free, a house carries all its walls\' strokes and a tree all its shaded sides, the same whatever the sun', () => {
  const camera = new Camera({ width: 30, height: 30 });
  const saved = { ...SUN }, on = SUN_FREE.on;
  SUN_FREE.on = true;
  try {
    const draw = (azimuth) => {
      SUN.azimuth = azimuth;
      const g = new Painter(camera, { x: 10, y: 10, z: 0 }, 0, 42);
      STRUCTURE_TYPES.house.draw(g, { seed: 42, rotation: 0 });
      drawTree(g, 2, 2, 'spreading', 1);
      return g.toSVG();
    };
    const a = draw(10), b = draw(170);
    assert.equal(a, b);
    assert.ok(/wall-shade[^"]* sf wd\d+ wl\d/.test(a));
    // (light straight from above shades the crown's open underside: no marks)
    const sectors = SUN_FREE.drawn.filter((s) => a.includes(`tq${s}"`) || a.includes(`tq${s} `));
    assert.ok(sectors.length >= SUN_FREE.drawn.length - 1, `${sectors}`);
  } finally {
    Object.assign(SUN, saved);
    SUN_FREE.on = on;
  }
});
