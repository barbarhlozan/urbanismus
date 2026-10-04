// The town grows on its own in one way: now and then a church appears by
// itself on free land by a road in a neighbourhood with enough homes and no
// church nearby (config.growth.church). Every other building is built by
// the player – nothing grows or upgrades into something else.

import { STRUCTURE_TYPES, matches, codeOf } from '../../structures/index.js';
import { rotateQuarter } from '../core/grid.js';
import { UNLOCKS } from '../story/unlocks.js';

export class GrowthSystem {
  constructor(world, config) {
    this.world = world;
    this.config = config.growth;
    this.timer = 0;
    this.log = () => {}; // (text, [x, y]) – set by main to feed annotations
  }

  update(dt) {
    if (!(dt > 0)) return;
    this.timer += dt;
    if (this.timer < this.config.interval) return;
    this.timer = 0;
    this.spawnChurch();
  }

  // One round in one go.
  step() {
    this.spawnChurch();
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
      if (matches(STRUCTURE_TYPES[o.type], 'residential')) homes.push(world.grid.xy(o.node));
      else if (o.type === 'church') churches.push(world.centerOf(o));
    }
    if (homes.length < rule.minHomes || !UNLOCKS.allows('church')) return;

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
    if (s) this.log(`${codeOf(s)} consecrated · ${STRUCTURE_TYPES.church.name}`, world.centerOf(s));
  }
}
