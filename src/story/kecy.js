// Kecy (story/kecy.md): little scenes of the village talking, tied to no
// story. Now and then three dots show over a house (ui/kecDots.js); they
// wait there until the player clicks the house. Then the talk is shown
// there in bubbles (ui/bubbles.js), a line a click – on the house, on a
// bubble, or Enter. The last line stays a while, then they go one by one,
// the oldest first.
//
// The file: every `## Title` is one kec, its lines `WHO: what's said`.
// Stage directions (*[…]*), choices (`>` and the lines answering them)
// and any other text are passed over, as is everything before the first
// title. A line `[name]` (or `Dům: name`) before the first said one ties
// the kec to a house: the first kec told with that name picks the house at
// random, later ones with it are told there too (while it stands), and in
// the order they're written – a series.
//
// Kecy not told yet come first (a series' next only); when all have been,
// any but the last.
// What was told and which house each name has are kept with the town
// (world.story.kecy).
//
// From the console (src/dev/commands.js):
//   cmd.kecy.list()             the kecy in the file
//   cmd.kecy.now('Polívka', 7)  the dots now (that kec, that house; both may be left out)
//   cmd.kecy.reload()           read the file again (after editing it)
//   cmd.kecy.reset()            forget what was told and the houses

import { normalName } from './script.js';
import { STRUCTURE_TYPES } from '../../structures/index.js';
import { KecDots } from '../ui/kecDots.js';

export function parseKecy(text) {
  const kecy = [];
  let kec = null, answering = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const head = line.match(/^##\s+(.+)$/);
    if (head) {
      const title = head[1].trim();
      kec = { title, key: normalName(title), home: null, lines: [], line: i + 1 };
      kecy.push(kec);
      answering = false;
      return;
    }
    if (!kec) return;
    if (!line) { answering = false; return; }
    if (line.startsWith('>')) { answering = true; return; } // a choice: it and its answer passed over
    const home = line.match(/^\[([\p{L}\d_-]+)\]$/u) ?? line.match(/^d[uů]m\s*:\s*(.+)$/i);
    if (home && !kec.lines.length) { kec.home = normalName(home[1]); return; }
    if (/^\*?\[/.test(line)) return;                         // what happens on the map
    const said = line.match(/^([^:]{1,40}):\s*(.+)$/);
    if (said && !answering) kec.lines.push({ who: said[1].trim(), text: said[2].trim() });
  });
  return kecy.filter((k) => k.lines.length);
}

const between = ([a, b]) => a + Math.random() * (b - a);

export class Kecy {
  constructor({ world, dialogue, config }) {
    this.world = world;
    this.dialogue = dialogue;
    this.config = config.kecy;
    this.list = [];
    this.timer = between(this.config.every);
    this.waiting = null; // { kec, s }: the dots are up
    this.playing = null; // { kec, s }: being told
    this.busy = () => false; // something else talking (the story): no dots meanwhile
    this.dots = new KecDots(dialogue.layer, { roofOf: dialogue.roofOf });
  }

  get state() {
    return (this.world.story.kecy ??= { told: [], homes: {} });
  }

  async load() {
    let text = '';
    try {
      const res = await fetch(this.config.file, { cache: 'no-store' });
      if (res.ok) text = await res.text();
    } catch {
      // none
    }
    this.list = parseKecy(text);
    return this.list.map((k) => k.title);
  }

  reload() {
    return this.load();
  }

  reset() {
    this.state.told = [];
    this.state.homes = {};
  }

  find(name) {
    const key = normalName(name);
    return this.list.find((k) => k.key === key) ?? this.list.find((k) => k.key.includes(key));
  }

  // dt: real seconds.
  update(dt) {
    const s = this.waiting?.s;
    if (s && (this.world.structures.get(s.id) !== s || s.ruin)) this.hideDots(); // (the house went)
    if (!this.list.length || this.waiting || this.playing) return;
    if (this.busy() || this.dialogue.open) return;
    this.timer -= dt;
    if (this.timer <= 0) this.offer();
  }

  frame() {
    this.dots.frame();
  }

  // The dots over a house: that kec (by name) or the next, at that house
  // (a number) or its own. Says what and where, or why not.
  offer(name = null, no = null) {
    if (this.playing) return 'a kec is being told';
    const kec = name ? this.find(name) : this.next();
    if (!kec) return name ? `no kec "${name}"` : 'no kecy';
    const s = no != null ? this.world.structureByNo(no) : this.houseFor(kec);
    if (!s || s.ruin) return no != null ? `no house č. p. ${no}` : 'no house to talk in';
    if (kec.home && no == null) this.state.homes[kec.home] = s.no;
    this.waiting = { kec, s };
    this.dots.show(s);
    return `${kec.title} · č. p. ${s.no}`;
  }

  // Not told yet first; when all were, any but the one told last.
  next() {
    const told = this.state.told;
    // (of a series, only the first not told yet)
    let pool = this.list.filter((k, i) => !told.includes(k.key)
      && !(k.home && this.list.slice(0, i).some((o) => o.home === k.home && !told.includes(o.key))));
    if (!pool.length) pool = this.list.filter((k) => k.key !== told[told.length - 1]);
    if (!pool.length) pool = this.list;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Its house, while it stands; else one people live in, at random.
  houseFor(kec) {
    const no = kec.home ? this.state.homes[kec.home] : null;
    const bound = no != null && this.world.structureByNo(no);
    if (bound && !bound.ruin) return bound;
    const homes = [...this.world.structures.values()]
      .filter((s) => s.no != null && !s.ruin && !s.burning && STRUCTURE_TYPES[s.type]?.stats?.residents);
    return homes.length ? homes[Math.floor(Math.random() * homes.length)] : null;
  }

  hideDots() {
    this.waiting = null;
    this.dots.hide();
  }

  // A building clicked on the map: true if it was the kec's (the dots'
  // house starts it, the house being told goes on a line).
  click(s) {
    if (this.playing?.s === s) {
      this.dialogue.next();
      return true;
    }
    if (this.waiting?.s === s) {
      this.start();
      return true;
    }
    return false;
  }

  start() {
    if (!this.waiting || this.playing || this.busy()) return;
    const { kec, s } = this.waiting;
    this.hideDots();
    this.play(kec, s);
  }

  async play(kec, s) {
    this.playing = { kec, s };
    const told = this.state.told.filter((k) => k !== kec.key);
    told.push(kec.key);
    this.state.told = told;
    this.world.events.emit('story:changed'); // (saved)
    try {
      for (let i = 0; i < kec.lines.length; i++) {
        if (this.world.structures.get(s.id) !== s) break;
        const { who, text } = kec.lines[i];
        const said = this.dialogue.say(who, text, { at: s });
        if (i < kec.lines.length - 1) {
          await said;
          continue;
        }
        // the last: it stays a while (or till clicked)
        await Promise.race([said, new Promise((r) => setTimeout(r, this.config.linger * 1000))]);
      }
    } catch (err) {
      console.error('Kec failed:', err);
    } finally {
      this.playing = null;
      this.dialogue.close({ fade: this.config.fade, after: this.config.after });
      this.timer = between(this.config.every);
    }
  }
}
