// The families of the town, and who of them runs its places.
//
// Every home gets its families as it's built: one for every FAMILY of its
// residents (a house one, a panel block eight), each with a surname
// (src/core/surnames.js), others in town first, never two of a name in one
// house. They are kept on the building: s.data.families = [{ surname }].
// A home that burns keeps them – the card still says whose it was.
//
// Every place with slots (structures/staff.js) has them filled by someone
// from a family living in town: a man or a woman as the role asks, with a
// first name of the time, kept on the place: s.data.staff = [{ role,
// first, sex, surname, home }], or just { role } while the slot is vacant.
// When a person's home is gone, or their family no longer lives there, the
// slot is vacant again, and filled as soon as someone can be found. No
// family gives more than WORKERS people. A place that burns down has none.
//
// It's all saved with the buildings and goes back and forth with them on
// ⌘Z (History records them whole), so nothing here runs while History is
// putting a step back.

import { STRUCTURE_TYPES } from '../../structures/index.js';
import { STAFF, ROLES } from '../../structures/staff.js';
import { SURNAMES, FIRST_NAMES } from '../core/surnames.js';

const FAMILY = 4;  // residents to a family
const WORKERS = 2; // most people one family gives to the town's places

const any = (list) => list[Math.floor(Math.random() * list.length)];

// How many families live in a home of this type (0: not a home).
export function familiesFor(def) {
  const n = def?.stats?.residents ?? 0;
  return n ? Math.max(1, Math.round(n / FAMILY)) : 0;
}

export class Families {
  constructor(world) {
    this.world = world;
    const follow = (fn) => (s) => {
      if (world.history.applying) return;
      fn(s);
      this.fill();
    };
    world.events.on('structure:added', follow((s) => this.settle(s)));
    world.events.on('structure:changed', follow((s) => this.settle(s)));
    world.events.on('structure:removed', follow((s) => this.vacate((p) => p.home === s.id)));
    // a town from before families: everyone moves in now (and is saved)
    for (const s of world.structures.values()) this.settle(s);
    this.fill();
  }

  // A building as it is now: its families and its slots, as many as its
  // type has.
  settle(s) {
    const def = STRUCTURE_TYPES[s.type];
    const want = familiesFor(def);
    const families = s.data.families ?? [];
    while (families.length < want) families.push({ surname: this.surname(families) });
    const gone = families.splice(want);
    if (gone.length) this.vacate((p) => p.home === s.id && gone.some((f) => f.surname === p.surname));
    if (families.length) s.data.families = families;
    else delete s.data.families;

    const roles = s.ruin ? [] : STAFF[s.type] ?? [];
    const staff = roles.map((role, i) => (s.data.staff?.[i]?.role === role ? s.data.staff[i] : { role }));
    if (staff.length) s.data.staff = staff;
    else delete s.data.staff;
  }

  // A surname for a new family: one nobody in town has yet, while there
  // are such; never one already in this house.
  surname(here) {
    const taken = new Set();
    for (const s of this.world.structures.values()) for (const f of s.data.families ?? []) taken.add(f.surname);
    const keys = [...SURNAMES.keys()].filter((k) => !here.some((f) => f.surname === k));
    const fresh = keys.filter((k) => !taken.has(k));
    return any(fresh.length ? fresh : keys);
  }

  // Empty the slots held by people `who(person)` picks.
  vacate(who) {
    for (const s of this.world.structures.values()) {
      if (!s.data.staff) continue;
      s.data.staff = s.data.staff.map((p) => (p.first && who(p) ? { role: p.role } : p));
    }
  }

  // Fill every vacant slot there's someone for.
  fill() {
    const { world } = this;
    const homes = [], working = new Map(), vacant = [];
    const key = (home, surname) => `${home}|${surname}`;
    for (const s of world.structures.values()) {
      if (!s.ruin) for (const f of s.data.families ?? []) homes.push({ home: s.id, surname: f.surname });
      for (const [i, p] of (s.data.staff ?? []).entries()) {
        if (p.first) working.set(key(p.home, p.surname), [...(working.get(key(p.home, p.surname)) ?? []), p.first]);
        else vacant.push([s, i]);
      }
    }
    for (const [s, i] of vacant) {
      const free = homes.filter((h) => (working.get(key(h.home, h.surname))?.length ?? 0) < WORKERS);
      if (!free.length) return;
      const { home, surname } = any(free);
      const { role } = s.data.staff[i];
      const sex = ROLES[role] === 'a' ? any(['m', 'f']) : ROLES[role];
      const names = working.get(key(home, surname)) ?? [];
      const first = any(FIRST_NAMES[sex].filter((n) => !names.includes(n)));
      s.data.staff[i] = { role, first, sex, surname, home };
      working.set(key(home, surname), [...names, first]);
    }
  }
}
