// Parked cars. Parking lots (the 'parking' surroundings style) mark their
// stalls with g.spot(); the renderer hands those to setSpots(). Each lot only
// keeps a count of parked cars (s.data.parked) – nobody owns a car:
//   take(s)  someone drives off from s: one parked car disappears (if any)
//   park(s)  someone drives in to s: one appears (if there's a free stall)
// Cars are shown as hollow dots in the first `count` stalls of a stable,
// per-lot shuffled order. While cars are locked (src/story/unlocks.js) every
// lot stands empty – its count is kept for when they're back.

import { mulberry32 } from '../core/random.js';
import { UNLOCKS } from '../story/unlocks.js';

export class ParkingSystem {
  constructor(world) {
    this.world = world;
    this.spots = new Map(); // structure id -> [[x, y]…] world positions, in fill order
    world.events.on('structure:removed', (s) => this.spots.delete(s.id));
  }

  capacity(s) {
    return this.spots.get(s.id)?.length ?? 0;
  }

  count(s) {
    if (!UNLOCKS.allowsVehicle('cars')) return 0;
    return Math.min(s.data.parked ?? 0, this.capacity(s));
  }

  // Called by the renderer whenever a lot is (re)drawn.
  setSpots(s, spots) {
    const rng = mulberry32(s.seed ^ 0x9a7c);
    const order = spots.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.spots.set(s.id, order);
    if (s.data.parked === undefined && order.length) s.data.parked = Math.round(order.length * (0.3 + rng() * 0.4));
  }

  // Forget lots that are no longer drawn.
  retain(ids) {
    for (const id of this.spots.keys()) if (!ids.has(id)) this.spots.delete(id);
  }

  take(s) {
    if (!s || this.count(s) === 0 || !UNLOCKS.allowsVehicle('cars')) return false;
    s.data.parked = this.count(s) - 1;
    this.world.events.emit('parking:changed', s);
    return true;
  }

  park(s) {
    if (!s || this.count(s) >= this.capacity(s) || !UNLOCKS.allowsVehicle('cars')) return false;
    s.data.parked = this.count(s) + 1;
    this.world.events.emit('parking:changed', s);
    return true;
  }
}
