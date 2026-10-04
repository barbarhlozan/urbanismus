// Cows and sheep in the pastures (sim/pastures.js): every pasture closed
// in by fences gets a herd, as many as its grass feeds (CONFIG.livestock
// area per head) – sheep where it's steep, cows where it's not. They
// graze, look up, wander a few steps and lie down for a while, and never
// leave the fence; sheep keep together as a flock. When the fences, roads
// or buildings change the pastures are found again: animals in a pasture
// stay, those whose pasture opened up are gone, and the herds are topped
// up or thinned to fit.
//
// The renderer reads livestock.visible() -> { id, x, y, kind, variant,
// pose, facing, walked }, like the deer's: `kind` 'cow' / 'sheep', `pose`
// 'stand' / 'walk' / 'graze' / 'lie'.

import { findPastures } from './pastures.js';

export class LivestockSystem {
  constructor(world, config) {
    this.world = world;
    this.config = config.livestock;
    this.animals = new Map();
    this.seq = 0;
    this.stamp = null;
    this.pastures = null;
  }

  // The pastures, found again when what closes or opens them changed.
  refresh() {
    const { world } = this, nw = world.networks;
    const stamp = `${nw.fence.version}|${nw.road.version}|${nw.rail.version}|${world.structureVersion ?? 0}`;
    if (stamp === this.stamp) return false;
    this.stamp = stamp;
    this.pastures = findPastures(world);
    this.restock();
    return true;
  }

  // Which kind a pasture keeps (by how steep it is), and how many.
  kindOf(p) {
    return p.slope >= this.config.steep ? 'sheep' : 'cow';
  }

  wanted(p) {
    const { config } = this, kind = this.kindOf(p);
    return Math.min(config.most, Math.floor(p.area / config.area[kind]));
  }

  // Animals out of a pasture (or of the wrong kind for it, or too many)
  // are gone; pastures short of animals get more.
  restock() {
    const { pastures } = this;
    const herds = pastures.list.map(() => []);
    for (const [id, a] of this.animals) {
      const p = pastures.at(a.x, a.y);
      if (p < 0 || a.kind !== this.kindOf(pastures.list[p]) || !this.grass(a.x, a.y)) this.animals.delete(id);
      else herds[p].push(a);
    }
    pastures.list.forEach((p, i) => {
      const herd = herds[i], want = this.wanted(p);
      for (const a of herd.slice(want)) this.animals.delete(a.id);
      for (let k = herd.length; k < want; k++) {
        const at = this.spot(i);
        if (at) this.add(this.kindOf(p), at);
      }
    });
  }

  add(kind, [x, y]) {
    const id = `l${this.seq++}`;
    const a = {
      id, kind, x, y, variant: Math.floor(Math.random() * 1e6),
      facing: Math.random() < 0.5 ? 0 : Math.PI, walked: 0,
      pose: 'graze', timer: Math.random() * 6, to: null,
    };
    this.animals.set(id, a);
    return a;
  }

  // Somewhere an animal can stand: no water, building or road there.
  grass(x, y) {
    const w = this.world, n = w.grid.nodeAt(x, y);
    return n >= 0 && !w.terrain.isWater(n) && !w.structureAt(n) && !w.hasRoad(n);
  }

  // A free spot in pasture `p`, or null.
  spot(p) {
    for (let tries = 0; tries < 20; tries++) {
      const at = this.pastures.pick(p);
      if (at && this.grass(...at)) return at;
    }
    return null;
  }

  update(dt) {
    this.refresh();
    if (!dt) return;
    const { config } = this;
    for (const a of this.animals.values()) {
      if (a.to) {
        const left = this.walk(a, a.to[0], a.to[1], config.speed[a.kind] * dt);
        if (left < 1e-3) {
          a.to = null;
          a.pose = 'graze';
        }
        continue;
      }
      a.timer -= dt;
      if (a.timer > 0) continue;
      this.next(a);
    }
  }

  // What it does next: graze on, look up, wander a few steps, lie down.
  next(a) {
    const { config } = this, r = Math.random();
    if (a.pose === 'lie') {
      // lying a while yet, or up again
      if (r < 0.4) a.timer = 10 + Math.random() * 20;
      else [a.pose, a.timer] = ['stand', 2 + Math.random() * 4];
      return;
    }
    if (r < 0.5) {
      a.pose = 'graze';
      a.timer = 6 + Math.random() * 14;
    } else if (r < 0.68) {
      a.pose = 'stand';
      a.timer = 2 + Math.random() * 6;
    } else if (r < 0.94) {
      const to = this.wanderTo(a);
      if (to) a.to = to;
      a.timer = 0.5;
    } else {
      a.pose = 'lie';
      a.timer = config.lie[0] + Math.random() * (config.lie[1] - config.lie[0]);
    }
  }

  // A few steps away in the same pasture; sheep towards the rest of their flock.
  wanderTo(a) {
    const { config, pastures } = this;
    const p = pastures.at(a.x, a.y);
    if (p < 0) return null;
    let [cx, cy] = [a.x, a.y];
    if (a.kind === 'sheep') {
      const flock = [...this.animals.values()].filter((b) => b !== a && b.kind === 'sheep' && pastures.at(b.x, b.y) === p);
      if (flock.length) {
        cx = flock.reduce((s, b) => s + b.x, 0) / flock.length;
        cy = flock.reduce((s, b) => s + b.y, 0) / flock.length;
        [cx, cy] = [a.x + (cx - a.x) * 0.6, a.y + (cy - a.y) * 0.6];
      }
    }
    for (let tries = 0; tries < 8; tries++) {
      const ang = Math.random() * Math.PI * 2, r = (0.3 + Math.random() * 0.7) * config.wander;
      const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
      if (pastures.at(x, y) === p && this.grass(x, y) && this.clear(a, x, y)) return [x, y];
    }
    return null;
  }

  // Not right on top of another animal.
  clear(a, x, y) {
    for (const b of this.animals.values()) {
      if (b !== a && Math.abs(b.x - x) < this.config.room && Math.abs(b.y - y) < this.config.room) return false;
    }
    return true;
  }

  walk(a, tx, ty, max) {
    const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
    if (d < 1e-4) return 0;
    const k = Math.min(1, max / d);
    a.x += dx * k;
    a.y += dy * k;
    a.walked += d * k;
    a.facing = Math.atan2(dy, dx);
    a.pose = 'walk';
    return d * (1 - k);
  }

  *visible() {
    for (const a of this.animals.values()) {
      yield { id: a.id, x: a.x, y: a.y, kind: a.kind, variant: a.variant, pose: a.pose, facing: a.facing, walked: a.walked };
    }
  }

  get count() {
    return this.animals.size;
  }
}
