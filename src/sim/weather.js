// The weather: one for the whole map. It holds for a while (config.weather
// .lasts), then turns to one of the kinds that may follow it, by the weights
// in config.weather.next – rain and storms only out of clouds, mist only out
// of fair weather. The state is world.weather = { kind, from, since, until,
// n }: `from` the kind before, `since` and `until` in world.time, `n` how
// many changes there have been. What comes next depends only on the world's
// seed and n, so a town's weather is the same however it is played.
//
// The kind changes at once (the HUD's word, what people do), but what is
// seen of it – the wind, the clouds, the rain, the grey – goes over
// gradually around each change, each on its own time (config.weather.blend,
// sky()): the wind picks up before a storm, the rain thickens after it
// has begun.

import { mulberry32 } from '../core/random.js';

export class WeatherSystem {
  constructor(world, config) {
    this.world = world;
    this.config = config.weather;
    const w = world.weather;
    // a kind there is no more (an old save's overcast) starts as `start`
    if (!this.config.kinds.includes(w.kind)) w.kind = this.config.start;
    // (a save from before `from`: no blend in from the kind before)
    if (!this.config.kinds.includes(w.from)) w.from = w.kind;
    if (!w.until) w.until = this.world.time + this.lasts(w);
    // (a save from before `since`: the spell's length is known from n)
    if (w.since == null || w.since > w.until) w.since = w.until - this.lasts(w);
  }

  // A fresh random stream for each change.
  rnd(w) {
    return mulberry32(Math.imul(this.world.seed ^ 0x5bd1e995, 2654435761) ^ Math.imul(w.n + 1, 374761393));
  }

  // How long a spell lasts: [shortest, longest, skew] – with a skew over 1
  // most are short and now and then one lasts.
  lasts(w) {
    const [a, b, skew = 1] = this.config.lasts[w.kind];
    return a + this.rnd(w)() ** skew * (b - a);
  }

  // The kind that will follow this spell.
  following(w = this.world.weather) {
    const options = Object.entries(this.config.next[w.kind] ?? { [this.config.start]: 1 });
    const rnd = this.rnd(w);
    rnd(); // (the first draw is the spell's length)
    let r = rnd() * options.reduce((sum, [, p]) => sum + p, 0);
    return options.find(([, p]) => (r -= p) < 0)?.[0] ?? options[0][0];
  }

  // Make it so now (for trying things out from the console:
  // cmd.weather('rain')); it then runs its usual course.
  set(kind) {
    if (!this.config.kinds.includes(kind)) throw new Error(`Unknown weather '${kind}' (${this.config.kinds.join(', ')})`);
    const w = this.world.weather;
    w.from = w.kind;
    w.kind = kind;
    w.since = this.world.time;
    w.until = this.world.time + this.lasts(w);
  }

  update() {
    const w = this.world.weather;
    while (this.world.time >= w.until) {
      w.from = w.kind;
      w.kind = this.following(w);
      w.n++;
      w.since = w.until;
      w.until += this.lasts(w);
    }
  }

  // What is seen of the weather now: { wind, cover, rain, gloom, sun }, each
  // the kind's own (config.weather[that]) except around a change, where it
  // goes from one kind's to the next's over config.weather.blend[that] =
  // [seconds before the change, seconds after].
  sky(time = this.world.time) {
    const w = this.world.weather, c = this.config;
    const out = {};
    let next;
    for (const [q, [before, after]] of Object.entries(c.blend)) {
      const of = (kind) => c[q][kind] ?? SKY[q];
      let v = of(w.kind);
      if (time < w.since + after && w.from !== w.kind) {
        v = mix(of(w.from), v, (time - w.since + before) / (before + after));
      } else if (time > w.until - before) {
        next ??= this.following(w);
        v = mix(v, of(next), (time - w.until + before) / (before + after));
      }
      out[q] = v;
    }
    return out;
  }
}

// what a kind leaves out of config.weather's tables is this
const SKY = { wind: 0, cover: 0, rain: 0, gloom: 0, sun: 1 };

// from a to b as k goes 0 to 1, slow at both ends
function mix(a, b, k) {
  k = Math.min(1, Math.max(0, k));
  return a + (b - a) * k * k * (3 - 2 * k);
}

// How far up the mist is, 0 (none) to 1: it rises over the first `rise`
// seconds of a spell of mist and sinks over the last, in `steps` steps (each
// one is a redraw of the map's mist, render/mist.js).
export function mistRisen(w, time, { rise, steps }) {
  if (w.kind !== 'mist') return 0;
  const k = Math.min(1, (time - w.since) / rise, (w.until - time) / rise);
  return k <= 0 ? 0 : Math.ceil(k * steps) / steps;
}
