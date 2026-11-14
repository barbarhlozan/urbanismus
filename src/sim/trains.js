// Trains. They come in through railways that run off the map edge
// (TrainSystem.exits()), call at stations and leave through another exit.
//
// A train's route is planned when it arrives: from its exit it heads for the
// nearest station it can reach going forwards (trains can't reverse or take
// sharp branches, see trackRoute in sim/wayGraph.js), then the next nearest, up to
// config.trains.maxStops, and then for an exit – another one than it came in
// by if it can. When no exit can be reached going on, it turns round at the
// last station. It stops at every station it passes on the way.
//
// The route is a list of runs (one, or two when it turns round). A run is a
// smoothed polyline on the right-hand track; `s` is the head's distance
// along it. A train is one railcar (a lokálka) `length` long, its middle at
// s - length / 2. Turning round swaps head and tail: the next run starts
// from the station the other way, with the head where the tail was.
//
// Trains keep their distance from any train ahead (lookAhead) and brake for
// stops.
//
// Level crossings: every point where a road or footpath segment crosses a
// railway segment (crossingList(), rebuilt when any network changes). Each
// frame `closed` holds the ids of the crossings a train is near
// (config.crossing); AgentSystem makes people wait in front of those.
//
// The renderer reads trains.visible() -> { points: [[x, y, dx, dy]] } (the
// railcar's middle and heading, a list as there once were carriages), and
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

import { offsetPolyline, measurePolyline, pointAt } from '../roads/geometry.js';
import { crossingsOf } from '../roads/curves.js';
import { WayGraph, trackRoute } from './wayGraph.js';
import { STRUCTURE_TYPES, codeOf } from '../../structures/index.js';
import { stationStop } from '../../structures/station.js';
import { compass } from '../ui/annotations.js';
import { centerOf } from './pose.js';

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

  // The railways as a graph (sim/wayGraph.js), rebuilt when the ways change.
  graph() {
    const { ways } = this.world;
    if (this._graph?.version !== ways.version) {
      this._graph = { version: ways.version, g: new WayGraph(ways, { pass: (e) => e.kind === 'rail', mend: 0.3 }), exits: null };
    }
    return this._graph.g;
  }

  // Railways running off the map's edge: [{ node, pos, dir }], dir off it.
  exits() {
    const g = this.graph();
    if (!this._graph.exits) {
      const { width, height } = this.world.grid;
      const list = [];
      for (const [n, pieces] of g.adj) {
        if (pieces.length !== 1) continue;
        const [x, y] = g.nodes.get(n);
        const off = [[x, [-1, 0]], [width - 1 - x, [1, 0]], [y, [0, -1]], [height - 1 - y, [0, 1]]].sort((p, q) => p[0] - q[0])[0];
        if (off[0] <= 0.6) list.push({ node: n, pos: [x, y], dir: off[1] });
      }
      this._graph.exits = list;
    }
    return this._graph.exits;
  }

  *visible() {
    yield* this.trains.values();
  }

  get count() {
    return this.trains.size;
  }

  update(dt) {
    const exits = this.exits();
    // the clock for the next one only runs while there's room for it
    if (exits.length && this.trains.size < this.config.max && (this.timer -= dt) <= 0) {
      this.timer = (this.config.interval / exits.length) * (0.6 + Math.random() * 0.8);
      this.spawn();
    }
    for (const t of this.trains.values()) this.move(t, dt);
    for (const t of this.trains.values()) this.placeCars(t);
    this.closeCrossings();
  }

  // ----- level crossings -----

  // Bumped whenever the crossings may have moved.
  get crossingVersion() {
    const { road, path, rail } = this.world.networks;
    return `${this.world.ways.version}.${road.version}.${path.version}.${rail.version}`;
  }

  // [{ id, pos: [x, y], kind, dir: [ux, uy], near }] – kind: 'road', 'lane'
  // or 'path' (a road wins over a path at the same spot), dir: its
  // direction, near: its drawn segments [[p, q]…] round the crossing.
  // Found on the roads' and paths' curves as drawn (rounded at bends), so
  // the signs and the queues stand where the road really crosses.
  crossingList() {
    const version = this.crossingVersion;
    if (this._crossings?.version === version) return this._crossings.list;
    const edges = [...this.world.ways.edges.values()];
    const rails = edges.filter((e) => e.kind === 'rail');
    const found = new Map();
    const rank = { road: 2, lane: 1, path: 0 };
    const box = (pts) => {
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of pts) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      return [x0, y0, x1, y1];
    };
    const railBoxes = rails.map((e) => box(e.pts));
    for (const e of edges) {
      if (e.kind !== 'road' && e.kind !== 'path') continue;
      const kind = e.kind === 'path' ? 'path' : e.lane ? 'lane' : 'road';
      const b = box(e.pts);
      rails.forEach((r, k) => {
        const rb = railBoxes[k];
        if (b[2] < rb[0] || b[0] > rb[2] || b[3] < rb[1] || b[1] > rb[3]) return;
        for (const { point: x } of crossingsOf(e.pts, r.pts)) {
          const id = `${Math.round(x[0] * 20)}:${Math.round(x[1] * 20)}`;
          const known = found.get(id);
          if (known && rank[kind] <= rank[known.kind]) continue;
          // its heading there, and its pieces nearby (for the signs to follow it round a bend)
          const segs = e.pts.slice(1).map((q, i) => [e.pts[i], q]);
          let at = segs[0], bd = Infinity;
          for (const sg of segs) {
            const d = Math.hypot((sg[0][0] + sg[1][0]) / 2 - x[0], (sg[0][1] + sg[1][1]) / 2 - x[1]);
            if (d < bd) [at, bd] = [sg, d];
          }
          const l = Math.hypot(at[1][0] - at[0][0], at[1][1] - at[0][1]) || 1;
          const dir = [(at[1][0] - at[0][0]) / l, (at[1][1] - at[0][1]) / l];
          const near = segs.filter(([u, v]) => Math.hypot((u[0] + v[0]) / 2 - x[0], (u[1] + v[1]) / 2 - x[1]) < 1);
          found.set(id, { id, pos: x, kind, dir, near });
        }
      });
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

  // Stations and stops: [{ s, place (on the rail graph), centre, dir }] –
  // where trains stop (the middle of the platform's track) and the way the
  // platform runs (see stationStop).
  stations() {
    const g = this.graph();
    const rail = this.world.networks.rail;
    const out = [];
    for (const s of this.world.structures.values()) {
      if (!STRUCTURE_TYPES[s.type]?.railStop) continue;
      const stop = stationStop(this.world, s);
      if (!stop) continue;
      const place = g.attach(stop.centre[0], stop.centre[1], 0.5);
      if (!place) continue;
      const [p, q] = [rail.pos(stop.track[0]), rail.pos(stop.track[stop.track.length - 1])];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      out.push({ s, place, centre: place.point, dir: l > 1e-6 ? [(q[0] - p[0]) / l, (q[1] - p[1]) / l] : null });
    }
    return out;
  }

  spawn() {
    const g = this.graph();
    const exits = this.exits();
    if (!exits.length) return false;
    const entry = exits[Math.floor(Math.random() * exits.length)];
    const stations = this.stations();
    const beyond = (exit, d) => [exit.pos[0] + exit.dir[0] * d, exit.pos[1] + exit.dir[1] * d];

    // Greedy: nearest station reachable going forwards, again and again.
    let at = { node: entry.node, heading: [-entry.dir[0], -entry.dir[1]] };
    const pts = [entry.pos], ways = [];
    const add = (r) => {
      for (let i = 1; i < r.pts.length; i++) pts.push(r.pts[i]);
      for (const w of r.ways) if (ways[ways.length - 1] !== w) ways.push(w);
    };
    const targets = [];
    const left = new Set(stations);
    while (targets.length < this.config.maxStops && left.size) {
      let best = null;
      for (const st of left) {
        const r = trackRoute(g, at, st.place, Math.PI / 4);
        if (r && (!best || r.cost < best.r.cost)) best = { st, r };
      }
      if (!best) break;
      left.delete(best.st);
      targets.push(best.st);
      add(best.r);
      at = best.r.end;
    }

    // Then out: another exit if possible, else turn round at the last station.
    const outs = exits.filter((e) => e !== entry).sort(() => Math.random() - 0.5).concat(entry);
    const toExit = (from) => {
      for (const exit of outs) {
        if (exit === entry && !targets.length) continue;
        const r = trackRoute(g, from, exit.node, Math.PI / 4);
        if (r) return { exit, r };
      }
      return null;
    };
    const legs = [];
    let out = toExit(at);
    if (out) {
      add(out.r);
      legs.push({ pts, ways, from: beyond(entry, OFF_MAP), to: out.exit });
    } else if (targets.length) {
      // the other way from where it stopped
      const back = { ...at, toward: g.other(at.piece, at.toward) };
      out = toExit(back);
      if (!out) return false;
      legs.push({ pts, ways, from: beyond(entry, OFF_MAP), to: null });
      legs.push({ pts: out.r.pts, ways: out.r.ways, from: null, to: out.exit });
    } else {
      return false;
    }

    const { length } = this.config;
    const runs = legs.map((leg, i) => this.buildRun(leg, stations, length, i > 0));
    // enter with the whole train still off the map
    runs[0].poly = this.extendStart(runs[0].poly, length);
    for (const st of runs[0].stops) st.at += length;
    const id = `t${++this.seq}`;
    const t = {
      id, code: `T-${String(this.seq).padStart(3, '0')}`, length,
      runs, run: 0, stop: 0, s: length, speed: this.config.speed, state: 'run', timer: 0, wait: 0, points: [],
      exit: out.exit,
    };
    this.trains.set(id, t);
    this.log(`${t.code} arrives · exit ${compass(entry.dir)}`, entry.pos);
    return true;
  }

  // One run: the right-hand track along the ways' points, from an
  // off-map point and/or to one beyond an exit. Stops at the stations passed
  // (not the one it starts from after turning round), centred on them; a run
  // that doesn't leave the map ends at a station to turn round.
  buildRun({ pts: line, ways, from, to }, stations, length, turned) {
    const { rail } = this;
    const pts = line.slice();
    if (from) pts.unshift(from);
    if (to) pts.push([to.pos[0] + to.dir[0] * (OFF_MAP + length + 0.1), to.pos[1] + to.dir[1] * (OFF_MAP + length + 0.1)]);
    const route = measurePolyline(pts);
    const poly = measurePolyline(offsetPolyline(pts, rail.gauge));

    const stops = [];
    const end = line[line.length - 1];
    for (const st of stations) {
      // passed along the platform, not across it on another line
      const [x, y] = st.centre;
      let k = -1, bd = 0.12;
      route.points.forEach((p, i) => {
        const d = Math.hypot(p[0] - x, p[1] - y);
        if (d < bd) [k, bd] = [i, d];
      });
      if (k < 0) continue;
      const [a, b] = [route.points[Math.max(0, k - 1)], route.points[Math.min(route.points.length - 1, k + 1)]];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      if (st.dir && Math.abs(((b[0] - a[0]) * st.dir[0] + (b[1] - a[1]) * st.dir[1]) / l) < 0.7) continue;
      if (turned && route.cum[k] < 0.3) continue;
      const atEnd = !to && Math.hypot(end[0] - x, end[1] - y) < 0.05;
      if (atEnd) stops.push({ at: poly.total, station: st.s.id, turn: true });
      else stops.push({ at: Math.min(poly.total, this.arcAt(poly, st.centre) + length / 2), station: st.s.id, turn: false });
    }
    stops.sort((p, q) => p.at - q.at);
    if (!to && !stops.some((st) => st.turn)) stops.push({ at: poly.total, station: null, turn: true });
    return { poly, stops, ways, pts: line };
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
      this.log(`${t.code} leaves · exit ${compass(t.exit.dir)}`, t.exit.pos);
      this.trains.delete(t.id);
      return;
    }
    const st = this.world.structures.get(stop.station);
    t.state = 'stopped';
    t.speed = 0;
    t.timer = st ? cfg.dwell * (0.7 + Math.random() * 0.6) : 1.5;
    if (st) {
      this.log(`${t.code} calls at ${codeOf(st)}`, centerOf(this.world, st));
      this.onCall(st.id);
    }
  }

  // Another train's railcar just ahead of the head, going roughly the same
  // way? (Oncoming trains on the other track, a hand's width away, don't count.)
  blocked(t, run) {
    const [hx, hy] = pointAt(run.poly, t.s + this.config.lookAhead);
    const [dx, dy] = this.heading(run.poly, t.s);
    const half = this.config.length / 2;
    for (const o of this.trains.values()) {
      if (o === t) continue;
      for (const [x, y, ox, oy] of o.points) {
        if (dx * ox + dy * oy <= -0.5) continue;
        // nearest point of its body, front to back
        const u = Math.max(-half, Math.min(half, (hx - x) * ox + (hy - y) * oy));
        if (Math.hypot(x + ox * u - hx, y + oy * u - hy) < 0.09) return true;
      }
    }
    return false;
  }

  heading(poly, s) {
    const a = pointAt(poly, s - 0.03), b = pointAt(poly, s + 0.03);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  }

  // The railcar's middle with its heading: [[x, y, dx, dy]].
  placeCars(t) {
    const { poly } = t.runs[t.run];
    const s = t.s - t.length / 2;
    t.points = [[...pointAt(poly, s), ...this.heading(poly, s)]];
  }

  // Track removed under a train: it's gone. (Its way edges are there, or
  // the rails still run under its route – after a split, say.)
  revalidate() {
    const { edges } = this.world.ways;
    const g = this.graph();
    const under = (pts) => {
      let last = null;
      for (const p of pts) {
        if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.4) continue;
        last = p;
        if (!g.attach(p[0], p[1], 0.05)) return false;
      }
      return true;
    };
    for (const [id, t] of this.trains) {
      const intact = t.runs.every(({ ways, pts }) => ways.every((w) => edges.has(w)) || under(pts));
      if (!intact) this.trains.delete(id);
    }
  }
}
