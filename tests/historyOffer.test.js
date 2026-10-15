// When the dock offers Zpět and Znovu (ui/historyOffer.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyOffer } from '../src/ui/historyOffer.js';
import { flatWorld, road } from './helpers.js';

test('Zpět once something is changed, Znovu only after an undo', () => {
  const w = flatWorld();
  assert.deepEqual(historyOffer(w.history, 'inspect'), { undo: false, redo: false });
  road(w, [2, 5], [10, 5]);
  w.history.commit();
  assert.deepEqual(historyOffer(w.history, 'road'), { undo: true, redo: false });
  assert.deepEqual(historyOffer(w.history, 'inspect'), { undo: true, redo: false });
  w.history.undo();
  assert.deepEqual(historyOffer(w.history, 'inspect'), { undo: false, redo: true });
  w.history.redo();
  assert.deepEqual(historyOffer(w.history, 'inspect'), { undo: true, redo: false });
});

test('nothing is offered in photo mode', () => {
  const w = flatWorld();
  road(w, [2, 5], [10, 5]);
  w.history.commit();
  w.history.undo();
  assert.deepEqual(historyOffer(w.history, 'photo'), { undo: false, redo: false });
});
