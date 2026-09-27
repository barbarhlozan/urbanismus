// Buildings develop on their own. Every `interval` seconds each building
// works out the highest level whose `grow` conditions it meets (see the
// structure files). If that is above its level it builds up progress and
// upgrades after roughly `upTime[next level]` simulated seconds (a level can
// override it with `growTime`); if below, it declines after about `downTime`.
// Each check adds a random amount, so a neighbourhood doesn't change all at
// once. Progress fades if the conditions stop holding.
//
// Rule parts (in a level's `grow`):
//   requires   [{ type, count, radius, minLevel }]  enough of them nearby
//   avoid      [{ type, radius }]                   none of them nearby
//   coveredBy  ['services']                         inside such a building's `coverage`
//   boost      [{ type, radius, factor }]           grows faster when one is nearby
// `type` is a structure id or tag (see matches() in structures/index.js).
//
// Buildings the player levelled by hand are `locked` and left alone.
//
// Now and then a church appears by itself on free land by a road in a
// neighbourhood with enough homes and no church nearby (config.growth.church).
//
// Distances are plain grid distance (Chebyshev, footprint to footprint).
// Later this is the place to swap in travel distance, land value, pollution…

import { STRUCTURE_TYPES, maxLevel, levelOf, matches, nameOf, codeOf } from '../../structures/index.js';
import { rotateQuarter } from '../core/grid.js';

export class GrowthSystem {
  constructor(world, config) {
    this.world = world;
    this.config = config.growth;
    this.timer = 0;
    this.log = () => {}; // (text, [x, y]) – set by main to feed annotations
    // Footprints and structures by type, for the distance checks: built
    // when first needed, dropped whenever a structure comes, goes, moves or
    // changes type (not on a new level: levels are read as they are).
    this.index = null;
    for (const type of ['structure:added', 'structure:removed']) world.events.on(type, () => (this.index = null));
    world.events.on('structure:changed', (s) => {
      if (this.index?.foot.get(s.id)?.sig !== footSig(s)) this.index = null;
    });
  }

  // A check of every building every `interval`, spread over the frames of
  // that interval (a whole city at once would stall a frame): each frame
  // takes the next share of the buildings listed when the round began.
  update(dt) {
    if (!(dt > 0)) return;
    this.timer += dt;
    this.round ??= { list: [...this.world.structures.values()], done: 0 };
    const { list } = this.round;
    const upTo = Math.min(list.length, Math.ceil((list.length * this.timer) / this.config.interval));
    while (this.round.done < upTo) {
      const s = list[this.round.done++];
      if (this.world.structures.get(s.id) === s) this.check1(s);
    }
    if (this.timer < this.config.interval) return;
    this.timer = 0;
    this.round = null;
    this.spawnChurch();
  }

  // One round in one go.
  step() {
    for (const s of [...this.world.structures.values()]) this.check1(s);
    this.spawnChurch();
  }

  check1(s) {
    const { interval, upTime, downTime } = this.config;
    if (s.data.locked) return;
    const def = STRUCTURE_TYPES[s.type];
    const target = this.targetLevel(s);
    const jitter = 0.5 + Math.random(); // 0.5–1.5, averages 1
    let g = s.data.growth ?? 0;
    if (target > s.level) {
      const next = def.levels[s.level];
      const time = next.growTime ?? upTime[s.level + 1];
      g = Math.max(g, 0) + (interval / time) * jitter * this.boost(s, next.grow);
    } else if (target < s.level) {
      g = Math.min(g, 0) - (interval / downTime) * jitter;
    } else {
      g *= 0.8;
    }

    const report = (verb) => this.log(`${codeOf(s)} ${verb} · ${levelOf(def, s).name}`, this.world.centerOf(s));
    if (g >= 1) {
      this.world.setStructureLevel(s.id, s.level + 1);
      report('grows');
    } else if (g <= -1) {
      this.world.setStructureLevel(s.id, s.level - 1);
      report('declines');
    } else {
      s.data.growth = g;
    }
  }

  // Maybe build a church: on free land where its front (local -y) faces a
  // road, with at least `minHomes` homes within `radius`, and no church
  // within `spacing`. The spot with the most homes around wins.
  spawnChurch() {
    const rule = this.config.church;
    if (!rule || Math.random() > rule.chance) return;
    const { world } = this;
    const { grid } = world;
    const homes = [], churches = [];
    for (const o of world.structures.values()) {
      if (o.type === 'residential') homes.push(world.grid.xy(o.node));
      else if (o.type === 'church') churches.push(world.centerOf(o));
    }
    if (homes.length < rule.minHomes) return;

    // homes in any rectangle of dots from a table of running sums
    const W = grid.width + 1;
    const sums = new Int32Array(W * (grid.height + 1));
    for (const [hx, hy] of homes) sums[(hy + 1) * W + hx + 1]++;
    for (let y = 1; y <= grid.height; y++) for (let x = 1; x < W; x++) sums[y * W + x] += sums[(y - 1) * W + x] + sums[y * W + x - 1] - sums[(y - 1) * W + x - 1];
    const homesIn = (x0, y0, x1, y1) => {
      [x0, y0] = [Math.max(x0, 0), Math.max(y0, 0)];
      [x1, y1] = [Math.min(x1, grid.width - 1), Math.min(y1, grid.height - 1)];
      if (x0 > x1 || y0 > y1) return 0;
      return sums[(y1 + 1) * W + x1 + 1] - sums[y0 * W + x1 + 1] - sums[(y1 + 1) * W + x0] + sums[y0 * W + x0];
    };

    let best = null;
    for (let n = 0; n < grid.size; n++) {
      const [x, y] = grid.xy(n);
      const cx = x + 0.5, cy = y + 0.5;
      if (churches.some(([px, py]) => Math.max(Math.abs(px - cx), Math.abs(py - cy)) <= rule.spacing)) continue;
      // homes (on whole dots) within rule.radius of (cx, cy)
      const count = homesIn(Math.ceil(cx - rule.radius), Math.ceil(cy - rule.radius), Math.floor(cx + rule.radius), Math.floor(cy + rule.radius));
      if (count < rule.minHomes || (best && count < best.count)) continue;
      for (let rotation = 0; rotation < 4; rotation++) {
        if (!world.canPlaceStructure('church', n, rotation).ok) continue;
        // the front row must look onto a road
        const [fx, fy] = rotateQuarter(0, -1, rotation);
        const front = world.footprintNodes('church', n, rotation).some((m) => {
          const f = grid.offset(m, fx, fy);
          return f >= 0 && world.hasRoad(f);
        });
        if (!front) continue;
        const score = count + Math.random();
        if (!best || score > best.score) best = { n, rotation, count, score };
      }
    }
    if (!best) return;
    const s = world.placeStructure('church', best.n, { rotation: best.rotation });
    if (s) this.log(`${codeOf(s)} consecrated · ${levelOf(STRUCTURE_TYPES.church, s).name}`, world.centerOf(s));
  }

  targetLevel(s) {
    if (!this.world.isServed(s)) return 1;
    const def = STRUCTURE_TYPES[s.type];
    let level = 1;
    for (let l = 2; l <= maxLevel(def); l++) {
      if (!this.check(s, def.levels[l - 1].grow).ok) break;
      level = l;
    }
    return level;
  }

  check(s, rule) {
    const missing = [];
    for (const { type, count, radius, minLevel = 1 } of rule?.requires ?? []) {
      const have = this.countNear(s, type, radius, minLevel);
      if (have < count) {
        const what = nameOf(type) + (minLevel > 1 ? ` (level ${minLevel}+)` : '');
        missing.push(`${count - have} more ${what} within ${radius}`);
      }
    }
    for (const { type, radius } of rule?.avoid ?? []) {
      if (this.countNear(s, type, radius) > 0) missing.push(`no ${nameOf(type)} within ${radius}`);
    }
    for (const type of rule?.coveredBy ?? []) {
      if (!this.isCovered(s, type)) missing.push(`${nameOf(type)} coverage`);
    }
    return { ok: missing.length === 0, missing };
  }

  // Growth speed multiplier from boosts that apply.
  boost(s, rule) {
    let k = 1;
    for (const { type, radius, factor } of rule?.boost ?? []) {
      if (this.countNear(s, type, radius) > 0) k *= factor;
    }
    return k;
  }

  // Every structure's footprint dots and their bounding box, and the
  // structures matching each type or tag (filled in as asked for).
  getIndex() {
    if (this.index) return this.index;
    const { world } = this;
    const foot = new Map();
    for (const o of world.structures.values()) {
      const pts = world.nodesOf(o).map((n) => world.grid.xy(n));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      foot.set(o.id, { sig: footSig(o), pts, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
    }
    return (this.index = { foot, byType: new Map() });
  }

  ofType(type) {
    const { byType } = this.getIndex();
    let entry = byType.get(type);
    if (!entry) {
      const list = [...this.world.structures.values()].filter((o) => matches(STRUCTURE_TYPES[o.type], type));
      byType.set(type, entry = { list, ids: new Set(list.map((o) => o.id)) });
    }
    return entry;
  }

  // Is the footprint-to-footprint grid distance (Chebyshev) at most r? The
  // bounding boxes rule out most pairs; the dots decide the rest.
  within(a, b, r) {
    const { foot } = this.getIndex();
    const fa = foot.get(a.id), fb = foot.get(b.id);
    if (Math.max(fa.x0 - fb.x1, fb.x0 - fa.x1, fa.y0 - fb.y1, fb.y0 - fa.y1) > r) return false;
    for (const [x, y] of fb.pts) {
      for (const [ax, ay] of fa.pts) if (Math.max(Math.abs(ax - x), Math.abs(ay - y)) <= r) return true;
    }
    return false;
  }

  // Structures matching `type` (at least `minLevel`) within `radius` of s:
  // from the dots around s when there are fewer of them than such
  // structures, else from the list of those.
  countNear(s, type, radius, minLevel = 1) {
    const { list, ids } = this.ofType(type);
    const { world } = this;
    const f = this.getIndex().foot.get(s.id);
    let count = 0;
    if ((f.x1 - f.x0 + 2 * radius + 1) * (f.y1 - f.y0 + 2 * radius + 1) < list.length) {
      const seen = new Set();
      for (let y = f.y0 - radius; y <= f.y1 + radius; y++) {
        for (let x = f.x0 - radius; x <= f.x1 + radius; x++) {
          const n = world.grid.nodeAt(x, y);
          const id = n >= 0 ? world.structureAtNode.get(n) : undefined;
          if (id === undefined || id === s.id || !ids.has(id) || seen.has(id)) continue;
          seen.add(id);
          const o = world.structures.get(id);
          if (o.level >= minLevel && this.within(s, o, radius)) count++;
        }
      }
      return count;
    }
    for (const o of list) {
      if (o.id === s.id || o.level < minLevel) continue;
      if (this.within(s, o, radius)) count++;
    }
    return count;
  }

  isCovered(s, type) {
    for (const o of this.ofType(type).list) {
      if (o.id === s.id) continue;
      const def = STRUCTURE_TYPES[o.type];
      if (this.within(s, o, levelOf(def, o).coverage ?? 0) && this.world.isServed(o)) return true;
    }
    return false;
  }

  // For the UI: what's happening, what's missing for the next level, and
  // which boosts are currently helping.
  explain(s) {
    const def = STRUCTURE_TYPES[s.type];
    if (s.data.locked) return { trend: 'manual', missing: [], boosts: [] };
    if (!this.world.isServed(s)) {
      return { trend: s.level > 1 ? 'declining' : 'waiting', missing: [def.access === 'any' ? 'road or footpath' : 'road access'], boosts: [] };
    }
    const target = this.targetLevel(s);
    const trend = target > s.level ? 'growing' : target < s.level ? 'declining' : 'stable';
    const next = s.level < maxLevel(def) ? def.levels[s.level].grow : null;
    const boosts = (next?.boost ?? []).filter((b) => this.countNear(s, b.type, b.radius) > 0).map((b) => nameOf(b.type));
    // Declining: explain what the current level is missing; otherwise the next level.
    const keep = trend === 'declining';
    const rule = keep ? def.levels[s.level - 1].grow : next;
    const missing = rule ? this.check(s, rule).missing : [];
    return { trend, missing, keep, boosts, progress: Math.abs(s.data.growth ?? 0) };
  }
}

const footSig = (s) => `${s.type}|${s.node}|${s.rotation}`;
