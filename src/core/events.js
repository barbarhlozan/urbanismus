// Tiny pub/sub. Systems talk to each other only through world events, so new
// systems (economy, traffic, sound…) can listen in without touching others.
//
// Events emitted by World:
//   structure:added (s)   structure:removed (s)   structure:changed (s)  – level / type / lock
//   feature:added (f)     feature:removed (f)
//   roads:changed / paths:changed / fences:changed ({ layer, nodes }) – nodes whose lines changed
//   terrain:changed ()
//
// Emitted by other systems:
//   parking:changed (s)   – a car parked at / left structure s (sim/parking.js)

export class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this.handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    for (const fn of this.handlers.get(type) ?? []) fn(payload);
    for (const fn of this.handlers.get('*') ?? []) fn(type, payload);
  }
}
