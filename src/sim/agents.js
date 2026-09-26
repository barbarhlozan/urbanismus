// Moving dots. Each structure spawns `agents` (per level) people who travel
// from home to a random structure of a type listed in `def.sim.destinations`,
// wait there, and come back.
//
// Every trip picks a mode:
//   walk   – destination within comfortable walking distance over footpaths
//            and street sidewalks (or reachable on foot only)
//   cycle  – trips too long to walk, sometimes (bike.share), over footpaths
//            and every road (with sidewalks or not), faster and further
//   drive  – everything else, over the road network
//   stroll – residents sometimes go for a walk (chance: def.sim.strollChance):
//            to a park or square (def.sim.leisure) if one is in walking
//            range, otherwise just along footpaths and back
//
// Agent lifecycle:  home --(leg out)--> away --(leg back)--> home …
//
// Map exits (roads ending at the map edge, world.roadExits()):
//   - residents sometimes drive off the map (sim.leaveChance), stay away a
//     while and come back the same way
//   - jobs vs residents (config.commute): when the city has more residents
//     than jobs, that share of residents' trips go to work off the map; when
//     it has more jobs, commuters drive in to buildings with jobs, work a
//     shift and leave (see balance, updateCommuters)
//   - visitors arrive through exits, drive to a destination (visitors.*),
//     stay, then leave through a random exit and are gone
//
// Trucks (config.trucks, agent.truck): drivers too, drawn as a cab and a
// trailer (a.x / a.y and a.tx / a.ty). Industrial buildings keep a few
// (perLevel) that export goods off the map – out through an exit, away a
// while, back – or make service runs to businesses and other industry.
// Delivery trucks also arrive from outside like visitors (updateDeliveries).
// They don't use parking lots, and drive a bit slower than cars.
//
// Traffic: cars slow down where roads are crowded (config.traffic, see
// trafficSpeeds). Pedestrians and cyclists always move at their own pace.
//
// Drivers use parking lots without owning cars: leaving by car takes a parked
// car from the lot there (if any), arriving parks one (see sim/parking.js).
//
// Richer behaviour (schedules, needs, jobs) should replace
// startTrip / planCommute without changing how the renderer reads agents
// (it only needs visible() and x / y / trip.mode).

import { STRUCTURE_TYPES, levelOf, matches, codeOf } from '../../structures/index.js';
import { compass } from '../ui/annotations.js';
import { findPath } from '../roads/pathfinding.js';
import { smoothPolyline, offsetPolyline, measurePolyline, pointAt, roadway } from '../roads/geometry.js';
import { WalkNetwork } from './walking.js';

export class AgentSystem {
  constructor(world, config, parking = null) {
    this.world = world;
    this.config = config;
    this.parking = parking;
    this.agents = new Map();
    this.walk = new WalkNetwork(world, config); // registers its listeners first
    this.ride = new WalkNetwork(world, config, { allRoads: true }); // cyclists
    this.visitorTimer = 5;
    this.visitorSeq = 0;
    this.commuteTimer = 3;
    this.deliveryTimer = 12;
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

  // Match the number of agents (and trucks) to the structure's current level.
  sync(s) {
    const def = STRUCTURE_TYPES[s.type];
    const count = def ? levelOf(def, s).agents ?? 1 : 0;
    const trucks = this.config.trucks;
    const fleet = def && trucks.homes.some((n) => matches(def, n)) ? trucks.perLevel[(s.level ?? 1) - 1] ?? 0 : 0;
    this.syncCount(s, '', count, () => this.dwell() * Math.random());
    this.syncCount(s, 't', fleet, () => trucks.firstTrip * Math.random(), { truck: true });
  }

  syncCount(s, tag, count, timer, extra = {}) {
    for (let k = 0; ; k++) {
      const id = `${s.id}:${tag}${k}`;
      if (k < count) {
        if (!this.agents.has(id)) {
          this.agents.set(id, { id, home: s.id, state: 'home', timer: timer(), trip: null, s: 0, x: 0, y: 0, ...extra });
        }
      } else if (this.agents.has(id)) {
        this.agents.delete(id);
      } else {
        break;
      }
    }
  }

  despawnFor(s) {
    for (const [id, a] of this.agents) if (a.home === s.id && !a.visitor) this.agents.delete(id);
  }

  visitorCount() {
    let n = 0;
    for (const a of this.agents.values()) if (a.visitor && !a.commuter && !a.truck) n++;
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
      const stats = levelOf(STRUCTURE_TYPES[s.type], s).stats ?? {};
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
    for (const a of this.agents.values()) if (a.state === 'out' || a.state === 'back') yield a;
  }

  dwell(mode, trip) {
    if (trip?.truck) {
      const t = this.config.trucks;
      const [min, max] = trip.outside ? [t.outsideMin, t.outsideMax] : [t.dwellMin, t.dwellMax];
      return min + Math.random() * (max - min);
    }
    if (mode === 'stroll') return 0.5 + Math.random() * 1.5; // a short pause, then back
    if (trip?.commuter) {
      const { shiftMin, shiftMax } = this.config.commute;
      return shiftMin + Math.random() * (shiftMax - shiftMin);
    }
    if (trip?.outside) {
      const { outsideMin, outsideMax } = this.config.sim;
      return outsideMin + Math.random() * (outsideMax - outsideMin);
    }
    const { dwellMin, dwellMax } = trip?.visitor ? this.config.visitors : this.config.sim;
    return dwellMin + Math.random() * (dwellMax - dwellMin);
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
    const traffic = this.trafficSpeeds(dt);
    const closed = this.trains?.closed;
    for (const k of this.queues.keys()) if (!closed?.has(k.split('|')[0])) this.queues.delete(k);
    for (const [id, a] of this.agents) {
      switch (a.state) {
        case 'home':
          if ((a.timer -= dt) > 0) break;
          if (this.startTrip(a)) a.state = 'out';
          else a.timer = this.config.sim.retryDelay;
          break;
        case 'away':
          if ((a.timer -= dt) > 0) break;
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
        case 'out':
        case 'back': {
          const leg = a.state === 'out' ? a.trip.out : a.trip.back;
          const step = this.speedOf(a.trip.mode) * (a.trip.mode === 'drive' ? traffic(a) : 1) * this.doorEase(a, leg) * (a.truck ? this.config.trucks.speed : 1) * dt;
          a.s = Math.min(a.s + step, Math.max(a.s, this.crossingStop(a, leg)));
          [a.x, a.y] = pointAt(leg, a.s);
          if (a.truck) [a.tx, a.ty] = pointAt(leg, a.s - this.config.trucks.trailer);
          if (a.s < leg.total) break;
          const arrived = a.trip.mode === 'stroll' || a.trip.outside || this.world.structures.has(a.trip.dest);
          if (a.trip.mode === 'drive' && !a.truck) {
            this.parking?.park(this.world.structures.get(a.state === 'out' ? a.trip.dest : a.home));
          }
          if (a.state === 'out' && arrived) {
            a.state = 'away';
            a.timer = this.dwell(a.trip.mode, a.trip);
          } else if (a.visitor) {
            this.agents.delete(id); // left the map (or lost its destination)
          } else {
            a.state = 'home';
            a.trip = null;
            a.timer = a.truck ? this.dwell('drive', { truck: true }) : this.dwell();
          }
          break;
        }
      }
    }
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
        this.queues.set(key, a.slot + (a.truck ? 2 : 1)); // a truck takes two places
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

  // Residents' drive off the map (and, on the way back, the same way in).
  planLeave(home, why = 'leaves the city') {
    const exit = this.pickExit();
    const from = this.world.accessInfo(home);
    if (!exit || !from) return null;
    const nodes = findPath(this.world.networks.road, from.road, exit.node);
    if (!nodes) return null;
    this.log(`${codeOf(home)} resident ${why} · exit ${compass(exit.dir)}`, this.world.grid.xy(home.node));
    return { mode: 'drive', nodes, fromDoor: from.door, toPoint: this.offMap(exit), outside: true, exit };
  }

  updateVisitors(dt) {
    const cfg = this.config.visitors;
    const exits = this.world.roadExits();
    const size = Math.min(1, this.world.structures.size / cfg.fullCity);
    if (!exits.length || size === 0) return;
    if ((this.visitorTimer -= dt) > 0) return;
    // average gap between arrivals: interval per exit, scaled by city size
    this.visitorTimer = (cfg.interval / exits.length / size) * (0.5 + Math.random());
    if (this.visitorCount() < cfg.max) this.spawnVisitor();
  }

  // More jobs than residents: people from outside fill the gap, arriving
  // every commute.interval / (missing workers) seconds on average.
  updateCommuters(dt) {
    const { residents, jobs } = this.balance();
    const missing = jobs - residents;
    if (missing <= 0 || !this.world.roadExits().length) return;
    if ((this.commuteTimer -= dt) > 0) return;
    this.commuteTimer = (this.config.commute.interval / missing) * (0.5 + Math.random());
    if (this.commuterCount().inbound < Math.min(missing, this.config.commute.max)) this.spawnVisitor({ commuter: true });
  }

  // Delivery trucks from outside, more often in a bigger city (like visitors).
  updateDeliveries(dt) {
    const cfg = this.config.trucks;
    const size = Math.min(1, this.world.structures.size / this.config.visitors.fullCity);
    if (!this.world.roadExits().length || size === 0) return;
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
      const a = { id, home: null, visitor: true, commuter, truck, state: 'out', timer: 0, trip: null, s: 0, x: 0, y: 0 };
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
  candidates(home, names = []) {
    const out = [];
    if (!names.length) return out;
    for (const s of this.world.structures.values()) {
      const def = STRUCTURE_TYPES[s.type];
      if (s.id !== home.id && names.some((n) => matches(def, n))) out.push(s);
    }
    return out;
  }

  startTrip(a) {
    const home = this.world.structures.get(a.home);
    if (!home) return false;
    if (a.truck) return this.startTruckTrip(a, home);
    const { walk } = this.config;

    const sim = STRUCTURE_TYPES[home.type]?.sim ?? {};
    if (Math.random() < (sim.strollChance ?? 0)) {
      const places = Math.random() < walk.leisureShare ? this.candidates(home, sim.leisure) : [];
      while (places.length) {
        const place = places.splice(Math.floor(Math.random() * places.length), 1)[0];
        const route = this.walk.route(home, place, walk.maxDistance);
        if (route) return this.begin(a, { mode: 'stroll', ...route }, place.id);
      }
      const stroll = this.walk.stroll(home, walk.strollMin, walk.strollMax);
      if (stroll) return this.begin(a, { mode: 'stroll', ...stroll }, null);
    }

    // not enough jobs in town: go to work elsewhere
    const lives = levelOf(STRUCTURE_TYPES[home.type], home).stats?.residents;
    if (lives && Math.random() < this.outboundShare()) {
      const leave = this.planLeave(home, 'goes to work outside');
      if (leave) {
        leave.commute = true;
        return this.begin(a, leave, null);
      }
    }

    if (Math.random() < this.config.sim.leaveChance) {
      const leave = this.planLeave(home);
      if (leave) return this.begin(a, leave, null);
    }

    const candidates = this.candidates(home, sim.destinations);
    for (let attempt = 0; attempt < 4 && candidates.length; attempt++) {
      const dest = candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0];
      const plan = this.planCommute(home, dest);
      if (plan) return this.begin(a, plan, dest.id);
    }
    return false;
  }

  planCommute(home, dest) {
    const { comfortDistance, maxDistance, longWalkChance } = this.config.walk;
    const walk = this.walk.route(home, dest, maxDistance);
    if (walk && (walk.cost <= comfortDistance || Math.random() < longWalkChance)) return { mode: 'walk', ...walk };
    const bike = this.bikeRoute(home, dest, walk);
    if (bike) return bike;
    const drive = this.driveRoute(home, dest);
    if (drive) return drive;
    return walk ? { mode: 'walk', ...walk } : null;
  }

  bikeRoute(home, dest, walk) {
    const { share, maxDistance } = this.config.bike;
    if (Math.random() >= share) return null;
    const route = walk ?? this.ride.route(home, dest, maxDistance);
    return route && { mode: 'cycle', ...route };
  }

  // ----- traffic -----

  // Counts cars per grid cell and direction and returns (agent) -> speed
  // factor 0..1. A car looks at its own cell and the one just ahead; every
  // car there going the same way beyond `capacity` slows it down (oncoming
  // traffic doesn't). Factors ease towards their target so cars brake and
  // accelerate smoothly.
  trafficSpeeds(dt) {
    const { cell, capacity, slowdown, minSpeed, ease } = this.config.traffic;
    const key = ([x, y], dir) => (Math.round(x / cell) * 4096 + Math.round(y / cell)) * 4 + dir;
    const counts = new Map();
    const cars = [];
    for (const a of this.visible()) {
      if (a.trip.mode !== 'drive') continue;
      const leg = a.state === 'out' ? a.trip.out : a.trip.back;
      const ahead = pointAt(leg, Math.min(leg.total, a.s + 0.6 * cell));
      const dx = ahead[0] - a.x, dy = ahead[1] - a.y;
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 1) : dy > 0 ? 2 : 3;
      a.cell = key([a.x, a.y], dir);
      a.ahead = key(ahead, dir);
      counts.set(a.cell, (counts.get(a.cell) ?? 0) + 1);
      cars.push(a);
    }
    let sum = 0;
    for (const a of cars) {
      const here = counts.get(a.cell) - 1;
      const there = a.ahead === a.cell ? here : counts.get(a.ahead) ?? 0;
      const crowd = Math.max(0, Math.max(here, there) - capacity);
      const target = Math.max(minSpeed, (1 - slowdown) ** crowd);
      a.speed = a.speed ?? 1;
      a.speed += (target - a.speed) * Math.min(1, ease * dt);
      sum += a.speed;
    }
    this.flow = cars.length ? sum / cars.length : 1; // average car speed, 1 = free flowing
    return (a) => a.speed ?? 1;
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
    const onRoad = !drive && this.roadway();
    const side = drive ? config.sim.laneOffset : (p) => (onRoad(p) ? walker.sideOffset : walker.pathOffset);

    // Only the route itself is smoothed; buildings are left and entered in a
    // straight line from their edge, so nobody cuts across them or their yard.
    const pts = plan.nodes.map((n) => layer.pos(n));
    if (plan.fromPoint) pts.unshift(plan.fromPoint);
    if (plan.toPoint) pts.push(plan.toPoint);
    const first = plan.fromPoint ? 1 : 0;
    const radius = (i) => this.cornerAt(plan.mode, plan.nodes[i - first]);
    const smooth = smoothPolyline(pts, radius, curve.curveSamples);
    const atDoor = !plan.toPoint && plan.toDoor != null;
    if (plan.fromDoor != null) smooth.unshift(this.doorEdge(plan.fromDoor, smooth[0]));
    if (atDoor) smooth.push(this.doorEdge(plan.toDoor, smooth[smooth.length - 1]));

    return {
      mode: plan.mode,
      dest: destId,
      outside: !!plan.outside,
      commute: !!plan.commute, // resident working outside the map
      truck: !!plan.truck,
      exit: plan.exit ?? null,
      nodes: plan.nodes,
      out: this.leg(offsetPolyline(smooth, side), plan.fromDoor != null, atDoor),
      back: this.leg(offsetPolyline(smooth.slice().reverse(), side), atDoor, plan.fromDoor != null),
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
    if (!onRoad) return pathDeg === 2 ? cornerRadius : junctionRadius;
    return pathDeg === 0 && world.roads.degree(c) === 2 ? cornerRadius : junctionRadius; // along a street
  }

  // The roadway test (roads/geometry.js), rebuilt when roads, paths or
  // sidewalks change.
  roadway() {
    const { world, config } = this;
    const key = `${world.networks.road.version}|${world.networks.path.version}|${world.sidewalks.size}`;
    if (this.roadwayKey !== key) {
      this.roadwayKey = key;
      this.roadwayTest = roadway(world, config.road);
    }
    return this.roadwayTest;
  }

  // A measured leg, remembering which of its ends is at a building's door.
  leg(points, doorStart, doorEnd) {
    return { ...measurePolyline(points), doorStart, doorEnd };
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
    a.speed = 1;
    [a.x, a.y] = leg.points[0];
    [a.tx, a.ty] = [a.x, a.y];
  }

  tripIntact(trip) {
    const { nodes } = trip;
    if (trip.mode === 'drive') {
      const { roads } = this.world;
      return nodes.every((n, i) => roads.hasNode(n) && (i === 0 || roads.hasEdge(nodes[i - 1], n)));
    }
    const net = trip.mode === 'cycle' ? this.ride : this.walk;
    return nodes.every((n, i) => net.hasNode(n) && (i === 0 || net.hasEdge(nodes[i - 1], n)));
  }

  // After road / path edits, send anyone whose route no longer exists straight home.
  revalidate() {
    for (const a of this.agents.values()) {
      if (a.trip && !this.tripIntact(a.trip)) {
        if (a.visitor) {
          this.agents.delete(a.id);
          continue;
        }
        a.state = 'home';
        a.trip = null;
        a.timer = this.dwell();
      }
    }
  }
}
