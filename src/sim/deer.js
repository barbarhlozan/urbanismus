// Deer. Now and then a small herd (1–4) steps out of a forest: they walk
// from somewhere among the trees to a patch of open grass nearby – no
// building, road, path, railway, water, rock or tree on it – and graze
// there a while, heads down and up again, shuffling a step now and then.
// Then they walk back in among the trees and are gone. Anyone coming close
// (a walker, a car…) sends them running back early. A herd is roe deer (a
// buck with does, maybe a fawn) or, less often, red deer (a stag, hinds).
//
// The renderer reads deer.visible() -> { id, x, y, kind, variant, pose,
// facing, walked }: `kind` a DEER_KINDS key (render/deer.js), `pose`
// 'stand' / 'walk' / 'graze', `facing` the angle it last moved along,
// `walked` how far it has walked (for its steps).

export class DeerSystem {
  constructor(world, config, agents = null) {
    this.world = world;
    this.config = config.deer;
    this.agents = agents; // (to shy away from)
    this.herds = new Map();
    this.seq = 0;
    this.timer = this.config.first;
    this.look = 0; // seconds to the next look round for people
  }

  update(dt) {
    if (!dt) return;
    const { config } = this;
    for (const [id, h] of this.herds) {
      this.step(h, dt);
      if (h.gone) this.herds.delete(id);
    }
    this.look -= dt;
    if (this.look <= 0) {
      this.look = 0.5;
      this.shy();
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    const [lo, hi] = config.interval;
    this.timer = lo + Math.random() * (hi - lo);
    if (this.count < config.max) this.launch();
  }

  // ---------- where they go ----------

  // Open grass at main dot n: nothing on it or right next to it but grass.
  grazing(n) {
    const w = this.world, [x, y] = w.grid.xy(n);
    if (!this.walkable(n) || w.featureAt(n) || w.hasRoad(n) || w.railNear(n)) return false;
    if (w.paths.hasNode(w.coarseToFine(n)) || w.rockAt(x, y) > 0.2) return false;
    return w.grid.neighbors(n).every((m) => !w.structureAt(m) && !w.terrain.isWater(m));
  }

  // Deer walk anywhere but through water and buildings.
  walkable(n) {
    return n >= 0 && !this.world.terrain.isWater(n) && !this.world.structureAt(n);
  }

  isTree(n) {
    return this.world.featureAt(n)?.type === 'tree';
  }

  // Breadth-first out from `start` over walkable dots, at most `reach`
  // steps: { order: dots in the order reached, from: dot -> the one before }.
  spread(start, reach) {
    const grid = this.world.grid;
    const from = new Map([[start, -1]]), dist = new Map([[start, 0]]), order = [start];
    for (let i = 0; i < order.length; i++) {
      const n = order[i], d = dist.get(n);
      if (d >= reach) continue;
      for (const m of grid.neighbors(n)) {
        if (from.has(m) || !this.walkable(m)) continue;
        from.set(m, n);
        dist.set(m, d + 1);
        order.push(m);
      }
    }
    return { order, from, dist };
  }

  // The way from the search's start to `end`, as [x, y] points.
  route({ from }, end) {
    const pts = [];
    for (let n = end; n !== -1; n = from.get(n)) pts.push(this.world.grid.xy(n));
    return pts.reverse();
  }

  // A herd out of a forest: a tree dot with open grass within reach.
  launch() {
    const { config, world } = this;
    const trees = [...world.features.values()].filter((f) => f.type === 'tree').map((f) => f.node);
    if (trees.length < config.forest) return null;
    for (let tries = 0; tries < 12; tries++) {
      const start = trees[Math.floor(Math.random() * trees.length)];
      // well inside the trees, so they come out of the forest, not off a lone tree
      if (world.grid.neighbors(start).filter((m) => this.isTree(m)).length < 5) continue;
      const search = this.spread(start, config.reach);
      const meadows = search.order.filter((n) => search.dist.get(n) >= 2 && this.grazing(n));
      if (!meadows.length) continue;
      const spot = meadows[Math.floor(Math.random() * meadows.length)];
      return this.addHerd(start, spot, this.route(search, spot));
    }
    return null;
  }

  addHerd(start, spot, route) {
    const { config } = this;
    const [, most] = config.herd;
    const size = Math.min(most, 1 + Math.floor(Math.random() ** 1.6 * most));
    const red = Math.random() < config.red;
    const kinds = [];
    for (let k = 0; k < size; k++) {
      // a male now and then (never alone with a fawn), the rest females, the youngest last
      if (k === 0 && Math.random() < config.male) kinds.push(red ? 'stag' : 'buck');
      else if (k > 0 && k === size - 1 && Math.random() < config.fawn) kinds.push('fawn');
      else kinds.push(red ? 'hind' : 'doe');
    }
    const id = `d${this.seq++}`;
    const [sx, sy] = this.world.grid.xy(start);
    const herd = {
      id, start, spot, state: 'out', speed: config.speed, time: 0, gone: false,
      graze: config.graze[0] + Math.random() * (config.graze[1] - config.graze[0]),
      path: withLengths(smooth(route)),
      members: kinds.map((kind, k) => ({
        id: `${id}.${k}`, kind, variant: Math.floor(Math.random() * 1e6),
        lag: k * config.gap * (0.8 + Math.random() * 0.4), // how far behind the lead along the way
        lane: (Math.random() - 0.5) * 0.5,                  // to the side of the way
        x: sx + (Math.random() - 0.5) * 0.3, y: sy + (Math.random() - 0.5) * 0.3,
        facing: Math.random() * Math.PI * 2, walked: 0, pose: 'stand', moving: false,
        timer: Math.random() * 3, head: 'up',
      })),
      s: 0,
    };
    this.herds.set(id, herd);
    return herd;
  }

  // Back among the trees: the way to the nearest dot deep in the forest
  // (else any tree, else where they came out), running if `flee`.
  leave(h, flee = false) {
    const { config, world } = this;
    const lead = h.members[0];
    const from = world.grid.index(Math.round(lead.x), Math.round(lead.y));
    const search = this.spread(this.walkable(from) ? from : h.start, config.reach + 4);
    const deep = (n) => this.isTree(n) && world.grid.neighbors(n).every((m) => this.isTree(m));
    const end = search.order.find(deep) ?? search.order.find((n) => this.isTree(n) && search.dist.get(n) >= 1) ?? h.start;
    const route = search.from.has(end) ? this.route(search, end) : [world.grid.xy(from), world.grid.xy(h.start)];
    h.path = withLengths(smooth(route));
    h.s = 0;
    h.state = 'back';
    h.speed = flee ? config.run : config.speed;
    for (const m of h.members) m.head = 'up';
  }

  // ---------- moving ----------

  step(h, dt) {
    const { config } = this;
    h.time += dt;
    if (h.state === 'out' || h.state === 'back') {
      h.s += h.speed * dt;
      const end = h.path.at.at(-1), out = h.state === 'out';
      let all = h.s >= end + Math.max(...h.members.map((m) => m.lag));
      for (const m of h.members) {
        // each follows the lead's point along the way, `lag` behind and off
        // to its side; going out they stop strung along the end of it,
        // going back they file in together
        const s = Math.min(out ? end - m.lag * 0.7 : end, Math.max(0, h.s - m.lag));
        const [px, py, dx, dy] = pointAlong(h.path, s);
        const side = m.lane * Math.min(1, s, out ? 1 : end - s);
        const tx = px - dy * side, ty = py + dx * side;
        this.walk(m, tx, ty, h.speed * 1.4 * dt);
        m.head = 'up';
        if (Math.hypot(tx - m.x, ty - m.y) > 0.05) all = false;
      }
      if (!all) return;
      if (h.state === 'back') {
        h.gone = true;
        return;
      }
      // arrived: spread out over the grass round the spot
      h.state = 'graze';
      h.time = 0;
      for (const m of h.members) m.home = [m.x, m.y];
      return;
    }
    // grazing: heads down a while, up a while, now and then a step
    if (h.time > h.graze || !this.grazing(h.spot)) {
      this.leave(h);
      return;
    }
    for (const m of h.members) {
      if (m.to) {
        const left = this.walk(m, m.to[0], m.to[1], config.speed * 0.5 * dt);
        if (left < 1e-3) m.to = null;
        continue;
      }
      m.pose = m.head === 'down' ? 'graze' : 'stand';
      m.moving = false;
      m.timer -= dt;
      if (m.timer > 0) continue;
      if (m.head === 'down' && Math.random() < 0.35) {
        // a step or two to fresh grass, near where it settled
        const a = Math.random() * Math.PI * 2, r = Math.random() * config.roam;
        m.to = [m.home[0] + Math.cos(a) * r, m.home[1] + Math.sin(a) * r];
        m.timer = 1;
        continue;
      }
      m.head = m.head === 'down' ? 'up' : 'down';
      m.timer = m.head === 'down' ? 4 + Math.random() * 8 : 1.5 + Math.random() * 3;
    }
  }

  // Move member m up to `max` towards (tx, ty); how far is left.
  walk(m, tx, ty, max) {
    const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy);
    if (d < 1e-4) {
      m.moving = false;
      m.pose = 'stand';
      return 0;
    }
    const k = Math.min(1, max / d);
    m.x += dx * k;
    m.y += dy * k;
    m.walked += d * k;
    if (d * k > 1e-4) m.facing = Math.atan2(dy, dx);
    m.moving = true;
    m.pose = 'walk';
    return d * (1 - k);
  }

  // Anyone coming near grazing (or arriving) deer: off they run.
  shy() {
    if (!this.agents) return;
    const near = this.config.shy;
    const out = [...this.herds.values()].filter((h) => h.state !== 'back');
    if (!out.length) return;
    for (const a of this.agents.visible()) {
      for (const h of out) {
        if (h.state === 'back') continue;
        if (h.members.some((m) => Math.abs(m.x - a.x) < near && Math.abs(m.y - a.y) < near)) this.leave(h, true);
      }
    }
  }

  *visible() {
    for (const h of this.herds.values()) {
      for (const m of h.members) {
        yield { id: m.id, x: m.x, y: m.y, kind: m.kind, variant: m.variant, pose: m.pose, facing: m.facing, walked: m.walked };
      }
    }
  }

  get count() {
    let n = 0;
    for (const h of this.herds.values()) n += h.members.length;
    return n;
  }
}

// Corners cut off a grid route once (Chaikin), ends kept.
function smooth(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
    if (k > 0) out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
    if (k < pts.length - 2) out.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
  }
  out.push(pts.at(-1));
  return out;
}

function withLengths(points) {
  const at = [0];
  for (let k = 1; k < points.length; k++) at.push(at[k - 1] + Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]));
  return { points, at };
}

// [x, y, dx, dy] at distance s along a path (dx, dy: unit, the way on).
function pointAlong({ points, at }, s) {
  if (points.length < 2) return [...points[0], 1, 0];
  let k = 1;
  while (k < points.length - 1 && at[k] < s) k++;
  const [ax, ay] = points[k - 1], [bx, by] = points[k];
  const len = at[k] - at[k - 1] || 1e-9, t = Math.min(1, Math.max(0, (s - at[k - 1]) / len));
  return [ax + (bx - ax) * t, ay + (by - ay) * t, (bx - ax) / len, (by - ay) / len];
}
