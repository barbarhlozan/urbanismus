import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathLines, sheetStrokes, readSheet, layout, templateSVG, CHALUPA as spec } from '../src/lab/lines.js';

test('paths: lines, relative moves, curves end where they should', () => {
  assert.deepEqual(pathLines('M0 0 L10 0 l0 10 H0 z'), [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]);
  const [c] = pathLines('M0 0 C0 10 10 10 10 0');
  assert.deepEqual(c[c.length - 1], [10, 0]);
  const [a] = pathLines('M0 0 A5 5 0 0 1 10 0');
  assert.ok(Math.abs(a[a.length - 1][0] - 10) < 1e-9 && Math.min(...a.map((p) => p[1])) < -4.9);
});

test('the template draws nothing, its groups are left out', () => {
  assert.equal(sheetStrokes(templateSVG(spec)).length, 0);
});

test('a stroke goes to its panel, in grid steps; blue is a window', () => {
  const { panels } = layout(spec);
  const f = panels.front;
  const svg = templateSVG(spec).replace('</g>\n</svg>', `
    <path d="M${f.x0} ${f.ground - 25} H${f.x0 + 300}"/>
    <g transform="translate(${f.x0} ${f.ground})"><rect x="50" y="-120" width="40" height="60" stroke="#2a5bd7"/></g>
    <path d="M5 5 L20 20"/>
  </g>\n</svg>`);
  const sheet = readSheet(svg, spec);
  assert.equal(sheet.front.lines.length, 1);
  assert.deepEqual(sheet.front.lines[0].map((p) => p.map((v) => +v.toFixed(3))), [[0, 0.025], [0.3, 0.025]]);
  assert.deepEqual(sheet.front.windows[0].map((v) => +v.toFixed(3)), [0.05, 0.06, 0.09, 0.12]);
  assert.equal(Object.values(sheet).reduce((n, p) => n + p.lines.length + p.windows.length, 0), 2); // the note is left out
});

test('the cottage sheet has strokes on every panel', () => {
  const sheet = readSheet(readFileSync(new URL('../drawings/chalupa.svg', import.meta.url), 'utf8'), spec);
  for (const id of ['left', 'front', 'right', 'back', 'roof']) assert.ok(sheet[id].lines.length > 0, id);
});
