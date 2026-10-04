// Canoes. Now and then a group of them (1–5) comes in where a river or
// stream runs onto the map and floats down it, a little apart, each
// drifting slowly from side to side across the water, until it leaves the
// map. Sometimes instead one or two put in by a house near the water
// (`fromHome`) and set off from there. A tributary's canoes carry on down
// the river it runs into. Each
// canoe has one paddler at the back or two, paddling on opposite sides and
// switching every so often.
//
// The renderer reads boats.visible() -> { id, x, y, angle, crew, stroke,
// home }: `crew` the paddlers' body variants (render/people.js, the back
// one first), `stroke` which side each paddles on now (0 / 1), `home`
// whether it put in on the map (so it appears there, rather than coming in).

import { STRUCTURE_TYPES, matches } from '../../structures/index.js';

const OFF_MAP = 1.9; // where they stop being drawn (as the trains, render/renderer.js)

export class BoatSystem {
  constructor(world, config) {
    this.world = world;
    this.config = config.boats;
    this.boats = new Map();
    this.seq = 0;
    this.time = 0;
    this.timer = this.config.first;
    this._routes = null;
    this._rivers = null;
  }

  // Each river's way down: its own line, then on down the river it runs
  // into (from the junction), and on. [{ points, at: lengths along }].
  get routes() {
    const rivers = this.world.terrain.rivers;
    if (this._rivers !== rivers) {
      this._rivers = rivers;
      this._routes = [];
      rivers.forEach(({ points }, i) => {
        let line = points;
        const into = this._routes.slice(0, i).map((r) => ({ r, ...nearest(r.points, points[points.length - 1]) })).sort((a, b) => a.d - b.d)[0];
        if (into && into.d < 1e-3) line = [...points, ...into.r.points.slice(into.seg + 1)];
        const at = [0];
        for (let k = 1; k < line.length; k++) at.push(at[k - 1] + Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]));
        this._routes.push({ points: line, at });
      });
      for (const [id, b] of this.boats) if (!this._routes[b.route]) this.boats.delete(id);
    }
    return this._routes;
  }

  update(dt) {
    if (!dt) return;
    this.time += dt;
    const routes = this.routes;
    for (const [id, b] of this.boats) {
      b.s += b.speed * dt;
      if (b.s > routes[b.route].at.at(-1)) this.boats.delete(id);
    }
    if (!routes.length) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    const [lo, hi] = this.config.interval;
    this.timer = lo + Math.random() * (hi - lo);
    this.launch();
  }

  // A group onto a river, picked by how long it runs over the map, just
  // before it comes onto the map – or now and then one or two by a house
  // near the water, if there is one.
  launch() {
    const { config } = this;
    const routes = this.routes;
    const homes = Math.random() < config.fromHome ? this.landings() : [];
    let route, start, most = config.group[1];
    if (homes.length) {
      ({ route, s: start } = homes[Math.floor(Math.random() * homes.length)]);
      most = config.homeGroup;
    } else {
      const onMap = routes.map((r) => r.at.at(-1));
      let pick = Math.random() * onMap.reduce((a, b) => a + b, 0);
      route = 0;
      while (route < routes.length - 1 && pick > onMap[route]) pick -= onMap[route++];
      start = entry(routes[route], this.world.grid);
    }
    const count = Math.min(most, 1 + Math.floor(Math.random() ** 1.5 * most), config.max - this.boats.size);
    const speed = config.speed * (0.85 + Math.random() * 0.3);
    for (let k = 0; k < count; k++) {
      const id = `b${this.seq++}`;
      this.boats.set(id, {
        id, route, speed,
        s: start - k * config.gap * (0.8 + Math.random() * 0.5),
        lane: (Math.random() - 0.5) * 0.6,  // across the water: -0.5 by one bank, 0.5 by the other
        drift: Math.random() * Math.PI * 2, // its own slow swing across
        crew: Math.random() < config.pair ? [bodyOf(), bodyOf()] : [bodyOf()],
        beat: config.switch * (0.7 + Math.random() * 0.6), // seconds between switching sides
        home: homes.length > 0,
      });
    }
  }

  // Where canoes may put in by a house: the nearest point of a river's
  // way to each house within `homeReach` of its line. [{ route, s }].
  landings() {
    const { world } = this, out = [];
    for (const o of world.structures.values()) {
      if (!matches(STRUCTURE_TYPES[o.type] ?? {}, 'residential')) continue;
      const at = world.centerOf(o);
      this.routes.forEach((r, route) => {
        const near = nearest(r.points, at);
        if (near.d <= this.config.homeReach) out.push({ route, s: r.at[near.seg] + near.t * (r.at[near.seg + 1] - r.at[near.seg]) });
      });
    }
    return out;
  }

  *visible() {
    const routes = this.routes, field = this.world.riverField, { width, height } = this.world.grid;
    for (const b of this.boats.values()) {
      if (b.s < 0) continue;
      const { points, at } = routes[b.route];
      const [x, y, dx, dy] = pointAlong(points, at, b.s);
      if (x < -OFF_MAP || y < -OFF_MAP || x > width - 1 + OFF_MAP || y > height - 1 + OFF_MAP) continue;
      // out from the middle by its lane, swinging slowly; kept off the banks
      const bank = field?.at(x, y)?.river.bank(x, y) ?? 0.3;
      const lane = (b.lane + 0.15 * Math.sin(this.time * 0.15 + b.drift)) * 2 * Math.max(0, bank - 0.07);
      yield {
        id: b.id, x: x - dy * lane, y: y + dx * lane, angle: Math.atan2(dy, dx), crew: b.crew,
        stroke: Math.floor(this.time / b.beat + b.drift) % 2, home: b.home,
      };
    }
  }

  get count() {
    return this.boats.size;
  }
}

const bodyOf = () => Math.floor(Math.random() * 1e6);

// How far along a route it comes onto the map (a step before the edge).
function entry({ points, at }, { width, height }) {
  for (let k = 0; k < points.length; k++) {
    const [x, y] = points[k];
    if (x >= 0 && y >= 0 && x <= width - 1 && y <= height - 1) return Math.max(0, at[k] - 1);
  }
  return 0;
}

// [x, y, dx, dy] at distance s along a polyline (dx, dy: unit, the way on).
function pointAlong(points, at, s) {
  let k = 1;
  while (k < points.length - 1 && at[k] < s) k++;
  const [ax, ay] = points[k - 1], [bx, by] = points[k];
  const len = at[k] - at[k - 1] || 1e-9, t = Math.min(1, Math.max(0, (s - at[k - 1]) / len));
  return [ax + (bx - ax) * t, ay + (by - ay) * t, (bx - ax) / len, (by - ay) / len];
}

// The segment of a polyline nearest to p: { seg (its first point), t
// (how far along it), d }.
function nearest(points, [x, y]) {
  let best = { seg: 0, t: 0, d: Infinity };
  for (let s = 1; s < points.length; s++) {
    const [ax, ay] = points[s - 1], [bx, by] = points[s];
    const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy || 1e-9;
    const t = Math.min(Math.max(((x - ax) * vx + (y - ay) * vy) / len2, 0), 1);
    const d = Math.hypot(ax + vx * t - x, ay + vy * t - y);
    if (d < best.d) best = { seg: s - 1, t, d };
  }
  return best;
}
