// The birds: two recordings from the Czech countryside (sounds/README.md),
// played so that they never come round the same twice.
//
// The song: one bird's phrases cut out of the Olomouc recording (PHRASES).
// A few singers sing them, each from a place of its own (left or right,
// near or far, its voice a touch higher or lower), as a chaffinch does: a
// bout of songs from one perch, a pause between each, then a rest, and
// it starts again from somewhere else. The fewer the birds (the weather,
// the hour), the fewer sing and the longer they wait.
//
// The forest: the June forest recording under them, a bed of birds further
// off (bed.js).

import { Bed } from './bed.js';
import { load } from './sounds.js';

export const BIRDS = {
  volume: { song: 0.42, forest: 0.5 },
  // up to this many singers; the next sings only once there are this many
  // more birds (0 … 1)
  singers: 3,
  each: 0.3,
  // seconds between one song and the next of a bout, songs in a bout,
  // seconds of rest after one
  pause: [5, 10],
  bout: [3, 8],
  rest: [12, 45],
  // how far a voice is from the recording's (playback rate) and a perch
  // from the middle (pan, -1 … 1)
  voice: 0.06,
  pan: 0.85,
  // the forest: stretches this long, faded over `fade` seconds, a hair
  // faster or slower (bed.js)
  forest: { stretch: [14, 30], fade: 5, drift: 0.02 },
  // how many birds there are through the day, 0 … 1, by the hour: none
  // at night, the most at dawn, again a little in the evening
  day: [[0, 0], [3.5, 0], [4.25, 0.5], [5, 1], [6.5, 1], [8, 0.75], [11, 0.55], [15, 0.5], [18, 0.65], [19.5, 0.8], [20.75, 0.35], [21.5, 0], [24, 0]],
};

// The bird's phrases in birds-olomouc.mp3, [from, to] in seconds (found by
// where the song stands out of the quiet, with a little before and a
// tail of echo after; three faint far calls left out).
const PHRASES = [
  [0.06, 2.35], [5.8, 8.47], [13.44, 16.55], [24.6, 28.01], [30.22, 32.97], [36.36, 39.33],
  [44.68, 48.61], [51.44, 54.11], [59.3, 62.75], [65.82, 68.83], [75.9, 79.09], [84.5, 86.69],
];

// How many birds there are at an hour (0 … 24).
export function birdsAt(hour) {
  const d = BIRDS.day;
  let i = 0;
  while (i + 2 < d.length && d[i + 1][0] <= hour) i++;
  const [[a, va], [b, vb]] = [d[i], d[i + 1]];
  return va + (vb - va) * Math.min(1, Math.max(0, (hour - a) / (b - a)));
}

const between = ([a, b]) => a + Math.random() * (b - a);

export class Birds {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.k = 0;
    this.song = null;
    this.songOut = out;
    this.singers = Array.from({ length: BIRDS.singers }, () => ({ next: 0, left: 0 }));
    this.recent = [];
    load(ctx, 'birds').then((b) => { this.song = b; }, (err) => console.warn('No birdsong:', err));
    this.forest = new Bed(ctx, out, load(ctx, 'forest'), BIRDS.forest);
  }

  // How many birds there are now (0 … 1), and the forest's level eased to it.
  level(k, ease) {
    this.k = k;
    this.forest.level(BIRDS.volume.forest * k, ease);
  }

  // A few times a second: the songs and the forest's stretches due soon
  // are set going.
  frame() {
    const now = this.ctx.currentTime;
    this.forest.frame();
    if (!this.song) return;
    this.singers.forEach((s, i) => {
      if (now < s.next) return;
      const k = this.k - i * BIRDS.each;
      // fewer birds: the singer waits longer before it tries again
      const slow = 1 / Math.max(0.15, Math.min(1, this.k));
      if (k <= 0.05) s.next = now + between(BIRDS.rest);
      else if (s.left > 0) {
        s.left--;
        s.next = now + this.sing(s, now + 0.05) + between(BIRDS.pause) * slow;
      } else {
        // a new bout, from another perch
        Object.assign(s, perch(), { left: Math.round(between(BIRDS.bout)) });
        s.next = now + (s.started ? between(BIRDS.rest) * slow : Math.random() * 6);
        s.started = true;
      }
    });
  }

  // One song from a singer at ctx time `at`; how long it lasts (s).
  sing(s, at) {
    const ctx = this.ctx;
    // not one of the last few sung
    let i;
    do i = Math.floor(Math.random() * PHRASES.length); while (this.recent.includes(i));
    this.recent = [...this.recent.slice(-3), i];
    const [from, to] = PHRASES[i];
    const rate = s.rate * (1 + (Math.random() - 0.5) * 0.01);
    const length = (to - from) / rate;
    const src = ctx.createBufferSource();
    src.buffer = this.song;
    src.playbackRate.value = rate;
    // further off: quieter and duller
    const dull = ctx.createBiquadFilter();
    dull.type = 'lowpass';
    dull.frequency.value = 15000 - 10000 * s.far;
    const g = ctx.createGain();
    const level = BIRDS.volume.song * (1 - 0.75 * s.far) * (0.85 + 0.3 * Math.random());
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.03);
    g.gain.setValueAtTime(level, at + length - 0.25);
    g.gain.linearRampToValueAtTime(0, at + length);
    let node = src.connect(dull).connect(g);
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = s.pan;
      node = node.connect(pan);
    }
    node.connect(this.songOut);
    src.start(at, from, to - from);
    return length;
  }
}

// a perch: where the singer is, how far, its voice
function perch() {
  return {
    pan: (Math.random() * 2 - 1) * BIRDS.pan,
    far: Math.random() ** 1.5,
    rate: 1 + (Math.random() * 2 - 1) * BIRDS.voice,
  };
}
