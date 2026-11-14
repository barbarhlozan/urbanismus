// Where people go (AgentSystem methods; see agents.js): the day's
// activities, trips planned and sent, commutes, bikes and truck runs.

import { STRUCTURE_TYPES, matches, codeOf, statsOf } from '../../../structures/index.js';
import { compass } from '../../ui/annotations.js';
import { can, between } from './shared.js';
import { centerOf } from '../pose.js';

// A random key of { key: weight }, or null when none is left.
function pickWeighted(weights) {
  let total = 0;
  for (const w of Object.values(weights)) total += Math.max(0, w);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const [k, w] of Object.entries(weights)) if ((r -= Math.max(0, w)) < 0) return k;
  return null;
}

export class AgentTrips {
  // Visitors leave through a random exit, not necessarily the one they came in by.
  planDeparture(a) {
    const { world } = this;
    const dest = world.structures.get(a.trip.dest);
    const from = dest && this.drivePlace(dest);
    const exit = this.pickExit();
    if (!from || !exit) return false;
    const way = this.driveWay(from.place, exit.node);
    if (!way) return false;
    const leave = this.buildTrip({ mode: 'drive', ...way, fromDoor: from.door, toPoint: this.offMap(exit) }, null);
    a.trip.back = leave.out;
    a.trip.ways = leave.ways;
    a.trip.wayPts = leave.wayPts;
    if (!a.truck) this.log(`V-${a.id.slice(1).padStart(3, '0')} leaves · exit ${compass(exit.dir)}`, exit.pos);
    return true;
  }

  // A truck's run from its depot: export off the map, or a service run.
  startTruckTrip(a, home) {
    const cfg = this.config.trucks;
    if (Math.random() < cfg.exportShare) {
      const exit = this.pickExit();
      const from = this.drivePlace(home);
      const way = exit && from && this.driveWay(from.place, exit.node);
      if (way) {
        this.log(`${codeOf(home)} truck exports goods · exit ${compass(exit.dir)}`, centerOf(this.world, home));
        return this.begin(a, { mode: 'drive', ...way, fromDoor: from.door, toPoint: this.offMap(exit), outside: true, exit, truck: true }, null);
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

  // Structures matching any of `names` (ids or tags), excluding home (and ruins).
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
        if (!s.ruin && names.some((n) => matches(def, n))) all.push(s);
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
    if (a.sentTo != null) { // sent somewhere (send): there, if there's still a way
      const dest = this.world.structures.get(a.sentTo);
      a.sentTo = null;
      const plan = dest && this.planCommute(home, dest);
      if (plan) return this.begin(a, { ...plan, purpose: 'visit' }, dest.id);
    }
    if (a.retry) { // gave up waiting for a bus / train: drive instead
      const { commute } = a.retry;
      a.retry = null;
      const leave = this.planLeave(home, commute ? 'goes to work outside' : 'leaves the city', commute, false);
      if (leave) return this.begin(a, leave.plan, leave.dest);
    }
    const weights = { ...this.config.activities[this.profile(home)] };
    for (const [k, f] of Object.entries(this.weather().activities ?? {})) if (k in weights) weights[k] *= f;
    for (const [k, f] of Object.entries(this.rhythm().activities ?? {})) if (k in weights) weights[k] *= f;
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
        return this.startPorch(a, home) ?? this.startYard(a, home);
      case 'stroll': {
        const loop = this.walk.stroll(home, walk.strollMin, walk.strollMax);
        return loop && this.begin(a, { mode: 'stroll', purpose: 'stroll', ...loop }, null);
      }
      case 'park': {
        const [hx, hy] = centerOf(this.world, home);
        const near = (s) => {
          const [x, y] = centerOf(this.world, s);
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
      case 'sit': {
        const def = STRUCTURE_TYPES[home.type] ?? {};
        if (!matches(def, 'houses') && !matches(def, 'farm')) return null;
        return this.startSit(a, home);
      }
      case 'garden': {
        const def = STRUCTURE_TYPES[home.type] ?? {};
        if (!matches(def, 'houses') && !matches(def, 'farm')) return null;
        const field = Math.random() < this.config.village.fieldShare && this.startField(a, home);
        if (field) return field;
        const yard = this.startYard(a, home);
        if (!yard) return null;
        a.wander.time = between(...this.config.village.garden);
        a.carry = 'hoe';
        return yard;
      }
      case 'forest': {
        const { forestReach } = this.config.village;
        const route = this.walk.toward(home, (p) => this.byWood(p), 1, forestReach);
        if (!route) return null;
        const next = this.begin(a, { mode: 'stroll', purpose: 'forest', linger: true, ...route }, null);
        if (next) a.carry = 'basket';
        return next;
      }
      case 'errand':
        return this.goTo(a, home, this.rhythm().errands ?? this.config.activities.errands, 'errand');
      case 'work': {
        const lives = statsOf(home).residents;
        if (lives && Math.random() < this.outboundShare()) { // not enough jobs in town
          if (Math.random() < this.config.village.homeWork) return this.activity('garden', a, home); // works at home
          const leave = this.planLeave(home, 'goes to work outside', true);
          if (leave) return this.begin(a, leave.plan, leave.dest);
        }
        return this.goTo(a, home, sim.destinations, 'work') ?? this.activity('garden', a, home);
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

  // Sends the people of `homes` (structures) who are in to `dest`: each
  // leaves the house a moment apart (config.dwell.setOff), goes as to any
  // errand – walking, cycling or driving – stays a while (dwell.visit) and
  // comes home. Whoever is out already carries on. { sent, missed }:
  // how many set off, and the homes none did from, with why.
  send(homes, dest) {
    let sent = 0;
    const missed = [];
    for (const home of homes) {
      if (dest.ruin) { missed.push({ home, why: 'burnt down' }); continue; }
      if (home.id === dest.id) { missed.push({ home, why: 'already there' }); continue; }
      if (!this.planCommute(home, dest)) { missed.push({ home, why: 'no way there' }); continue; }
      let n = 0;
      for (const a of this.agents.values()) {
        if (a.home !== home.id || a.truck || a.state !== 'home') continue;
        a.sentTo = dest.id;
        a.retry = null;
        a.timer = between(...this.config.dwell.setOff);
        n++;
      }
      if (n) this.log(`č. p. ${home.no ?? codeOf(home)} sent to č. p. ${dest.no ?? codeOf(dest)} · ${n}`, centerOf(this.world, home));
      else missed.push({ home, why: 'nobody in' });
      sent += n;
    }
    return { sent, missed };
  }

  // To a random structure matching `names`, walking, cycling or driving.
  goTo(a, home, names, purpose) {
    const places = this.candidates(home, names);
    for (let attempt = 0; attempt < 4 && places.length; attempt++) {
      const dest = places.splice(Math.floor(Math.random() * places.length), 1)[0];
      // to the pub on foot, or by bike if it's far: never by car
      const pub = matches(STRUCTURE_TYPES[dest.type] ?? {}, 'pub');
      const plan = this.planCommute(home, dest, pub);
      if (plan) return this.begin(a, { ...plan, purpose }, dest.id);
    }
    return null;
  }

  // How to get from home to dest: walk, cycle or drive (`onFoot`: walk if
  // there's a way within walking range, else cycle, never drive).
  planCommute(home, dest, onFoot = false) {
    const { comfortDistance, maxDistance, longWalkChance } = this.config.walk;
    const walk = this.walk.route(home, dest, maxDistance);
    if (onFoot) {
      if (walk) return { mode: 'walk', ...walk };
      const ride = this.ride.route(home, dest, this.config.bike.maxDistance);
      return ride && { mode: 'cycle', ...ride };
    }
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
}
