// The game's sound (Web Audio), all of it from recordings (sounds.js):
// the birds (birds.js), as many as the weather and the hour of the day
// bring; the rain in the woods and the wind in the trees before it (bed.js),
// as hard as they are; the pencil when the player builds and a tap of wood
// on the buttons (effects.js). The weather's follow what is seen of it
// (WeatherSystem.sky()), so they come and go as gradually as the rain and
// the clouds on the map do.
//
// A browser lets a page make sound only after the player has done something
// on it, so nothing is set up until the first click or key. Whether there
// is sound at all is the player's (the Menu's Sound button), remembered in
// this browser; it's on unless they turned it off.

import { Birds, birdsAt } from './birds.js';
import { Bed } from './bed.js';
import { Effects } from './effects.js';
import { load } from './sounds.js';

export const SOUND = {
  key: 'urbanismus.sound',
  byDefault: true,
  volume: 0.5,
  // how often the levels are set (s), and how fast each setting is eased to
  every: 0.1,
  ease: 0.3,
  // the rain in the woods (sounds/rain-woods.mp3): the rain from 33 s on,
  // and the wind in the trees before it began; how loud each is at its
  // hardest (the rain at `rain` and over, config.weather.rain; the wind at
  // `wind`, config.weather.wind.storm)
  rain: { part: [33, 47.6], stretch: [5, 9], fade: 2.5, volume: 2.4, at: 1.6 },
  wind: { part: [1, 28], stretch: [8, 16], fade: 4, volume: 1.4, at: 0.14 },
  // the pencil: how long for one building, and for a line (a road, a path,
  // a fence) by its segments
  build: { one: [0.4, 0.75], line: [0.35, 0.06, 2.2] },
};

export class Ambience {
  constructor() {
    this.on = SOUND.byDefault;
    try {
      const saved = localStorage.getItem(SOUND.key);
      if (saved !== null) this.on = saved === '1';
    } catch {
      // storage unavailable: the choice just won't be remembered
    }
    this.ctx = null;
    this.wait = 0;
    this.sky = { birds: 0, rain: 0, wind: 0 };
    this.hour = 12;
    this.changed = () => {};
    // the first click or key anywhere: the sound may start
    const first = () => {
      removeEventListener('pointerdown', first, true);
      removeEventListener('keydown', first, true);
      if (this.on) this.start();
    };
    addEventListener('pointerdown', first, true);
    addEventListener('keydown', first, true);
    // nobody's listening while the game is out of sight
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else if (this.on) this.ctx.resume();
    });
  }

  toggle() {
    this.set(!this.on);
  }

  set(on) {
    this.on = on;
    try {
      localStorage.setItem(SOUND.key, on ? '1' : '0');
    } catch {
      // storage unavailable
    }
    if (on) this.start();
    else if (this.ctx) {
      // it fades out, then stops working
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
      clearTimeout(this.resting);
      this.resting = setTimeout(() => { if (!this.on) this.ctx.suspend(); }, 1000);
    }
    this.changed(on);
  }

  // Set up (the first time) and fade in. Called from a click or a key.
  start() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.build();
    }
    clearTimeout(this.resting);
    this.ctx.resume();
    this.levels(true);
    this.master.gain.setTargetAtTime(SOUND.volume, this.ctx.currentTime, 0.4);
  }

  // Each frame: the real seconds since the last, what is seen of the weather
  // now (WeatherSystem.sky(): its birds, rain and wind) and the hour of the day.
  frame(dt, sky, hour = this.hour) {
    this.sky = sky;
    this.hour = hour;
    if (!this.ctx || !this.on) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = SOUND.every;
    this.levels();
    this.birds.frame();
    this.rain.frame();
    this.wind.frame();
  }

  build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    // (a safety: never louder than this, however the sounds add up)
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -12;
    limit.ratio.value = 6;
    this.master.connect(limit).connect(ctx.destination);
    this.birds = new Birds(ctx, this.master);
    const woods = load(ctx, 'rain');
    this.rain = new Bed(ctx, this.master, woods, SOUND.rain);
    this.wind = new Bed(ctx, this.master, woods, SOUND.wind);
    this.effects = new Effects(ctx, this.master);
  }

  // A button pressed (`knock`: one of the bigger ones), at screen x 0 … 1.
  tap(knock, x) {
    if (this.ctx && this.on) this.effects.tap(knock ? 'knock' : 'tick', x);
  }

  // The player built or took away something (a step of core/history.js):
  // the pencil, as long as it takes to draw – a building's while, a line's
  // by its length; taking away is the pencil low and dull, as if rubbed out.
  built(step) {
    if (!this.ctx || !this.on || this.ctx.state !== 'running') return;
    const added = step.structures.filter((s) => !s.before).length;
    const gone = step.structures.filter((s) => !s.after).length;
    const changed = step.structures.length - added - gone;
    let laid = 0, cut = 0;
    for (const d of Object.values(step.edges)) {
      laid += d.added.length;
      cut += d.removed.length;
    }
    const [first, each, most] = SOUND.build.line;
    const [a, b] = SOUND.build.one;
    const one = () => a + Math.random() * (b - a);
    if (laid) this.effects.scribble(Math.min(most, first + each * laid + (added ? one() / 2 : 0)));
    else if (added) this.effects.scribble(Math.min(most, one() + 0.25 * (added - 1)));
    else if (changed) this.effects.scribble(one() * 0.6, { soft: 0.8 });
    else if (gone || cut) this.effects.scribble(Math.min(1.2, 0.3 + 0.1 * (gone + cut / 4)), { rate: 0.8, dull: 0.6, soft: 0.6 });
  }

  // Set every sound for the weather and the hour now (at once when `now`,
  // otherwise eased).
  levels(now = false) {
    const ease = now ? 0.01 : SOUND.ease;
    this.birds.level(clamp(this.sky.birds ?? 0) * birdsAt(this.hour), ease);
    const { rain, wind } = SOUND;
    this.rain.level(rain.volume * clamp((this.sky.rain ?? 0) / rain.at) ** 0.7, ease);
    this.wind.level(wind.volume * clamp((this.sky.wind ?? 0) / wind.at) ** 1.3, ease);
  }
}

const clamp = (v) => Math.min(1, Math.max(0, v));
