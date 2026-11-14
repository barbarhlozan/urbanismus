// Changing what stands (World methods; see world.js): structures placed,
// numbered, set on fire, burnt, removed, restyled and converted; trees
// and other features added and cleared.

import { STRUCTURE_TYPES, newSeed, isNumbered } from '../../../structures/index.js';
import { FEATURE_TYPES } from '../../../features/index.js';

export class WorldStructures {
  // ---------- mutations ----------

  placeStructure(type, node, { rotation = 0, seed = newSeed(), data = {} } = {}) {
    if (!this.canPlaceStructure(type, node, rotation).ok) return null;
    this.history.touch();
    const s = { id: this.nextId++, type, node, rotation, seed, data };
    this.numberStructure(s);
    this._insertStructure(s);
    this.faceOnce(s);
    this.nodesOf(s).forEach((n) => this.clearFeaturesAt(n));
    STRUCTURE_TYPES[type].placed?.(this, s); // e.g. a station lays its track
    this.events.emit('structure:added', s);
    return s;
  }

  // House numbers, as the číslo popisné of a Czech village: every building
  // gets the next one when it is built (s.no), and keeps it whatever it
  // turns into. Numbers run through the whole town and a building's dies
  // with it: the next house is never given a number already gone (only
  // ⌘Z takes one back, History.apply). Open ground has none (isNumbered).
  numberStructure(s) {
    if (!isNumbered(STRUCTURE_TYPES[s.type])) delete s.no;
    else s.no ??= this.nextNo++;
  }

  // The structure with house number `no`, or null.
  structureByNo(no) {
    for (const s of this.structures.values()) if (s.no === no) return s;
    return null;
  }

  // A building catches fire, and burns while the neighbours come to watch
  // and help and the brigade comes (src/sim/fire.js): until it's put out
  // (extinguishStructure) or burns down (burnStructure) – or, given
  // `seconds` of game time, burns down by itself when they're up.
  // s.burning = { age, left, total } (saved with it): seconds it has
  // burnt, and those left of `seconds` (null without), counted by
  // src/sim/fire.js. The story's `ignite`, `put out` and `burn` and the
  // same console commands do these.
  igniteStructure(id, seconds = null) {
    const s = this.structures.get(id);
    if (!s || s.ruin || s.burning || !isNumbered(STRUCTURE_TYPES[s.type])) return false;
    this.history.touch();
    s.burning = { age: 0, left: seconds, total: seconds };
    this.events.emit('structure:changed', s);
    return true;
  }

  // The fire is put out: the house stands (no ruin).
  extinguishStructure(id) {
    const s = this.structures.get(id);
    if (!s?.burning) return false;
    this.history.touch();
    delete s.burning;
    this.events.emit('structure:changed', s);
    return true;
  }

  // A building burns down: it stands as a ruin (s.ruin) on its ground,
  // its house number with it, until it's demolished. Nobody lives or
  // works there and it counts for nothing (statsOf), nobody goes there,
  // and it's drawn as burnt-out walls (structures/ruin.js). The story
  // burns things (`burn`, src/story/). For `embers` seconds after, it
  // still smoulders (s.embers = { left, total }, counted down by
  // src/sim/fire.js).
  burnStructure(id, embers = 0) {
    const s = this.structures.get(id);
    if (!s || s.ruin || !isNumbered(STRUCTURE_TYPES[s.type])) return false;
    this.history.touch();
    delete s.burning;
    s.ruin = true;
    if (embers > 0) s.embers = { left: embers, total: embers };
    this.structureVersion = (this.structureVersion ?? 0) + 1;
    this.events.emit('structure:changed', s);
    return true;
  }

  removeStructure(id) {
    const s = this.structures.get(id);
    if (!s) return false;
    this.history.touch();
    this._unindexStructure(s);
    this.structures.delete(id);
    this.events.emit('structure:removed', s);
    return true;
  }

  // Surroundings override: a style id from structures/yards.js, 'none', or null for automatic.
  setYard(id, style) {
    const s = this.structures.get(id);
    if (!s) return;
    this.history.touch();
    if (style) s.data.yard = style;
    else delete s.data.yard;
    this.events.emit('structure:changed', s);
  }

  // Give a building a new random look.
  // Another look: a new seed, and `kind` (one of its def.kinds) if given.
  restyleStructure(id, kind = null) {
    const s = this.structures.get(id);
    if (!s) return;
    this.history.touch();
    s.seed = newSeed();
    if (kind) s.data.kind = kind;
    this.events.emit('structure:changed', s);
  }

  canConvert(id, type) {
    const s = this.structures.get(id);
    if (!s || s.type === type) return { ok: false, reason: 'Same type' };
    return this.canPlaceStructure(type, s.node, s.rotation, s.id);
  }

  convertStructure(id, type) {
    if (!this.canConvert(id, type).ok) return false;
    this.history.touch();
    const s = this.structures.get(id);
    this._unindexStructure(s);
    s.type = type;
    this.numberStructure(s);
    this._insertStructure(s);
    this.nodesOf(s).forEach((n) => this.clearFeaturesAt(n));
    this.events.emit('structure:changed', s);
    return true;
  }

  addFeature(type, node, props = {}) {
    if (!FEATURE_TYPES[type] || node < 0 || this.featureAt(node)) return null;
    this.history.touch();
    const f = { id: this.nextId++, type, node, ox: 0, oy: 0, variant: 0, scale: 1, ...props };
    this._insertFeature(f);
    this.events.emit('feature:added', f);
    return f;
  }

  removeFeature(id) {
    const f = this.features.get(id);
    if (!f) return false;
    this.history.touch();
    this.features.delete(id);
    this._unindexFeature(f);
    this.events.emit('feature:removed', f);
    return true;
  }

  clearFeaturesAt(node) {
    const f = this.featureAt(node);
    if (f && FEATURE_TYPES[f.type]?.clearable !== false) this.removeFeature(f.id);
  }
}
