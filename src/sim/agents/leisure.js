// People at home and out for themselves (AgentSystem methods; see agents.js):
// how long they stay, meeting and chatting, wandering, sitting out on the
// porch or in the yard, field work, walks in the woods and the parks.

import { STRUCTURE_TYPES, matches, fieldsOf } from '../../../structures/index.js';
import { measurePolyline, pointAt } from '../../roads/geometry.js';
import { siteWalks } from '../../roads/siteWalks.js';
import { DAY } from '../../render/shadows.js';
import { rotateQuarter } from '../../core/grid.js';
import { between } from './shared.js';
import { quarterOf, centerOf } from '../pose.js';

// The way a building faces, by its drawn rotation (its front is local -y).
const FACING = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// A picker of random points within r of (x, y).
function around(x, y, r) {
  return () => [x + (Math.random() * 2 - 1) * r, y + (Math.random() * 2 - 1) * r];
}

export class AgentLeisure {
  // Seconds at the far end of a trip.
  dwell(trip) {
    if (trip.truck) {
      const t = this.config.trucks;
      return trip.outside ? between(t.outsideMin, t.outsideMax) : between(t.dwellMin, t.dwellMax);
    }
    if (trip.commuter) return between(this.config.commute.shiftMin, this.config.commute.shiftMax);
    if (trip.outside || trip.transit) return between(this.config.sim.outsideMin, this.config.sim.outsideMax);
    if (trip.visitor) return between(this.config.visitors.dwellMin, this.config.visitors.dwellMax);
    const d = this.config.dwell, r = this.config.rhythm;
    if (r && trip.purpose === 'work') { // early: till the shift ends
      const { hour } = this.rhythm();
      if (hour < r.shiftBefore) return ((between(...r.shiftEnd) - hour) / 24) * DAY.day;
    }
    if (r && trip.purpose === 'errand' && matches(STRUCTURE_TYPES[this.world.structures.get(trip.dest)?.type] ?? {}, 'pub')) return between(...r.pub);
    return between(...(trip.purpose === 'work' ? d.work : trip.purpose === 'stroll' ? d.turn : trip.purpose === 'visit' ? d.visit : d.errand));
  }

  // Seconds at home (for workers: at work) before setting off again.
  homeDwell(home) {
    return between(...(this.profile(home) === 'resident' ? this.config.dwell.home : this.config.dwell.work));
  }

  // Two on foot meeting on the way stop for a word (village.chat), turned
  // to each other; one passing a group already talking may join it
  // (chatJoin), up to chatMost. Each stops once a trip.
  meet() {
    const v = this.config.village, reach = v.chatReach, f = this.weather().chat ?? 1;
    if (!f) return;
    const cells = new Map(), key = (x, y) => `${Math.floor(x / reach)},${Math.floor(y / reach)}`;
    const free = (a) => (a.state === 'out' || a.state === 'back') && !a.visitor && !a.carry && !a.watch
      && (a.trip.mode === 'walk' || a.trip.mode === 'stroll') && !a.trip.transit && a.trip.purpose !== 'fire' && a.trip.purpose !== 'refuge';
    for (const a of this.agents.values()) {
      if (!a.chat && !free(a)) continue;
      const k = key(a.x, a.y);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(a);
    }
    for (const list of cells.values()) {
      for (const a of list) {
        if (a.chat || a.chatted === a.trip) continue;
        const cx = Math.floor(a.x / reach), cy = Math.floor(a.y / reach);
        for (let i = -1; i <= 1 && a.chatted !== a.trip; i++) {
          for (let j = -1; j <= 1 && a.chatted !== a.trip; j++) {
            for (const b of cells.get(`${cx + i},${cy + j}`) ?? []) {
              const d = Math.hypot(b.x - a.x, b.y - a.y);
              if (b === a || b.home === a.home || d > reach || d < reach * 0.4) continue; // (not with their own family, nor on top of each other)
              if (b.chat) { // a group talking: join it, or walk on by
                a.chatted = a.trip;
                const g = b.chat.group;
                if (g.people.length < v.chatMost && Math.random() < v.chatJoin * f) {
                  g.people.push(a);
                  a.chat = { group: g, time: Math.max(b.chat.time, between(...v.chatTime) / 2), at: this.chatSpot(g, a.x, a.y) };
                  for (const c of g.people) c.watch = g.people.length > 2 ? g.centre : null;
                  a.watch = g.centre;
                }
                break;
              }
              if (b.chatted === b.trip) continue;
              a.chatted = a.trip;
              b.chatted = b.trip;
              if (Math.random() >= v.chat * f) break;
              // they step up to each other, either side of where they met
              const g = { people: [a, b], centre: [(a.x + b.x) / 2, (a.y + b.y) / 2] }, time = between(...v.chatTime);
              a.chat = { group: g, time, at: this.chatSpot(g, a.x, a.y, true) };
              b.chat = { group: g, time: time + between(-2, 2), at: this.chatSpot(g, b.x, b.y, true) };
              if (a.chat.at[0] === b.chat.at[0]) b.chat.at = [2 * g.centre[0] - a.chat.at[0], 2 * g.centre[1] - a.chat.at[1]]; // (level: one each side)
              a.watch = b.chat.at;
              b.watch = a.chat.at;
              break;
            }
          }
        }
      }
    }
  }

  // Where one stands in a group talking: a step from its middle, on the
  // side they came from – a pair side by side across the screen (along
  // x − y), not one behind the other.
  chatSpot(g, x, y, pair = false) {
    const [cx, cy] = g.centre, r = this.config.village.chatReach * 0.42;
    if (pair) {
      const s = Math.sign(x - y - (cx - cy)) || 1;
      return [cx + s * r * Math.SQRT1_2, cy - s * r * Math.SQRT1_2];
    }
    const d = Math.hypot(x - cx, y - cy) || 1;
    return [cx + ((x - cx) / d) * r, cy + ((y - cy) / d) * r];
  }

  // One stopped for a word (meet): steps to its place in the group, stands
  // there its time, then back onto its way. True once it walks on.
  chatting(a, leg, dt) {
    const c = a.chat;
    c.time -= dt;
    const to = c.time > 0 ? c.at : pointAt(leg, a.s);
    const dx = to[0] - a.x, dy = to[1] - a.y, d = Math.hypot(dx, dy);
    const step = this.config.sim.walkSpeed * 0.6 * dt;
    if (d > step) {
      a.x += (dx / d) * step;
      a.y += (dy / d) * step;
      return false;
    }
    [a.x, a.y] = to;
    if (c.time > 0) return false;
    c.group.people.splice(c.group.people.indexOf(a), 1);
    a.chat = a.watch = null;
    return true;
  }

  // At the end of the way out.
  arrive(a) {
    const { trip } = a;
    if (trip.purpose === 'fire') return this.fires?.arrived(a); // a fire engine pulling up
    if (trip.purpose === 'refuge') return this.agents.delete(a.id); // taken in by the neighbours
    if (trip.transit) {
      a.state = 'wait';
      a.timer = trip.transit.inbound ? this.config.transit.commuterWait : this.config.transit.maxWait;
      this.startWander(a, Infinity, around(a.x, a.y, 0.08), 0.2);
    } else if (trip.linger && trip.purpose === 'forest') {
      a.state = 'linger';
      this.startWander(a, between(...this.config.village.forest), this.woodSpots([a.x, a.y]), 0.6);
    } else if (trip.linger) {
      a.state = 'linger';
      const place = this.world.structures.get(trip.dest);
      this.startWander(a, between(...this.config.linger.park), this.parkSpots(place, [a.x, a.y]));
    } else {
      a.state = 'away';
      a.timer = this.dwell(trip);
    }
  }

  arriveHome(a) {
    if (a.engine || a.drop) return this.agents.delete(a.id); // (a fire engine back, a brigade on foot, or homeless: gone)
    a.state = 'home';
    a.trip = null;
    a.wander = null;
    a.carry = null;
    if (a.truck) a.timer = this.dwell({ truck: true });
    else if (a.retry) a.timer = between(1, 3);
    else a.timer = this.homeDwell(this.world.structures.get(a.home));
  }

  // ----- lingering -----

  // Stand about: step to a spot (`spot()`), pause there, on to another… and
  // when `time` is up back to where it began. `speed` is a share of walking
  // speed on top of config.linger.speed.
  startWander(a, time, spot, speed = 1) {
    a.wander = { anchor: [a.x, a.y], spot, time, target: null, back: false, pause: between(0.5, 2), speed };
  }

  // Moves a lingering agent on; true once it's back where it began after its time.
  wander(a, dt) {
    const w = a.wander;
    if (w.loop) return this.roundYard(a, dt);
    if (w.route) return this.sitWalk(a, dt);
    w.time -= dt;
    if (w.pause > 0) {
      w.pause -= dt;
      return false;
    }
    if (!w.target) {
      w.back = w.time <= 0;
      w.target = w.back ? w.anchor : w.spot();
    }
    const dx = w.target[0] - a.x, dy = w.target[1] - a.y;
    const d = Math.hypot(dx, dy);
    const step = this.config.sim.walkSpeed * this.config.linger.speed * w.speed * dt;
    if (d > step) {
      a.x += (dx / d) * step;
      a.y += (dy / d) * step;
      return false;
    }
    [a.x, a.y] = w.target;
    w.target = null;
    if (w.back) return true;
    w.pause = between(...this.config.linger.pause);
    return false;
  }

  // Out in front of the house for a while. 'linger', or null without a front.
  startPorch(a, home) {
    const { world } = this;
    const front = world.frontFor(world.nodesOf(home));
    if (!front) return null;
    const [x, y] = world.grid.xy(front.door);
    const [dx, dy] = front.dir;
    const { porchReach, porchWidth, porch } = this.config.linger;
    const pad = this.config.sim.doorPad;
    a.trip = { mode: 'linger', nodes: [], dest: null, back: null };
    [a.x, a.y] = [x + dx * pad, y + dy * pad];
    [a.tx, a.ty] = [a.x, a.y];
    const cx = x + dx * porchReach, cy = y + dy * porchReach;
    this.startWander(a, between(...porch), () => {
      const u = (Math.random() * 2 - 1) * porchWidth, v = (Math.random() * 2 - 1) * 0.1;
      return [cx - dy * u + dx * v, cy + dx * u + dy * v];
    });
    return 'linger';
  }

  // Round the house, where nothing leads from its front (no road, no
  // footpath): out of the door and a little way round it in the garden,
  // along a loop at the door's distance (doorPad) round the footprint,
  // stopping here and there, then back the same way and in. Not into water
  // nor off the map: the walk keeps to the stretch of the loop either side
  // of the door that's clear. 'linger', or null when even the door step
  // isn't.
  startYard(a, home) {
    const { world } = this;
    const m = this.config.sim.doorPad;
    const pts = world.nodesOf(home).map((n) => world.grid.xy(n));
    const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
    const y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
    // the footprint's box grown by m, its corners rounded (clockwise from the top right)
    const ring = [];
    for (const [cx, cy, from] of [[x1, y0, -0.5], [x1, y1, 0], [x0, y1, 0.5], [x0, y0, 1]]) {
      for (let k = 0; k <= 4; k++) {
        const t = (from + k / 8) * Math.PI;
        ring.push([cx + Math.cos(t) * m, cy + Math.sin(t) * m]);
      }
    }
    ring.push(ring[0]);
    const loop = measurePolyline(ring);
    // the door: the middle of the side the house faces
    const [fx, fy] = FACING[quarterOf(world, home)];
    const door = [(x0 + x1) / 2 + fx * ((x1 - x0) / 2 + m), (y0 + y1) / 2 + fy * ((y1 - y0) / 2 + m)];
    let s0 = 0, best = Infinity;
    for (let s = 0; s < loop.total; s += 0.02) {
      const [x, y] = pointAt(loop, s);
      const d = Math.hypot(x - door[0], y - door[1]);
      if (d < best) [best, s0] = [d, s];
    }
    const at = (u) => pointAt(loop, (((s0 + u) % loop.total) + loop.total) % loop.total);
    const clear = (u) => {
      const [x, y] = at(u);
      // (the main dot a step further out: the ground the garden runs down to)
      const [ix, iy] = world.grid.xy(world.grid.nodeAt(Math.min(Math.max(x, x0), x1), Math.min(Math.max(y, y0), y1)));
      const d = Math.hypot(x - ix, y - iy) || 1;
      const n = world.grid.nodeAt(ix + ((x - ix) / d) * 0.65, iy + ((y - iy) / d) * 0.65);
      return n >= 0 && !world.terrain.isWater(n);
    };
    if (!clear(0)) return null;
    const half = loop.total / 2, step = 0.05;
    let hi = 0, lo = 0;
    while (hi < half && clear(hi + step)) hi += step;
    while (lo > -half && clear(lo - step)) lo -= step;
    a.trip = { mode: 'linger', nodes: [], dest: null, back: null };
    [a.x, a.y] = at(0);
    [a.tx, a.ty] = [a.x, a.y];
    a.wander = { loop: { at, lo, hi }, u: 0, goal: null, time: between(...this.config.linger.porch), pause: between(0.5, 2), back: false };
    return 'linger';
  }

  // A chair carried out and sat on (a.carry 'chair', then 'sit'): towards
  // evening against the front wall beside the door, watching the street;
  // before it out in the garden behind the house. Then up and back in with
  // it. 'linger', or null where the spot is water or off the map.
  startSit(a, home) {
    const { world } = this;
    const { sit, sitFront } = this.config.village;
    const m = this.config.sim.doorPad;
    const pts = world.nodesOf(home).map((n) => world.grid.xy(n));
    const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
    const y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
    const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2], [hw, hh] = [(x1 - x0) / 2, (y1 - y0) / 2];
    const [fx, fy] = FACING[quarterOf(world, home)];
    const half = Math.abs(fx) * hw + Math.abs(fy) * hh, wide = Math.abs(fy) * hw + Math.abs(fx) * hh;
    const door = [cx + fx * (half + m), cy + fy * (half + m)];
    const front = this.rhythm().hour >= sitFront;
    // along the wall from the door, or out behind the house
    const u = (Math.random() < 0.5 ? -1 : 1) * between(0.18, 0.3 + wide * 0.5);
    const out = front ? half + m * 0.55 : -(half + m + between(0.1, 0.3));
    const seat = [cx + fx * out - fy * u, cy + fy * out + fx * u];
    const n = world.grid.nodeAt(...seat);
    if (n < 0 || world.terrain.isWater(n)) return null;
    a.trip = { mode: 'linger', nodes: [], dest: null, back: null };
    [a.x, a.y] = door;
    [a.tx, a.ty] = door;
    a.carry = 'chair';
    // (behind the house round it by a corner, and back the same way)
    const side = Math.sign(u), corner = [door[0] - fy * (wide + m) * side, door[1] + fx * (wide + m) * side];
    const route = front ? [door, seat] : [door, corner, seat];
    a.wander = { route, i: 1, dir: 1, time: between(...sit), pause: between(0.5, 1.5) };
    return 'linger';
  }

  // Moves one carrying a chair out (startSit) along its route to the seat,
  // sits it out, and back; true once back at the door.
  sitWalk(a, dt) {
    const w = a.wander;
    if (w.pause > 0) {
      w.pause -= dt;
      return false;
    }
    if (a.carry === 'sit') a.carry = 'chair'; // up, the chair back in
    const [tx, ty] = w.route[w.i];
    const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
    const step = this.config.sim.walkSpeed * this.config.linger.speed * 0.7 * dt;
    if (d > step) {
      a.x += (dx / d) * step;
      a.y += (dy / d) * step;
      return false;
    }
    [a.x, a.y] = [tx, ty];
    if (w.dir > 0 && w.i === w.route.length - 1) { // there: down on it
      a.carry = 'sit';
      [w.pause, w.dir] = [w.time, -1];
    }
    w.i += w.dir;
    return w.i < 0;
  }

  // Out to the house's field (STRUCTURE_TYPES fields, fieldsOf) with a hoe:
  // along a furrow a step at a time, stopping to hoe, then over to the next
  // one; when the time's up back to the house and in. 'linger', or null
  // with no field.
  startField(a, home) {
    const { world } = this;
    const fields = fieldsOf(STRUCTURE_TYPES[home.type] ?? {}, home);
    if (!fields.length) return null;
    const [x0, x1, y0, y1, step] = fields[Math.floor(Math.random() * fields.length)];
    const [ox, oy] = world.anchorOf(home), r = quarterOf(world, home); // (the field is laid out from the anchor)
    const at = (lx, ly) => { const [dx, dy] = rotateQuarter(lx, ly, r); return [ox + dx, oy + dy]; };
    const rows = [];
    for (let x = x0 + step; x < x1 - step / 2; x += step) rows.push(x);
    if (!rows.length) return null;
    // from the house's side facing the field, a step out
    const [cx, cy] = centerOf(world, home), [fx, fy] = at((x0 + x1) / 2, (y0 + y1) / 2);
    const d = Math.hypot(fx - cx, fy - cy) || 1, out = Math.min(0.45, d / 2);
    a.trip = { mode: 'linger', nodes: [], dest: null, back: null };
    [a.x, a.y] = [cx + ((fx - cx) / d) * out, cy + ((fy - cy) / d) * out];
    [a.tx, a.ty] = [a.x, a.y];
    a.carry = 'hoe';
    let row = Math.floor(Math.random() * rows.length), dir = Math.random() < 0.5 ? 1 : -1;
    let ly = dir > 0 ? y0 + 0.03 : y1 - 0.03;
    const { hoe } = this.config.village;
    this.startWander(a, between(...this.config.village.garden), () => {
      ly += dir * between(...hoe);
      if (ly > y1 - 0.03 || ly < y0 + 0.03) { // the end of the furrow: over to the next
        ly = Math.min(y1 - 0.03, Math.max(y0 + 0.03, ly));
        dir = -dir;
        row = (row + 1) % rows.length;
      }
      return at(rows[row] + between(-0.008, 0.008), ly);
    }, 0.5);
    return 'linger';
  }

  // Moves an agent round its house (startYard); true once back at the door.
  roundYard(a, dt) {
    const w = a.wander;
    const { lo, hi, at } = w.loop;
    w.time -= dt;
    if (w.pause > 0) {
      w.pause -= dt;
      return false;
    }
    if (w.goal === null) {
      w.back = w.time <= 0;
      if (w.back) {
        w.goal = 0;
      } else { // on a bit, either way round (back from the end of the clear stretch)
        const len = between(0.3, 1);
        let dir = Math.random() < 0.5 ? -1 : 1;
        if (w.u + dir * len > hi || w.u + dir * len < lo) dir = -dir;
        w.goal = Math.min(hi, Math.max(lo, w.u + dir * len));
      }
    }
    const d = w.goal - w.u;
    const step = this.config.sim.walkSpeed * this.config.linger.speed * dt;
    w.u = Math.abs(d) > step ? w.u + Math.sign(d) * step : w.goal;
    [a.x, a.y] = at(w.u);
    if (w.u !== w.goal) return false;
    w.goal = null;
    if (w.back) return true;
    w.pause = between(...this.config.linger.pause);
    return false;
  }

  // Where to stand about in a park or square: along its walkways, a step
  // to either side; on a green without any, round its middle; elsewhere (a
  // churchyard…) near where they came in.
  parkSpots(place, anchor) {
    if (!place || !STRUCTURE_TYPES[place.type]?.site) return around(...anchor, 0.25);
    const { lines, centre } = siteWalks(this.world.sitePaths(place));
    if (!lines.length) return around(...centre, 0.3);
    const walks = lines.map(measurePolyline);
    const total = walks.reduce((sum, w) => sum + w.total, 0);
    return () => {
      let s = Math.random() * total;
      const w = walks.find((p) => (s -= p.total) < 0) ?? walks[walks.length - 1];
      return around(...pointAt(w, Math.random() * w.total), 0.1)();
    };
  }

  // The trees deep enough in a wood to go mushrooming among (a tree with
  // village.deep trees round it), as [x, y]; worked out again when the
  // trees change. (cells: the same by unit cell, "cx,cy" -> [[x, y], …],
  // for byWood.)
  woods() {
    return this.woodsByCell().list;
  }

  woodsByCell() {
    const { world } = this;
    if (this._woods?.n === world.features.size) return this._woods;
    const list = [], cells = new Map();
    for (const f of world.features.values()) {
      if (f.type !== 'tree') continue;
      const round = world.featureIndex.near(f.x, f.y, 1.5).filter((id) => id !== f.id && world.features.get(id)?.type === 'tree');
      if (round.length < this.config.village.deep) continue;
      list.push([f.x, f.y]);
      const key = `${Math.floor(f.x)},${Math.floor(f.y)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push([f.x, f.y]);
    }
    this._woods = { n: world.features.size, list, cells };
    return this._woods;
  }

  // A point (on a walk) with a wood within a step and a half of it.
  byWood([x, y]) {
    const { list, cells } = this.woodsByCell();
    if (!list.length) return false;
    // only the cells within 1.5 of it
    for (let cy = Math.floor(y - 1.5); cy <= Math.floor(y + 1.5); cy++) {
      for (let cx = Math.floor(x - 1.5); cx <= Math.floor(x + 1.5); cx++) {
        for (const [wx, wy] of cells.get(`${cx},${cy}`) ?? []) {
          if (Math.abs(wx - x) <= 1.5 && Math.abs(wy - y) <= 1.5) return true;
        }
      }
    }
    return false;
  }

  // Where to look for mushrooms: among the wood's trees near `anchor`,
  // between and round them.
  woodSpots(anchor) {
    const [ax, ay] = anchor;
    const near = this.woods().filter(([x, y]) => Math.hypot(x - ax, y - ay) < 2.5);
    if (!near.length) return around(ax, ay, 0.3);
    return () => {
      const [x, y] = near[Math.floor(Math.random() * near.length)];
      return [x + (Math.random() - 0.5) * 0.8, y + (Math.random() - 0.5) * 0.8];
    };
  }
}
