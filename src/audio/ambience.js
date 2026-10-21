// The game's sound (Web Audio): for now the birds (birds.js), as many as
// the weather and the hour of the day bring. They follow what is seen of
// the weather (WeatherSystem.sky()), so they come and go as gradually as
// the rain and the clouds on the map do. (The wind and the rain are to
// come, from recordings.)
//
// A browser lets a page make sound only after the player has done something
// on it, so nothing is set up until the first click or key. Whether there
// is sound at all is the player's (the Menu's Sound button), remembered in
// this browser; it's on unless they turned it off.

import { Birds, birdsAt } from './birds.js';

export const SOUND = {
  key: 'urbanismus.sound',
  byDefault: true,
  volume: 0.5,
  // how often the levels are set (s), and how fast each setting is eased to
  every: 0.1,
  ease: 0.3,
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
    this.sky = { birds: 0 };
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
  // now (WeatherSystem.sky(); its birds) and the hour of the day.
  frame(dt, sky, hour = this.hour) {
    this.sky = sky;
    this.hour = hour;
    if (!this.ctx || !this.on) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = SOUND.every;
    this.levels();
    this.birds.frame();
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
  }

  // Set every sound for the weather and the hour now (at once when `now`,
  // otherwise eased).
  levels(now = false) {
    const ease = now ? 0.01 : SOUND.ease;
    this.birds.level(clamp(this.sky.birds ?? 0) * birdsAt(this.hour), ease);
  }
}

const clamp = (v) => Math.min(1, Math.max(0, v));
