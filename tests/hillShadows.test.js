import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUN } from '../src/render/shadows.js';
import { HILL_SHADOWS, hillShade, hillShadowPaths } from '../src/render/hillShadows.js';

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
  const sh = { ...sun(4), screen: true, px: 32 };
  const shade = hillShade(height, box, sh, opts);
  const project = (x, y) => [x * 32, y * 32]; // (flat will do)
  const pts = (d) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(Number).reduce((o, x, i) => (i % 2 ? o[o.length - 1].push(x) : o.push([x]), o), []);
  const [near, far] = hillShadowPaths(shade, box, sh, project, () => false, opts);
  assert.ok(near && far, 'both tiers');
  const slack = 0.15;
  for (const [x] of pts(near + far)) assert.ok(x / 32 > 6 - slack && x / 32 < 10 + slack, `at x ${x / 32}`);
  const [dn, df] = hillShadowPaths(shade, box, sh, project, (x, y) => y < 5, opts);
  assert.ok((dn + df).length > 0);
  for (const [, y] of pts(dn + df)) assert.ok(y / 32 > 5 - slack, `at y ${y / 32}`);
});
