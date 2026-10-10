// The weather: one for the whole map. It holds for a while (config.weather
// .lasts), then turns to one of the kinds that may follow it, by the weights
// in config.weather.next – mostly cloudy, rain only out of cloudy, a storm
// only out of rain, so it always clouds over first. The state is
// world.weather = { kind, until, n }: `until` in world.time, `n` how many
// changes there have been. What comes next depends only on the world's seed
// and n, so a town's weather is the same however it is played.

import { mulberry32 } from '../core/random.js';

export class WeatherSystem {
  constructor(world, config) {
    this.world = world;
    this.config = config.weather;
    const w = world.weather;
    // a kind there is no more (an old save's overcast) starts as `start`
    if (!this.config.kinds.includes(w.kind)) w.kind = this.config.start;
    if (!w.until) w.until = this.world.time + this.lasts(w);
  }

  // A fresh random stream for each change.
  rnd(w) {
    return mulberry32(Math.imul(this.world.seed ^ 0x5bd1e995, 2654435761) ^ Math.imul(w.n + 1, 374761393));
  }

  lasts(w) {
    const [a, b] = this.config.lasts[w.kind];
    return a + this.rnd(w)() * (b - a);
  }

  // Make it so now (for trying things out from the console:
  // cmd.weather('rain')); it then runs its usual course.
  set(kind) {
    if (!this.config.kinds.includes(kind)) throw new Error(`Unknown weather '${kind}' (${this.config.kinds.join(', ')})`);
    const w = this.world.weather;
    w.kind = kind;
    w.until = this.world.time + this.lasts(w);
  }

  update() {
    const w = this.world.weather;
    while (this.world.time >= w.until) {
      const options = Object.entries(this.config.next[w.kind] ?? { [this.config.start]: 1 });
      const rnd = this.rnd(w);
      rnd(); // (the first draw is the length of the spell that just ended)
      let r = rnd() * options.reduce((sum, [, p]) => sum + p, 0);
      w.kind = options.find(([, p]) => (r -= p) < 0)?.[0] ?? options[0][0];
      w.n++;
      w.until += this.lasts(w);
    }
  }
}
