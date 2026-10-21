// A bed of sound under everything (the forest's birds, the rain, the wind
// in the trees), played from a recording so it never comes round the same:
// stretches from anywhere in it (or in a part of it, `part`: [from, to]
// seconds), each faded into the next, half of them the other way round
// (left for right) and each a hair faster or slower. While it is quiet
// nothing plays.

const between = ([a, b]) => a + Math.random() * (b - a);

// as loud all through a fade (the stretches aren't alike, so their sum isn't)
const FADE_IN = Float32Array.from({ length: 64 }, (_, i) => Math.sin((i / 63) * Math.PI / 2));
const FADE_OUT = FADE_IN.slice().reverse();

export class Bed {
  constructor(ctx, out, recording, { part = null, stretch = [14, 30], fade = 5, drift = 0.02 } = {}) {
    this.ctx = ctx;
    this.opts = { part, stretch, fade, drift };
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(out);
    this.k = 0;
    this.next = 0; // when the next stretch begins (ctx time)
    this.last = -1; // where in the recording the last began
    this.buffer = null;
    recording.then((b) => { this.buffer = b; }, (err) => console.warn('A sound is missing:', err));
  }

  // How loud (0 …), eased to over `ease` seconds.
  level(k, ease) {
    this.k = k;
    this.gain.gain.setTargetAtTime(k, this.ctx.currentTime, ease);
  }

  // A few times a second: the next stretch set going when it's due.
  frame() {
    const now = this.ctx.currentTime;
    if (!this.buffer || now < this.next - 0.5) return;
    // (quiet: none, until it's wanted again)
    if (this.k < 0.002) {
      this.next = now;
      return;
    }
    this.stretch(Math.max(now, this.next));
  }

  stretch(at) {
    const ctx = this.ctx, b = this.buffer, { stretch, fade, drift } = this.opts;
    const [a, z] = this.opts.part ?? [0, b.duration];
    const span = Math.min(z, b.duration) - a;
    const rate = 1 + (Math.random() * 2 - 1) * drift;
    const length = Math.max(fade * 2 + 0.5, Math.min(between(stretch), (span - 0.5) / rate));
    // from anywhere it fits, but not too near where the last began
    let from, tries = 0;
    do from = a + Math.random() * Math.max(0, span - length * rate);
    while (Math.abs(from - this.last) < span / 5 && ++tries < 8);
    this.last = from;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueCurveAtTime(FADE_IN, at, fade);
    g.gain.setValueCurveAtTime(FADE_OUT, at + length - fade, fade);
    let node = src;
    if (Math.random() < 0.5 && b.numberOfChannels === 2) {
      const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
      src.connect(split);
      split.connect(merge, 0, 1);
      split.connect(merge, 1, 0);
      node = merge;
    }
    node.connect(g).connect(this.gain);
    src.start(at, from, length * rate);
    this.next = at + length - fade;
  }
}
