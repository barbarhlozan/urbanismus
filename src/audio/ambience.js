// The sound of the weather, made as it plays (Web Audio): no recordings,
// only noise shaped by filters. The wind is a low rush that comes in gusts,
// a whistle in the strongest of them and the leaves rustling; the rain is a
// hiss with drops in it, and in a storm a roar under them. Both follow what
// is seen of the weather (WeatherSystem.sky(): its wind and rain), so they
// go over as gradually as the trees and the rain on the map do.
//
// A browser lets a page make sound only after the player has done something
// on it, so nothing is set up until the first click or key. Whether there
// is sound at all is the player's (the Menu's Sound button), remembered in
// this browser; it's on unless they turned it off.

export const SOUND = {
  key: 'urbanismus.sound',
  byDefault: true,
  volume: 0.5,
  // how often the levels are set (s), and how fast each setting is eased to
  every: 0.1,
  ease: 0.3,
  // the strongest wind and rain there is (config.weather.wind.storm, .rain.storm):
  // these sound as loud as the wind and the rain get
  wind: 0.14,
  rain: 2.4,
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
    this.t = 0; // (seconds of sound so far, for the gusts)
    this.wait = 0;
    this.sky = { wind: 0, rain: 0 };
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

  // Each frame: what is seen of the weather now ({ wind, rain }, as
  // WeatherSystem.sky() gives them), and the real seconds since the last.
  frame(dt, sky) {
    this.sky = sky;
    if (!this.ctx || !this.on) return;
    this.t += dt;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = SOUND.every;
    this.levels();
  }

  build() {
    const ctx = this.ctx;
    const pink = loopBuffer(ctx, 11, pinkNoise);
    const brown = loopBuffer(ctx, 13, brownNoise);
    const flutter = flutterBuffer(ctx, 9);
    // the light rain: drops few enough to hear one by one; the heavy: so many
    // they run together
    const sparse = dropsBuffer(ctx, 7.3, 26);
    const dense = dropsBuffer(ctx, 5.1, 340);

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    // (a safety: never louder than this, however the layers add up)
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -12;
    limit.ratio.value = 6;
    this.master.connect(limit).connect(ctx.destination);

    const source = (buffer, offset = 0) => {
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.start(0, offset);
      return s;
    };
    const filter = (type, frequency, Q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = frequency;
      f.Q.value = Q;
      return f;
    };
    const gain = (to = this.master) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(to);
      return g;
    };
    const chain = (...nodes) => nodes.reduce((a, b) => a.connect(b));

    // the wind: a low rush, opened up by the gusts
    this.body = gain();
    this.bodyLow = filter('lowpass', 300);
    chain(source(brown), this.bodyLow, this.body);
    // a whistle round the corners in the strongest gusts
    this.whistle = gain();
    this.whistleBand = filter('bandpass', 600, 2.5);
    chain(source(pink, 3.1), this.whistleBand, this.whistle);
    // the leaves: a high rustle, fluttering
    this.leaves = gain();
    const flutterAmp = ctx.createGain();
    flutterAmp.gain.value = 0; // (all of it from the flutter below)
    chain(source(pink, 7.4), filter('highpass', 1900), filter('lowpass', 7500), flutterAmp, this.leaves);
    source(flutter).connect(flutterAmp.gain);

    // the rain: a hiss, the drops in it, and a roar under a storm's
    this.hiss = gain();
    chain(source(pink, 1.7), filter('highpass', 450), filter('lowpass', 6000), this.hiss);
    this.sparse = gain();
    chain(source(sparse), filter('highpass', 300), this.sparse);
    this.dense = gain();
    chain(source(dense), filter('lowpass', 9000), this.dense);
    this.roar = gain();
    chain(source(brown, 5.9), filter('lowpass', 220), this.roar);
  }

  // Set every layer for the weather now (at once when `now`, otherwise eased).
  levels(now = false) {
    const ctx = this.ctx;
    const at = ctx.currentTime, ease = now ? 0.01 : SOUND.ease;
    const to = (param, v) => param.setTargetAtTime(v, at, ease);
    const wind = clamp(this.sky.wind / SOUND.wind), rain = clamp(this.sky.rain / SOUND.rain);

    // the stronger the wind, the more there is between its gusts and its lulls
    const g = 0.5 + (gusts(this.t) - 0.5) * (0.5 + wind);
    const w = wind ** 0.9;
    to(this.body.gain, 0.75 * w * (0.45 + 0.55 * g));
    to(this.bodyLow.frequency, 160 + 640 * w * (0.3 + 0.7 * g));
    to(this.whistle.gain, 0.16 * Math.max(0, (wind - 0.35) / 0.65) ** 1.3 * g * g);
    to(this.whistleBand.frequency, 420 + 700 * g * wind);
    // (some rustle even in a still fair day: the countryside is never quite quiet)
    to(this.leaves.gain, 0.3 * Math.min(1, 0.3 + wind) * (0.35 + 0.65 * g));

    to(this.hiss.gain, 0.42 * rain ** 0.7);
    to(this.sparse.gain, 0.7 * Math.min(1, rain / 0.42) ** 0.8);
    to(this.dense.gain, 0.55 * rain ** 1.4);
    to(this.roar.gain, 0.4 * Math.max(0, (rain - 0.45) / 0.55) ** 1.2);
  }
}

const clamp = (v) => Math.min(1, Math.max(0, v));

// ---------- the gusts ----------

// a smooth random value 0–1 through time: a slow swell and quicker gusts on it
const LATTICE = Array.from({ length: 256 }, Math.random);
function smooth(x) {
  const i = Math.floor(x), f = x - i;
  const a = LATTICE[i & 255], b = LATTICE[(i + 1) & 255];
  return a + (b - a) * f * f * (3 - 2 * f);
}
function gusts(t) {
  return clamp((0.62 * smooth(t / 6.5) + 0.38 * smooth(t / 1.9 + 91) - 0.5) * 1.5 + 0.5);
}

// ---------- the sounds' buffers ----------

// A stereo buffer of `seconds` that loops without a seam: each channel
// made `fill(out)` a little longer, and its end faded into its start.
function loopBuffer(ctx, seconds, fill) {
  const n = Math.round(seconds * ctx.sampleRate), fade = Math.round(0.5 * ctx.sampleRate);
  const buffer = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const x = new Float32Array(n + fade);
    fill(x);
    normalise(x);
    const out = buffer.getChannelData(c);
    out.set(x.subarray(0, n));
    for (let i = 0; i < fade; i++) {
      const k = (i / fade) * Math.PI / 2;
      out[i] = x[i] * Math.sin(k) + x[n + i] * Math.cos(k);
    }
  }
  return buffer;
}

// to the same loudness (RMS 0.25), whatever the colour
function normalise(x) {
  let sum = 0;
  for (const v of x) sum += v * v;
  const k = 0.25 / Math.sqrt(sum / x.length || 1);
  for (let i = 0; i < x.length; i++) x[i] *= k;
}

// noise with as much in each octave (Paul Kellet's filter)
function pinkNoise(x) {
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < x.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    x[i] = b0 + b1 + b2 + w * 0.1848;
  }
}

// deeper still: mostly the low end
function brownNoise(x) {
  let b = 0;
  for (let i = 0; i < x.length; i++) {
    b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    x[i] = b;
  }
}

// The leaves' flutter: a smooth random level 0.2–1 changing a few times a
// second, over a loop of `seconds` (its random points wrap round).
function flutterBuffer(ctx, seconds) {
  const n = Math.round(seconds * ctx.sampleRate);
  const points = Math.round(seconds * 5);
  const p = Array.from({ length: points }, () => Math.random() ** 1.6);
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const out = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const x = (i / n) * points, j = Math.floor(x), f = x - j;
    const a = p[j % points], b = p[(j + 1) % points];
    out[i] = 0.2 + 0.8 * (a + (b - a) * f * f * (3 - 2 * f));
  }
  return buffer;
}

// A stereo loop of rain drops, `perSecond` of them at random: each a short
// tick of noise dying away, most of them small, now and then a bigger one,
// and a few ringing a little (a drop in a puddle or on a leaf). Drops near
// the end run on into the start.
function dropsBuffer(ctx, seconds, perSecond) {
  const sr = ctx.sampleRate, n = Math.round(seconds * sr);
  const buffer = ctx.createBuffer(2, n, sr);
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  const count = Math.round(seconds * perSecond);
  for (let d = 0; d < count; d++) {
    const start = Math.floor(Math.random() * n);
    const size = 0.12 + 0.88 * Math.random() ** 3;
    const decay = sr * (0.0008 + 0.0035 * Math.random() * size);
    const length = Math.ceil(decay * 6);
    // where it falls, left to right
    const pan = (Math.random() * 0.9 + 0.05) * Math.PI / 2;
    const l = Math.cos(pan) * size, r = Math.sin(pan) * size;
    // brighter or duller, as what it falls on
    const dull = 0.2 + 0.7 * Math.random();
    const ring = Math.random() < 0.12 ? 1800 + 2600 * Math.random() : 0;
    let prev = 0, low = 0;
    for (let i = 0; i < length; i++) {
      const env = Math.exp(-i / decay);
      const w = Math.random() * 2 - 1;
      low += (w - low) * (1 - dull);
      let v = (low - prev) * env;
      prev = low;
      if (ring) v += 0.35 * Math.sin((2 * Math.PI * ring * i) / sr) * Math.exp(-i / (decay * 2.5));
      const k = (start + i) % n;
      left[k] += v * l;
      right[k] += v * r;
    }
  }
  // the loudest drop to 0.8 (by their peaks: a few drops a second measured
  // by their average would come out far too loud one by one)
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const k = 0.8 / (peak || 1);
  for (let i = 0; i < n; i++) { left[i] *= k; right[i] *= k; }
  return buffer;
}
