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
// Distances are plain grid distance (Chebyshev, footprint to footprint).
// Later this is the place to swap in travel distance, land value, pollution…

import { STRUCTURE_TYPES, maxLevel, levelOf, matches, nameOf, codeOf } from '../../structures/index.js';

export class GrowthSystem {
  constructor(world, config) {
    this.world = world;
    this.config = config.growth;
    this.timer = 0;
    this.log = () => {}; // (text, [x, y]) – set by main to feed annotations
  }

  update(dt) {
    this.timer += dt;
    if (this.timer < this.config.interval) return;
    this.timer = 0;
    this.step();
  }

  step() {
    const { interval, upTime, downTime } = this.config;
    for (const s of [...this.world.structures.values()]) {
      if (s.data.locked) continue;
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

  // Footprint-to-footprint grid distance (Chebyshev).
  distance(a, b) {
    const { world } = this;
    const pa = world.nodesOf(a).map((n) => world.grid.xy(n));
    let best = Infinity;
    for (const n of world.nodesOf(b)) {
      const [x, y] = world.grid.xy(n);
      for (const [ax, ay] of pa) best = Math.min(best, Math.max(Math.abs(ax - x), Math.abs(ay - y)));
    }
    return best;
  }

  // Structures matching `type` (at least `minLevel`) within `radius` of s.
  countNear(s, type, radius, minLevel = 1) {
    let count = 0;
    for (const o of this.world.structures.values()) {
      if (o.id === s.id || o.level < minLevel || !matches(STRUCTURE_TYPES[o.type], type)) continue;
      if (this.distance(s, o) <= radius) count++;
    }
    return count;
  }

  isCovered(s, type) {
    for (const o of this.world.structures.values()) {
      const def = STRUCTURE_TYPES[o.type];
      if (o.id === s.id || !matches(def, type) || !this.world.isServed(o)) continue;
      if (this.distance(s, o) <= (levelOf(def, o).coverage ?? 0)) return true;
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
