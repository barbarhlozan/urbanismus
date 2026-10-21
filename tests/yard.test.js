// Round the house (sim/agents.js startYard): with no road or footpath in
// front, a resident's porch outing is a walk round the house in its garden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, river } from './helpers.js';
import { AgentSystem } from '../src/sim/agents.js';
import { CONFIG } from '../src/config.js';

test('with nothing in front, a resident walks round the house and back in', () => {
  const w = flatWorld();
  const house = w.placeStructure('house', w.grid.index(10, 10));
  const agents = new AgentSystem(w, CONFIG);
  const a = [...agents.agents.values()].find((x) => x.home === house.id);
  assert.equal(agents.activity('porch', a, house), 'linger');
  a.state = 'linger';
  const pad = CONFIG.sim.doorPad;
  const start = [a.x, a.y];
  let far = 0, steps = 0;
  while (a.state === 'linger' && steps++ < 20000) {
    agents.update(0.05);
    if (a.state !== 'linger') break;
    // always on the loop round the house: never inside it, never out of the garden
    const d = Math.hypot(a.x - 10, a.y - 10);
    assert.ok(d > pad * 0.95 && d < pad * 1.01, `at ${d}`);
    far = Math.max(far, Math.hypot(a.x - start[0], a.y - start[1]));
  }
  assert.equal(a.state, 'home');
  assert.ok(far > 0.3, 'went some way round');
});

// The house at (10, 10) faces north (nothing to turn it): clockwise from
// its door the walk heads east, the other way west.
const yard = (build) => {
  const w = flatWorld();
  const house = w.placeStructure('house', w.grid.index(10, 10));
  build(w);
  const agents = new AgentSystem(w, CONFIG);
  const a = [...agents.agents.values()].find((x) => x.home === house.id);
  assert.equal(agents.activity('porch', a, house), 'linger');
  return a.wander.loop;
};
const quarter = (Math.PI / 2) * CONFIG.sim.doorPad; // (the door to the next side)

test('the walk keeps out of water', () => {
  const { lo, hi } = yard((w) => river(w, 9));
  assert.ok(lo > -quarter - 0.1, `west as far as ${lo}`);
  assert.ok(hi > quarter + 0.2, `east as far as ${hi}`);
});
