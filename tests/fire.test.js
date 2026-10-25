// A fire (src/sim/fire.js): the house burns a while and then is a ruin;
// neighbours come to watch and help, the brigade drives over, and they all
// go home afterwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatWorld, road } from './helpers.js';
import { CONFIG } from '../src/config.js';
import { AgentSystem } from '../src/sim/agents.js';
import { FireSystem } from '../src/sim/fire.js';
import { World } from '../src/core/world.js';
import { UNLOCKS } from '../src/story/unlocks.js';

const at = (w, x, y) => w.grid.index(x, y);

function town() {
  const w = flatWorld(30, 30);
  UNLOCKS.setWorld(w);
  road(w, [1, 5], [28, 5]);
  const homes = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((x) => w.placeStructure('house', at(w, x, 6)));
  const station = w.placeStructure('fire-house', at(w, 20, 6));
  w.history.commit();
  const agents = new AgentSystem(w, CONFIG);
  const fires = new FireSystem(w, agents, CONFIG);
  for (const a of agents.agents.values()) a.timer = 1e6; // (everyone stays in)
  return { w, homes, station, agents, fires };
}

const run = (agents, fires, seconds, each = () => {}) => {
  for (let t = 0; t < seconds; t += 0.1) {
    agents.update(0.1);
    fires.update(0.1);
    each();
  }
};

test('a house burns a while, the town turns out, then it is a ruin and they go home', () => {
  const { w, homes, station, agents, fires } = town();
  const s = homes[4];
  CONFIG.fire.turnOut = 1;
  assert.ok(w.history.aside(() => fires.ignite(s)));
  assert.ok(s.burning && !s.ruin);
  assert.ok(s.burning.left >= CONFIG.fire.burn[0] && s.burning.left <= CONFIG.fire.burn[1]);
  const coming = [...agents.agents.values()].filter((a) => a.fire);
  assert.ok(coming.length > 3, `${coming.length} turned out`);

  let watching = 0, carrying = 0, engine = null, hose = 0;
  run(agents, fires, CONFIG.fire.burn[0] - 1, () => {
    for (const a of agents.agents.values()) {
      if (a.fire?.phase === 'watch') watching++;
      if (a.carry === 'bucket' || a.carry === 'throw') carrying++;
      if (a.carry === 'hose') hose++;
      if (a.engine) engine = a;
    }
  });
  assert.ok(watching > 0, 'some stood watching');
  assert.ok(carrying > 0, 'some carried water');
  assert.ok(engine, 'the engine came');
  assert.equal(engine.engine, 'dvs'); // (a village fire house's)
  assert.equal(engine.home, station.id);
  assert.ok(hose > 0, 'the crew got the hose on it');
  assert.ok(!s.ruin); // still burning

  run(agents, fires, CONFIG.fire.burn[1] - CONFIG.fire.burn[0] + 2);
  assert.ok(s.ruin && !s.burning);
  run(agents, fires, 400);
  // everyone went home: nobody at the fire, the engine and crew put away
  assert.ok(![...agents.agents.values()].some((a) => a.fire || a.state === 'fire' || a.state === 'fireWait'));
  assert.ok(![...agents.agents.values()].some((a) => String(a.id).startsWith('fire:')));
  assert.equal(fires.fires.size, 0);
  assert.ok(![...agents.agents.values()].some((a) => a.home === s.id)); // (they went to the neighbours)
  assert.ok(![...agents.agents.values()].some((a) => a.drop)); // (and the households' others gone back in)
  CONFIG.fire.turnOut = 0.75;
});

test('with enough helpers near another house, they form a bucket chain', () => {
  const { w, homes, agents, fires } = town();
  const old = { ...CONFIG.fire };
  Object.assign(CONFIG.fire, { helpers: 1, turnOut: 1 });
  try {
    fires.ignite(homes[4]);
    const f = fires.fires.get(homes[4].id);
    assert.ok(f.chain, 'a chain');
    const chain = [...f.people].filter((a) => a.fire.role === 'chain');
    assert.equal(chain.length, f.chain.places);
    run(agents, fires, 60);
    assert.ok(chain.some((a) => a.fire.phase === 'chain'));
    assert.ok(chain.some((a) => a.carry === 'bucket') || chain.some((a) => a.carry === 'throw'));
  } finally {
    Object.assign(CONFIG.fire, old);
  }
  void w;
});

test('the burning state is saved, and a loaded town turns out again', () => {
  const { w, homes, fires } = town();
  fires.ignite(homes[2]);
  const back = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  const s = back.structureByNo(homes[2].no);
  assert.ok(s.burning);
  const agents = new AgentSystem(back, CONFIG);
  const again = new FireSystem(back, agents, CONFIG);
  assert.ok(again.fires.has(s.id));
  assert.equal(back.igniteStructure(s.id, 10), false); // (burning already)
});
