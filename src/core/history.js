// Undo and redo of the player's own changes to the town (world.history).
//
// A step is whatever one click did: a house placed, a road drawn (with the
// trees it cleared), a station
// with the track it laid, a building pulled down, a new look or yard. World
// calls touch() before it changes anything; the first touch takes a
// snapshot of the town, and when the click's handler is done (the end of
// the task, a microtask later) the step closes with the difference: which
// structures and trees came, went or changed, which segments of each
// network and which sidewalks and lanes, and the chronicle lines the change
// wrote. Snapshots rather than an inverse per World method, so whatever a
// method sets off by itself (pruned bridges, a
// station's track) comes back with it without each of those knowing about
// undo.
//
// The town also changes by itself: a church grows by a road, the first map
// is generated. Those run inside aside(), are never recorded, and stay when
// the player undoes – undo puts back only what the step changed, item by
// item, not the whole town as it was. So a church that grew by a road the
// player then takes back keeps standing, without its road, as if the road
// had been erased.
//
// Before a step is undone (or redone) it is checked: what it would bring
// back must still have room – no building of the town's own (or of a later
// step that's still there) on the ground a building or a segment would
// return to. If something is in the way the step can't be undone: it is
// dropped from the history, nothing changes, and undo() says why. The
// steps before it stay and can still be undone (each is checked the same
// way). A redo that can't be done drops what's left to redo.
//
// Things brought back keep their ids (ids are never reused, World.nextId
// only grows), so the save stays as it would have been. Each change is
// announced with the usual world events, so agents, the renderer and the
// save follow; the chronicle keeps quiet meanwhile (`applying`) and gets
// back exactly the lines the step wrote – they go on undo and return on
// redo. The story is left as it is: what was told was told.
//
// The last LIMIT steps are kept; a new step clears what could be redone.
// The history lives only in the page: it isn't saved, and a new or loaded
// town starts without one.

import { edgeKey } from '../roads/network.js';

const LIMIT = 100;

// A structure as recorded: everything about it but the cars parked at it
// (s.data.parked, kept by sim/parking.js – the town's own business).
const record = (s) => JSON.stringify({ ...s, data: { ...s.data, parked: undefined } });

const edgeKeys = (graph) => {
  const keys = new Set();
  for (const [a, b] of graph.edges()) keys.add(edgeKey(a, b));
  return keys;
};
const ends = (key) => key.split('-').map(Number);

// What's in `after` and not in `before`, and the other way round.
function setDiff(before, after) {
  const added = [...after].filter((k) => !before.has(k));
  const removed = [...before].filter((k) => !after.has(k));
  return added.length || removed.length ? { added, removed } : null;
}

export class History {
  constructor(world) {
    this.world = world;
    this.done = [];
    this.undone = [];
    this.open = null;     // the snapshot of the step being made
    this.applying = false; // an undo or redo is being put in
    this.asides = 0;
    this.listeners = new Set();
    this.steps = new Set();
  }

  get canUndo() {
    return this.done.length > 0 || !!this.open;
  }

  get canRedo() {
    return this.undone.length > 0;
  }

  // fn() whenever what can be undone or redone changes (a future button).
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    this.listeners.forEach((fn) => fn(this));
  }

  // fn(step) whenever the player has done something (not on undo or redo):
  // the step as diff() makes it (the pencil's sound, audio/ambience.js).
  onStep(fn) {
    this.steps.add(fn);
    return () => this.steps.delete(fn);
  }

  // World is about to change the town.
  touch() {
    if (this.applying || this.asides || this.open) return;
    this.open = this.snapshot();
    queueMicrotask(() => this.commit());
  }

  // Close the step being made now (it closes by itself at the end of the task).
  commit() {
    const before = this.open;
    if (!before) return;
    this.open = null;
    const step = this.diff(before);
    if (!step) return;
    this.done.push(step);
    if (this.done.length > LIMIT) this.done.shift();
    this.undone = [];
    this.notify();
    this.steps.forEach((fn) => fn(step));
  }

  // The town's own doing: changes made in fn() aren't recorded.
  aside(fn) {
    this.commit();
    this.asides++;
    try {
      return fn();
    } finally {
      this.asides--;
    }
  }

  clear() {
    this.open = null;
    this.done = [];
    this.undone = [];
    this.notify();
  }

  // Take back the last step: { ok: true }, or { ok: false, reason }.
  undo() {
    this.commit();
    const step = this.done.pop();
    if (!step) return { ok: false, reason: 'Nothing to undo' };
    const result = this.apply(step, 'before');
    if (result.ok) this.undone.push(step);
    this.notify();
    return result;
  }

  redo() {
    this.commit();
    const step = this.undone.pop();
    if (!step) return { ok: false, reason: 'Nothing to redo' };
    const result = this.apply(step, 'after');
    if (result.ok) this.done.push(step);
    else this.undone = [];
    this.notify();
    return result;
  }

  // ---------- inside ----------

  snapshot() {
    const w = this.world;
    return {
      structures: new Map([...w.structures.values()].map((s) => [s.id, record(s)])),
      features: new Map(w.features), // (never changed in place: kept as they are)
      edges: Object.fromEntries(Object.entries(w.networks).map(([kind, layer]) => [kind, edgeKeys(layer.graph)])),
      sidewalks: new Set(w.sidewalks),
      lanes: new Set(w.lanes),
      laneWalks: new Map(w.laneWalks),
      entries: w.chronicle.entries.length,
      marks: new Set(w.chronicle.marks),
    };
  }

  // The step from `before` to now, or null if nothing changed. Structures
  // and features as { id, before, after } (null where there was none),
  // network segments and street keys as { added, removed }.
  diff(before) {
    const w = this.world;
    const structures = [];
    for (const [id, was] of before.structures) {
      const s = w.structures.get(id);
      const now = s ? record(s) : null;
      if (now !== was) structures.push({ id, before: was, after: now });
    }
    for (const s of w.structures.values()) {
      if (!before.structures.has(s.id)) structures.push({ id: s.id, before: null, after: record(s) });
    }
    const features = [];
    for (const [id, f] of before.features) if (w.features.get(id) !== f) features.push({ id, before: f, after: w.features.get(id) ?? null });
    for (const f of w.features.values()) if (!before.features.has(f.id)) features.push({ id: f.id, before: null, after: f });
    const edges = {};
    for (const [kind, layer] of Object.entries(w.networks)) {
      const d = setDiff(before.edges[kind], edgeKeys(layer.graph));
      if (d) edges[kind] = d;
    }
    const sidewalks = setDiff(before.sidewalks, w.sidewalks);
    const lanes = setDiff(before.lanes, w.lanes);
    const laneWalks = [];
    for (const key of new Set([...before.laneWalks.keys(), ...w.laneWalks.keys()])) {
      const was = before.laneWalks.get(key) ?? null, now = w.laneWalks.get(key) ?? null;
      if (was !== now) laneWalks.push({ key, before: was, after: now });
    }
    if (!structures.length && !features.length && !Object.keys(edges).length && !sidewalks && !lanes && !laneWalks.length) return null;
    return {
      structures, features, edges, sidewalks, lanes, laneWalks,
      entries: w.chronicle.entries.slice(before.entries),
      marks: w.chronicle.marks.filter((m) => !before.marks.has(m)),
    };
  }

  // Put the town as the step had it `side` ('before': undo, 'after': redo).
  apply(step, side) {
    const w = this.world;
    const undo = side === 'before';
    // segments to put in and take out
    const put = {}, take = {};
    for (const [kind, d] of Object.entries(step.edges)) {
      put[kind] = undo ? d.removed : d.added;
      take[kind] = undo ? d.added : d.removed;
    }

    // Room for what comes back: no structure the step didn't touch on its ground.
    const ours = new Set(step.structures.map((c) => c.id));
    const foreign = (n) => {
      const id = w.structureAtNode.get(n);
      return id !== undefined && !ours.has(id) ? id : undefined;
    };
    const coming = step.structures.filter((c) => c[side]).map((c) => JSON.parse(c[side]));
    for (const s of coming) {
      if (w.nodesOf(s).some((n) => n < 0 || foreign(n) !== undefined)) return { ok: false, reason: 'Occupied' };
    }
    for (const [kind, keys] of Object.entries(put)) {
      const fine = kind !== 'road';
      const blocked = (n) => {
        if (!fine) return foreign(n) !== undefined;
        const around = w.coarseAround(n).map(foreign);
        // railways keep clear of buildings; footpaths and fences only of
        // the inside of one (as World.isRailBlocked / isPathBlocked)
        return kind === 'rail' ? around.some((id) => id !== undefined) : around[0] !== undefined && around.every((id) => id === around[0]);
      };
      if (keys.some((key) => ends(key).some(blocked))) return { ok: false, reason: 'Occupied' };
    }

    this.applying = true;
    try {
      // structures: all out of the index first, so two can swap ground
      const removed = [], added = [], changed = [];
      for (const c of step.structures) {
        const s = w.structures.get(c.id);
        if (s) w._unindexStructure(s);
      }
      for (const c of step.structures) {
        const s = w.structures.get(c.id);
        const to = c[side] && JSON.parse(c[side]);
        if (!to) {
          if (s) { w.structures.delete(c.id); removed.push(s); }
        } else if (s) {
          // changed in place, so whoever holds it sees the change (the cars
          // parked there stay)
          const parked = s.data.parked;
          for (const k of Object.keys(s)) delete s[k];
          Object.assign(s, to);
          if (parked !== undefined) s.data.parked = parked;
          w._insertStructure(s);
          changed.push(s);
        } else {
          w._insertStructure(to);
          added.push(to);
        }
      }
      // features (trees): only where the ground is free
      const goneF = [], newF = [];
      for (const c of step.features) {
        const f = w.features.get(c.id);
        const to = c[side];
        if (!to && f) {
          w.features.delete(f.id);
          if (w.featureAtNode.get(f.node) === f.id) w.featureAtNode.delete(f.node);
          goneF.push(f);
        } else if (to && !f && !w.featureAt(to.node) && !w.structureAt(to.node)) {
          w._insertFeature(to);
          newF.push(to);
        }
      }
      // networks and streets
      const touched = {};
      for (const kind of Object.keys(step.edges)) {
        const { graph } = w.networks[kind];
        const nodes = touched[kind] = [];
        for (const key of take[kind]) { graph.removeEdge(...ends(key)); nodes.push(...ends(key)); }
        for (const key of put[kind]) { graph.addEdge(...ends(key)); nodes.push(...ends(key)); }
      }
      let streets = false;
      for (const name of ['sidewalks', 'lanes']) {
        const d = step[name];
        if (!d) continue;
        streets = true;
        for (const key of undo ? d.added : d.removed) w[name].delete(key);
        for (const key of undo ? d.removed : d.added) w[name].add(key);
        (touched.road ??= []).push(...[...d.added, ...d.removed].flatMap(ends));
      }
      for (const c of step.laneWalks) {
        streets = true;
        if (c[side] === null) w.laneWalks.delete(c.key);
        else w.laneWalks.set(c.key, c[side]);
        (touched.road ??= []).push(...ends(c.key));
      }

      // and tell everyone, now that the town is whole again
      removed.forEach((s) => w.events.emit('structure:removed', s));
      goneF.forEach((f) => w.events.emit('feature:removed', f));
      for (const [kind, nodes] of Object.entries(touched)) {
        const layer = w.networks[kind];
        layer.version++;
        w.events.emit(layer.event, { layer, nodes: [...new Set(nodes)], ...(kind === 'road' && streets ? { sidewalks: true } : {}) });
      }
      added.forEach((s) => w.events.emit('structure:added', s));
      changed.forEach((s) => w.events.emit('structure:changed', s));
      newF.forEach((f) => w.events.emit('feature:added', f));
    } finally {
      this.applying = false;
    }

    // the chronicle: the step's own lines go, or come back
    const book = w.chronicle;
    if (undo) {
      const lines = new Set(step.entries), marks = new Set(step.marks);
      book.entries = book.entries.filter((e) => !lines.has(e));
      book.marks = book.marks.filter((m) => !marks.has(m));
    } else {
      for (const m of step.marks) if (!book.marks.includes(m)) book.marks.push(m);
      for (const e of step.entries) {
        book.entries.push(e);
        w.events.emit('chronicle:added', e);
      }
    }
    return { ok: true };
  }
}
