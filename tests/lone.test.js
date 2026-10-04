// Structures standing alone mostly go unfenced (structures/plots.js
// boundaryChance; the garden yard does the same with LONE).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundaryChance, LONE } from '../structures/plots.js';
import { STRUCTURE_TYPES } from '../structures/index.js';

const plotOf = (id) => STRUCTURE_TYPES[id].plot;

test('alone, a structure keeps only a share of its boundary chance', () => {
  for (const id of ['house', 'chapel', 'church', 'tv-tower']) {
    const plot = plotOf(id);
    assert.equal(boundaryChance(plot, false), plot.boundary, id);
    assert.equal(boundaryChance(plot, true), plot.boundary * LONE, id);
  }
});

test('security fences, the pool and the stadium stay fenced alone', () => {
  for (const id of ['pool', 'stadium', ...Object.keys(STRUCTURE_TYPES).filter((id) => plotOf(id)?.kinds?.includes('tall'))]) {
    const plot = plotOf(id);
    assert.equal(boundaryChance(plot, true), plot.boundary, id);
  }
});
