import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUN } from '../src/render/shadows.js';
import { NIGHT, nightLines } from '../src/render/night.js';

const box = [0, 0, 10, 6];

test('the night hatches the whole box, and no further', () => {
  const [near, far] = nightLines(box, SUN, 0.3, { ...NIGHT, every: 2 });
  assert.ok(near.length > 0 && far.length > 0);
  const slack = SUN.hatch.wave + 1e-6;
  let length = 0;
  for (const line of [...near, ...far]) {
    for (const [x, y] of line) assert.ok(x > -slack && x < 10 + slack && y > -slack && y < 6 + slack);
    length += Math.hypot(line.at(-1)[0] - line[0][0], line.at(-1)[1] - line[0][1]);
  }
  // as much line as the box's area over the lines' spacing (less the corners)
  const expect = 60 / (SUN.hatch.gap * 2);
  assert.ok(length > expect * 0.9 && length < expect * 1.05, `${length} of ${expect}`);
});

test('crossed, it has a second set of lines as long as the first', () => {
  const count = (o) => o.flat().length;
  const one = nightLines(box, SUN, 0, { ...NIGHT, every: 4 }), two = nightLines(box, SUN, 0, { ...NIGHT, every: 4, cross: true });
  assert.ok(count(two) > count(one) * 1.7);
});
