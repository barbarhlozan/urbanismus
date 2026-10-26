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

test('a house set to burn two minutes: the town turns out, then it is a ruin and they go home', () => {
  const { w, homes, station, agents, fires } = town();
  const s = homes[4];
  CONFIG.fire.turnOut = 1;
  assert.ok(w.history.aside(() => fires.ignite(s, 120)));
  assert.ok(s.burning && !s.ruin);
  assert.deepEqual(s.burning, { age: 0, left: 120, total: 120 });
  const coming = [...agents.agents.values()].filter((a) => a.fire);
  assert.ok(coming.length > 3, `${coming.length} turned out`);

  let watching = 0, carrying = 0, engine = null, hose = 0;
  run(agents, fires, 119, () => {
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

  assert.ok(s.burning.age > 118);
  run(agents, fires, 2);
  assert.ok(s.ruin && !s.burning);
  run(agents, fires, 400);
  // everyone went home: nobody at the fire, the engine and crew put away
  assert.ok(![...agents.agents.values()].some((a) => a.fire || a.state === 'fire' || a.state === 'fireWait'));
  assert.ok(![...agents.agents.values()].some((a) => String(a.id).startsWith('fire:')));
  assert.equal(fires.fires.size, 0);
  assert.equal(fires.waning.size, 0);
  assert.ok(![...agents.agents.values()].some((a) => a.home === s.id)); // (they went to the neighbours)
  assert.ok(![...agents.agents.values()].some((a) => a.drop)); // (and the households' others gone back in)
  CONFIG.fire.turnOut = 0.75;
});

test('two helpers run buckets on their own: no chain', () => {
  const { homes, agents, fires } = town();
  const old = { ...CONFIG.fire };
  Object.assign(CONFIG.fire, { helpers: 1, turnOut: 1, most: 2, household: [0, 0] });
  try {
    fires.ignite(homes[4]);
    const f = fires.fires.get(homes[4].id);
    let threw = false;
    run(agents, fires, 200, () => { threw ||= [...f.people].some((a) => a.carry === 'throw'); });
    assert.ok(threw);
    assert.equal(f.chain.members.length + f.chain.runners.length, 0);
  } finally {
    Object.assign(CONFIG.fire, old);
  }
});

test('from three helpers on, a chain grows from the fire as they come back with buckets', () => {
  const { homes, agents, fires } = town();
  const old = { ...CONFIG.fire };
  Object.assign(CONFIG.fire, { helpers: 1, turnOut: 1 });
  try {
    fires.ignite(homes[4]);
    const f = fires.fires.get(homes[4].id);
    const c = f.chain;
    assert.ok(c, 'a way for a chain');
    assert.equal(c.members.length, 0); // (nobody there yet)
    let most = 0, passed = false, ran = false;
    run(agents, fires, 240, () => {
      most = Math.max(most, c.members.length);
      passed ||= c.members.some((a) => a.carry === 'bucket') && c.members[0]?.carry === 'throw';
      ran ||= c.runners.length > 0;
      // never more than a bucket's handing apart, the first at the fire
      for (let i = 1; i < c.members.length; i++) assert.ok(fires.slotAt(f, i - 1) - fires.slotAt(f, i) <= CONFIG.fire.chainGap + 1e-9);
      if (c.members.length) assert.equal(fires.slotAt(f, 0), c.leg.total);
      if (fires.chainReaches(f)) assert.ok(fires.slotAt(f, c.members.length - 1) < 1e-9);
      else if (c.members.length > 1) assert.ok(ran);
    });
    assert.ok(most >= 3, `${most} in the chain`);
    assert.ok(passed, 'buckets passed down it, thrown at the fire');
  } finally {
    Object.assign(CONFIG.fire, old);
  }
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

test('a fire put out leaves the house standing, and everyone goes home', () => {
  const { w, homes, agents, fires } = town();
  const s = homes[4];
  fires.ignite(s);
  run(agents, fires, 40);
  assert.ok(fires.putOut(s));
  assert.ok(!s.burning && !s.ruin);
  assert.equal(fires.putOut(s), false); // (out already)
  run(agents, fires, 400);
  assert.equal(fires.fires.size, 0);
  assert.ok(![...agents.agents.values()].some((a) => a.fire || a.state === 'fire' || a.state === 'fireWait'));
  assert.ok([...agents.agents.values()].some((a) => a.home === s.id)); // (they still live there)
  void w;
});

test('burn ends a fire as a ruin, or burns a house down at once; the ruin smoulders a while', () => {
  const { homes, agents, fires } = town();
  const [a, b] = [homes[2], homes[7]];
  fires.ignite(a);
  run(agents, fires, 10);
  assert.ok(fires.burnDown(a));
  assert.ok(a.ruin && !a.burning && a.embers);
  assert.ok(fires.burnDown(b)); // (wasn't burning)
  assert.ok(b.ruin && b.embers);
  assert.equal(fires.burnDown(b), false);
  run(agents, fires, CONFIG.fire.embers[1] + 1);
  assert.ok(!a.embers && !b.embers);
});

test('a fire without a time burns until the story ends it', () => {
  const { homes, agents, fires } = town();
  fires.ignite(homes[3]);
  run(agents, fires, 600);
  assert.ok(homes[3].burning && !homes[3].ruin);
  assert.equal(homes[3].burning.left, null);
  assert.ok(homes[3].burning.age > 599);
});

test('the story ignites (for a time or not), puts out and burns', async () => {
  const { parseStory } = await import('../src/story/script.js');
  const { branches, errors } = parseStory('::A::\nignite 4\nignite 6 for 2 minutes\nignite 7 for 1,5 min\nput out 4\nburn 5\nput out barn\n');
  const steps = branches.get('a').steps;
  assert.deepEqual(steps.map((s) => s.kind), ['ignite', 'ignite', 'ignite', 'putOut', 'burn', 'putOut']);
  assert.deepEqual(steps.slice(0, 3).map((s) => s.minutes), [null, 2, 1.5]);
  assert.equal(errors.length, 1); // (barn was never picked)
});

test('a house lit again right after its fire was put out burns again', () => {
  const { homes, agents, fires } = town();
  const s = homes[4];
  fires.ignite(s);
  run(agents, fires, 40); // (the brigade on its way or there)
  fires.putOut(s);
  assert.ok(fires.ignite(s, 120)); // (while the first fire's people are still going home)
  run(agents, fires, 60);
  assert.ok(s.burning.age > 59 && s.burning.left < 61);
  run(agents, fires, 61);
  assert.ok(s.ruin && !s.burning);
  run(agents, fires, 400);
  assert.equal(fires.fires.size + fires.waning.size, 0);
  assert.ok(![...agents.agents.values()].some((a) => a.fire || a.state === 'fire' || a.state === 'fireWait' || String(a.id).startsWith('fire:')));
});
