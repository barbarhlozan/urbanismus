// Undo and redo of the player's own changes to the town (world.history).
//
// A step is whatever one click did: a house placed, a road drawn (with the
// trees it cleared), a station
// with the track it laid, a building pulled down, a new look or yard. World
// calls touch() before it changes anything; the first touch takes a
// snapshot of the town, and when the click's handler is done (the end of
// the task, a microtask later) the step closes with the difference: which
// structures and trees came, went or changed, which of the ways' nodes
// and edges (by id, with their street, lane and kerbs), and the chronicle
// lines the change wrote. Snapshots rather than an inverse per World method, so whatever a
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
// only grows), and their house numbers (World.nextNo steps back over one
// an undone building took last), so the save stays as it would have been. Each change is
// announced with the usual world events, so agents, the renderer and the
// save follow; the chronicle keeps quiet meanwhile (`applying`) and gets
// back exactly the lines the step wrote – they go on undo and return on
// redo. The story is left as it is: what was told was told.
//
// The last LIMIT steps are kept; a new step clears what could be redone.
// The history lives only in the page: it isn't saved, and a new or loaded
// town starts without one.

import { traceLine } from '../roads/dotView.js';

const LIMIT = 100;

// A structure as recorded: everything about it but the cars parked at it
// (s.data.parked, kept by sim/parking.js – the town's own business).
const record = (s) => JSON.stringify({ ...s, data: { ...s.data, parked: undefined } });

// The ways as recorded: nodes and edges by id (an edge without its cached
// measurements).
const nodeRecord = ({ id, x, y }) => JSON.stringify({ id, x, y });
const edgeRecord = ({ _m, ...e }) => JSON.stringify(e);

// What changed in a Map of records: [{ id, before, after }] (null where
// there was none).
function mapDiff(before, after) {
  const out = [];
  for (const [id, was] of before) if (after.get(id) !== was) out.push({ id, before: was, after: after.get(id) ?? null });
  for (const [id, now] of after) if (!before.has(id)) out.push({ id, before: null, after: now });
  return out;
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
      ways: this.waysNow(),
      entries: w.chronicle.entries.length,
      marks: new Set(w.chronicle.marks),
    };
  }

  // The ways now, as records by id.
  waysNow() {
    const { ways } = this.world;
    return {
      nodes: new Map([...ways.nodes.values()].map((n) => [n.id, nodeRecord(n)])),
      edges: new Map([...ways.edges.values()].map((e) => [e.id, edgeRecord(e)])),
      nextId: ways.nextId,
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
    const now = this.waysNow();
    const ways = { nodes: mapDiff(before.ways.nodes, now.nodes), edges: mapDiff(before.ways.edges, now.edges), nextId: [before.ways.nextId, now.nextId] };
    if (!structures.length && !features.length && !ways.nodes.length && !ways.edges.length) return null;
    return {
      structures, features, ways,
      entries: w.chronicle.entries.slice(before.entries),
      marks: w.chronicle.marks.filter((m) => !before.marks.has(m)),
    };
  }

  // Put the town as the step had it `side` ('before': undo, 'after': redo).
  apply(step, side) {
    const w = this.world;
    const undo = side === 'before';
    // ways coming back: their edges as they'll be
    const coming = step.ways.edges.filter((c) => c[side]).map((c) => JSON.parse(c[side]));

    // Room for what comes back: no structure the step didn't touch on its ground.
    const ours = new Set(step.structures.map((c) => c.id));
    const foreign = (n) => {
      const id = w.structureAtNode.get(n);
      return id !== undefined && !ours.has(id) ? id : undefined;
    };
    const comingS = step.structures.filter((c) => c[side]).map((c) => JSON.parse(c[side]));
    for (const s of comingS) {
      if (w.nodesOf(s).some((n) => n < 0 || foreign(n) !== undefined)) return { ok: false, reason: 'Occupied' };
    }
    for (const e of coming) {
      const layer = w.networks[e.kind];
      if (!layer) continue;
      const blocked = (n) => {
        if (e.kind === 'road') return foreign(n) !== undefined;
        const around = w.coarseAround(n).map(foreign);
        // railways keep clear of buildings; footpaths and fences only of
        // the inside of one (as World.isRailBlocked / isPathBlocked)
        return e.kind === 'rail' ? around.some((id) => id !== undefined) : around[0] !== undefined && around.every((id) => id === around[0]);
      };
      if (traceLine(e.pts, layer.grid, layer.scale).some((d) => blocked(d.n))) return { ok: false, reason: 'Occupied' };
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
          // parked there stay; and a building the story burnt since stays
          // a ruin)
          const parked = s.data.parked, ruin = s.ruin;
          for (const k of Object.keys(s)) delete s[k];
          Object.assign(s, to);
          if (parked !== undefined) s.data.parked = parked;
          if (ruin) s.ruin = true;
          w._insertStructure(s);
          changed.push(s);
        } else {
          w._insertStructure(to);
          added.push(to);
        }
      }
      // house numbers: the step's new ones are taken back on undo if
      // nothing has had a later one since (a house built and undone leaves
      // no gap), and counted again on redo
      const no = (json) => (json ? JSON.parse(json).no : undefined);
      const back = [];
      for (const c of step.structures) {
        const was = no(c[undo ? 'after' : 'before']), now = no(c[side]);
        if (now != null) w.nextNo = Math.max(w.nextNo, now + 1);
        else if (was != null && undo) back.push(was);
      }
      for (const n of back.sort((a, b) => b - a)) if (n === w.nextNo - 1) w.nextNo--;
      // features (trees): only where the ground is free
      const goneF = [], newF = [];
      for (const c of step.features) {
        const f = w.features.get(c.id);
        const to = c[side];
        if (!to && f) {
          w.features.delete(f.id);
          w._unindexFeature(f);
          goneF.push(f);
        } else if (to && !f && !w.featureAt(to.node) && !w.structureAt(to.node)) {
          w._insertFeature(to);
          newF.push(to);
        }
      }
      // the ways: edges out, nodes as they were, edges in – by id, so an
      // edge a later way split comes back whole, and the halves go
      const ways = w.ways, kinds = new Map(); // kind -> dots touched
      const touch = (json) => {
        if (!json) return;
        const e = JSON.parse(json), layer = w.networks[e.kind];
        if (!layer) return;
        if (!kinds.has(e.kind)) kinds.set(e.kind, []);
        kinds.get(e.kind).push(...traceLine(e.pts, layer.grid, layer.scale).map((d) => d.n));
      };
      for (const c of step.ways.edges) {
        touch(c.before);
        touch(c.after);
        ways.dropEdge(c.id);
      }
      for (const c of step.ways.nodes) {
        if (c[side]) ways.restoreNode(JSON.parse(c[side]));
        else ways.dropNode(c.id);
      }
      for (const c of step.ways.edges) if (c[side]) ways.restoreEdge(JSON.parse(c[side]));
      // ids: given back if nothing has taken a later one since
      const [was, now] = step.ways.nextId;
      if (!undo) ways.nextId = Math.max(ways.nextId, now);
      else if (ways.nextId === now) ways.nextId = was;
      for (const kind of kinds.keys()) w.refreshNetwork(kind);

      // and tell everyone, now that the town is whole again
      removed.forEach((s) => w.events.emit('structure:removed', s));
      goneF.forEach((f) => w.events.emit('feature:removed', f));
      for (const [kind, nodes] of kinds) {
        const layer = w.networks[kind];
        w.events.emit(layer.event, { layer, nodes: [...new Set(nodes)], ...(kind === 'road' ? { sidewalks: true } : {}) });
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
