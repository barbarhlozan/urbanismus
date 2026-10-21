// The short sounds: the pencil when something is built, a tap of wood when
// a button is pressed, a knock for the bigger ones (opening the Menu,
// folding the Build menu). Each recording is cut into its separate sounds
// as it's read (slices: the scribbles, the taps, each between silences),
// and every time one is played it's another of them, never the one just
// heard, a little higher or lower, louder or softer, brighter or duller,
// more to one side or the other, and (the pencil) begun somewhere else in
// it – so no two are alike.

import { load } from './sounds.js';

export const EFFECTS = {
  // how loud, how far up or down a voice goes (playback rate), how much
  // softer it may be (share), how far to the sides (pan), how bright (Hz
  // its top is cut at, from … to)
  scribble: { recording: 'pencil', volume: 0.6, pitch: 0.1, soft: 0.3, pan: 0.3, bright: [6000, 14000] },
  tick: { recording: 'wood', volume: 0.4, pitch: 0.12, soft: 0.35, pan: 0.4, bright: [9000, 18000] },
  knock: { recording: 'knock', volume: 1.4, pitch: 0.1, soft: 0.3, pan: 0.4, bright: [9000, 18000] },
  // no two taps closer than this (s): a double click is one
  apart: 0.04,
};

const between = (a, b) => a + Math.random() * (b - a);
const vary = (k) => 1 + (Math.random() * 2 - 1) * k;

export class Effects {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.kinds = {};
    this.lastTap = -1;
    for (const [kind, o] of Object.entries(EFFECTS)) {
      if (!o.recording) continue;
      const k = this.kinds[kind] = { ...o, buffer: null, slices: [], last: -1 };
      load(ctx, o.recording).then((b) => {
        k.buffer = b;
        k.slices = slices(b);
      }, (err) => console.warn('A sound is missing:', err));
    }
  }

  // A button pressed: a tap, or a knock; `x` where on the screen (0 … 1).
  tap(kind = 'tick', x = 0.5) {
    const now = this.ctx.currentTime;
    if (now - this.lastTap < EFFECTS.apart) return;
    this.lastTap = now;
    this.play(kind, now, { pan: (x * 2 - 1) * this.kinds[kind]?.pan });
  }

  // The pencil for `seconds`: one scribble, or for longer (a road) one after
  // another, a lift of the pencil now and then between them.
  scribble(seconds, { at = this.ctx.currentTime, soft = 1, rate = 1, dull = 0 } = {}) {
    const k = this.kinds.scribble;
    if (!k?.slices.length) return;
    const pan = (Math.random() * 2 - 1) * k.pan;
    let t = 0;
    while (t < seconds - 0.08) {
      const left = seconds - t;
      // the last one cut to what's left, the others whole or nearly
      const length = left < 0.9 ? left : between(0.35, Math.min(0.9, left));
      const played = this.play('scribble', at + t, { length, pan: pan + between(-0.1, 0.1), soft, rate, dull });
      t += played * between(0.75, 0.95) + (Math.random() < 0.3 ? between(0.03, 0.12) : 0);
    }
  }

  // One of `kind`'s sounds at ctx time `at`; how long it plays (s).
  play(kind, at, { length = Infinity, pan = 0, soft = 1, rate = 1, dull = 0 } = {}) {
    const k = this.kinds[kind];
    if (!k?.slices.length) return 0;
    const ctx = this.ctx;
    let i = Math.floor(Math.random() * k.slices.length);
    if (i === k.last && k.slices.length > 1) i = (i + 1 + Math.floor(Math.random() * (k.slices.length - 1))) % k.slices.length;
    k.last = i;
    const s = k.slices[i];
    const r = rate * vary(k.pitch);
    // the pencil: begun anywhere in its first part, so its start is
    // another each time; a tap from its start
    let from = s.from, until = s.to;
    if (kind === 'scribble') from += Math.random() * Math.max(0, (until - from) * 0.3 - 0.05);
    until = Math.min(until, from + length * r);
    const played = (until - from) / r;
    if (played <= 0.01) return 0;
    const src = ctx.createBufferSource();
    src.buffer = k.buffer;
    src.playbackRate.value = r;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = between(...k.bright) * (1 - 0.7 * dull);
    const g = ctx.createGain();
    const level = k.volume * s.gain * soft * (1 - Math.random() * k.soft);
    g.gain.setValueAtTime(0, at);
    // (a tap's hit is in its first milliseconds: no fade over it)
    const rise = kind === 'scribble' ? 0.005 : 0.0005;
    g.gain.linearRampToValueAtTime(level, at + rise);
    g.gain.setValueAtTime(level, Math.max(at + rise + 0.001, at + played - 0.05));
    g.gain.linearRampToValueAtTime(0, at + played);
    let node = src.connect(tone).connect(g);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node = node.connect(p);
    }
    node.connect(this.out);
    src.start(at, from, until - from);
    return played;
  }
}

// A recording's separate sounds: where it rises out of its silences and
// falls back (5 ms windows, 40 dB under its loudest), each with a little
// before and a tail after, and as loud as each other (gain); faint ones
// (a tenth of the loudest) are left out.
function slices(buffer) {
  const x = buffer.getChannelData(0), sr = buffer.sampleRate;
  const hop = Math.round(sr * 0.005);
  const rms = [];
  for (let i = 0; i + hop <= x.length; i += hop) {
    let s = 0;
    for (let j = 0; j < hop; j++) s += x[i + j] * x[i + j];
    rms.push(Math.sqrt(s / hop));
  }
  const loudest = Math.max(...rms);
  const floor = loudest * 0.01, gap = Math.round(0.06 / 0.005);
  const found = [];
  let start = -1, quiet = 0;
  rms.forEach((v, i) => {
    if (v > floor) {
      if (start < 0) start = i;
      quiet = 0;
    } else if (start >= 0 && ++quiet > gap) {
      found.push([start, i - quiet + 1]);
      start = -1;
    }
  });
  if (start >= 0) found.push([start, rms.length]);
  const out = found.map(([a, b]) => {
    let peak = 0;
    for (let i = a; i < b; i++) peak = Math.max(peak, rms[i]);
    return { from: Math.max(0, a * 0.005 - 0.005), to: Math.min(buffer.duration, b * 0.005 + 0.03), peak };
  }).filter((s) => s.to - s.from > 0.03);
  const top = Math.max(...out.map((s) => s.peak));
  return out.filter((s) => s.peak > top * 0.1).map((s) => ({ ...s, gain: Math.min(4, top / s.peak) }));
}
