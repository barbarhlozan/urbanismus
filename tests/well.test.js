// The village well: people walk to it, stand round it a moment and go home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, path } from './helpers.js';
import { AgentSystem } from '../src/sim/agents.js';
import { CONFIG } from '../src/config.js';
import { STRUCTURE_TYPES } from '../structures/index.js';

test('a resident walks to the well, stands round it briefly and goes home', () => {
  const w = flatWorld();
  const house = w.placeStructure('house', w.grid.index(10, 10));
  const well = w.placeStructure('well', w.grid.index(12, 10));
  path(w, [10, 10], [12, 10]);
  const agents = new AgentSystem(w, CONFIG);
  const a = [...agents.agents.values()].find((x) => x.home === house.id);
  assert.equal(agents.activity('park', a, house), true, 'sets out');
  a.state = 'out'; // (as AgentSystem.update does with a trip begun)
  assert.equal(a.trip.dest, well.id);
  const { reach, time } = STRUCTURE_TYPES.well.sim.stop;
  const [cx, cy] = w.centerOf(well);
  let lingered = 0, steps = 0, back = false;
  while (steps++ < 40000) {
    agents.update(0.05);
    if (a.state === 'linger') {
      lingered += 0.05;
      if (a.wander?.target && !a.wander.back) {
        const d = Math.hypot(a.wander.target[0] - cx, a.wander.target[1] - cy);
        assert.ok(d < reach * 1.5, `stands ${d} from the well`);
      }
    }
    if (a.state === 'home') { back = true; break; }
  }
  assert.ok(lingered > 0, 'stopped at the well');
  assert.ok(lingered < time[1] + 20, `only a moment (${lingered.toFixed(1)} s)`);
  assert.ok(back, 'went home');
});
