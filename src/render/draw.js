// Pen animations: a new building (or tree) is sketched stroke by stroke
// instead of popping up, and a removed one is erased in the reverse order.
//
// Works on what the Painter already produced – no drawing code needs to know
// about it. Each outline is revealed along its length with a stroke dash (a
// dash as long as the line, slid in from the gap), and its fill fades in
// once the outline is closed, so for a moment the sketch shows through
// itself like a construction drawing. Order, one pen moving on:
//   1. ground drawing (lawns, paving, yard lines)
//   2. outlines – filled faces, in the Painter's depth order (back to front)
//   3. details – windows, hatching, fences, tree glyphs
// Time per stroke goes with its length, and a few strokes overlap, so it
// reads as a quick hand rather than a plotter.
//
// Timing is by the clock, not by the DOM: the renderer rebuilds an object's
// elements now and then (neighbours change, camera rotates), and a rebuild
// in mid-drawing continues from `elapsed` instead of starting over.

export const DRAW = {
  on: true,
  speed: 1,      // multiplies every duration (2 = twice as slow)
  min: 320,      // ms for the smallest object…
  max: 950,      // …and the largest
  perUnit: 14,   // ms per grid unit of line drawn, between the two
  overlap: 2.2,  // about how many strokes are under way at once
  cap: 24,       // more objects than this at once (new map, big batch) just appear
  swap: 0.55,    // a rebuilt building (new level, new look): the old one is erased
                 // this much faster, and the new one starts when it is half gone
  grow: 260,     // ms for people and vehicles to grow out of a building…
  shrink: 200,   // …and to shrink back into one
};

// Size (0..1+) of something popping up `t` ms ago: grows with a little
// overshoot, like a dot set down with a flick of the pen.
export function growScale(t) {
  const u = Math.min(1, Math.max(0, t / (DRAW.grow * DRAW.speed))) - 1;
  return 1 + 2.2 * u * u * u + 1.2 * u * u;
}

// …and of something going away `t` ms ago (0 when gone).
export function shrinkScale(t) {
  const u = Math.min(1, Math.max(0, t / (DRAW.shrink * DRAW.speed)));
  return 1 - u * u;
}

const SHAPES = 'path,polygon,polyline,circle,ellipse,line,rect';
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)');

export const drawEnabled = () => DRAW.on && !reduced?.matches;

// Strokes to draw in `groups` (ground first), with their share of the time.
// `tile` converts screen px to grid units for the overall duration.
function plan(groups, tile, speed) {
  const phases = [[], [], []];
  groups.forEach((root, gi) => {
    if (!root?.isConnected) return;
    // non-scaling strokes dash in screen px: path lengths are measured in
    // the group's units, so scale them
    const m = root.getScreenCTM?.();
    const scale = m ? Math.hypot(m.a, m.b) : 1;
    for (const el of root.querySelectorAll(SHAPES)) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      let len = 0;
      try { len = el.getTotalLength(); } catch { /* not measurable */ }
      if (!(len > 0)) continue;
      const stroke = cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0;
      const fill = cs.fill !== 'none';
      const dashed = cs.strokeDasharray !== 'none';
      const phase = gi === 0 ? 0 : fill && !el.classList.contains('ink') ? 1 : 2;
      phases[phase].push({ el, len, px: len * scale, stroke: stroke && !dashed, fill });
    }
  });
  const items = phases.flat();
  const total = items.reduce((s, it) => s + it.len, 0);
  if (!total) return null;
  const T = Math.min(DRAW.max, Math.max(DRAW.min, DRAW.min + (total / tile) * DRAW.perUnit)) * DRAW.speed * speed;
  const pen = T * (1 - 0.35 / DRAW.overlap); // the last strokes still need time to finish
  let cum = 0;
  for (const it of items) {
    it.t0 = (cum / total) * pen;
    it.t1 = Math.min(T, it.t0 + Math.max(50, (it.len / total) * pen * DRAW.overlap));
    cum += it.len;
  }
  return { T, items };
}

// Animate `el` through keyframes over [a, b] of a T-long drawing; reversed,
// the same keyframes run backwards, mirrored in time. `elapsed` skips ahead.
function run(el, kf, a, b, { T, reverse, elapsed, easing = 'ease-in-out' }) {
  const delay = (reverse ? T - b : a) - elapsed;
  if (reverse) kf = kf.map((k) => (k.offset == null ? k : { ...k, offset: 1 - k.offset })).reverse();
  return el.animate(kf, {
    duration: Math.max(1, b - a), delay, easing,
    fill: reverse ? 'forwards' : 'backwards', // erased stays erased until removed
  });
}

// Sketch the groups in, `elapsed` ms into the drawing. Returns the ms left
// (<= 0 when done or there is nothing to draw).
export function drawIn(groups, { elapsed = 0, tile = 32 } = {}) {
  return animate(groups, tile, false, () => elapsed);
}

// Erase the groups: the drawing backwards. `drawn` is how long it had been
// drawing in, so a half-drawn object is erased from as far as it got.
// `speed` < 1 erases faster.
export function eraseOut(groups, { drawn = Infinity, tile = 32, speed = 1 } = {}) {
  return animate(groups, tile, true, (T) => Math.max(0, T - drawn * speed), speed);
}

function animate(groups, tile, reverse, skip, speed = 1) {
  const p = plan(groups, tile, speed);
  if (!p) return 0;
  const elapsed = skip(p.T);
  if (elapsed >= p.T) return 0;
  const o = { T: p.T, reverse, elapsed };
  for (const it of p.items) {
    const { el, t0, t1 } = it;
    if (it.stroke) {
      // one dash as long as the line (with room for measuring error), slid
      // in from the gap after it; round caps would show a dot at 0 length
      const n = it.px * 1.05 + 4;
      const d = `${n} ${n}`;
      run(el, [{ strokeDasharray: d, strokeDashoffset: n + 1 }, { strokeDasharray: d, strokeDashoffset: 0 }], t0, t1, o);
    } else {
      run(el, [{ opacity: 0 }, { opacity: 1 }], t0, t1, { ...o, easing: 'linear' });
    }
    if (it.fill && it.stroke) {
      // the fill settles in as the outline closes
      const f0 = t0 + (t1 - t0) * 0.75, f1 = Math.min(p.T, f0 + 140);
      const kf = [{ fillOpacity: 0 }, { fillOpacity: 0, offset: (f0 - t0) / (f1 - t0) }, { fillOpacity: 1 }];
      run(el, kf, t0, f1, { ...o, easing: 'linear' });
    }
  }
  return p.T - elapsed;
}
