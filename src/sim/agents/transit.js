// Who comes and goes from off the map (AgentSystem methods; see agents.js):
// visitors, commuters and deliveries, the buses and their stops, and
// leaving by the map's edge.

import { STRUCTURE_TYPES, codeOf } from '../../../structures/index.js';
import { compass } from '../../ui/annotations.js';
import { findPath } from '../../roads/pathfinding.js';
import { pointAt } from '../../roads/geometry.js';
import { can, backPoint, paceAt, newAgent, between } from './shared.js';
import { centerOf } from '../pose.js';

export class AgentTransit {
  // ----- bus and train rides -----

  // A bus or train calls at stop / station `id`: whoever waits there gets on,
  // whoever is coming back that way gets off.
  transitCall(id) {
    let on = 0, off = 0;
    for (const a of this.agents.values()) {
      if (a.trip?.transit?.stop !== id) continue;
      if (a.state === 'wait' && a.trip.transit.inbound) { // a commuter going home
        this.agents.delete(a.id);
        on++;
      } else if (a.state === 'wait') {
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
      this.log(`${codeOf(stop)} · ${[n(on, 'get on'), n(off, 'get off')].filter(Boolean).join(', ')}`, centerOf(this.world, stop));
    }
  }

  alight(a) {
    if (!this.world.structures.has(a.trip.dest)) { // the stop is gone
      return a.trip.transit.inbound ? this.agents.delete(a.id) : this.arriveHome(a);
    }
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
        this.log(`${codeOf(home)} resident ${why} · ${how} from ${codeOf(ride.stop)}`, centerOf(this.world, home));
        return { dest: ride.stop.id, plan: { mode: 'walk', ...ride.route, transit: { stop: ride.stop.id }, commute } };
      }
    }
    if (!can('cars')) return null;
    const exit = this.pickExit();
    const from = this.world.accessInfo(home);
    if (!exit || !from) return null;
    const nodes = findPath(this.world.networks.road, from.road, exit.node);
    if (!nodes) return null;
    this.log(`${codeOf(home)} resident ${why} · exit ${compass(exit.dir)}`, centerOf(this.world, home));
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
  // every commute.interval / (missing workers) seconds on average – most by
  // bus / train where a stop is in walking range of work (commute.transit),
  // the rest by car.
  updateCommuters(dt) {
    const { residents, jobs } = this.balance();
    const missing = jobs - residents;
    const cars = this.world.roadExits().length && can('cars');
    if (missing <= 0) return;
    if ((this.commuteTimer -= dt) > 0) return;
    this.commuteTimer = (this.config.commute.interval / missing) * (0.5 + Math.random());
    if (this.commuterCount().inbound >= Math.min(missing, this.config.commute.max)) return;
    if ((Math.random() < this.config.commute.transit || !cars) && this.spawnRider()) return;
    if (cars) this.spawnVisitor({ commuter: true });
  }

  // A commuter off a bus / train: due at a stop in walking range of a
  // workplace, walks there, works a shift, walks back and rides off.
  spawnRider() {
    const places = this.balance().workplaces.slice();
    for (let attempt = 0; attempt < 4 && places.length; attempt++) {
      const work = places.splice(Math.floor(Math.random() * places.length), 1)[0];
      const ride = this.transitRoute(work);
      if (!ride) continue;
      const id = `v${++this.visitorSeq}`;
      const a = newAgent({ id, visitor: true, commuter: true, state: 'abroad' });
      a.trip = this.buildTrip({ mode: 'walk', ...ride.route, transit: { stop: ride.stop.id, inbound: true, work: work.id } }, ride.stop.id);
      a.trip.visitor = true;
      a.trip.commuter = true;
      a.timer = this.config.transit.returnWait;
      const how = STRUCTURE_TYPES[ride.stop.type].railStop ? 'train' : 'bus';
      this.log(`Commuter-${String(this.visitorSeq).padStart(3, '0')} due by ${how} at ${codeOf(ride.stop)} → ${codeOf(work)}`, centerOf(this.world, ride.stop));
      this.agents.set(id, a);
      return true;
    }
    return false;
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
}
