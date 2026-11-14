// Constants and helpers that more than one part of AgentSystem uses
// (agents.js and the files in this folder).

import { pointAt } from '../../roads/geometry.js';
import { UNLOCKS } from '../../story/unlocks.js';

export const can = (kind) => UNLOCKS.allowsVehicle(kind); // 'cars' | 'trucks' | 'buses'

// The point `len` behind s on a leg – straight back from its start while
// the vehicle is still pulling out (so it keeps its length).
export function backPoint(leg, s, len) {
  const back = s - len;
  if (back >= 0 || leg.total < 1e-6) return pointAt(leg, back);
  const [x0, y0] = leg.points[0], [x1, y1] = pointAt(leg, Math.min(leg.total, 0.1));
  const l = Math.hypot(x1 - x0, y1 - y0) || 1;
  return [x0 + ((x1 - x0) / l) * back, y0 + ((y1 - y0) / l) * back];
}

// The share of full speed at arc length s of a leg (its pace; 1 without).
export function paceAt(leg, s) {
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
export function newAgent(fields) {
  return Object.assign({
    id: null, home: null, state: 'home', timer: 0, trip: null, s: 0, x: 0, y: 0, tx: 0, ty: 0,
    visitor: false, commuter: false, truck: false, bus: false,
    followK: 1, room: Infinity, held: 0, creep: 0, stall: 0, fx: 0, fy: 0, bx: 0, by: 0, hx: 1, hy: 0, half: 0, next: -1,
    box: null, toBox: Infinity, claim: false, yieldTo: null, nose: 0, len: 0, px: 0, py: 0, v: 0, aside: false, leader: null, blocker: null, ahead: Infinity, across: Infinity,
    waitKey: null, slot: 0, wander: null, retry: null, sentTo: null,
    fire: null, carry: null, watch: null, engine: null, drop: false,
    legs: null, leg: 0, call: 0, pause: 0, left: 0,
  }, fields);
}

export function between(min, max) {
  return min + Math.random() * (max - min);
}
