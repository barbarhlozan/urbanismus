// What may be built where (World methods; see world.js): slopes and rock,
// dots taken by roads, railways and paths, and whether a structure fits.

import { CONFIG } from '../../config.js';
import { makeElevation } from '../../terrain/elevation.js';
import { makeRocks } from '../../terrain/rocks.js';
import { riverField } from '../../terrain/rivers.js';
import { STRUCTURE_TYPES, footprintOffsets } from '../../../structures/index.js';
import { FEATURE_TYPES } from '../../../features/index.js';

// grade(): how finely a segment's climb is measured along it (grid units)
const GRADE_STEP = 0.2;

export class WorldPlacement {
  // How much rock there is at a world position, 0–1 (terrain/rocks.js).
  rockAt(x, y) {
    return this.relief().rock(x, y);
  }

  // Too steep at this main dot to put up a building (CONFIG.steep.build);
  // never for a `type` laid out on any slope (parks).
  tooSteepToBuild(node, type = null) {
    if (STRUCTURE_TYPES[type]?.anySlope) return false;
    return this.slopeAt(node) > CONFIG.steep.build;
  }

  // How steep the ground is at a main dot (metres of rise per grid step,
  // either way along its steepest line), worked out once per relief.
  slopeAt(node) {
    const r = this.relief();
    if (!r.slopes) {
      const e = r.elevation, d = 0.5;
      r.slopes = new Float32Array(this.grid.size);
      for (let i = 0; i < this.grid.size; i++) {
        const [x, y] = this.grid.xy(i);
        r.slopes[i] = Math.hypot(e(x + d, y) - e(x - d, y), e(x, y + d) - e(x, y - d)) / (2 * d);
      }
    }
    return r.slopes[node];
  }

  // How steeply a segment of a network climbs: metres per grid step of its
  // length, at its steepest – measured piece by piece along it, so a stretch
  // whose ends sit at the same height can't hide a steep climb in between.
  grade(layer, a, b) {
    const [ax, ay] = layer.pos(a), [bx, by] = layer.pos(b);
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) return 0;
    const n = Math.max(2, Math.ceil(len / GRADE_STEP));
    let worst = 0, prev = this.elevation(ax, ay);
    for (let k = 1; k <= n; k++) {
      const z = this.elevation(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
      worst = Math.max(worst, Math.abs(z - prev));
      prev = z;
    }
    return worst / (len / n);
  }

  relief() {
    const rivers = this.terrain.rivers;
    if (this._relief?.rivers !== rivers) {
      const field = riverField(rivers);
      const { width, height } = this.grid;
      const rocks = makeRocks(this.seed, makeElevation(this.seed, field, this.hilliness), [-3, -3, width + 2, height + 2], { rivers: field, amount: this.rockiness });
      this._relief = { rivers, field, elevation: rocks.elevation, rock: rocks.rock };
    }
    return this._relief;
  }

  isRoadBlocked(node) {
    if (this.terrain.isWater(node)) return true;
    if (this.structureAt(node)) return true;
    const f = this.featureAt(node);
    return !!f && FEATURE_TYPES[f.type]?.blocksRoad === true;
  }

  // Railways keep clear of buildings: no dense dot touching one, nor a
  // feature that blocks roads.
  isRailBlocked(f) {
    return this.coarseAround(f).some((c) => this.isRoadBlocked(c));
  }

  isPathBlocked(f) {
    const around = this.coarseAround(f);
    if (around.some((c) => this.terrain.isWater(c))) return true;
    // Blocked only if every surrounding dot belongs to the same building,
    // so paths can squeeze between neighbouring buildings.
    const ids = around.map((c) => this.structureAtNode.get(c));
    return ids[0] !== undefined && ids.every((id) => id === ids[0]);
  }

  // Free ground for the footprint, plus the type's own rule (def.canPlace,
  // e.g. a station needs room for its track).
  canPlaceStructure(type, node, rotation = 0, ignoreId = null) {
    const fits = this.fitsStructure(type, node, rotation, ignoreId);
    const rule = STRUCTURE_TYPES[type]?.canPlace;
    return fits.ok && rule ? rule(this, this.footprintNodes(type, node, rotation), rotation) : fits;
  }

  // Where to put a structure the player points at: as asked, or – for types
  // with their own rule – turned half round over the same dots if only that
  // fits, or if that way it uses what's there rather than building its own
  // (a station facing existing track instead of laying some: check.lay).
  // { node, rotation, check }.
  placementFor(type, node, rotation = 0) {
    const check = this.canPlaceStructure(type, node, rotation);
    if ((check.ok && !check.lay) || !STRUCTURE_TYPES[type]?.canPlace || node < 0) return { node, rotation, check };
    const offs = footprintOffsets(STRUCTURE_TYPES[type], rotation);
    const [sx, sy] = [0, 1].map((k) => Math.min(...offs.map((o) => o[k])) + Math.max(...offs.map((o) => o[k])));
    const flipped = this.grid.offset(node, sx, sy);
    const turned = (rotation + 2) % 4;
    const other = flipped >= 0 ? this.canPlaceStructure(type, flipped, turned) : { ok: false };
    if (other.ok && (!other.lay || !check.ok)) return { node: flipped, rotation: turned, check: other };
    return { node, rotation, check };
  }

  fitsStructure(type, node, rotation = 0, ignoreId = null) {
    if (!STRUCTURE_TYPES[type]) return { ok: false, reason: 'Unknown type' };
    if (node < 0) return { ok: false, reason: 'Off the map' };
    const nodes = this.footprintNodes(type, node, rotation);
    for (const n of nodes) {
      const reason = this.dotBlocked(n, type, ignoreId);
      if (reason) return { ok: false, reason };
    }
    if (this.fineCoveredBy(nodes).some((f) => this.paths.hasNode(f))) return { ok: false, reason: 'Footpath' };
    return { ok: true };
  }

  // Why a structure of `type` can't have main dot `n` among its dots, or
  // null if it can: what fitsStructure checks dot by dot – and what the dots
  // round the pointer show while building (OverlayKit.nearDots), so a dot is
  // drawn exactly where the thing in hand could stand. (A footpath running
  // between two of its dots, and a type's own canPlace rule, are the whole
  // footprint's business.)
  dotBlocked(n, type = null, ignoreId = null) {
    if (n < 0) return 'Off the map';
    if (this.terrain.isWater(n)) return 'Water';
    const sid = this.structureAtNode.get(n);
    if (sid !== undefined && sid !== ignoreId) return 'Occupied';
    if (this.hasRoad(n)) return 'Road';
    if (this.railNear(n)) return 'Railway';
    const f = this.featureAt(n);
    if (f && FEATURE_TYPES[f.type]?.clearable === false) return 'Blocked';
    if (this.tooSteepToBuild(n, type)) return 'Too steep';
    if (this.paths.hasNode(this.coarseToFine(n))) return 'Footpath';
    return null;
  }
}
