// How the town turns out for a fire. A building set alight
// (World.igniteStructure: the story's `ignite`, cmd.ignite) burns until the
// story puts it out (putOut: the house stays) or burns it down (burnDown)
// – whatever the townspeople do. Given a time, it burns down by itself
// when that's up (s.burning, counted here).
// Burnt down, the ruin smoulders a while (s.embers, counted down here).
// Meanwhile:
//
//   watchers – people in within config.fire.reach (fewer the further) walk
//              over and stand in a loose crowd out from the building's
//              edge on the side they came from, facing it, shifting about
//              a little; whoever lives there comes out and joins them
//   helpers  – a share of them bring water. The first run home, fill a
//              bucket, run back, throw it and go again. Once chainStart of
//              them have got there (and there's a house near enough,
//              chainSource), whoever comes back with a bucket joins a
//              chain from the fire back along the way to that house's
//              door, passing buckets down it. It grows as they come, spread
//              as far apart as a bucket can be handed on (chainGap); while
//              it doesn't reach the house, one in gapRunners runs buckets
//              from the house to its end instead; when it does, they close
//              up (down to chainClose), and any more go on running
//   brigade  – the nearest fire house or station is alarmed (alarm) and its
//              engine drives over – a village brigade's Avia DVS, a
//              station's Tatra 148 CAS (render/vehicles.js) – pulls up on
//              the road, and the crew get down and stand at the fire, two
//              on the hose; with no road (or no trucks yet) the crew run
//              over on foot
//
// When it has burnt down or is out everyone stays a little (after,
// brigadeAfter), then goes home – those who lived there, when it has
// burnt down, to the neighbours, and are gone.
//
// The people are the town's own agents (AgentSystem), taken over: state
// 'fire' while in view, 'fireWait' while out of it (still at home, in the
// house filling a bucket, riding in the engine); a.fire is what they're
// doing here, a.carry what they hold (render/people.js: 'bucket', 'throw',
// 'hose'), a.watch the point they face. They're handed back on a leg home
// (state 'back'). Nothing of this is saved: a town loaded mid-fire turns
// out again.

import { STRUCTURE_TYPES, matches } from '../../structures/index.js';
import { pointAt } from '../roads/geometry.js';
import { UNLOCKS } from '../story/unlocks.js';
import { personName } from '../core/surnames.js';

const between = ([min, max]) => min + Math.random() * (max - min);

export class FireSystem {
  constructor(world, agents, config) {
    this.world = world;
    this.agents = agents;
    this.config = config;
    this.fires = new Map(); // burning structure id -> fire
    this.waning = new Set(); // fires over, their people still going home
    this.seq = 0;            // (each fire's engine and crew their own ids)
    this.embers = new Set(); // ids of ruins still smouldering
    agents.fires = this;
    world.events.on('structure:changed', (s) => {
      if (s.burning && !this.fires.has(s.id)) this.start(s);
      if (s.embers) this.embers.add(s.id);
    });
    world.events.on('structure:removed', (s) => {
      const f = this.fires.get(s.id);
      if (f) this.burntOut(f, true);
    });
    for (const s of world.structures.values()) {
      if (s.burning) this.start(s);
      if (s.embers) this.embers.add(s.id);
    }
  }

  // A way on foot from building a to b, cost at most `most`: footpaths and
  // sidewalks, or along any road (where there's no pavement, at a fire
  // people walk in the road).
  route(a, b, most) {
    return this.agents.walk.route(a, b, most) ?? this.agents.ride.route(a, b, most);
  }

  // Sets building `s` alight: until put out or burnt down, or for
  // `seconds`, then it burns down.
  ignite(s, seconds = null) {
    return this.world.igniteStructure(s.id, seconds);
  }

  // The fire at `s` is put out: the flames die down and the house stays;
  // everyone goes home a little after.
  putOut(s) {
    if (!this.world.extinguishStructure(s.id)) return false;
    const f = this.fires.get(s.id);
    if (f && !f.out) this.burntOut(f);
    return true;
  }

  // `s` burns down now: the fire ends in a ruin (one that wasn't burning
  // burns down at once), smouldering a while.
  burnDown(s) {
    if (!this.world.burnStructure(s.id, between(this.config.fire.embers))) return false;
    const f = this.fires.get(s.id);
    if (f && !f.out) this.burntOut(f);
    return true;
  }

  // ----- turning out -----

  start(s) {
    const { world, agents } = this;
    const cfg = this.config.fire;
    const centre = world.centerOf(s);
    const pts = world.nodesOf(s).map((n) => world.grid.xy(n));
    const edge = Math.max(...pts.map(([x, y]) => Math.hypot(x - centre[0], y - centre[1]))) + this.config.sim.doorPad;
    const f = { id: s.id, seq: ++this.seq, centre, edge, out: false, people: new Set(), arrived: new Set(), chain: null, engine: null, crew: [], alarm: null, station: null };
    this.fires.set(s.id, f);
    agents.log(`č. p. ${s.no} on fire`, centre);

    // who's in, nearest first
    const inside = new Map();
    for (const a of agents.agents.values()) {
      if (a.state !== 'home' || a.truck || a.visitor || a.commuter) continue;
      if (!inside.has(a.home)) inside.set(a.home, []);
      inside.get(a.home).push(a);
    }
    const near = [];
    for (const h of world.structures.values()) {
      if (h.ruin) continue;
      const d = Math.hypot(...world.centerOf(h).map((v, i) => v - centre[i]));
      if (h.id === s.id || d <= cfg.reach) near.push({ h, d });
    }
    near.sort((p, q) => p.d - q.d);
    let count = 0;
    for (const { h, d } of near) {
      const them = inside.get(h.id);
      if (!them) continue;
      if (h.id === s.id) { // out of the house, and watching it go
        for (const a of them) this.flee(f, s, a);
        continue;
      }
      if (count >= cfg.most) continue;
      const route = this.route(h, s, cfg.reach * 1.6);
      if (!route) continue;
      for (const one of them) {
        if (count >= cfg.most || Math.random() > cfg.turnOut * (1 - 0.6 * d / cfg.reach)) continue;
        // (and some more of the household with them, for this only)
        const extra = Math.floor(between([cfg.household[0], cfg.household[1] + 1]));
        const party = [one];
        for (let k = 0; k < extra; k++) party.push(agents.spawn({ id: `${one.id}:f${k}`, home: h.id, state: 'fireWait', drop: true }));
        for (const a of party) {
          if (count >= cfg.most) {
            if (a !== one) agents.agents.delete(a.id);
            continue;
          }
          a.trip = agents.buildTrip({ mode: 'walk', ...route, purpose: 'fire' }, s.id);
          const help = Math.random() < cfg.helpers;
          this.take(f, a, { role: help ? 'run' : 'watch', phase: 'notice', timer: between(cfg.notice) + d * 0.5 });
          count++;
        }
      }
    }
    this.planChain(f, s);
    this.alarm(f, s);
  }

  take(f, a, job) {
    a.state = 'fireWait';
    a.fire = { fire: f, s: 0, leg: null, target: null, release: null, ...job };
    a.wander = null;
    a.carry = null;
    a.watch = null;
    f.people.add(a);
  }

  // Those at home in the burning house: straight out of the door and into the crowd.
  flee(f, s, a) {
    const { world } = this;
    const front = world.frontFor(world.nodesOf(s));
    const [x, y] = front ? world.grid.xy(front.door) : f.centre;
    const [dx, dy] = front?.dir ?? [0, 1];
    const pad = this.config.sim.doorPad;
    this.take(f, a, { role: 'watch', phase: 'notice', timer: between([0.3, 2.5]) });
    a.trip = { mode: 'walk', nodes: [], dest: s.id, purpose: 'fire', out: null, back: null };
    a.fire.door = [x + dx * pad, y + dy * pad];
  }

  // Where a bucket chain would run: the way from the nearest house's door
  // to the fire's. People join it as they come (joinChain).
  planChain(f, s) {
    const { world, agents } = this;
    const cfg = this.config.fire;
    let best = null;
    for (const h of world.structures.values()) {
      if (h.id === s.id || h.ruin || h.burning) continue;
      const d = Math.hypot(...world.centerOf(h).map((v, i) => v - f.centre[i]));
      if (d > cfg.chainSource || best && d >= best.d) continue;
      const route = this.route(h, s, cfg.chainSource * 2);
      if (route) best = { h, d, route };
    }
    if (!best) return;
    const leg = agents.buildTrip({ mode: 'walk', ...best.route }, s.id).out;
    // members[0] stands at the fire; runners carry to the chain's end
    f.chain = { leg, t: 0, from: best.h.id, members: [], runners: [], logged: false };
  }

  // A helper back at the fire with a bucket, once enough have come: into
  // the chain, or running its gap. False: they go on running on their own
  // (no chain, or it's full).
  joinChain(f, a) {
    const c = f.chain, cfg = this.config.fire, j = a.fire;
    if (!c || f.out || f.arrived.size < cfg.chainStart) return false;
    const L = c.leg.total, k = c.members.length;
    if (k >= Math.floor(L / cfg.chainClose) + 1) return false;
    const short = L > k * cfg.chainGap; // (with one more, it still wouldn't reach)
    j.leg = c.leg;
    j.s = L;
    a.watch = null;
    if (k >= 1 && short && c.runners.length < Math.max(1, Math.floor((k + 1) / cfg.gapRunners))) {
      j.role = 'gap';
      j.phase = 'gapBack';
      a.carry = 'bucket';
      c.runners.push(a);
    } else {
      j.role = 'chain';
      j.phase = 'chain';
      a.carry = null;
      c.members.push(a);
    }
    if (!c.logged && (c.logged = true)) this.agents.log(`bucket chain from č. p. ${this.world.structures.get(c.from)?.no}`, pointAt(c.leg, 0));
    return true;
  }

  // Where chain member i stands along its way (0: the fire's door end):
  // spread as far as a bucket can be handed on, or closed up to reach.
  slotAt(f, i) {
    const c = f.chain, cfg = this.config.fire, L = c.leg.total, k = c.members.length;
    const gap = k > 1 && L <= (k - 1) * cfg.chainGap ? L / (k - 1) : cfg.chainGap;
    return Math.max(0, L - i * gap);
  }

  // Whether the chain reaches the house the water comes from.
  chainReaches(f) {
    const c = f.chain;
    return c.members.length > 1 && c.leg.total <= (c.members.length - 1) * this.config.fire.chainGap;
  }

  // The nearest brigade gets the call.
  alarm(f, s) {
    const { world } = this;
    let best = null;
    for (const st of world.structures.values()) {
      if (st.id === s.id || st.ruin || st.burning || !matches(STRUCTURE_TYPES[st.type], 'fire')) continue;
      const d = Math.hypot(...world.centerOf(st).map((v, i) => v - f.centre[i]));
      if (!best || d < best.d) best = { st, d };
    }
    if (!best) return;
    const kind = best.st.type === 'fire-house' ? 'fire-house' : 'station';
    f.station = { id: best.st.id, kind };
    f.alarm = between(this.config.fire.alarm[kind]);
  }

  // The engine sets off with its crew aboard – or the crew on foot.
  turnOut(f, s) {
    const { world, agents } = this;
    const cfg = this.config.fire;
    const st = world.structures.get(f.station.id);
    if (!st || st.ruin) return;
    const n = cfg.crew[f.station.kind];
    const chief = st.data?.staff?.find((p) => p.role === 'velitel_sboru' && p.first);
    const drive = UNLOCKS.allowsVehicle('trucks') && agents.driveRoute(st, s);
    const crew = [];
    for (let k = 0; k < n; k++) {
      const a = agents.spawn({ id: `fire:${s.id}:${f.seq}:c${k}`, home: st.id, state: 'fireWait', drop: true });
      [a.x, a.y] = world.centerOf(st);
      a.trip = { mode: 'walk', nodes: [], dest: s.id, purpose: 'fire', out: null, back: null };
      this.take(f, a, { role: 'crew', phase: drive ? 'aboard' : 'notice', timer: k * 0.6, post: k });
      crew.push(a);
    }
    f.crew = crew;
    if (drive) {
      const e = agents.spawn({ id: `fire:${s.id}:${f.seq}:e`, home: st.id, state: 'out', truck: true, engine: f.station.kind === 'fire-house' ? 'dvs' : 'cas' });
      agents.begin(e, { ...drive, truck: true, purpose: 'fire' }, s.id);
      // (pulls up on the road short of the door, and turns back from there)
      const out = cut(e.trip.out, 0.3);
      e.trip.out = agents.leg(out, true, false, true);
      e.trip.back = agents.leg(out.slice().reverse(), false, true, true);
      agents.beginLeg(e, e.trip.out);
      e.fire = { fire: f, role: 'engine', phase: 'drive', release: null };
      f.engine = e;
    } else {
      const route = this.route(st, s, Infinity);
      for (const a of crew) {
        if (route) a.trip = agents.buildTrip({ mode: 'walk', ...route, purpose: 'fire' }, s.id);
        else this.drop(f, a);
      }
    }
    const who = chief ? `, velitel ${personName(chief)}` : '';
    agents.log(`${f.station.kind === 'fire-house' ? 'SDH' : 'brigade'} from č. p. ${st.no} to č. p. ${s.no}${who}`, world.centerOf(st));
  }

  // AgentSystem: an engine has pulled up. Its crew get down.
  arrived(e) {
    const f = e.fire?.fire;
    e.state = 'fire';
    if (!f) return this.leave(e);
    const back = [e.tx, e.ty];
    for (const a of f.crew) {
      if (!f.people.has(a)) continue;
      [a.x, a.y] = back;
      a.fire.phase = 'post';
      a.fire.timer = a.fire.post * 0.5;
      a.fire.target = this.post(f, a.fire.post, back);
    }
  }

  // Where crew member k stands: two on the hose near the building, facing
  // it, the rest between there and the engine.
  post(f, k, from) {
    const [cx, cy] = f.centre;
    let dx = from[0] - cx, dy = from[1] - cy;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    const r = k < 2 ? f.edge + 0.12 + k * 0.06 : f.edge + 0.25 + Math.random() * Math.max(0.05, l - f.edge - 0.3);
    const side = k < 2 ? 0.03 * (k ? 1 : -1) : (Math.random() * 2 - 1) * 0.3;
    return [cx + dx * r - dy * side, cy + dy * r + dx * side];
  }

  // ----- every frame -----

  update(dt) {
    const waning = [...this.waning]; // (not those going out this frame: they've had their step)
    for (const f of this.fires.values()) this.step(f, dt);
    for (const f of waning) this.step(f, dt);
    for (const id of this.embers) {
      const s = this.world.structures.get(id);
      if (!s?.embers) this.embers.delete(id);
      else if ((s.embers.left -= dt) <= 0) {
        delete s.embers;
        this.embers.delete(id);
        this.world.events.emit('structure:changed', s);
      }
    }
  }

  step(f, dt) {
    const { world } = this;
    const s = world.structures.get(f.id);
    if (!f.out) {
      if (!s) this.burntOut(f, true); // (gone)
      else if (!s.burning) this.burntOut(f); // (put out, or put back with ⌘Z)
      else {
        s.burning.age = (s.burning.age ?? 0) + dt;
        if (s.burning.left !== null && (s.burning.left -= dt) <= 0) world.history.aside(() => this.burnDown(s));
      }
    }
    if (f.alarm !== null && (f.alarm -= dt) <= 0) {
      f.alarm = null;
      if (!f.out && s) this.turnOut(f, s);
    }
    if (f.chain) {
      const c = f.chain;
      c.t += dt * this.config.fire.pass;
      c.members = c.members.filter((a) => f.people.has(a) && a.fire.role === 'chain');
      c.runners = c.runners.filter((a) => f.people.has(a) && a.fire.role === 'gap');
    }
    for (const a of f.people) {
      if (this.agents.agents.get(a.id) !== a || (a.state !== 'fire' && a.state !== 'fireWait')) {
        f.people.delete(a); // (taken back: a road gone, a lock…)
        continue;
      }
      this.move(f, a, dt);
    }
    const e = f.engine;
    if (e && (this.agents.agents.get(e.id) !== e || e.state === 'back')) {
      f.engine = null;
      for (const a of f.crew) if (f.people.has(a) && a.state === 'fireWait' && a.trip.out === null) this.drop(f, a); // (left without them)
    } else if (e?.state === 'fire' && f.out && (e.fire.release -= dt) <= 0 && f.crew.every((a) => !f.people.has(a) || a.fire.phase === 'boarded')) {
      for (const a of f.crew) this.drop(f, a);
      this.leave(e);
    }
    if (f.out && !f.people.size && !f.engine) this.waning.delete(f);
  }

  // It has burnt down (or the fire is over some other way: `now`, all at once).
  // It moves to the waning fires, so the house can catch fire again
  // while they go home.
  burntOut(f, now = false) {
    f.out = true;
    if (this.fires.get(f.id) === f) {
      this.fires.delete(f.id);
      this.waning.add(f);
    }
    f.alarm = null;
    const cfg = this.config.fire;
    for (const a of f.people) a.fire.release = now ? 0 : between(a.fire.role === 'crew' ? cfg.brigadeAfter : cfg.after);
    if (f.engine) f.engine.fire.release = now ? 0 : between(cfg.brigadeAfter) + 2;
    if (now) { // the brigade straight back
      for (const a of f.crew) if (f.people.has(a) && a.fire.phase !== 'notice' && a.trip.out === null) this.drop(f, a);
      if (f.engine && f.engine.state === 'fire') this.leave(f.engine);
    }
  }

  move(f, a, dt) {
    const j = a.fire, cfg = this.config.fire;
    const walk = this.config.sim.walkSpeed * cfg.hurry * (j.role === 'watch' && j.phase !== 'go' ? 0.6 : 1) * dt;
    const done = j.release !== null && (j.release -= dt) <= 0;
    switch (j.phase) {
      case 'notice': // still in, about to set off
        if ((j.timer -= dt) > 0) break;
        if (f.out) return this.goHome(f, a); // (over before they got going)
        a.state = 'fire';
        if (j.door) { // from the burning house
          [a.x, a.y] = j.door;
          this.toCrowd(f, a, j.door);
          break;
        }
        this.agents.beginLeg(a, a.trip.out);
        j.leg = a.trip.out;
        j.s = 0;
        j.phase = 'go';
        a.carry = j.role === 'run' ? 'bucket' : null;
        break;
      case 'go': // along their way to the fire
        if (!along(a, j, walk)) break;
        if (j.role === 'watch') this.toCrowd(f, a, [a.x, a.y]);
        else if (j.role === 'crew') {
          j.phase = 'post';
          j.timer = 0;
          j.target = this.post(f, j.post, [a.x, a.y]);
        } else if (f.out) {
          this.homeward(a);
        } else if (f.arrived.add(a) && this.joinChain(f, a)) {
          break;
        } else { // a runner: a step to the side, and throw
          const [x, y] = [a.x, a.y], [cx, cy] = f.centre;
          const l = Math.hypot(x - cx, y - cy) || 1, u = (Math.random() * 2 - 1) * 0.12;
          j.target = [x - ((y - cy) / l) * u, y + ((x - cx) / l) * u];
          j.phase = 'toThrow';
        }
        break;
      case 'toThrow':
        if (!toward(a, j.target, walk)) break;
        j.phase = 'throw';
        j.timer = between(cfg.splash);
        a.carry = 'throw';
        a.watch = f.centre;
        break;
      case 'throw':
        if ((j.timer -= dt) > 0) break;
        a.carry = 'bucket';
        a.watch = null;
        j.phase = 'return';
        j.target = a.trip.back.points[0];
        break;
      case 'return': // back to where their way home starts, and off
        if (!toward(a, j.target, walk)) break;
        if (j.role === 'run' && !f.out) {
          this.agents.beginLeg(a, a.trip.back);
          j.leg = a.trip.back;
          j.s = 0;
          j.phase = 'refill';
          j.timer = null;
        } else this.handBack(f, a);
        break;
      case 'refill': // a runner on the way home for more water, then in filling it
        if (j.timer === null) {
          if (!along(a, j, walk)) break;
          a.state = 'fireWait';
          a.carry = null;
          j.timer = between(cfg.refill);
          break;
        }
        if ((j.timer -= dt) > 0) break;
        if (f.out) return this.goHome(f, a);
        a.state = 'fire';
        this.agents.beginLeg(a, a.trip.out);
        j.leg = a.trip.out;
        j.s = 0;
        j.phase = 'go';
        a.carry = 'bucket';
        break;
      case 'toCrowd':
        if (!toward(a, j.target, walk * 0.8)) break;
        j.phase = 'watch';
        this.agents.startWander(a, Infinity, () => around(j.target, 0.06), 0.3);
        break;
      case 'watch':
        if (done) a.wander.time = 0;
        if (!this.agents.wander(a, dt)) break;
        a.wander = null;
        j.phase = 'return';
        j.target = j.door ?? a.trip.back.points[0];
        break;
      case 'chain': { // in the chain: to their place in it, passing buckets on
        const c = f.chain, i = c.members.indexOf(a);
        if (done || i < 0) {
          a.carry = null;
          a.watch = null;
          j.phase = 'leaveChain';
          break;
        }
        const goal = this.slotAt(f, i);
        j.s = j.s > goal ? Math.max(goal, j.s - walk) : Math.min(goal, j.s + walk);
        const there = j.s === goal;
        // a bucket every other place, moving down the chain to the fire
        const k = (((i + c.t) % 2) + 2) % 2, holds = there && k < 1;
        a.carry = holds ? (i === 0 ? 'throw' : 'bucket') : null;
        a.watch = i === 0 ? f.centre : pointAt(c.leg, Math.min(c.leg.total, j.s + 0.1));
        // standing in a zigzag either side of the way, leaning to pass it on
        const [x, y] = pointAt(c.leg, j.s), [x1, y1] = pointAt(c.leg, Math.min(c.leg.total, j.s + 0.02));
        const l = Math.hypot(x1 - x, y1 - y) || 1, ux = (x1 - x) / l, uy = (y1 - y) / l;
        const zig = (i % 2 ? 1 : -1) * 0.025, lean = holds ? 0.012 * Math.sin(k * Math.PI) : 0;
        a.x = x - uy * zig + ux * lean;
        a.y = y + ux * zig + uy * lean;
        break;
      }
      case 'gapBack': // running the gap: back along the way to the house for water…
        if (done) {
          j.phase = 'leaveChain';
          a.carry = null;
          break;
        }
        j.s = Math.max(0, j.s - walk);
        [a.x, a.y] = pointAt(j.leg, j.s);
        if (j.s > 0) break;
        a.state = 'fireWait';
        a.carry = null;
        j.phase = 'gapFill';
        j.timer = between(cfg.refill);
        break;
      case 'gapFill': // …in it, filling the bucket…
        if ((j.timer -= dt) > 0 && !done) break;
        a.state = 'fire';
        if (done) {
          j.phase = 'leaveChain';
          break;
        }
        a.carry = 'bucket';
        j.phase = 'gapGo';
        break;
      case 'gapGo': { // …and out to the chain's end with it, to hand it on
        const c = f.chain, end = this.slotAt(f, Math.max(0, c.members.length - 1)) - 0.05;
        if (done) {
          j.phase = 'leaveChain';
          a.carry = null;
          break;
        }
        j.s = Math.min(Math.max(0, end), j.s + walk);
        [a.x, a.y] = pointAt(j.leg, j.s);
        if (j.s < end) break;
        a.carry = null;
        a.watch = pointAt(j.leg, Math.min(j.leg.total, j.s + 0.1));
        j.phase = 'gapHand';
        j.timer = 0.6;
        break;
      }
      case 'gapHand':
        if ((j.timer -= dt) > 0) break;
        a.watch = null;
        if (this.chainReaches(f) && !done) { // (no gap left: into the chain)
          j.role = 'chain';
          j.phase = 'chain';
          f.chain.runners.splice(f.chain.runners.indexOf(a), 1);
          f.chain.members.push(a);
          break;
        }
        j.phase = 'gapBack';
        a.carry = 'bucket';
        break;
      case 'leaveChain': // on along the chain to the fire's door, and home from there
        if (j.s < j.leg.total) {
          j.s = Math.min(j.leg.total, j.s + walk);
          [a.x, a.y] = pointAt(j.leg, j.s);
          break;
        }
        j.phase = 'return';
        j.target = a.trip.back.points[0];
        break;
      case 'aboard': // in the engine
        break;
      case 'post': // the crew: down from the engine, to their places
        if ((j.timer -= dt) > 0) break;
        a.state = 'fire';
        if (!toward(a, j.target, walk)) break;
        j.phase = 'hose';
        a.carry = j.post < 2 ? 'hose' : null;
        a.watch = f.centre;
        break;
      case 'hose':
        if (!done) break;
        a.carry = null;
        a.watch = null;
        if (f.engine?.state === 'fire') {
          j.phase = 'board';
          j.target = [f.engine.tx, f.engine.ty];
        } else {
          j.phase = 'return';
          j.target = a.trip.back?.points[0] ?? [a.x, a.y];
        }
        break;
      case 'board':
        if (!toward(a, j.target, walk)) break;
        a.state = 'fireWait';
        j.phase = 'boarded';
        break;
      case 'boarded':
        break;
    }
  }

  // A watcher's place in the crowd: out from the building's edge, on the
  // side they came from, on open ground.
  toCrowd(f, a, from) {
    const { world } = this;
    const cfg = this.config.fire;
    const [cx, cy] = f.centre;
    const base = Math.atan2(from[1] - cy, from[0] - cx);
    let spot = null;
    for (let tries = 0; tries < 8 && !spot; tries++) {
      const t = base + (Math.random() * 2 - 1) * cfg.spread, r = f.edge + between(cfg.crowd);
      const p = [cx + Math.cos(t) * r, cy + Math.sin(t) * r];
      const n = world.grid.nodeAt(...p);
      if (n >= 0 && !world.terrain.isWater(n) && !world.structureAt(n)) spot = p;
    }
    const j = a.fire;
    j.phase = 'toCrowd';
    j.target = spot ?? from;
    a.carry = null;
    a.watch = f.centre;
  }

  // Off the fire's hands: on the way home (or, homeless, to the
  // neighbours, and gone).
  handBack(f, a) {
    f.people.delete(a);
    a.fire = null;
    a.carry = null;
    a.watch = null;
    a.wander = null;
    if (a.drop) return this.homeward(a);
    const home = this.world.structures.get(a.home);
    if (!home || home.ruin) return this.refuge(a, home);
    if (!a.trip?.back) return this.agents.arriveHome(a); // (out of their own door: back in)
    this.homeward(a);
  }

  homeward(a) {
    if (a.fire) {
      a.fire.fire.people.delete(a);
      a.fire = null;
    }
    a.carry = null;
    a.watch = null;
    if (!a.trip?.back) return this.agents.agents.delete(a.id);
    this.agents.beginLeg(a, a.trip.back);
    a.state = 'back';
  }

  // Burnt out of their home: they walk to the nearest house that stands
  // and are taken in there (gone from the map).
  refuge(a, ruin) {
    const { world, agents } = this;
    let best = null;
    if (ruin) {
      for (const h of world.structures.values()) {
        if (h.ruin || h.burning || !STRUCTURE_TYPES[h.type]?.stats?.residents) continue;
        const d = Math.hypot(...world.centerOf(h).map((v, i) => v - world.centerOf(ruin)[i]));
        if (!best || d < best.d) best = { h, d };
      }
    }
    const route = best && this.route(ruin, best.h, this.config.fire.reach * 3);
    if (!route) return agents.agents.delete(a.id);
    a.trip = agents.buildTrip({ mode: 'walk', ...route, purpose: 'refuge' }, best.h.id);
    a.drop = true;
    // (from where they stand to the start of the way, then along it)
    a.trip.out = agents.leg([[a.x, a.y], ...a.trip.out.points], false, true);
    agents.beginLeg(a, a.trip.out);
    a.state = 'out';
  }

  // Still at home, or in the house filling a bucket, when it's over: stays in.
  goHome(f, a) {
    f.people.delete(a);
    a.fire = null;
    a.carry = null;
    if (a.drop) return this.agents.agents.delete(a.id);
    const home = this.world.structures.get(a.home);
    if (!home || home.ruin) return this.agents.agents.delete(a.id);
    this.agents.arriveHome(a);
  }

  drop(f, a) {
    f.people.delete(a);
    this.agents.agents.delete(a.id);
  }

  // The engine drives back to its station (and is put away there).
  leave(e) {
    e.fire = null;
    this.agents.beginLeg(e, e.trip.back);
    e.state = 'back';
  }
}

// Along a fire walker's leg (j.leg, at j.s); true at its end.
function along(a, j, step) {
  j.s = Math.min(j.leg.total, j.s + step);
  [a.x, a.y] = pointAt(j.leg, j.s);
  return j.s >= j.leg.total;
}

// A step straight towards `p`; true once there.
function toward(a, p, step) {
  const dx = p[0] - a.x, dy = p[1] - a.y, d = Math.hypot(dx, dy);
  if (d <= step) {
    [a.x, a.y] = p;
    return true;
  }
  a.x += (dx / d) * step;
  a.y += (dy / d) * step;
  return false;
}

function around([x, y], r) {
  return [x + (Math.random() * 2 - 1) * r, y + (Math.random() * 2 - 1) * r];
}

// A leg's points up to `short` before its end (all of it when that short).
function cut(leg, short) {
  const end = leg.total - short;
  if (end <= short) return leg.points;
  const pts = [];
  for (let i = 0; i < leg.points.length && leg.cum[i] < end; i++) pts.push(leg.points[i]);
  pts.push(pointAt(leg, end));
  return pts;
}
