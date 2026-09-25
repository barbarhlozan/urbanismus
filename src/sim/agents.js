// Moving dots. Each structure spawns `agents` (per level) people who travel
// from home to a random structure of a type listed in `def.sim.destinations`,
// wait there, and come back.
//
// Every trip picks a mode:
//   walk   – destination within comfortable walking distance over footpaths
//            and pavements (or reachable on foot only)
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
//   - visitors arrive through exits, drive to a destination (visitors.*),
//     stay, then leave through a random exit and are gone
//
// Drivers use parking lots without owning cars: leaving by car takes a parked
// car from the lot there (if any), arriving parks one (see sim/parking.js).
//
// Richer behaviour (schedules, needs, jobs, traffic) should replace
// startTrip / planCommute without changing how the renderer reads agents
// (it only needs visible() and x / y / trip.mode).

import { STRUCTURE_TYPES, levelOf, matches, codeOf } from '../../structures/index.js';
import { compass } from '../ui/annotations.js';
import { findPath } from '../roads/pathfinding.js';
import { smoothPolyline, offsetPolyline, measurePolyline, pointAt } from '../roads/geometry.js';
import { WalkNetwork } from './walking.js';

export class AgentSystem {
  constructor(world, config, parking = null) {
    this.world = world;
    this.config = config;
    this.parking = parking;
    this.agents = new Map();
    this.walk = new WalkNetwork(world, config); // registers its listeners first
    this.visitorTimer = 5;
    this.visitorSeq = 0;
    this.log = () => {}; // (text, [x, y]) – set by main to feed annotations

    world.events.on('structure:added', (s) => this.sync(s));
    world.events.on('structure:changed', (s) => this.sync(s));
    world.events.on('structure:removed', (s) => this.despawnFor(s));
    world.events.on('roads:changed', () => this.revalidate());
    world.events.on('paths:changed', () => this.revalidate());
    for (const s of world.structures.values()) this.sync(s);
  }

  // Match the number of agents to the structure's current level.
  sync(s) {
    const def = STRUCTURE_TYPES[s.type];
    const count = def ? levelOf(def, s).agents ?? 1 : 0;
    for (let k = 0; ; k++) {
      const id = `${s.id}:${k}`;
      if (k < count) {
        if (!this.agents.has(id)) {
          this.agents.set(id, { id, home: s.id, state: 'home', timer: this.dwell() * Math.random(), trip: null, s: 0, x: 0, y: 0 });
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
    for (const a of this.agents.values()) if (a.visitor) n++;
    return n;
  }

  *visible() {
    for (const a of this.agents.values()) if (a.state === 'out' || a.state === 'back') yield a;
  }

  dwell(mode, trip) {
    if (mode === 'stroll') return 0.5 + Math.random() * 1.5; // a short pause, then back
    if (trip?.outside) {
      const { outsideMin, outsideMax } = this.config.sim;
      return outsideMin + Math.random() * (outsideMax - outsideMin);
    }
    const { dwellMin, dwellMax } = trip?.visitor ? this.config.visitors : this.config.sim;
    return dwellMin + Math.random() * (dwellMax - dwellMin);
  }

  update(dt) {
    const { agentSpeed, walkSpeed } = this.config.sim;
    this.updateVisitors(dt);
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
          if (a.trip.mode === 'drive') this.parking?.take(this.world.structures.get(a.trip.dest));
          if (a.trip.outside) {
            const home = this.world.structures.get(a.home);
            if (home) this.log(`${codeOf(home)} resident returns · exit ${compass(a.trip.exit.dir)}`, this.world.grid.xy(a.trip.exit.node));
          }
          break;
        case 'out':
        case 'back': {
          a.s += (a.trip.mode === 'drive' ? agentSpeed : walkSpeed) * dt;
          const leg = a.state === 'out' ? a.trip.out : a.trip.back;
          [a.x, a.y] = pointAt(leg, a.s);
          if (a.s < leg.total) break;
          const arrived = a.trip.mode === 'stroll' || a.trip.outside || this.world.structures.has(a.trip.dest);
          if (a.trip.mode === 'drive') {
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
            a.timer = this.dwell();
          }
          break;
        }
      }
    }
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
  planLeave(home) {
    const exit = this.pickExit();
    const from = this.world.accessInfo(home);
    if (!exit || !from) return null;
    const nodes = findPath(this.world.networks.road, from.road, exit.node);
    if (!nodes) return null;
    this.log(`${codeOf(home)} resident leaves the city · exit ${compass(exit.dir)}`, this.world.grid.xy(home.node));
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

  spawnVisitor() {
    const { world } = this;
    const exit = this.pickExit();
    const places = this.candidates({ id: null }, this.config.visitors.destinations);
    for (let attempt = 0; attempt < 4 && exit && places.length; attempt++) {
      const dest = places.splice(Math.floor(Math.random() * places.length), 1)[0];
      const to = world.accessInfo(dest);
      if (!to) continue;
      const nodes = findPath(world.networks.road, exit.node, to.road);
      if (!nodes) continue;
      const id = `v${++this.visitorSeq}`;
      const a = { id, home: null, visitor: true, state: 'out', timer: 0, trip: null, s: 0, x: 0, y: 0 };
      a.trip = this.buildTrip({ mode: 'drive', nodes, fromPoint: this.offMap(exit), toDoor: to.door }, dest.id);
      a.trip.visitor = true;
      this.log(`V-${String(this.visitorSeq).padStart(3, '0')} arrives · exit ${compass(exit.dir)} → ${codeOf(dest)}`, world.grid.xy(exit.node));
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
    this.log(`V-${a.id.slice(1).padStart(3, '0')} leaves · exit ${compass(exit.dir)}`, world.grid.xy(exit.node));
    return true;
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
    const drive = this.driveRoute(home, dest);
    if (drive) return drive;
    return walk ? { mode: 'walk', ...walk } : null;
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
    if (plan.mode === 'drive') this.parking?.take(this.world.structures.get(a.home));
    return true;
  }

  // Door -> route nodes -> destination door (strolls end on the path).
  // Each leg keeps to the right-hand side of its line.
  buildTrip(plan, destId) {
    const { world, config } = this;
    const drive = plan.mode === 'drive';
    const layer = drive ? world.networks.road : world.networks.path;
    const curve = drive ? config.road : config.path;
    const side = drive ? config.sim.laneOffset : config.walk.sideOffset;

    const pts = [plan.fromPoint ?? world.grid.xy(plan.fromDoor), ...plan.nodes.map((n) => layer.pos(n))];
    if (plan.toPoint) pts.push(plan.toPoint);
    else if (plan.toDoor != null) pts.push(world.grid.xy(plan.toDoor));
    const smooth = smoothPolyline(pts, curve.cornerRadius, curve.curveSamples);

    return {
      mode: plan.mode,
      dest: destId,
      outside: !!plan.outside,
      exit: plan.exit ?? null,
      nodes: plan.nodes,
      out: measurePolyline(offsetPolyline(smooth, side)),
      back: measurePolyline(offsetPolyline(smooth.slice().reverse(), side)),
    };
  }

  beginLeg(a, leg) {
    a.s = 0;
    [a.x, a.y] = leg.points[0];
  }

  tripIntact(trip) {
    const { nodes } = trip;
    if (trip.mode === 'drive') {
      const { roads } = this.world;
      return nodes.every((n, i) => roads.hasNode(n) && (i === 0 || roads.hasEdge(nodes[i - 1], n)));
    }
    return nodes.every((n, i) => this.walk.hasNode(n) && (i === 0 || this.walk.hasEdge(nodes[i - 1], n)));
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
