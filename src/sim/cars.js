// The town's cars. Each is one thing in the world (world.cars, kept in the
// save): it stands parked somewhere or someone drives it, and the car that
// drove in to the shop is the one that drives off from it again.
//
//   { id, home, at, stall, x, y, angle, state, driver }
//   home    the building whose people it belongs to (null: a visitor's)
//   at      where it is parked, or where it is driving to park
//   stall   which of that building's stalls (painter.spots), -1 none: put
//           away in the yard, out of sight
//   x, y, angle   where it stands and the way its nose looks
//   state   'parked', 'driving', or 'away' (off the map with its driver)
//   driver  the agent who has it (a driver keeps it while out at a place,
//           to drive back in), null for one nobody has
//
// Setting off by car takes a car standing at that building: the house's own,
// at home; else one of the house's left about town comes home with nobody
// seeing it (its driver went off another way), else the house gets a new one.
// Visitors bring theirs in from off the map and take it off again.
// A drive into a building with a free stall ends in that stall (the leg is
// made to end there, AgentSystem.carLeg); with none free the car goes into
// the yard. Stalls are those the yard's drawing marks (structures/yards.js
// g.spot), handed over by the renderer (setSpots) whenever it draws one.
// While cars are locked (src/story/unlocks.js) none is shown parked; they
// are kept for when they're back.

import { UNLOCKS } from '../story/unlocks.js';
import { centerOf } from './pose.js';

export class CarSystem {
  constructor(world, agents) {
    this.world = world;
    this.agents = agents;
    this.spots = new Map(); // structure id -> [[x, y, angle]…] its stalls, as drawn
    world.events.on('structure:removed', (s) => {
      this.spots.delete(s.id);
      // (one driving there finds it gone when it gets there, and goes home)
      for (const c of [...world.cars.values()]) if (c.state !== 'driving' && (c.at === s.id || c.home === s.id)) this.remove(c);
    });
  }

  get(id) {
    return id == null ? null : this.world.cars.get(id) ?? null;
  }

  // Called by the renderer whenever a building with stalls is drawn (an
  // empty list: none). Cars in a stall that is gone go into the yard.
  setSpots(s, spots) {
    if (!spots.length) this.spots.delete(s.id);
    else this.spots.set(s.id, spots);
    for (const c of this.world.cars.values()) {
      if (c.at !== s.id || c.stall < 0) continue;
      const spot = spots[c.stall];
      if (!spot) c.stall = -1;
      else if (c.state === 'parked') [c.x, c.y, c.angle] = spot;
    }
  }

  // A free stall at s (one nobody stands in or drives to), or -1.
  freeStall(s) {
    const spots = s && this.spots.get(s.id);
    if (!spots) return -1;
    const used = new Set();
    for (const c of this.world.cars.values()) if (c.at === s.id && c.stall >= 0) used.add(c.stall);
    for (let i = 0; i < spots.length; i++) if (!used.has(i)) return i;
    return -1;
  }

  add(fields) {
    const w = this.world;
    const c = { id: w.nextCar++, home: null, at: null, stall: -1, x: 0, y: 0, angle: 0, state: 'parked', driver: null, ...fields };
    w.cars.set(c.id, c);
    return c;
  }

  remove(c) {
    this.world.cars.delete(c.id);
    const a = c.driver != null && this.agents.agents.get(c.driver);
    if (a && a.car === c.id) a.car = null;
  }

  // The car agent a drives off in from building `from` (null: from off the
  // map). Its own if it has one standing there.
  take(a, from) {
    const cars = this.world.cars;
    let c = this.get(a.car);
    if (c && (c.state === 'away' ? from : c.at !== (from?.id ?? null))) c = null; // (not where they are)
    if (!c && from) {
      for (const o of cars.values()) {
        if (o.state === 'parked' && o.driver == null && o.at === from.id && o.home === a.home) {
          c = o;
          break;
        }
      }
    }
    // at home with none there: one of the house's left about town comes home
    if (!c && from && !a.visitor && from.id === a.home) {
      for (const o of cars.values()) {
        if (o.state === 'parked' && o.driver == null && o.home === a.home) {
          c = o;
          break;
        }
      }
    }
    if (!c) {
      const [x, y] = from ? centerOf(this.world, from) : [a.x, a.y];
      c = this.add({ home: a.visitor ? null : a.home, at: from?.id ?? null, x, y });
    }
    const was = this.get(a.car);
    if (was && was !== c && was.driver === a.id) was.driver = null;
    const stall = c.at === (from?.id ?? null) ? c.stall : -1;
    c.state = 'driving';
    c.driver = a.id;
    a.car = c.id;
    return { car: c, stall: stall >= 0 ? this.spots.get(from.id)?.[stall] ?? null : null };
  }

  // The car a drives to `to` (a building, or null: off the map): which
  // stall it will park in there (a stall's [x, y, angle], or null).
  // `to`: a building's id, null for off the map.
  bound(a, to) {
    const c = this.get(a.car);
    if (!c) return null;
    const s = to != null && this.world.structures.get(to);
    c.at = to;
    c.stall = this.freeStall(s);
    return c.stall >= 0 ? this.spots.get(to)[c.stall] : null;
  }

  // a's car has got where it was going, at (x, y) heading `angle`.
  // `keep`: a goes on with it later (out at a place), else it's left there.
  park(a, x, y, angle, keep) {
    const c = this.get(a.car);
    if (!c) return;
    if (c.at == null) { // off the map
      if (c.home == null || !keep) this.remove(c);
      else c.state = 'away';
      return;
    }
    const spot = c.stall >= 0 && this.spots.get(c.at)?.[c.stall];
    if (spot) [c.x, c.y, c.angle] = spot;
    else [c.x, c.y, c.angle] = [x, y, angle];
    c.state = 'parked';
    if (!keep) this.release(a);
  }

  // a is done with its car: it stays where it stands.
  release(a) {
    const c = this.get(a.car);
    a.car = null;
    if (!c || c.driver !== a.id) return;
    c.driver = null;
    if (c.state !== 'parked') this.sendHome(c);
  }

  // A car dropped on the way (its driver sent home, taken by a fire, its
  // road gone): home with nobody seeing it, or gone with its visitor.
  sendHome(c) {
    const home = c.home != null && this.world.structures.get(c.home);
    if (!home) return this.remove(c);
    [c.x, c.y] = centerOf(this.world, home);
    Object.assign(c, { at: home.id, stall: -1, state: 'parked', driver: null });
  }

  // Every so often: cars whose driver is gone, or has done with them
  // without saying so.
  tidy() {
    const agents = this.agents.agents;
    for (const c of [...this.world.cars.values()]) {
      if (c.driver == null) continue;
      const a = agents.get(c.driver);
      if (!a || a.car !== c.id) {
        c.driver = null;
        if (c.state !== 'parked' || c.home == null) this.sendHome(c); // (a visitor's left behind: gone)
      } else if (a.state === 'home' || (c.state === 'driving' && a.state !== 'out' && a.state !== 'back')) {
        this.release(a);
      }
    }
  }

  // Cars standing in a stall, to draw (none while cars are locked).
  *parked() {
    if (!UNLOCKS.allowsVehicle('cars')) return;
    for (const c of this.world.cars.values()) if (c.state === 'parked' && c.stall >= 0) yield c;
  }
}

// The cars as saved: those of the town's own houses, each parked (one out
// driving at home, as its driver will be when the town is opened again).
export function carsToJSON(world) {
  const out = [];
  for (const c of world.cars.values()) {
    const home = c.home != null && world.structures.get(c.home);
    if (!home) continue;
    const parked = c.state === 'parked';
    const [x, y] = parked ? [c.x, c.y] : centerOf(world, home);
    out.push({ id: c.id, home: c.home, at: parked ? c.at : c.home, stall: parked ? c.stall : -1, x, y, angle: parked ? c.angle : 0 });
  }
  return out;
}

export function carsFromJSON(world, list = []) {
  for (const c of list) {
    if (!world.structures.has(c.home) || !world.structures.has(c.at)) continue;
    world.cars.set(c.id, { ...c, state: 'parked', driver: null });
    world.nextCar = Math.max(world.nextCar, c.id + 1);
  }
}
