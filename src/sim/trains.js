// Trains. They come in through railways that run off the map edge
// (world.railExits()), call at stations and leave through another exit.
//
// A train's route is planned when it arrives: from its exit it heads for the
// nearest station it can reach going forwards (trains can't reverse or take
// sharp branches, see findTrackPath), then the next nearest, up to
// config.trains.maxStops, and then for an exit – another one than it came in
// by if it can. When no exit can be reached going on, it turns round at the
// last station. It stops at every station it passes on the way.
//
// The route is a list of runs (one, or two when it turns round). A run is a
// smoothed polyline on the right-hand track; `s` is the head's distance
// along it and carriages follow at s - i * carSpacing. Turning round swaps
// head and tail: the next run starts from the station the other way, with
// the head where the tail was.
//
// Trains keep their distance from any train ahead (lookAhead) and brake for
// stops.
//
// Level crossings: every point where a road or footpath segment crosses a
// railway segment (crossingList(), rebuilt when any network changes). Each
// frame `closed` holds the ids of the crossings a train is near
// (config.crossing); AgentSystem makes people wait in front of those.
//
// The renderer reads trains.visible() -> { points: [[x, y, dx, dy]…] }, and
// crossingList() with `closed` for the signs at crossings (render/crossings.js).

// Where segments p–q and r–s cross (endpoints included), or null.
function intersect(p, q, r, s) {
  const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
  const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
}

import { findTrackPath } from '../roads/pathfinding.js';
import { smoothPolyline, offsetPolyline, measurePolyline, pointAt, networkPolylines } from '../roads/geometry.js';
import { STRUCTURE_TYPES, codeOf } from '../../structures/index.js';
import { stationStop } from '../../structures/station.js';
import { compass } from '../ui/annotations.js';

const OFF_MAP = 1.9; // where the exits fade out (render/renderer.js)

export class TrainSystem {
  constructor(world, config) {
    this.world = world;
    this.curves = { road: config.road, path: config.path }; // how roads and paths are drawn round bends
    this.config = config.trains;
    this.crossing = config.crossing;
    this.closed = new Set(); // ids of level crossings closed right now
    this._crossings = null;
    this.rail = config.rail;
    this.trains = new Map();
    this.seq = 0;
    this.timer = 17;
    this.log = () => {}; // (text, [x, y]) – set by main to feed annotations
    this.onCall = () => {}; // (station id) – a train stopped there; set by main
    world.events.on('rails:changed', () => this.revalidate());
  }

  *visible() {
    yield* this.trains.values();
  }

  get count() {
    return this.trains.size;
  }

  update(dt) {
    const exits = this.world.railExits();
    if (exits.length && (this.timer -= dt) <= 0) {
      this.timer = (this.config.interval / exits.length) * (0.6 + Math.random() * 0.8);
      if (this.trains.size < this.config.max) this.spawn();
    }
    for (const t of this.trains.values()) this.move(t, dt);
    for (const t of this.trains.values()) this.placeCars(t);
    this.closeCrossings();
  }

  // ----- level crossings -----

  // Bumped whenever the crossings may have moved.
  get crossingVersion() {
    const { road, path, rail } = this.world.networks;
    return `${road.version}.${path.version}.${rail.version}`;
  }

  // [{ id, pos: [x, y], kind, dir: [ux, uy], near }] – kind: 'road', 'lane'
  // or 'path' (a road wins over a path at the same spot), dir: its
  // direction, near: its drawn segments [[p, q]…] round the crossing.
  // Found on the roads' and paths' curves as drawn (rounded at bends), so
  // the signs and the queues stand where the road really crosses.
  crossingList() {
    const version = this.crossingVersion;
    if (this._crossings?.version === version) return this._crossings.list;
    const { world } = this;
    const rail = world.networks.rail;
    const railSegs = [...world.rails.edges()].map(([a, b]) => [rail.pos(a), rail.pos(b)]);
    const found = new Map();
    const rank = { road: 2, lane: 1, path: 0 };
    // a lane or a road: the kind of the road segment nearest to point x
    const kindAt = ([x, y]) => {
      let best = Infinity, lane = false;
      for (const [a, b] of world.roads.edges()) {
        const [p, q] = [world.networks.road.pos(a), world.networks.road.pos(b)];
        const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
        const t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(p[0] + dx * t - x, p[1] + dy * t - y);
        if (d < best) [best, lane] = [d, world.isLane(a, b)];
      }
      return lane ? 'lane' : 'road';
    };
    const scan = (layer, isRoad) => {
      const segs = networkPolylines(layer, this.curves[isRoad ? 'road' : 'path'])
        .flatMap((line) => line.slice(1).map((q, i) => [line[i], q]));
      for (const [p, q] of segs) {
        for (const [r, s] of railSegs) {
          if (Math.max(p[0], q[0]) < Math.min(r[0], s[0]) || Math.min(p[0], q[0]) > Math.max(r[0], s[0])) continue;
          if (Math.max(p[1], q[1]) < Math.min(r[1], s[1]) || Math.min(p[1], q[1]) > Math.max(r[1], s[1])) continue;
          const x = intersect(p, q, r, s);
          if (!x) continue;
          const id = `${Math.round(x[0] * 20)}:${Math.round(x[1] * 20)}`;
          const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
          const dir = [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
          const kind = isRoad ? kindAt(x) : 'path';
          const known = found.get(id);
          if (!known || rank[kind] > rank[known.kind]) {
            // the road's drawn pieces nearby, for the signs to follow it round a bend
            const near = segs.filter(([u, v]) => Math.hypot((u[0] + v[0]) / 2 - x[0], (u[1] + v[1]) / 2 - x[1]) < 1);
            found.set(id, { id, pos: x, kind, dir, near });
          }
        }
      }
    };
    if (railSegs.length) {
      scan(world.networks.road, true);
      scan(world.networks.path, false);
    }
    const list = [...found.values()];
    this._crossings = { version, list };
    for (const t of this.trains.values()) for (const run of t.runs) run.crossings = null;
    return list;
  }

  // Crossings a polyline passes within `within` of: [{ id, at, dir }], `at`
  // = distance along it, `dir` = its heading there (0–7, for queues).
  crossingsAlong(poly, within) {
    const out = [];
    for (const c of this.crossingList()) {
      let best = -1, dist = within;
      poly.points.forEach(([x, y], i) => {
        const d = Math.hypot(x - c.pos[0], y - c.pos[1]);
        if (d < dist) {
          dist = d;
          best = i;
        }
      });
      if (best < 0) continue;
      const a = poly.points[Math.max(0, best - 1)], b = poly.points[Math.min(poly.points.length - 1, best + 1)];
      const dir = (Math.round(Math.atan2(b[1] - a[1], b[0] - a[0]) / (Math.PI / 4)) + 8) % 8;
      out.push({ id: c.id, at: poly.cum[best], dir });
    }
    return out.sort((p, q) => p.at - q.at);
  }

  closeCrossings() {
    const { approach, clear } = this.crossing;
    this.closed.clear();
    if (!this.trains.size) return;
    this.crossingList();
    for (const t of this.trains.values()) {
      const run = t.runs[t.run];
      run.crossings ??= this.crossingsAlong(run.poly, 0.15);
      for (const c of run.crossings) {
        if (c.at > t.s - t.length - clear && c.at < t.s + approach) this.closed.add(c.id);
      }
    }
  }

  // ----- planning -----

  // Stations and stops by the track dot their trains stop at:
  // stop dot -> { s, track, centre } (see stationStop).
  stations() {
    const out = new Map();
    for (const s of this.world.structures.values()) {
      if (!STRUCTURE_TYPES[s.type]?.railStop) continue;
      const stop = stationStop(this.world, s);
      if (stop) out.set(stop.node, { s, ...stop });
    }
    return out;
  }

  pickLength() {
    const kinds = Object.entries(this.config.lengths);
    const [kind, cars] = kinds[Math.floor(Math.random() * kinds.length)];
    return { kind, cars };
  }

  spawn() {
    const { world } = this;
    const layer = world.networks.rail;
    const exits = world.railExits();
    const entry = exits[Math.floor(Math.random() * exits.length)];
    const stations = this.stations();
    const beyond = (exit, d) => {
      const [x, y] = layer.pos(exit.node);
      return [x + exit.dir[0] * d, y + exit.dir[1] * d];
    };

    // Greedy: nearest station reachable going forwards, again and again.
    let nodes = [entry.node];
    let behind = beyond(entry, 1);
    const targets = [];
    const left = new Set(stations.keys());
    while (targets.length < this.config.maxStops && left.size) {
      let best = null;
      for (const stop of left) {
        const p = findTrackPath(layer, nodes[nodes.length - 1], behind, stop);
        if (p && (!best || p.length < best.length)) best = p;
      }
      if (!best) break;
      const stop = best[best.length - 1];
      left.delete(stop);
      targets.push(stop);
      if (best.length > 1) {
        nodes = nodes.concat(best.slice(1));
        behind = layer.dot(nodes[nodes.length - 2]);
      }
    }

    // Then out: another exit if possible, else turn round at the last station.
    const cur = nodes[nodes.length - 1];
    const outs = exits.filter((e) => e !== entry).sort(() => Math.random() - 0.5).concat(entry);
    const toExit = (from, back) => {
      for (const exit of outs) {
        const p = findTrackPath(layer, from, back, exit.node);
        if (p && (p.length > 1 || from !== entry.node)) return { exit, path: p };
      }
      return null;
    };
    const legs = [];
    let out = toExit(cur, behind);
    if (out) {
      legs.push({ nodes: nodes.concat(out.path.slice(1)), from: beyond(entry, OFF_MAP), to: out.exit });
    } else if (targets.length) {
      out = toExit(cur, null);
      if (!out) return false;
      legs.push({ nodes, from: beyond(entry, OFF_MAP), to: null });
      legs.push({ nodes: out.path, from: null, to: out.exit });
    } else {
      return false;
    }

    const { kind, cars } = this.pickLength();
    const length = (cars - 1) * this.config.carSpacing;
    const runs = legs.map((leg, i) => this.buildRun(leg, stations, length, i > 0));
    // enter with the whole train still off the map
    runs[0].poly = this.extendStart(runs[0].poly, length);
    for (const st of runs[0].stops) st.at += length;
    const id = `t${++this.seq}`;
    const t = {
      id, code: `T-${String(this.seq).padStart(3, '0')}`, kind, cars, length,
      runs, run: 0, stop: 0, s: length, speed: this.config.speed, state: 'run', timer: 0, wait: 0, points: [],
      exit: out.exit,
    };
    this.trains.set(id, t);
    this.log(`${t.code} ${kind} train arrives · exit ${compass(entry.dir)}`, layer.pos(entry.node));
    return true;
  }

  // One run: the smoothed right-hand track through `nodes`, from an
  // off-map point and/or to one beyond an exit. Stops at the stations passed
  // (not the one it starts from after turning round), centred on them; a run
  // that doesn't leave the map ends at a station to turn round.
  buildRun({ nodes, from, to }, stations, length, turned) {
    const { world, rail } = this;
    const layer = world.networks.rail;
    const pts = nodes.map((n) => layer.pos(n));
    if (from) pts.unshift(from);
    if (to) {
      const [x, y] = layer.pos(to.node);
      pts.push([x + to.dir[0] * (OFF_MAP + length + 0.1), y + to.dir[1] * (OFF_MAP + length + 0.1)]);
    }
    const poly = measurePolyline(offsetPolyline(smoothPolyline(pts, rail.cornerRadius, rail.curveSamples), rail.gauge));

    const stops = [];
    const seen = new Set();
    nodes.forEach((n, i) => {
      const st = stations.get(n);
      if (!st || (turned && i === 0) || seen.has(st.s.id)) return;
      // along the platform, not across it on another line
      if (![nodes[i - 1], nodes[i + 1]].some((m) => m !== undefined && st.track.includes(m))) return;
      seen.add(st.s.id);
      if (!to && i === nodes.length - 1) stops.push({ at: poly.total, station: st.s.id, turn: true });
      else stops.push({ at: Math.min(poly.total, this.arcAt(poly, st.centre) + length / 2), station: st.s.id, turn: false });
    });
    if (!to && !stops.some((st) => st.turn)) stops.push({ at: poly.total, station: null, turn: true });
    return { poly, stops, nodes };
  }

  // Distance along a polyline to its point nearest p.
  arcAt(poly, [px, py]) {
    let best = 0, dist = Infinity;
    poly.points.forEach(([x, y], i) => {
      const d = Math.hypot(x - px, y - py);
      if (d < dist) {
        dist = d;
        best = poly.cum[i];
      }
    });
    return best;
  }

  // Lengthen a polyline backwards along its first segment by d.
  extendStart(poly, d) {
    const [a, b] = poly.points;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const start = [a[0] - ((b[0] - a[0]) / l) * d, a[1] - ((b[1] - a[1]) / l) * d];
    return measurePolyline([start, ...poly.points]);
  }

  // ----- moving -----

  move(t, dt) {
    const cfg = this.config;
    const run = t.runs[t.run];
    if (t.state === 'stopped') {
      if ((t.timer -= dt) > 0) return;
      const stop = run.stops[t.stop++];
      if (stop?.turn) {
        t.run++;
        t.stop = 0;
        const next = t.runs[t.run];
        if (!next) return this.trains.delete(t.id);
        t.s = Math.min(t.length, next.poly.total);
      }
      t.state = 'run';
      return;
    }

    const stop = run.stops[t.stop];
    const target = stop ? stop.at : run.poly.total;
    const dist = Math.max(0, target - t.s);
    let limit = Math.sqrt(2 * cfg.accel * dist) + 0.05;
    if (this.blocked(t, run)) {
      t.wait += dt;
      if (t.wait < 23) limit = 0; // give up waiting eventually, rather than lock up
    } else {
      t.wait = 0;
    }
    t.speed = Math.min(t.speed + cfg.accel * dt, cfg.speed, limit);
    t.s = Math.min(target, t.s + t.speed * dt);
    if (t.s < target - 1e-4) return;

    if (!stop) {
      this.log(`${t.code} leaves · exit ${compass(t.exit.dir)}`, this.world.networks.rail.pos(t.exit.node));
      this.trains.delete(t.id);
      return;
    }
    const st = this.world.structures.get(stop.station);
    t.state = 'stopped';
    t.speed = 0;
    t.timer = st ? cfg.dwell * (0.7 + Math.random() * 0.6) : 1.5;
    if (st) {
      this.log(`${t.code} calls at ${codeOf(st)}`, this.world.centerOf(st));
      this.onCall(st.id);
    }
  }

  // Another train's carriage just ahead of the head, going roughly the same
  // way? (Oncoming trains on the other track, a hand's width away, don't count.)
  blocked(t, run) {
    const [hx, hy] = pointAt(run.poly, t.s + this.config.lookAhead);
    const [dx, dy] = this.heading(run.poly, t.s);
    for (const o of this.trains.values()) {
      if (o === t) continue;
      for (const [x, y, ox, oy] of o.points) {
        if (Math.hypot(x - hx, y - hy) < 0.09 && dx * ox + dy * oy > -0.5) return true;
      }
    }
    return false;
  }

  heading(poly, s) {
    const a = pointAt(poly, s - 0.03), b = pointAt(poly, s + 0.03);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  }

  // Carriage positions, each with its heading: [x, y, dx, dy].
  placeCars(t) {
    const { poly } = t.runs[t.run];
    const { carSpacing } = this.config;
    t.points = [];
    for (let i = 0; i < t.cars; i++) {
      const s = t.s - i * carSpacing;
      t.points.push([...pointAt(poly, s), ...this.heading(poly, s)]);
    }
  }

  // Track removed under a train: it's gone.
  revalidate() {
    const { rails } = this.world;
    for (const [id, t] of this.trains) {
      const intact = t.runs.every(({ nodes }) => nodes.every((n, i) => rails.hasNode(n) && (i === 0 || rails.hasEdge(nodes[i - 1], n))));
      if (!intact) this.trains.delete(id);
    }
  }
}
