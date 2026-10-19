import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUN } from '../src/render/shadows.js';
import { nightTile } from '../src/render/night.js';
import { SCHEMES, nightPalette } from '../src/theme.js';

test('the night in lines is one tile of pen lines, as dense as asked', () => {
  const lines = (gap) => (nightTile('n', gap, SUN.hatch, 32).match(/M/g) ?? []).length;
  const sparse = lines(0.16), dense = lines(0.04);
  assert.ok(dense > sparse * 3.5 && dense < sparse * 4.5, `${dense} / ${sparse}`);
  assert.match(nightTile('n', 0.08, SUN.hatch, 32), new RegExp(`rotate\\(${SUN.hatch.angle}\\)`));
});

test('the night turns the paper darker than either ink', () => {
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255); };
  for (const scheme of SCHEMES.filter((s) => lum(s.bg) > lum(s.main))) {
    const night = nightPalette(scheme, 1);
    assert.ok(lum(night.bg) < lum(night.detail) && lum(night.bg) < lum(night.main), scheme.name);
    // halfway, between the two; none, the day as it was
    const half = nightPalette(scheme, 0.5);
    assert.ok(lum(half.bg) < lum(scheme.bg) && lum(half.bg) > lum(night.bg), scheme.name);
    assert.deepEqual(Object.values(nightPalette(scheme, 0)).map(lum), [scheme.bg, scheme.main, scheme.detail].map(lum));
  }
});

test('on the way to the night the ink never fades into the paper', () => {
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255); };
  for (const scheme of SCHEMES.filter((s) => lum(s.bg) > lum(s.main))) {
    for (let i = 0; i <= 20; i++) {
      const p = nightPalette(scheme, i / 20, 0.4);
      assert.ok(Math.abs(lum(p.bg) - lum(p.main)) > 120, `${scheme.name} at ${i / 20}: ${p.bg} / ${p.main}`);
    }
  }
});
