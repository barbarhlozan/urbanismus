// Trains on the railways' ways (sim/trains.js, trackRoute in sim/wayGraph.js):
// in from the map's edge, calling at stations, out again – or round at the
// end of a branch line; level crossings where a road crosses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, rail, road } from './helpers.js';
import { CONFIG } from '../src/config.js';
import { TrainSystem } from '../src/sim/trains.js';
import { UNLOCKS } from '../src/story/unlocks.js';

function town(build) {
  const w = flatWorld(24, 24);
  w._relief = { rivers: w.terrain.rivers, field: null, elevation: () => 0 };
  UNLOCKS.setWorld(w);
  build(w);
  const trains = new TrainSystem(w, CONFIG);
  const calls = [];
  trains.onCall = (id) => calls.push(id);
  return { w, trains, calls };
}

const stop = (w, x, y, r = 0) => {
  const at = w.placementFor('stop', w.grid.index(x, y), r);
  assert.ok(at.check.ok, at.check.reason);
  return w.placeStructure('stop', at.node, { rotation: at.rotation });
};

// Runs until the train is gone (or `seconds`): how long it took.
function ride(trains, seconds = 200, dt = 1 / 20) {
  for (let t = 0; t < seconds; t += dt) {
    trains.update(dt);
    if (!trains.count) return t;
  }
  return Infinity;
}

test('a train comes in, calls at the stop on its line and leaves', () => {
  let s;
  const { trains, calls } = town((w) => {
    assert.ok(rail(w, [0, 10], [23, 10]).ok);
    s = stop(w, 10, 11);
  });
  assert.equal(trains.exits().length, 2);
  assert.equal(trains.stations().length, 1);
  assert.ok(trains.spawn());
  assert.ok(ride(trains) < Infinity, 'it left');
  assert.deepEqual(calls, [s.id]);
});

test('two stops on one stretch of track: both called at', () => {
  const { trains, calls } = town((w) => {
    assert.ok(rail(w, [0, 10], [23, 10]).ok);
    stop(w, 6, 11);
    stop(w, 16, 11);
  });
  assert.ok(trains.spawn());
  ride(trains);
  assert.equal(calls.length, 2);
});

test('at the end of a branch line it turns round and goes back out', () => {
  let s;
  const { trains, calls } = town((w) => {
    assert.ok(rail(w, [0, 10], [14, 10]).ok);
    s = stop(w, 11, 11);
  });
  assert.equal(trains.exits().length, 1);
  assert.ok(trains.spawn());
  const t = [...trains.trains.values()][0];
  assert.equal(t.runs.length, 2);
  assert.ok(ride(trains) < Infinity, 'it left');
  assert.ok(calls.includes(s.id));
});

test('a road across the line is a level crossing, closed while a train passes', () => {
  const { trains } = town((w) => {
    assert.ok(rail(w, [0, 10], [23, 10]).ok);
    assert.ok(road(w, [12, 2], [12, 20]).ok);
  });
  const list = trains.crossingList();
  assert.equal(list.length, 1);
  assert.ok(Math.abs(list[0].pos[0] - 12) < 0.05 && Math.abs(list[0].pos[1] - 10) < 0.05);
  assert.equal(list[0].kind, 'road');
  assert.ok(trains.spawn());
  let closed = false;
  for (let t = 0; t < 120 && trains.count; t += 0.05) {
    trains.update(0.05);
    if (trains.closed.has(list[0].id)) closed = true;
  }
  assert.ok(closed);
});
