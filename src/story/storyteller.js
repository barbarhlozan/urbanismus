// Tells the story written in story/story.txt (format in story/README.md).
// Every few seconds the rules are checked against the town (variables.js),
// in the order they are written; the first that holds, for a branch not
// told yet, is told in the dialogue window. Each branch is told once.
// What has been told, the numbers the story `set` and the buildings it
// picked (house numbers by name) are kept with the town (world.story), so
// a reload carries on where it was. A picked name reads as its number in
// conditions and in {name}; send and burn act on it (agents.send,
// World.burnStructure – the town's own doing, not the player's: ⌘Z
// leaves it).
//
// Mistakes in the file are listed in the dialogue window when it loads (and
// in the console), with their line.
//
// From the console (see src/dev/commands.js):
//   cmd.story.play('IntroDialogue')   tell a branch now
//   cmd.story.reset()                 forget what was told, start over
//   cmd.story.reload()                read the file again (after editing it)

import { parseStory, evaluate, fillIn, namesIn, normalName } from './script.js';
import { townVariables } from './variables.js';
import { UNLOCKS, loadUnlocks, resolveScheme, applyScheme } from './unlocks.js';
import { STRUCTURE_TYPES, isNumbered } from '../../structures/index.js';

// Can `pick` look for this (a normalName)? A type, a tag, or any building.
const PICKABLE = (what) => what === 'building' || what === 'buildings'
  || Object.values(STRUCTURE_TYPES).some((def) => [def.id, ...(def.tags ?? [])].some((n) => normalName(n) === what));

export class Storyteller {
  constructor({ world, agents, trains, dialogue, chronicle, config }) {
    this.world = world;
    this.agents = agents;
    this.trains = trains;
    this.dialogue = dialogue;
    this.chronicle = chronicle;
    this.config = config.story;
    this.script = null;
    this.timer = 0;
    this.telling = false;
  }

  get state() {
    return this.world.story;
  }

  async load() {
    // what may be built (story/unlocks.txt): its mistakes are listed with the story's
    const unlockErrors = (await loadUnlocks(this.config.unlocks)).map((e) => `${this.config.unlocks} line ${e.line}: ${e.msg}`);
    let text = '';
    try {
      const res = await fetch(this.config.file, { cache: 'no-store' });
      if (res.ok) text = await res.text(); // (no story: nothing to tell)
    } catch {
      // no story
    }
    this.script = parseStory(text);
    const problems = [...this.script.errors.map((e) => `${this.config.file} line ${e.line}: ${e.msg}`), ...unlockErrors];
    for (const b of this.script.branches.values()) {
      for (const s of b.steps) if (s.kind === 'scheme' && !resolveScheme(s.value)) problems.push(`${this.config.file} line ${s.line}: "${s.value}" is no colour scheme`);
      for (const s of b.steps) if (s.kind === 'unlock' && !UNLOCKS.known(s.name)) problems.push(`${this.config.file} line ${s.line}: "${s.name}" is nothing that can be locked`);
    }
    // names a condition reads that are neither the town's nor set anywhere
    const known = this.variables();
    const set = new Set(this.script.picked);
    for (const b of this.script.branches.values()) for (const s of b.steps) if (s.kind === 'set') set.add(s.name);
    for (const b of this.script.branches.values()) {
      for (const s of b.steps) {
        if (s.kind !== 'pick') continue;
        if (s.which.what && !PICKABLE(s.which.what)) problems.push(`${this.config.file} line ${s.line}: "${s.which.what}" is nothing that can be built (a type or tag, or building)`);
      }
    }
    const conditions = [
      ...this.script.rules.map((r) => [r.expr, r.line]),
      ...[...this.script.branches.values()].flatMap((b) => b.steps.filter((s) => s.expr).map((s) => [s.expr, s.line])),
    ];
    for (const [expr, line] of conditions) {
      for (const v of namesIn(expr)) {
        if (!known.has(v.var) && !set.has(v.var)) problems.push(`${this.config.file} line ${line}: "${v.name}" is nothing the story knows (it counts as 0)`);
      }
    }
    if (problems.length) {
      console.warn(problems.join('\n'));
      // (nothing is told meanwhile: closing this would close it too)
      this.telling = true;
      this.dialogue.say(null, `The story has mistakes:\n${problems.join('\n')}`, { title: 'Story', instant: true }).then(() => {
        this.telling = false;
        this.dialogue.close();
      });
    }
  }

  reload() {
    return this.load();
  }

  reset() {
    this.state.seen = [];
    this.state.vars = {};
    this.state.places = {};
    this.world.events.emit('story:changed');
  }

  // The town's numbers, then what the story set (the town's win: a story
  // can't change how many houses there are), then the places it picked.
  variables() {
    const v = townVariables(this.world, { agents: this.agents, trains: this.trains, photos: this.state.vars.photos_taken ?? 0 });
    for (const [k, n] of Object.entries(this.state.vars)) if (!v.has(k)) v.set(k, n);
    // a name picked means that building's number, even one the town counts
    // by (pick farm = …: `farm` is no longer how many farms there are)
    for (const [k, n] of Object.entries(this.state.places)) v.set(k, n);
    return v;
  }

  // ----- buildings -----

  // The house number a place in the story means (placeRef in script.js):
  // a number as it is, a name what was picked for it (0: nothing).
  numberOf(ref) {
    return ref.no ?? this.state.places[ref.name] ?? 0;
  }

  // The building standing there, not burnt, or null.
  standing(ref) {
    const s = this.world.structureByNo(this.numberOf(ref));
    return s && !s.ruin ? s : null;
  }

  // `pick`: the house number of a building chosen by `which` (0 when
  // there's none). Only those standing; one picked under another name is
  // passed over while there are others, so two picks are two buildings.
  pick(name, which) {
    if (which.no != null) return which.no;
    const all = (which.what === 'building' || which.what === 'buildings')
      ? (def) => isNumbered(def)
      : (def) => [def.id, ...(def.tags ?? [])].some((n) => normalName(n) === which.what);
    const taken = new Set(Object.entries(this.state.places).filter(([k]) => k !== name).map(([, n]) => n));
    let list = [...this.world.structures.values()].filter((s) => s.no != null && !s.ruin && all(STRUCTURE_TYPES[s.type]));
    if (list.some((s) => !taken.has(s.no))) list = list.filter((s) => !taken.has(s.no));
    if (!list.length) return 0;
    if (which.how === 'oldest') return Math.min(...list.map((s) => s.no));
    if (which.how === 'newest') return Math.max(...list.map((s) => s.no));
    if (which.how === 'nearest') {
      const from = this.world.structureByNo(this.numberOf(which.to));
      if (!from) return 0;
      const [fx, fy] = this.world.centerOf(from);
      const far = (s) => { const [x, y] = this.world.centerOf(s); return Math.hypot(x - fx, y - fy); };
      list = list.filter((s) => s !== from);
      return list.length ? list.reduce((a, b) => (far(b) < far(a) ? b : a)).no : 0;
    }
    return list[Math.floor(Math.random() * list.length)].no;
  }

  seen(key) {
    return this.state.seen.includes(key);
  }

  // dt: real seconds.
  update(dt) {
    if (!this.script || this.telling) return;
    this.timer += dt;
    if (this.timer < this.config.check) return;
    this.timer = 0;
    const v = this.variables();
    const lookup = (k) => v.get(k);
    const seen = (k) => this.seen(k);
    const exists = (ref) => !!this.standing(ref);
    const rule = this.script.rules.find((r) => !this.seen(r.branch) && evaluate(r.expr, lookup, seen, exists));
    if (rule) this.play(rule.branch);
  }

  // Tell a branch (and those it leads on to), then close the window.
  async play(name) {
    const key = normalName(name);
    if (!this.script?.branches.has(key) || this.telling) return;
    this.telling = true;
    try {
      await this.tell(key);
    } catch (err) {
      console.error('Story failed:', err);
    } finally {
      this.telling = false;
      this.dialogue.close();
    }
  }

  async tell(key) {
    const { branches } = this.script;
    let branch = branches.get(key), i = 0, quiet = 0;
    const enter = (k) => {
      branch = branches.get(k);
      i = 0;
      if (!this.seen(k)) this.state.seen.push(k);
      this.world.events.emit('story:changed');
    };
    enter(key);
    while (branch && i < branch.steps.length) {
      const step = branch.steps[i++];
      // a branch that only jumps and sets, round and round, would hang the game
      if (++quiet > 500) throw new Error(`branch ${branch.name} goes round in circles`);
      const v = this.variables();
      const lookup = (k) => v.get(k);
      const seen = (k) => this.seen(k);
      const exists = (ref) => !!this.standing(ref);
      const fill = (t) => fillIn(t, lookup, this.world.name);
      switch (step.kind) {
        case 'say':
          await this.dialogue.say(step.speaker, fill(step.text));
          quiet = 0;
          break;
        case 'choice': {
          const pick = await this.dialogue.choose(step.options.map((o) => fill(o.text)));
          quiet = 0;
          enter(step.options[pick].to);
          break;
        }
        case 'jump':
          if (!step.expr || evaluate(step.expr, lookup, seen, exists)) enter(step.to);
          break;
        case 'pick':
          this.state.places[step.name] = this.pick(step.name, step.which);
          this.world.events.emit('story:changed');
          break;
        case 'send': {
          const dest = this.standing(step.to);
          const homes = step.from.map((r) => this.standing(r)).filter(Boolean);
          if (dest && homes.length) this.agents?.send(homes, dest);
          break;
        }
        case 'burn': {
          const s = this.standing(step.place);
          if (s) this.world.history.aside(() => this.world.burnStructure(s.id));
          break;
        }
        case 'set':
          if (v.has(step.name) && !(step.name in this.state.vars)) console.warn(`${this.config.file} line ${step.line}: ${step.name} is one of the town's numbers, the story can't change it`);
          this.state.vars[step.name] = evaluate(step.expr, lookup, seen, exists);
          this.world.events.emit('story:changed');
          break;
        case 'scheme':
          applyScheme(step.value);
          this.onScheme?.();
          break;
        case 'unlock':
          UNLOCKS.apply(step.unlock, step.name);
          break;
        case 'chronicle':
          this.chronicle?.write(fill(step.text), 'story');
          break;
      }
    }
  }
}
