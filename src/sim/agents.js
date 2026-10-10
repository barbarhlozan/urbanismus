// Moving dots. Each structure spawns `agents` (its type's) people who live or
// work there. Each time one sets off it picks an activity (config.activities,
// weighted by def.sim.activities – 'resident' or 'worker'): stay in a while
// longer, potter about in front of the house, a loop walk, a park, an errand,
// work, a trip off the map; workers take lunch walks and delivery drives.
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
//   linger – in front of the house (porch), or in a park on the way
//            (then the leg back)
//   wait   – at a bus stop / station for a ride off the map (config.transit);
//            they board when a bus or train calls there (transitCall), sit
//            out their time `away`, then `abroad` wait for one calling there
//            again to get off and walk home
//
// Map exits (roads ending at the map edge, world.roadExits()):
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
// The renderer only reads visible() and x / y / trip.mode.

import { STRUCTURE_TYPES, matches, codeOf } from '../../structures/index.js';
import { compass } from '../ui/annotations.js';
import { findPath } from '../roads/pathfinding.js';
import { smoothPolyline, offsetPolyline, measurePolyline, pointAt, roadway } from '../roads/geometry.js';
import { siteWalks, hubRadius } from '../roads/siteWalks.js';
import { UNLOCKS } from '../story/unlocks.js';

const can = (kind) => UNLOCKS.allowsVehicle(kind); // 'cars' | 'trucks' | 'buses'
import { WalkNetwork } from './walking.js';

// The point `len` behind s on a leg – straight back from its start while
// the vehicle is still pulling out (so it keeps its length).
function backPoint(leg, s, len) {
  const back = s - len;
  if (back >= 0 || leg.total < 1e-6) return pointAt(leg, back);
  const [x0, y0] = leg.points[0], [x1, y1] = pointAt(leg, Math.min(leg.total, 0.1));
  const l = Math.hypot(x1 - x0, y1 - y0) || 1;
  return [x0 + ((x1 - x0) / l) * back, y0 + ((y1 - y0) / l) * back];
}

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
    const count = def ? def.agents ?? 1 : 0;
    const trucks = this.config.trucks;
    const fleet = def && can('trucks') && trucks.homes.some((n) => matches(def, n)) ? def.trucks ?? 1 : 0;
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
        this.agents.delete(id);
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
      if (a.visitor) {
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
      const stats = STRUCTURE_TYPES[s.type].stats ?? {};
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

  // Seconds at the far end of a trip.
  dwell(trip) {
    if (trip.truck) {
      const t = this.config.trucks;
      return trip.outside ? between(t.outsideMin, t.outsideMax) : between(t.dwellMin, t.dwellMax);
    }
    if (trip.commuter) return between(this.config.commute.shiftMin, this.config.commute.shiftMax);
    if (trip.outside || trip.transit) return between(this.config.sim.outsideMin, this.config.sim.outsideMax);
    if (trip.visitor) return between(this.config.visitors.dwellMin, this.config.visitors.dwellMax);
    const d = this.config.dwell;
    return between(...(trip.purpose === 'work' ? d.work : trip.purpose === 'stroll' ? d.turn : d.errand));
  }

  // Seconds at home (for workers: at work) before setting off again.
  homeDwell(home) {
    return between(...(this.profile(home) === 'resident' ? this.config.dwell.home : this.config.dwell.work));
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
            if (home) this.log(`${codeOf(home)} resident returns · exit ${compass(a.trip.exit.dir)}`, this.world.grid.xy(a.trip.exit.node));
          }
          break;
        case 'abroad': // no bus / train came back in time: turn up anyway
          if ((a.timer -= dt) <= 0) this.alight(a);
          break;
        case 'wait':
          this.wander(a, dt);
          if ((a.timer -= dt) > 0) break;
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
          const step = this.speedOf(a.trip.mode) * paceAt(leg, a.s) * a.followK * this.doorEase(a, leg) * (a.truck ? this.config.trucks.speed : 1) * dt;
          a.s = Math.min(a.s + Math.min(step, a.room), Math.max(a.s, this.crossingStop(a, leg)));
          [a.x, a.y] = pointAt(leg, a.s);
          if (a.truck) [a.tx, a.ty] = backPoint(leg, a.s, this.config.trucks.trailer);
          if (a.s < leg.total) break;
          const arrived = a.trip.mode === 'stroll' && !a.trip.dest || a.trip.outside || this.world.structures.has(a.trip.dest);
          if (a.trip.mode === 'drive' && !a.truck) {
            this.parking?.park(this.world.structures.get(a.state === 'out' ? a.trip.dest : a.home));
          }
          if (a.state === 'out' && arrived) this.arrive(a);
          else if (a.visitor) this.agents.delete(id); // left the map (or lost its destination)
          else this.arriveHome(a);
          break;
        }
      }
    }
  }

  // At the end of the way out.
  arrive(a) {
    const { trip } = a;
    if (trip.transit) {
      a.state = 'wait';
      a.timer = this.config.transit.maxWait;
      this.startWander(a, Infinity, around(a.x, a.y, 0.08), 0.2);
    } else if (trip.linger) {
      a.state = 'linger';
      const place = this.world.structures.get(trip.dest);
      this.startWander(a, between(...this.config.linger.park), this.parkSpots(place, [a.x, a.y]));
    } else {
      a.state = 'away';
      a.timer = this.dwell(trip);
    }
  }

  arriveHome(a) {
    a.state = 'home';
    a.trip = null;
    a.wander = null;
    if (a.truck) a.timer = this.dwell({ truck: true });
    else if (a.retry) a.timer = between(1, 3);
    else a.timer = this.homeDwell(this.world.structures.get(a.home));
  }

  // ----- lingering -----

  // Stand about: step to a spot (`spot()`), pause there, on to another… and
  // when `time` is up back to where it began. `speed` is a share of walking
  // speed on top of config.linger.speed.
  startWander(a, time, spot, speed = 1) {
    a.wander = { anchor: [a.x, a.y], spot, time, target: null, back: false, pause: between(0.5, 2), speed };
  }

  // Moves a lingering agent on; true once it's back where it began after its time.
  wander(a, dt) {
    const w = a.wander;
    w.time -= dt;
    if (w.pause > 0) {
      w.pause -= dt;
      return false;
    }
    if (!w.target) {
      w.back = w.time <= 0;
      w.target = w.back ? w.anchor : w.spot();
    }
    const dx = w.target[0] - a.x, dy = w.target[1] - a.y;
    const d = Math.hypot(dx, dy);
    const step = this.config.sim.walkSpeed * this.config.linger.speed * w.speed * dt;
    if (d > step) {
      a.x += (dx / d) * step;
      a.y += (dy / d) * step;
      return false;
    }
    [a.x, a.y] = w.target;
    w.target = null;
    if (w.back) return true;
    w.pause = between(...this.config.linger.pause);
    return false;
  }

  // Out in front of the house for a while. 'linger', or null without a front.
  startPorch(a, home) {
    const { world } = this;
    const front = world.frontFor(world.nodesOf(home));
    if (!front) return null;
    const [x, y] = world.grid.xy(front.door);
    const [dx, dy] = front.dir;
    const { porchReach, porchWidth, porch } = this.config.linger;
    const pad = this.config.sim.doorPad;
    a.trip = { mode: 'linger', nodes: [], dest: null, back: null };
    [a.x, a.y] = [x + dx * pad, y + dy * pad];
    [a.tx, a.ty] = [a.x, a.y];
    const cx = x + dx * porchReach, cy = y + dy * porchReach;
    this.startWander(a, between(...porch), () => {
      const u = (Math.random() * 2 - 1) * porchWidth, v = (Math.random() * 2 - 1) * 0.1;
      return [cx - dy * u + dx * v, cy + dx * u + dy * v];
    });
    return 'linger';
  }

  // Where to stand about in a park or square: along its walkways, a step
  // to either side; on a green without any, round its middle; elsewhere (a
  // churchyard…) near where they came in.
  parkSpots(place, anchor) {
    if (!place || !STRUCTURE_TYPES[place.type]?.site) return around(...anchor, 0.25);
    const { lines, centre } = siteWalks(this.world.sitePaths(place));
    if (!lines.length) return around(...centre, 0.3);
    const walks = lines.map(measurePolyline);
    const total = walks.reduce((sum, w) => sum + w.total, 0);
    return () => {
      let s = Math.random() * total;
      const w = walks.find((p) => (s -= p.total) < 0) ?? walks[walks.length - 1];
      return around(...pointAt(w, Math.random() * w.total), 0.1)();
    };
  }

  // ----- bus and train rides -----

  // A bus or train calls at stop / station `id`: whoever waits there gets on,
  // whoever is coming back that way gets off.
  transitCall(id) {
    let on = 0, off = 0;
    for (const a of this.agents.values()) {
      if (a.trip?.transit?.stop !== id) continue;
      if (a.state === 'wait') {
        a.state = 'away';
        a.wander = null;
        a.timer = this.dwell(a.trip);
        on++;
      } else if (a.state === 'abroad') {
        this.alight(a);
        off++;
      }
    }
    const stop = this.world.structures.get(id);
    if (stop && (on || off)) {
      const n = (k, verb) => k && `${k} ${verb}`;
      this.log(`${codeOf(stop)} · ${[n(on, 'get on'), n(off, 'get off')].filter(Boolean).join(', ')}`, this.world.centerOf(stop));
    }
  }

  alight(a) {
    if (!this.world.structures.has(a.trip.dest)) return this.arriveHome(a); // the stop is gone
    this.beginLeg(a, a.trip.back);
    a.state = 'back';
  }

  // The nearest stop or station in walking range with rides off the map:
  // { stop, route } or null.
  transitRoute(home) {
    const { world } = this;
    const buses = world.roadExits().length > 0, trains = world.railExits().length > 0;
    if (!buses && !trains) return null;
    let best = null;
    for (const s of world.structures.values()) {
      const def = STRUCTURE_TYPES[s.type];
      if (!(buses && def?.busStop) && !(trains && def?.railStop)) continue;
      const route = this.walk.route(home, s, best ? Math.min(best.route.cost, this.config.walk.maxDistance) : this.config.walk.maxDistance);
      if (route && (!best || route.cost < best.route.cost)) best = { stop: s, route };
    }
    return best;
  }

  // ----- level crossings -----

  // How far along its leg an agent may go: in front of the next closed
  // level crossing (behind whoever already queues there), or Infinity.
  // Anyone already at or over the line when it closes carries on across.
  crossingStop(a, leg) {
    const closed = this.trains?.closed;
    if (!closed?.size) {
      a.waitKey = null;
      return Infinity;
    }
    const cfg = this.trains.crossing;
    const kind = a.trip.mode === 'drive' ? 'drive' : a.trip.mode === 'cycle' ? 'cycle' : 'walk';
    const version = this.trains.crossingVersion;
    if (leg.crossVersion !== version) {
      leg.crossings = this.trains.crossingsAlong(leg, 0.25);
      leg.crossVersion = version;
    }
    for (const c of leg.crossings) {
      const line = c.at - cfg.gap[kind];
      if (line < a.s - 1e-6) continue; // passed it, or already on it
      if (line - a.s > 1.5) break;     // the next one is still far off
      if (!closed.has(c.id)) break;
      const key = `${c.id}|${c.dir}|${kind}`;
      if (a.waitKey !== key) {
        a.waitKey = key;
        a.slot = this.queues.get(key) ?? 0;
        this.queues.set(key, a.slot + (a.truck || a.bus ? 2 : 1)); // a truck or a bus takes two places
      }
      return line - a.slot * cfg.queue[kind];
    }
    a.waitKey = null;
    return Infinity;
  }

  // ----- map exits -----

  // A point just off the map beyond an exit.
  offMap({ node, dir }, dist = 1.8) {
    const [x, y] = this.world.grid.xy(node);
    return [x + dir[0] * dist, y + dir[1] * dist];
  }

  pickExit() {
    const exits = this.world.roadExits();
    return exits.length ? exits[Math.floor(Math.random() * exits.length)] : null;
  }

  // Residents off the map: by bus / train from a stop in walking range
  // (sometimes, config.transit), else a drive out through an exit (and, on the
  // way back, the same way in).
  planLeave(home, why = 'leaves the city', commute = false, transit = true) {
    // (no cars: the bus or train it is, or nothing)
    if (transit && (Math.random() < this.config.transit.share || !can('cars'))) {
      const ride = this.transitRoute(home);
      if (ride) {
        const how = STRUCTURE_TYPES[ride.stop.type].railStop ? 'train' : 'bus';
        this.log(`${codeOf(home)} resident ${why} · ${how} from ${codeOf(ride.stop)}`, this.world.grid.xy(home.node));
        return { dest: ride.stop.id, plan: { mode: 'walk', ...ride.route, transit: { stop: ride.stop.id }, commute } };
      }
    }
    if (!can('cars')) return null;
    const exit = this.pickExit();
    const from = this.world.accessInfo(home);
    if (!exit || !from) return null;
    const nodes = findPath(this.world.networks.road, from.road, exit.node);
    if (!nodes) return null;
    this.log(`${codeOf(home)} resident ${why} · exit ${compass(exit.dir)}`, this.world.grid.xy(home.node));
    return { dest: null, plan: { mode: 'drive', nodes, fromDoor: from.door, toPoint: this.offMap(exit), outside: true, exit, commute } };
  }

  updateVisitors(dt) {
    const cfg = this.config.visitors;
    const exits = this.world.roadExits();
    const size = Math.min(1, this.world.structures.size / cfg.fullCity);
    if (!exits.length || size === 0 || !can('cars')) return;
    if ((this.visitorTimer -= dt) > 0) return;
    // average gap between arrivals: interval per exit, scaled by city size
    this.visitorTimer = (cfg.interval / exits.length / size / (this.weather().visitors ?? 1)) * (0.5 + Math.random());
    if (this.visitorCount() < cfg.max) this.spawnVisitor();
  }

  // More jobs than residents: people from outside fill the gap, arriving
  // every commute.interval / (missing workers) seconds on average.
  updateCommuters(dt) {
    const { residents, jobs } = this.balance();
    const missing = jobs - residents;
    if (missing <= 0 || !this.world.roadExits().length || !can('cars')) return;
    if ((this.commuteTimer -= dt) > 0) return;
    this.commuteTimer = (this.config.commute.interval / missing) * (0.5 + Math.random());
    if (this.commuterCount().inbound < Math.min(missing, this.config.commute.max)) this.spawnVisitor({ commuter: true });
  }

  // Delivery trucks from outside, more often in a bigger city (like visitors).
  updateDeliveries(dt) {
    const cfg = this.config.trucks;
    const size = Math.min(1, this.world.structures.size / this.config.visitors.fullCity);
    if (!this.world.roadExits().length || size === 0 || !can('trucks')) return;
    if ((this.deliveryTimer -= dt) > 0) return;
    this.deliveryTimer = (cfg.deliveryInterval / size) * (0.5 + Math.random());
    let n = 0;
    for (const a of this.agents.values()) if (a.truck && a.visitor) n++;
    if (n < cfg.deliveryMax) this.spawnVisitor({ truck: true });
  }

  spawnVisitor({ commuter = false, truck = false } = {}) {
    const { world } = this;
    const exit = this.pickExit();
    const places = commuter ? this.balance().workplaces.slice()
      : this.candidates({ id: null }, truck ? this.config.trucks.destinations : this.config.visitors.destinations);
    for (let attempt = 0; attempt < 4 && exit && places.length; attempt++) {
      const dest = places.splice(Math.floor(Math.random() * places.length), 1)[0];
      const to = world.accessInfo(dest);
      if (!to) continue;
      const nodes = findPath(world.networks.road, exit.node, to.road);
      if (!nodes) continue;
      const id = `v${++this.visitorSeq}`;
      const a = newAgent({ id, visitor: true, commuter, truck, state: 'out' });
      a.trip = this.buildTrip({ mode: 'drive', nodes, fromPoint: this.offMap(exit), toDoor: to.door }, dest.id);
      a.trip.visitor = true;
      a.trip.commuter = commuter;
      a.trip.truck = truck;
      const who = commuter ? 'Commuter' : truck ? 'Delivery truck' : 'V';
      this.log(`${who}-${String(this.visitorSeq).padStart(3, '0')} arrives · exit ${compass(exit.dir)} → ${codeOf(dest)}`, world.grid.xy(exit.node));
      this.beginLeg(a, a.trip.out);
      this.agents.set(id, a);
      return true;
    }
    return false;
  }

  // ----- buses -----

  // Bus stops by a road: [{ s, road }].
  busStops() {
    const out = [];
    for (const s of this.world.structures.values()) {
      if (!STRUCTURE_TYPES[s.type]?.busStop) continue;
      const at = this.world.accessInfo(s);
      if (at) out.push({ s, road: at.road });
    }
    return out;
  }

  busCount() {
    let n = 0;
    for (const a of this.agents.values()) if (a.bus) n++;
    return n;
  }

  // A bus every so often (more often with more stops), while there are
  // stops and a road off the map.
  updateBuses(dt) {
    const cfg = this.config.buses;
    if (!can('buses')) return;
    if ((this.busTimer -= dt) > 0) return;
    const stops = this.busStops();
    if (!stops.length || !this.world.roadExits().length) {
      this.busTimer = 9;
      return;
    }
    this.busTimer = (cfg.interval / Math.sqrt(stops.length)) * (0.5 + Math.random());
    if (this.busCount() < Math.min(cfg.max, stops.length)) this.spawnBus(stops);
  }

  // In through a random exit, then up to maxStops stops (a random pick,
  // nearest next), out through an exit it can reach.
  spawnBus(stops) {
    const { world } = this;
    const cfg = this.config.buses;
    const layer = world.networks.road;
    const entry = this.pickExit();
    if (!entry) return false;
    const pick = stops.slice();
    for (let i = pick.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pick[i], pick[j]] = [pick[j], pick[i]];
    }
    const left = pick.slice(0, cfg.maxStops);
    const segs = [], calls = [];
    let at = entry.node;
    while (left.length) {
      const [px, py] = world.grid.xy(at);
      const far = ({ road }) => {
        const [x, y] = world.grid.xy(road);
        return (x - px) ** 2 + (y - py) ** 2;
      };
      left.sort((a, b) => far(a) - far(b));
      const stop = left.shift();
      if (stop.road === at) continue;
      const nodes = findPath(layer, at, stop.road);
      if (!nodes) continue;
      segs.push(nodes);
      calls.push(stop.s);
      at = stop.road;
    }
    if (!calls.length) return false;
    const exits = world.roadExits().slice();
    let exit = null;
    while (exits.length && !exit) {
      const e = exits.splice(Math.floor(Math.random() * exits.length), 1)[0];
      const nodes = e.node !== at && findPath(layer, at, e.node);
      if (nodes) {
        segs.push(nodes);
        exit = e;
      }
    }
    if (!exit) return false;

    // one route; call k is where segment k ends
    const nodes = segs[0].slice();
    const callAt = [];
    for (let k = 1; k < segs.length; k++) {
      callAt.push(nodes.length - 1);
      nodes.push(...segs[k].slice(1));
    }
    // legs, split where it turns back at a stop
    const bounds = [0, ...callAt.filter((i) => nodes[i - 1] === nodes[i + 1]), nodes.length - 1];
    const half = cfg.length / 2; // stops with its middle at the stop
    const legs = [];
    for (let j = 0; j + 1 < bounds.length; j++) {
      const [b0, b1] = [bounds[j], bounds[j + 1]];
      const last = j + 2 === bounds.length;
      const leg = this.buildTrip({
        mode: 'drive',
        nodes: nodes.slice(b0, b1 + 1),
        fromPoint: j === 0 ? this.offMap(entry) : undefined,
        toPoint: last ? this.offMap(exit) : undefined,
      }, null).out;
      const onLeg = [];
      let from = 0;
      callAt.forEach((i, k) => {
        if (i <= b0 || i > b1) return;
        if (i === b1) return onLeg.push({ id: calls[k].id, at: leg.total });
        const [x, y] = world.grid.xy(nodes[i]);
        from = this.nearestAlong(leg, x, y, from);
        onLeg.push({ id: calls[k].id, at: Math.min(leg.total, leg.cum[from] + half) });
      });
      legs.push({ leg, calls: onLeg });
    }

    const id = `b${++this.busSeq}`;
    const a = newAgent({ id, visitor: true, bus: true, state: 'out', legs, leg: 0, call: 0, pause: 0, left: -Infinity });
    a.trip = { mode: 'drive', dest: null, outside: true, visitor: true, exit, nodes, out: legs[0].leg, back: null };
    this.beginLeg(a, a.trip.out);
    this.placeBus(a);
    this.agents.set(id, a);
    this.log(`Bus ${String(this.busSeq).padStart(3, '0')} arrives · exit ${compass(entry.dir)} · ${calls.length} ${calls.length === 1 ? 'stop' : 'stops'}`, world.grid.xy(entry.node));
    return true;
  }

  // Index of the point of `leg` from `from` on where it passes closest to
  // (x, y) – the first time it comes near.
  nearestAlong(leg, x, y, from) {
    const d = (k) => Math.hypot(leg.points[k][0] - x, leg.points[k][1] - y);
    let k = from;
    while (k < leg.points.length - 1 && d(k) > 0.3) k++;
    while (k < leg.points.length - 1 && d(k + 1) < d(k)) k++;
    return k;
  }

  // Move a bus on: easing into each stop, waiting there, pulling away, on
  // to its next leg where it turns back. false once it has left the map.
  moveBus(a, dt) {
    const cfg = this.config.buses;
    if (a.pause > 0) {
      if ((a.pause -= dt) > 0) return true;
      a.left = a.s;
      if (a.s >= a.trip.out.total - 1e-6 && a.leg + 1 < a.legs.length) {
        a.trip.out = a.legs[++a.leg].leg;
        a.call = 0;
        a.s = a.left = 0;
      }
    }
    const { leg, calls } = a.legs[a.leg];
    const next = calls[a.call];
    const target = next ? next.at : leg.total;
    const { doorSlowdown: zone, doorMinSpeed: min } = this.config.sim;
    const t = Math.max(0, Math.min(1, (a.s - a.left) / zone, next ? (target - a.s) / zone : 1));
    const ease = min + (1 - min) * t * t * (3 - 2 * t);
    const step = this.speedOf('drive') * cfg.speed * paceAt(leg, a.s) * a.followK * ease * dt;
    a.s = Math.min(a.s + Math.min(step, a.room), Math.max(a.s, this.crossingStop(a, leg)), target);
    this.placeBus(a);
    if (a.s < target - 1e-6) return true;
    if (!next) return false;
    a.call++;
    const there = this.world.structures.has(next.id);
    a.pause = there ? between(cfg.dwellMin, cfg.dwellMax) : 1e-3;
    if (there) this.transitCall(next.id);
    return true;
  }

  // A bus's front on its leg and its back a bus length behind (straight
  // back from the start at first – or after turning round at a stop).
  placeBus(a) {
    const leg = a.trip.out;
    [a.x, a.y] = pointAt(leg, a.s);
    [a.tx, a.ty] = backPoint(leg, a.s, this.config.buses.length);
  }

  // Visitors leave through a random exit, not necessarily the one they came in by.
  planDeparture(a) {
    const { world } = this;
    const dest = world.structures.get(a.trip.dest);
    const from = dest && world.accessInfo(dest);
    const exit = this.pickExit();
    if (!from || !exit) return false;
    const nodes = findPath(world.networks.road, from.road, exit.node);
    if (!nodes) return false;
    const leave = this.buildTrip({ mode: 'drive', nodes, fromDoor: from.door, toPoint: this.offMap(exit) }, null);
    a.trip.back = leave.out;
    a.trip.nodes = nodes;
    if (!a.truck) this.log(`V-${a.id.slice(1).padStart(3, '0')} leaves · exit ${compass(exit.dir)}`, world.grid.xy(exit.node));
    return true;
  }

  // A truck's run from its depot: export off the map, or a service run.
  startTruckTrip(a, home) {
    const cfg = this.config.trucks;
    if (Math.random() < cfg.exportShare) {
      const exit = this.pickExit();
      const from = this.world.accessInfo(home);
      const nodes = exit && from && findPath(this.world.networks.road, from.road, exit.node);
      if (nodes) {
        this.log(`${codeOf(home)} truck exports goods · exit ${compass(exit.dir)}`, this.world.grid.xy(home.node));
        return this.begin(a, { mode: 'drive', nodes, fromDoor: from.door, toPoint: this.offMap(exit), outside: true, exit, truck: true }, null);
      }
    }
    const places = this.candidates(home, [cfg.destinations[Math.floor(Math.random() * cfg.destinations.length)]]);
    for (let attempt = 0; attempt < 4 && places.length; attempt++) {
      const dest = places.splice(Math.floor(Math.random() * places.length), 1)[0];
      const drive = this.driveRoute(home, dest);
      if (drive) return this.begin(a, { ...drive, truck: true }, dest.id);
    }
    return false;
  }

  // Structures matching any of `names` (ids or tags), excluding home.
  // A fresh list (callers take from it) of the other structures matching
  // `names`. Every trip out asks, so the matches are kept per set of names
  // until a structure is built, removed or converted (world.structureVersion).
  candidates(home, names = []) {
    if (!names.length) return [];
    const version = this.world.structureVersion ?? 0;
    if (this.matchedVersion !== version) {
      this.matchedVersion = version;
      this.matched = new Map();
    }
    const key = names.join('|');
    let all = this.matched.get(key);
    if (!all) {
      all = [];
      for (const s of this.world.structures.values()) {
        const def = STRUCTURE_TYPES[s.type];
        if (names.some((n) => matches(def, n))) all.push(s);
      }
      this.matched.set(key, all);
    }
    return all.filter((s) => s.id !== home.id);
  }

  // Sets off from home: true (a trip out), another state to switch to, or
  // false when nothing could be done (try again shortly).
  startTrip(a) {
    const home = this.world.structures.get(a.home);
    if (!home) return false;
    if (a.truck) return this.startTruckTrip(a, home);
    if (a.retry) { // gave up waiting for a bus / train: drive instead
      const { commute } = a.retry;
      a.retry = null;
      const leave = this.planLeave(home, commute ? 'goes to work outside' : 'leaves the city', commute, false);
      if (leave) return this.begin(a, leave.plan, leave.dest);
    }
    const weights = { ...this.config.activities[this.profile(home)] };
    for (const [k, f] of Object.entries(this.weather().activities ?? {})) if (k in weights) weights[k] *= f;
    for (;;) {
      const pick = pickWeighted(weights);
      if (!pick) return false;
      delete weights[pick];
      const next = this.activity(pick, a, home);
      if (next) return next;
    }
  }

  // One activity (see config.activities): as startTrip, null if it can't happen.
  activity(kind, a, home) {
    const sim = STRUCTURE_TYPES[home.type]?.sim ?? {};
    const { walk } = this.config;
    switch (kind) {
      case 'stay':
        a.timer = this.homeDwell(home);
        return 'home';
      case 'porch':
        return this.startPorch(a, home);
      case 'stroll': {
        const loop = this.walk.stroll(home, walk.strollMin, walk.strollMax);
        return loop && this.begin(a, { mode: 'stroll', purpose: 'stroll', ...loop }, null);
      }
      case 'park': {
        const [hx, hy] = this.world.grid.xy(home.node);
        const near = (s) => {
          const [x, y] = this.world.grid.xy(s.node);
          return Math.hypot(x - hx, y - hy);
        };
        const places = this.candidates(home, sim.leisure ?? this.config.activities.leisure)
          .filter((s) => near(s) <= walk.maxDistance)
          .sort((p, q) => near(p) - near(q))
          .slice(0, 5);
        while (places.length) {
          const place = places.splice(Math.floor(Math.random() * places.length), 1)[0];
          const route = this.walk.route(home, place, walk.maxDistance);
          if (route) return this.begin(a, { mode: 'stroll', purpose: 'park', linger: true, ...route }, place.id);
        }
        return null;
      }
      case 'lunch':
        return this.activity('park', a, home) || this.activity('stroll', a, home);
      case 'errand':
        return this.goTo(a, home, this.config.activities.errands, 'errand');
      case 'work': {
        const lives = STRUCTURE_TYPES[home.type].stats?.residents;
        if (lives && Math.random() < this.outboundShare()) { // not enough jobs in town
          const leave = this.planLeave(home, 'goes to work outside', true);
          if (leave) return this.begin(a, leave.plan, leave.dest);
        }
        return this.goTo(a, home, sim.destinations, 'work');
      }
      case 'leave': {
        const leave = this.planLeave(home);
        return leave && this.begin(a, leave.plan, leave.dest);
      }
      case 'delivery': {
        if (!can('cars')) return null;
        const places = this.candidates(home, sim.destinations);
        for (let attempt = 0; attempt < 4 && places.length; attempt++) {
          const dest = places.splice(Math.floor(Math.random() * places.length), 1)[0];
          const drive = this.driveRoute(home, dest);
          if (drive) return this.begin(a, { ...drive, purpose: 'errand' }, dest.id);
        }
        return null;
      }
    }
    return null;
  }

  // To a random structure matching `names`, walking, cycling or driving.
  goTo(a, home, names, purpose) {
    const places = this.candidates(home, names);
    for (let attempt = 0; attempt < 4 && places.length; attempt++) {
      const dest = places.splice(Math.floor(Math.random() * places.length), 1)[0];
      const plan = this.planCommute(home, dest);
      if (plan) return this.begin(a, { ...plan, purpose }, dest.id);
    }
    return null;
  }

  planCommute(home, dest) {
    const { comfortDistance, maxDistance, longWalkChance } = this.config.walk;
    const walk = this.walk.route(home, dest, maxDistance);
    if (walk && (walk.cost <= comfortDistance || Math.random() < longWalkChance)) return { mode: 'walk', ...walk };
    const ride = this.ride.route(home, dest, this.config.bike.maxDistance);
    if (ride && Math.random() < this.bikeChance(ride.cost)) return { mode: 'cycle', ...(walk ?? ride) };
    const drive = can('cars') && this.driveRoute(home, dest);
    if (drive) return drive;
    if (walk) return { mode: 'walk', ...walk };
    return ride && { mode: 'cycle', ...ride };
  }

  // Chance of cycling a trip of length d rather than driving it (fewer in
  // the rain).
  bikeChance(d) {
    const { near, far, nearShare, farShare, share } = this.config.bike;
    const f = this.weather().bike ?? 1;
    if (d <= near) return nearShare * f;
    if (d <= far) return (nearShare + ((d - near) / (far - near)) * (farShare - nearShare)) * f;
    return share * f;
  }

  // How the weather now changes what people do (config.weather.people; {}
  // in fair weather).
  weather() {
    return this.config.weather?.people?.[this.world.weather?.kind] ?? {};
  }

  // ----- traffic -----

  // Every frame: how far each vehicle and cyclist may go before it is up
  // against whoever is in front of it (a.room) and how fast, as a share
  // (a.followK) – braking over traffic.brake, stopping traffic.gap behind.
  // Each is a stretch from its back to its front (a car's middle is a.x /
  // a.y, a truck's or bus's front, its back a.tx / a.ty); it looks ahead
  // of its front, straight on, for a part of another within its lane
  // (sideways less than traffic.lane of their two half-widths, up to
  // traffic.look ahead) or, crossing its way, of their whole width (up to
  // traffic.across). Oncoming ones
  // are passed; one pulling out of a driveway or turning into one is off
  // the road for everyone else, but still gives way itself. Two held up by
  // each other across a junction: the nearer goes; held up by someone across
  // its way longer than traffic.creep, it edges on through anyway – held up
  // in its lane, only after traffic.stall (longer than a bus stands at a
  // stop or a level crossing stays closed).
  // Looked up in a grid of traffic.cell squares; nothing is allocated.
  follow(dt) {
    const cfg = this.config.traffic;
    const list = (this.followList ??= []);
    const heads = (this.followHeads ??= new Map());
    list.length = 0;
    heads.clear();
    const cell = cfg.cell;
    const key = (x, y) => Math.floor(x / cell) * 4096 + Math.floor(y / cell);
    for (const a of this.agents.values()) {
      if (a.state !== 'out' && a.state !== 'back') continue;
      const mode = a.trip.mode;
      if (mode !== 'drive' && mode !== 'cycle') continue;
      const leg = a.state === 'out' ? a.trip.out : a.trip.back;
      const [x0, y0] = pointAt(leg, a.s - 0.03), [x1, y1] = pointAt(leg, a.s + 0.03);
      const l = Math.hypot(x1 - x0, y1 - y0);
      if (l > 1e-6) [a.hx, a.hy] = [(x1 - x0) / l, (y1 - y0) / l];
      if (a.truck || a.bus) {
        [a.fx, a.fy, a.bx, a.by] = [a.x, a.y, a.tx, a.ty];
        a.half = a.bus ? 0.044 : 0.042;
        a.nose = 0;
        a.len = a.bus ? this.config.buses.length : this.config.trucks.trailer;
      } else {
        const len = mode === 'drive' ? 0.085 : 0.03;
        [a.fx, a.fy, a.bx, a.by] = [a.x + a.hx * len, a.y + a.hy * len, a.x - a.hx * len, a.y - a.hy * len];
        a.half = mode === 'drive' ? 0.037 : 0.012;
        a.nose = len;
        a.len = 2 * len;
      }
      // how fast it went last frame (grid steps per second)
      a.v = dt > 0 ? Math.hypot(a.x - a.px, a.y - a.py) / dt : 0;
      [a.px, a.py] = [a.x, a.y];
      // off the road: on its way out of a driveway, or into one
      a.aside = (leg.doorStart && a.s < 0.4) || (leg.doorEnd && leg.total - a.s < 0.3);
      a.blocker = null;
      const k = key((a.fx + a.bx) / 2, (a.fy + a.by) / 2);
      a.next = heads.get(k) ?? -1;
      heads.set(k, list.length);
      list.push(a);
    }
    const { look, across: lookAcross, lane } = cfg;
    for (const a of list) {
      const { fx, fy, hx, hy } = a;
      const ax = (fx + a.bx) / 2, ay = (fy + a.by) / 2;
      const mx = fx + hx * look / 2, my = fy + hy * look / 2;
      const cx = Math.floor(mx / cell), cy = Math.floor(my / cell);
      let ahead = Infinity, across = Infinity, blocker = null, leader = null;
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (let j = cy - 1; j <= cy + 1; j++) {
          for (let n = heads.get(i * 4096 + j) ?? -1, b; n >= 0; n = b.next) {
            b = list[n];
            if (b === a || b.aside) continue;
            const along = hx * b.hx + hy * b.hy;
            if (along < -0.3) continue; // oncoming
            const crossing = along < 0.7;
            if (crossing ? a.creep > 0 : a.slip > 0) continue;
            // going the same way: only one whose middle is ahead (so two side by side don't hold each other up)
            if (!crossing && ((b.fx + b.bx) / 2 - ax) * hx + ((b.fy + b.by) / 2 - ay) * hy <= 0) continue;
            const lim = crossing ? a.half + b.half : lane * (a.half + b.half);
            for (let p = 0; p < 3; p++) {
              const px = (p === 0 ? b.bx : p === 1 ? (b.bx + b.fx) / 2 : b.fx) - fx;
              const py = (p === 0 ? b.by : p === 1 ? (b.by + b.fy) / 2 : b.fy) - fy;
              const d = px * hx + py * hy;
              if (d < -0.03 || d > (crossing ? lookAcross : look) || Math.abs(px * hy - py * hx) >= lim) continue;
              if (!crossing) { if (d < ahead) [ahead, leader] = [d, b]; }
              else if (d < across) [across, blocker] = [d, b];
            }
          }
        }
      }
      a.ahead = ahead;
      a.across = across;
      a.leader = leader;
      a.blocker = blocker;
    }
    const { brake } = cfg;
    for (const a of list) {
      let near = a.ahead;
      const b = a.blocker;
      // held up by each other across a junction: the nearer goes
      const yields = b && !(b.blocker === a && (a.across < b.across || (a.across === b.across && a.id < b.id)));
      if (yields) near = Math.min(near, a.across);
      let room = near - cfg.gap[a.trip.mode === 'cycle' ? 'cycle' : 'drive'];
      // in a queue that stands: not in a junction (others would have to
      // wait for it), but short of it until there's room past it
      const lead = a.leader;
      if (lead && near === a.ahead && lead.v < 0.05) {
        const { boxes } = a.state === 'out' ? a.trip.out : a.trip.back;
        const front = a.s + a.nose;
        for (let i = 0; boxes && i < boxes.length; i += 2) {
          const [e, x] = [boxes[i], boxes[i + 1]];
          if (e > front + room) break;
          if (front <= e && front + room - a.len < x) {
            room = e - front;
            break;
          }
        }
      }
      a.room = Math.max(0, room);
      const target = Math.max(0, Math.min(1, room / brake));
      a.followK = target < a.followK ? target : Math.min(target, a.followK + dt * 1.5); // pulls away gently
      if (a.creep > 0) a.creep -= dt;
      else if (yields && a.across <= a.ahead && room < 0.02) {
        if ((a.held += dt) > cfg.creep) [a.held, a.creep] = [0, 1.5];
      } else a.held = 0;
      // (and should a queue ever close on itself: after traffic.stall, on)
      if (a.slip > 0) a.slip -= dt;
      else if (room < 0.02 && a.ahead < a.across) {
        if ((a.stall += dt) > cfg.stall) [a.stall, a.slip] = [0, 2];
      } else a.stall = 0;
    }
  }

  driveRoute(home, dest) {
    const from = this.world.accessInfo(home);
    const to = this.world.accessInfo(dest);
    if (!from || !to) return null;
    const nodes = findPath(this.world.networks.road, from.road, to.road);
    return nodes && { mode: 'drive', nodes, fromDoor: from.door, toDoor: to.door };
  }

  begin(a, plan, destId) {
    a.trip = this.buildTrip(plan, destId);
    this.beginLeg(a, a.trip.out);
    if (plan.mode === 'drive' && !plan.truck) this.parking?.take(this.world.structures.get(a.home));
    return true;
  }

  // Door -> route nodes -> destination door (strolls end on the path).
  // Each leg keeps to the right-hand side of its line.
  buildTrip(plan, destId) {
    const { world, config } = this;
    const drive = plan.mode === 'drive';
    const layer = drive ? world.networks.road : world.networks.path;
    const curve = drive ? config.road : config.path;
    // on foot / by bike: the street's sidewalk or the road's lane where
    // there's roadway, near the middle of a footpath elsewhere
    const walker = plan.mode === 'cycle' ? config.bike : config.walk;
    const onRoad = this.roadway();
    const side = drive
      ? (p) => (onRoad(p) === 'lane' ? config.lane.laneOffset : config.sim.laneOffset)
      : (p) => {
        const where = onRoad(p);
        return where === 'lane' ? walker.laneOffset : where ? walker.sideOffset : walker.pathOffset;
      };

    // Only the route itself is smoothed; buildings are left and entered in a
    // straight line from their edge, so nobody cuts across them or their yard.
    const line = (nodes, fromPoint, toPoint, fromDoor, toDoor) => {
      const pts = nodes.map((n) => layer.pos(n));
      if (fromPoint) pts.unshift(fromPoint);
      if (toPoint) pts.push(toPoint);
      const first = fromPoint ? 1 : 0;
      const smooth = smoothPolyline(pts, (i) => this.cornerAt(plan.mode, nodes[i - first]), curve.curveSamples);
      if (fromDoor != null) smooth.unshift(this.doorEdge(fromDoor, smooth[0]));
      if (toDoor != null) smooth.push(this.doorEdge(toDoor, smooth[smooth.length - 1]));
      return smooth;
    };
    const atDoor = !plan.toPoint && plan.toDoor != null;
    const smooth = line(plan.nodes, plan.fromPoint, plan.toPoint, plan.fromDoor, atDoor ? plan.toDoor : null);
    // loop walks come home another way (backNodes, ending at backDoor)
    const back = plan.backNodes ? line(plan.backNodes, null, null, null, plan.backDoor) : smooth.slice().reverse();
    const home = plan.backNodes ? plan.backDoor != null : plan.fromDoor != null;

    return {
      mode: plan.mode,
      dest: destId,
      purpose: plan.purpose ?? null,
      outside: !!plan.outside,
      commute: !!plan.commute, // resident working outside the map
      truck: !!plan.truck,
      linger: !!plan.linger,   // wanders about the destination (a park)
      transit: plan.transit ?? null, // { stop }: waits there for a bus / train
      exit: plan.exit ?? null,
      nodes: plan.nodes,
      backNodes: plan.backNodes ?? null,
      out: this.leg(offsetPolyline(smooth, side), plan.fromDoor != null, atDoor, drive),
      back: this.leg(offsetPolyline(back, side), plan.backNodes ? false : atDoor, home, drive),
    };
  }

  // How much a route rounds its turn at node n: like the drawn roads and
  // paths – curved where the line just bends, (almost) sharp at junctions,
  // so nobody takes a shortcut across a crossroads.
  cornerAt(mode, n) {
    const { world, config } = this;
    if (mode === 'drive') {
      return n === undefined || world.roads.degree(n) === 2 ? config.road.cornerRadius : config.road.junctionRadius;
    }
    const { cornerRadius, junctionRadius } = config.path;
    if (n === undefined) return cornerRadius;
    const c = world.fineToCoarse(n);
    const onRoad = c >= 0 && world.roads.hasNode(c);
    const pathDeg = world.paths.degree(n);
    if (!onRoad && pathDeg === 0) {
      // a park's hub: as its walkways are drawn (roads/siteWalks.js)
      const s = world.structureAt(world.coarseAround(n)[0]);
      const paths = s && STRUCTURE_TYPES[s.type]?.site && world.sitePaths(s);
      if (paths?.hub === n) return hubRadius(paths.exits);
    }
    if (!onRoad) return pathDeg === 2 ? cornerRadius : junctionRadius;
    return pathDeg === 0 && world.roads.degree(c) === 2 ? cornerRadius : junctionRadius; // along a street
  }

  // The roadway test (roads/geometry.js), rebuilt when roads, paths or
  // sidewalks change.
  roadway() {
    const { world, config } = this;
    const key = `${world.networks.road.version}|${world.networks.path.version}|${world.sidewalks.size}|${world.lanes.size}`;
    if (this.roadwayKey !== key) {
      this.roadwayKey = key;
      this.roadwayTest = roadway(world, config.road, config.lane);
    }
    return this.roadwayTest;
  }

  // A measured leg, remembering which of its ends is at a building's door;
  // a drive's with its pace.
  leg(points, doorStart, doorEnd, drive = false) {
    const leg = { ...measurePolyline(points), doorStart, doorEnd, pace: null, boxes: null };
    if (drive) {
      leg.pace = this.pace(leg);
      leg.boxes = this.boxes(leg);
    }
    return leg;
  }

  // Where a leg goes through junctions (three roads or more): within
  // traffic.box of the dot. [in, out, in, out…] arc lengths, in order.
  boxes(leg) {
    const { world } = this;
    const r = this.config.traffic.box, step = 0.04;
    const out = [];
    let inside = false;
    for (let s = 0; s <= leg.total + step; s += step) {
      const [x, y] = pointAt(leg, Math.min(s, leg.total));
      const [i, j] = [Math.round(x), Math.round(y)];
      const n = world.grid.inBounds(i, j) ? world.grid.index(i, j) : -1;
      const here = n >= 0 && (x - i) ** 2 + (y - j) ** 2 < r * r && world.roads.hasNode(n) && world.roads.degree(n) >= 3;
      if (here !== inside) out.push(Math.min(s, leg.total));
      inside = here;
    }
    if (inside) out.push(leg.total);
    return out;
  }

  // The share of full speed at each point of a drive's leg: 1 on an open
  // road, sim.village through the village (a street, or a building within
  // sim.villageReach of the road), lane.speed on a single-track lane.
  // Changes are spread over traffic.ramp grid steps – slowing down before
  // the village, speeding up after it.
  pace(leg) {
    const { world, config } = this;
    const onRoad = this.roadway();
    const { village, villageReach: r } = config.sim;
    const built = (x, y) => {
      for (let j = Math.ceil(y - r); j <= y + r; j++) {
        for (let i = Math.ceil(x - r); i <= x + r; i++) {
          if ((i - x) ** 2 + (j - y) ** 2 <= r * r && world.grid.inBounds(i, j) && world.structureAt(world.grid.index(i, j))) return true;
        }
      }
      return false;
    };
    const { points, cum } = leg;
    const n = points.length;
    const k = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      const where = onRoad(points[i]);
      if (where === 'lane') k[i] = config.lane.speed;
      else if (where) k[i] = where === 'street' || built(...points[i]) ? village : 1;
    }
    // off the road (a door, off the map): as the road next to it
    for (let i = 1; i < n; i++) if (Number.isNaN(k[i])) k[i] = k[i - 1];
    for (let i = n - 2; i >= 0; i--) if (Number.isNaN(k[i])) k[i] = k[i + 1];
    if (Number.isNaN(k[0])) k.fill(1);
    const ramp = config.traffic.ramp;
    for (let i = 1; i < n; i++) k[i] = Math.min(k[i], k[i - 1] + (cum[i] - cum[i - 1]) / ramp);
    for (let i = n - 2; i >= 0; i--) k[i] = Math.min(k[i], k[i + 1] + (cum[i + 1] - cum[i]) / ramp);
    return k;
  }

  // Cars and bikes pull away from and roll up to doors slowly: speed factor
  // from sim.doorMinSpeed at the door up to 1 over sim.doorSlowdown.
  doorEase(a, leg) {
    if (a.trip.mode !== 'drive' && a.trip.mode !== 'cycle') return 1;
    const { doorSlowdown: zone, doorMinSpeed: min } = this.config.sim;
    let t = 1;
    if (leg.doorStart) t = Math.min(t, a.s / zone);
    if (leg.doorEnd) t = Math.min(t, (leg.total - a.s) / zone);
    if (t >= 1) return 1;
    t = Math.max(0, t);
    return min + (1 - min) * t * t * (3 - 2 * t); // smoothstep
  }

  // Where the line from a building's door dot towards `to` leaves the building.
  doorEdge(door, to) {
    const [x, y] = this.world.grid.xy(door);
    const dx = to[0] - x, dy = to[1] - y;
    const l = Math.hypot(dx, dy);
    const pad = this.config.sim.doorPad;
    return l > pad ? [x + (dx / l) * pad, y + (dy / l) * pad] : to;
  }

  beginLeg(a, leg) {
    a.s = 0;
    a.followK = 1;
    a.room = Infinity;
    [a.x, a.y] = leg.points[0];
    [a.tx, a.ty] = [a.x, a.y];
  }

  tripIntact(trip) {
    const net = trip.mode === 'drive' ? this.world.roads : trip.mode === 'cycle' ? this.ride : this.walk;
    const ok = (nodes) => nodes.every((n, i) => net.hasNode(n) && (i === 0 || net.hasEdge(nodes[i - 1], n)));
    return ok(trip.nodes) && (!trip.backNodes || ok(trip.backNodes));
  }

  // After road / path edits, send anyone whose route no longer exists straight home.
  revalidate() {
    for (const a of this.agents.values()) {
      if (a.trip && !this.tripIntact(a.trip)) {
        if (a.visitor) {
          this.agents.delete(a.id);
          continue;
        }
        this.arriveHome(a);
      }
    }
  }
}

// States in which an agent is out and about (drawn).
const VISIBLE = new Set(['out', 'back', 'linger', 'wait']);

// The share of full speed at arc length s of a leg (its pace; 1 without).
function paceAt(leg, s) {
  const k = leg.pace;
  if (!k) return 1;
  const { cum } = leg;
  if (s <= 0) return k[0];
  if (s >= leg.total) return k[k.length - 1];
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const t = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
  return k[lo] + (k[hi] - k[lo]) * t;
}

// A new agent with every field it may get later, always in this order: the
// update and the renderer read them for thousands of agents every frame,
// and objects that grew the same fields in different orders (a car gets
// its traffic fields, a walker its wander…) make each of those reads a
// slow lookup in the engine. `fields` only sets some of them.
function newAgent(fields) {
  return Object.assign({
    id: null, home: null, state: 'home', timer: 0, trip: null, s: 0, x: 0, y: 0, tx: 0, ty: 0,
    visitor: false, commuter: false, truck: false, bus: false,
    followK: 1, room: Infinity, held: 0, creep: 0, stall: 0, slip: 0, fx: 0, fy: 0, bx: 0, by: 0, hx: 1, hy: 0, half: 0, next: -1,
    nose: 0, len: 0, px: 0, py: 0, v: 0, aside: false, leader: null, blocker: null, ahead: Infinity, across: Infinity,
    waitKey: null, slot: 0, wander: null, retry: null,
    legs: null, leg: 0, call: 0, pause: 0, left: 0,
  }, fields);
}

function between(min, max) {
  return min + Math.random() * (max - min);
}

// A picker of random points within r of (x, y).
function around(x, y, r) {
  return () => [x + (Math.random() * 2 - 1) * r, y + (Math.random() * 2 - 1) * r];
}

// A random key of { key: weight }, or null when none is left.
function pickWeighted(weights) {
  let total = 0;
  for (const w of Object.values(weights)) total += Math.max(0, w);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const [k, w] of Object.entries(weights)) if ((r -= Math.max(0, w)) < 0) return k;
  return null;
}
