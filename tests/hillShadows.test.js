import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUN } from '../src/render/shadows.js';
import { HILL_SHADOWS, hillShade, hillShadowLines } from '../src/render/hillShadows.js';

// the sun casting along +x, a shadow as long as the ground is high times L
const sun = (length = 1) => ({ ...SUN, cast: [length, 0] });
const box = [0, 0, 20, 10];
const opts = { ...HILL_SHADOWS, low: 1, most: 10 };

test('a ridge shades the ground behind it, as far as the sun reaches', () => {
  // a wall of ground 1 high across x = 5…6
  const height = (x) => (x >= 5 && x <= 6 ? 1 : 0);
  const shade = hillShade(height, box, sun(2), opts);
  assert.ok(shade(3, 5) < 1e-6, 'lit before it');
  assert.ok(shade(5.5, 5) < 1e-6, 'lit on top');
  assert.ok(shade(7, 5) > 0.3, 'in shadow just behind');
  assert.ok(shade(9, 5) < 1e-6, 'lit again past its shadow (2 long)');
  // a lower sun, a longer shadow
  assert.ok(hillShade(height, box, sun(4), opts)(9, 5) > 0.1);
});

test('a gentle slope turned away stays lit by a high sun, not a low one', () => {
  const height = (x) => Math.max(0, 2 - x * 0.2); // falling away from the sun
  assert.ok(hillShade(height, box, sun(1), opts)(5, 5) < 1e-6);
  assert.ok(hillShade(height, box, sun(8), opts)(5, 5) > 0.1);
});

test('the hatching covers the shade only, and none of the water', () => {
  const height = (x) => (x >= 5 && x <= 6 ? 1 : 0);
  const shade = hillShade(height, box, sun(4), opts);
  const [near, far] = hillShadowLines(shade, box, sun(4), 0, () => false, opts);
  const pts = [...near, ...far].flat();
  assert.ok(pts.length > 0);
  const slack = SUN.hatch.wave + 0.1;
  for (const [x] of pts) assert.ok(x > 6 - slack && x < 10 + slack, `at x ${x}`);
  // the lines that stay further out are a share of them
  assert.ok(near.length > 0 && far.length > 0);
  const dry = hillShadowLines(shade, box, sun(4), 0, (x, y) => y < 5, opts).flat(2);
  assert.ok(dry.length > 0);
  for (const [, y] of dry) assert.ok(y > 5 - slack, `at y ${y}`);
});
