// Moving dots. Each structure spawns `agents` (its type's) people who live or
// work there. Each time one sets off it picks an activity (config.activities,
// weighted by def.sim.activities – 'resident' or 'worker'): stay in a while
// longer, potter about in front of the house, a loop walk, a park, an errand,
// work, a trip off the map; workers take lunch walks and delivery drives.
//
// People can also be sent: send() has those of given houses go to one
// place, stay and come back (cmd.send, by house number; the story next).
// At a fire (src/sim/fire.js) neighbours and the brigade are taken over by
// the FireSystem (state 'fire', or 'fireWait' while out of sight): it moves
// them itself and hands them back on a leg home.
//
// Trips to a place pick a mode (planCommute):
//   walk   – within comfortable walking distance over footpaths and street
//            sidewalks (or reachable on foot only)
//   cycle  – too long to walk: likely when short, less so further
//            (config.bike), over footpaths and every road
//   drive  – everything else, over the road network
//   stroll – walks for their own sake: loops, and walks to a park
//
// Agent lifecycle:  home --(leg out)--> away --(leg back)--> home …
// with some states where people stand about in view (see wander):
//   linger – in front of the house (porch), or round it in the garden
//            where nothing leads from its front (startYard), or in a park
//            on the way (then the leg back)
//   wait   – at a bus stop / station for a ride off the map (config.transit);
//            they board when a bus or train calls there (transitCall), sit
//            out their time `away`, then `abroad` wait for one calling there
//            again to get off and walk home
//
// Map exits (roads ending at the map edge, AgentSystem.driveExits()):
//   - residents sometimes leave the map (the 'leave' activity), stay away a
//     while and come back the same way – by car, or by bus / train
//   - jobs vs residents (config.commute): when the city has more residents
//     than jobs, that share of residents' work trips go off the map; when
//     it has more jobs, commuters drive in to buildings with jobs, work a
//     shift and leave (see balance, updateCommuters)
//   - visitors arrive through exits, drive to a destination (visitors.*),
//     stay, then leave through a random exit and are gone
//
// Trucks (config.trucks, agent.truck): drivers too, drawn as one long body
// from its front (a.x / a.y) to its back (a.tx / a.ty). Industrial buildings keep a few
// (def.trucks, default 1) that export goods off the map – out through an exit, away a
// while, back – or make service runs to businesses and other industry.
// Delivery trucks also arrive from outside like visitors (updateDeliveries).
// They don't use parking lots, and drive a bit slower than cars.
//
// Buses (config.buses, agent.bus): come in through a road exit, call at a
// few bus stops (structures with def.busStop) – nearest next – and leave
// through an exit; no road off the map, no buses. A bus runs along one leg,
// split only where it turns back at a stop, with the stops' places on it
// (see spawnBus, moveBus); a.x / a.y is its front, a.tx / a.ty its back.
//
// Traffic: vehicles (cars, trucks, buses) go their full speed on open
// roads, slower through the village (config.sim.village) and on single-track
// lanes (config.lane), where they keep near the middle – a profile along
// each leg (pace). Vehicles and cyclists keep behind whoever is in front of
// them in their lane and queue (config.traffic, see follow). Pedestrians
// always move at their own pace.
//
// Drivers use parking lots without owning cars: leaving by car takes a parked
// car from the lot there (if any), arriving parks one (see sim/parking.js).
//
// Cars, trucks and buses can be locked (src/story/unlocks.js): then nobody
// drives (walking, cycling or the bus / train instead, where they can), no
// visitors or commuters come in by car, industry keeps no trucks and none
// deliver, and no buses come. followVehicles() clears those already out.
//
// Weather (config.weather.people): in rain and storms more people stay in
// and fewer go for a walk, fewer cycle, fewer visitors come (see weather()).
//
// The day (config.rhythm, by the sun's clock): nobody sets off at night,
// early in the morning they go to work and stay till the shift ends,
// mornings are for the shop and the doctor, evenings for the bench in
// front of the house and the pub (see rhythm()).
//
// A village (config.village): people of houses and farms work round the
// house with a hoe (garden: startYard), and where the town has no jobs for
// them most do that rather than go off the map; and they go to the woods
// for mushrooms with a basket (forest: a walk to the nearest wood, a while
// about among its trees, home again). a.carry is what they hold
// (render/people.js), as at a fire.
//
// The renderer only reads visible() and x / y / trip.mode.
//
// This file keeps the set-up, update() and the counts; the rest of
// AgentSystem's methods are in ./agents/, by topic: leisure.js (at home and
// out: chatting, wandering, sitting out, fields, woods), transit.js
// (visitors, commuters, deliveries, buses), trips.js (where people go) and
// movement.js (following a trip, leg by leg). Each is a class whose methods
// are copied onto AgentSystem.prototype (at the end), so all share `this`.

import { STRUCTURE_TYPES, matches, codeOf, statsOf } from '../../structures/index.js';
import { compass } from '../ui/annotations.js';
import { pointAt } from '../roads/geometry.js';
import { DAY, hourAt } from '../render/shadows.js';
import { WalkNetwork } from './walking.js';
import { can, backPoint, paceAt, newAgent } from './agents/shared.js';
import { AgentLeisure } from './agents/leisure.js';
import { AgentTransit } from './agents/transit.js';
import { AgentTrips } from './agents/trips.js';
import { AgentMovement } from './agents/movement.js';
import { AgentWays } from './agents/ways.js';

export class AgentSystem {
  constructor(world, config, parking = null) {
    this.world = world;
    this.config = config;
    this.parking = parking;
    this.agents = new Map();
    this.walk = new WalkNetwork(world, config); // registers its listeners first
    this.ride = new WalkNetwork(world, config, { allRoads: true }); // cyclists
    this.visitorTimer = 14;
    this.visitorSeq = 0;
    this.commuteTimer = 9;
    this.deliveryTimer = 34;
    this.busTimer = 14;
    this.busSeq = 0;
    this._balance = null; // cached { residents, jobs, workplaces }
    this.log = () => {}; // (text, [x, y]) – set by main to feed annotations
    this.trains = null;  // TrainSystem, set by main: closed level crossings
    this.fires = null;   // FireSystem, set by main: fire engines pulling up
    this.queues = new Map(); // closed crossing + heading + kind -> people queued there

    const rebalance = () => (this._balance = null);
    for (const type of ['structure:added', 'structure:changed', 'structure:removed', 'roads:changed']) world.events.on(type, rebalance);
    world.events.on('structure:added', (s) => this.sync(s));
    world.events.on('structure:changed', (s) => this.sync(s));
    world.events.on('structure:removed', (s) => this.despawnFor(s));
    world.events.on('roads:changed', () => this.revalidate());
    world.events.on('paths:changed', () => this.revalidate());
    for (const s of world.structures.values()) this.sync(s);
  }

  // Match the number of agents (and trucks) to the structure's type.
  sync(s) {
    const def = STRUCTURE_TYPES[s.type];
    const count = def && !s.ruin ? def.agents ?? 1 : 0; // (nobody in a ruin)
    const trucks = this.config.trucks;
    const fleet = def && !s.ruin && can('trucks') && trucks.homes.some((n) => matches(def, n)) ? def.trucks ?? 1 : 0;
    this.syncCount(s, '', count, () => this.homeDwell(s) * Math.random());
    this.syncCount(s, 't', fleet, () => trucks.firstTrip * Math.random(), { truck: true });
  }

  syncCount(s, tag, count, timer, extra = {}) {
    for (let k = 0; ; k++) {
      const id = `${s.id}:${tag}${k}`;
      if (k < count) {
        if (!this.agents.has(id)) {
          this.agents.set(id, newAgent({ id, home: s.id, state: 'home', timer: timer(), ...extra }));
        }
      } else if (this.agents.has(id)) {
        // (out at the fire that took their home: they go to the neighbours
        // when it's over, src/sim/fire.js)
        const a = this.agents.get(id);
        if (a.state === 'fire' || a.state === 'fireWait') a.drop = true;
        else this.agents.delete(id);
      } else {
        break;
      }
    }
  }

  // Something was locked or unlocked: cars, trucks and buses that may no
  // longer run are taken off the map – visitors gone, residents back home –
  // and the industries' trucks are counted again.
  followVehicles() {
    for (const [id, a] of this.agents) {
      const kind = a.bus ? 'buses' : a.truck ? 'trucks' : a.trip?.mode === 'drive' ? 'cars' : null;
      if (!kind || can(kind)) continue;
      if (a.visitor || a.engine) {
        this.agents.delete(id);
        continue;
      }
      a.state = 'home';
      a.trip = null;
      a.retry = null;
      const home = this.world.structures.get(a.home);
      a.timer = home ? this.homeDwell(home) * Math.random() : 1;
    }
    for (const s of this.world.structures.values()) this.sync(s);
  }

  despawnFor(s) {
    for (const [id, a] of this.agents) if (a.home === s.id && !a.visitor) this.agents.delete(id);
  }

  // A new agent of someone else's (a fire engine and its crew, src/sim/fire.js).
  spawn(fields) {
    const a = newAgent(fields);
    this.agents.set(a.id, a);
    return a;
  }

  visitorCount() {
    let n = 0;
    for (const a of this.agents.values()) if (a.visitor && !a.commuter && !a.truck && !a.bus) n++;
    return n;
  }

  commuterCount() {
    let inbound = 0, outbound = 0;
    for (const a of this.agents.values()) {
      if (a.commuter) inbound++;
      else if (a.trip?.commute) outbound++;
    }
    return { inbound, outbound };
  }

  // Residents and jobs in buildings connected to the city (as in the stats
  // panel), plus the buildings that offer jobs.
  balance() {
    if (this._balance) return this._balance;
    let residents = 0, jobs = 0;
    const workplaces = [];
    for (const s of this.world.structures.values()) {
      if (!this.world.isServed(s)) continue;
      const stats = statsOf(s);
      residents += stats.residents ?? 0;
      jobs += stats.jobs ?? 0;
      if (stats.jobs) workplaces.push(s);
    }
    return (this._balance = { residents, jobs, workplaces });
  }

  // Share of residents' trips that go to work off the map.
  outboundShare() {
    const { residents, jobs } = this.balance();
    if (!residents || residents <= jobs) return 0;
    return ((residents - jobs) / residents) * this.config.commute.outShare;
  }

  *visible() {
    for (const a of this.agents.values()) if (VISIBLE.has(a.state)) yield a;
  }

  profile(s) {
    return STRUCTURE_TYPES[s?.type]?.sim?.activities ?? 'worker';
  }

  speedOf(mode) {
    if (mode === 'drive') return this.config.sim.agentSpeed;
    if (mode === 'cycle') return this.config.bike.speed;
    return this.config.sim.walkSpeed;
  }

  update(dt) {
    this.updateVisitors(dt);
    this.updateCommuters(dt);
    this.updateDeliveries(dt);
    this.updateBuses(dt);
    this.follow(dt);
    this.meet();
    const closed = this.trains?.closed;
    for (const k of this.queues.keys()) if (!closed?.has(k.split('|')[0])) this.queues.delete(k);
    for (const [id, a] of this.agents) {
      switch (a.state) {
        case 'home': {
          if ((a.timer -= dt) > 0) break;
          const next = this.startTrip(a);
          if (next) a.state = next === true ? 'out' : next;
          else a.timer = this.config.sim.retryDelay;
          break;
        }
        case 'away':
          if ((a.timer -= dt) > 0) break;
          if (a.trip.transit?.inbound) { // a commuter's shift is over: to the stop
            this.beginLeg(a, a.trip.out);
            a.state = 'out';
            break;
          }
          if (a.trip.transit) { // time to come back: wait for a ride
            a.state = 'abroad';
            a.timer = this.config.transit.returnWait;
            break;
          }
          if (a.visitor && !this.planDeparture(a)) {
            this.agents.delete(id);
            break;
          }
          this.beginLeg(a, a.trip.back);
          a.state = 'back';
          if (a.trip.mode === 'drive' && !a.truck) this.parking?.take(this.world.structures.get(a.trip.dest));
          if (a.trip.outside && !a.truck) {
            const home = this.world.structures.get(a.home);
            if (home) this.log(`${codeOf(home)} resident returns · exit ${compass(a.trip.exit.dir)}`, a.trip.exit.pos);
          }
          break;
        case 'abroad': // no bus / train came back in time: turn up anyway
          if ((a.timer -= dt) <= 0) this.alight(a);
          break;
        case 'wait':
          this.wander(a, dt);
          if ((a.timer -= dt) > 0) break;
          if (a.trip.transit.inbound) { // a commuter: gone some other way
            this.agents.delete(id);
            break;
          }
          // nothing came: walk home and drive off instead
          a.retry = { commute: a.trip.commute };
          this.beginLeg(a, a.trip.back);
          a.state = 'back';
          break;
        case 'linger':
          if (!this.wander(a, dt)) break;
          if (a.trip.back) {
            this.beginLeg(a, a.trip.back);
            a.state = 'back';
          } else {
            this.arriveHome(a);
          }
          break;
        case 'out':
          if (a.bus) {
            if (!this.moveBus(a, dt)) this.agents.delete(id); // left the map
            break;
          }
        // falls through
        case 'back': {
          const leg = a.state === 'out' ? a.trip.out : a.trip.back;
          if (a.chat && !this.chatting(a, leg, dt)) break; // stopped for a word (meet)
          const step = this.speedOf(a.trip.mode) * paceAt(leg, a.s) * a.followK * this.doorEase(a, leg) * (a.engine ? this.config.fire.engineSpeed : a.truck ? this.config.trucks.speed : 1) * dt;
          a.s = Math.min(a.s + Math.min(step, a.room), Math.max(a.s, this.crossingStop(a, leg)));
          [a.x, a.y] = pointAt(leg, a.s);
          if (a.truck) [a.tx, a.ty] = backPoint(leg, a.s, this.config.trucks.trailer);
          if (a.s < leg.total) break;
          const arrived = a.trip.mode === 'stroll' && !a.trip.dest || a.trip.outside || this.world.structures.has(a.trip.dest);
          if (a.trip.mode === 'drive' && !a.truck) {
            this.parking?.park(this.world.structures.get(a.state === 'out' ? a.trip.dest : a.home));
          }
          if (a.state === 'out' && arrived) this.arrive(a);
          else if (a.trip.transit?.inbound && this.world.structures.has(a.trip.transit.work)) { // off the bus, at work
            a.state = 'away';
            a.timer = this.dwell(a.trip);
          } else if (a.visitor) this.agents.delete(id); // left the map (or lost its destination)
          else this.arriveHome(a);
          break;
        }
      }
    }
  }

  // The hour now (the sun's clock; where the Debug panel holds it) and
  // its band of config.rhythm: { hour, activities?, errands? }.
  rhythm() {
    const hour = !DAY.on && DAY.held != null ? DAY.held : hourAt(this.world.time);
    return { hour, ...this.config.rhythm?.bands.find((b) => hour < b.to) };
  }

  // How the weather now changes what people do (config.weather.people; {}
  // in fair weather).
  weather() {
    return this.config.weather?.people?.[this.world.weather?.kind] ?? {};
  }
}

// AgentSystem's methods are kept by topic in ./agents/ – each file a class
// whose methods are copied onto AgentSystem.prototype here (all share `this`).
for (const part of [AgentLeisure, AgentTransit, AgentTrips, AgentMovement, AgentWays]) {
  for (const key of Object.getOwnPropertyNames(part.prototype)) {
    if (key !== 'constructor') Object.defineProperty(AgentSystem.prototype, key, Object.getOwnPropertyDescriptor(part.prototype, key));
  }
}

// States in which an agent is out and about (drawn).
const VISIBLE = new Set(['out', 'back', 'linger', 'wait', 'fire']);
