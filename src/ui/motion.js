// UI motion, all in one place so everything moves alike – a little playful,
// like paper on a desk. Panels land like a card tossed down: a slight tilt,
// a small overshoot, then they settle, their rows following one by one and
// the pen frame drawn round. They go out quicker, lifting a touch before
// they drop, the frame rubbed out. Folding boxes spring to their new size.
//
// Panels are hidden with the .hidden class (display: none), so an exit
// has to play before the class goes on: reveal() does both. With the
// device's "reduce motion" setting on, everything just appears and goes.

export const MOTION = {
  in: 340,     // ms: things arriving (most of it is the settling)
  out: 150,    // ms: leaving is quicker, so closing never feels like waiting
  resize: 300, // ms: folding and unfolding
  stagger: 22, // ms between one row and the next
  easeIn: 'cubic-bezier(0.2, 0.7, 0.3, 1)',      // arrives fast, settles
  spring: 'cubic-bezier(0.34, 1.5, 0.64, 1)',    // arrives, goes a bit past, comes back
  easeOut: 'cubic-bezier(0.4, -0.45, 0.75, 0.4)', // lifts a little, then goes
};

// a small tilt, different each time, as if set down by hand
const tilt = () => (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random() * 1.3);

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const running = new WeakMap(); // el -> its animations, so a new move stops the old one
function stop(el) {
  for (const a of running.get(el) ?? []) a.cancel();
  running.delete(el);
}

// The pen frame of a box (sketchFrame.js), if it has one.
const frameOf = (el) => el.querySelector(':scope > .sk-frame path');

// Is it showing (or on its way in)? False while it's leaving.
export function isShown(el) {
  return !el.classList.contains('hidden') && !el.classList.contains('leaving');
}

// Show or hide a panel. `from` nudges where it comes from ([x, y] px):
// sheets rise from the bottom edge, menus a few pixels. `force` plays the
// entrance of a panel that was already un-hidden (to measure it). `rows`
// (a selector) are its rows, which follow it in one by one. `fade`: only
// fade (a backdrop: no tilting the whole screen).
export function reveal(el, show, { from = [0, 4], force = false, rows = null, fade = false } = {}) {
  if (show === isShown(el) && !force) return;
  stop(el);
  el.classList.remove('leaving');
  if (show) el.classList.remove('hidden');
  if (still()) {
    el.classList.toggle('hidden', !show);
    return;
  }
  // sheets rising from the edge tilt less than menus dropped in place
  const t = fade ? 0 : tilt() * (Math.abs(from[1]) > 20 ? 0.3 : 1);
  const off = `translate(${from[0]}px, ${from[1]}px)`;
  const frame = frameOf(el);
  const anims = [];
  if (show) {
    anims.push(el.animate([
      { opacity: 0, transform: fade ? 'none' : `${off} rotate(${t}deg) scale(0.93)` },
      { opacity: 1, transform: 'none' },
    ], { duration: MOTION.in, easing: fade ? MOTION.easeIn : MOTION.spring }));
    if (rows) anims.push(...follow(el.querySelectorAll(rows)));
    // the frame is drawn a little slower than the contents arrive: a pen going round
    if (frame) anims.push(frame.animate([{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }],
      { duration: MOTION.in * 1.4, easing: MOTION.easeIn }));
  } else {
    el.classList.add('leaving');
    anims.push(el.animate([
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: fade ? 'none' : `${off} rotate(${-t * 0.7}deg) scale(0.95)` },
    ], { duration: MOTION.out, easing: MOTION.easeOut, fill: 'forwards' }));
    // rubbed out from where the pen started
    if (frame) anims.push(frame.animate([{ strokeDasharray: '1 1', strokeDashoffset: 0 }, { strokeDasharray: '1 1', strokeDashoffset: -1 }],
      { duration: MOTION.out, easing: MOTION.easeOut, fill: 'forwards' }));
    anims[0].finished.then(() => {
      el.classList.remove('leaving');
      el.classList.add('hidden');
      stop(el);
    }, () => { /* cancelled: shown again */ });
  }
  running.set(el, anims);
}

// Rows coming in one after another, each from a little below.
export function cascade(rows) {
  return still() ? [] : follow(rows);
}
function follow(rows) {
  return [...rows].slice(0, 16).map((row, i) => row.animate(
    [{ opacity: 0, transform: 'translateY(7px)' }, { opacity: 1, transform: 'none' }],
    { duration: MOTION.in * 0.8, delay: 40 + i * MOTION.stagger, easing: MOTION.spring, fill: 'backwards' },
  ));
}

// A little hop: a number that just changed, a value that was picked.
export function bump(el) {
  if (still() || !el) return;
  el.animate([
    { transform: 'none' },
    { transform: 'translateY(-3px) scale(1.25)', offset: 0.35 },
    { transform: 'none' },
  ], { duration: 420, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' });
}

// Change something that alters a box's size (fold rows away, open a
// group…) and let the box grow or shrink to it instead of jumping.
// `change` does the change; the box keeps overflow: hidden meanwhile.
export function resize(el, change) {
  if (still()) return change();
  stop(el);
  const before = el.getBoundingClientRect();
  change();
  const after = el.getBoundingClientRect();
  if (before.width === after.width && before.height === after.height) return;
  el.style.overflow = 'hidden';
  const a = el.animate([
    { width: `${before.width}px`, height: `${before.height}px` },
    { width: `${after.width}px`, height: `${after.height}px` },
  ], { duration: MOTION.resize, easing: MOTION.spring });
  // (not if a newer move has taken over: it clips too)
  const done = () => { if (!running.has(el) || running.get(el)[0] === a) el.style.overflow = ''; };
  a.finished.then(done, done);
  running.set(el, [a]);
}

// Open or close a section inside a box (a Build menu group): its height
// slides between nothing and its contents, its `rows` following in.
export function slide(el, open, { rows = null } = {}) {
  if (open === isShown(el)) return;
  stop(el);
  el.classList.remove('leaving');
  if (still()) {
    el.classList.toggle('hidden', !open);
    return;
  }
  el.classList.remove('hidden');
  if (!open) el.classList.add('leaving');
  const h = `${el.scrollHeight}px`;
  el.style.overflow = 'hidden';
  const a = el.animate([{ height: open ? '0px' : h, opacity: open ? 0 : 1 }, { height: open ? h : '0px', opacity: open ? 1 : 0 }],
    { duration: open ? MOTION.resize : MOTION.out, easing: open ? MOTION.easeIn : 'cubic-bezier(0.5, 0, 0.8, 0.4)' });
  if (open && rows) follow(el.querySelectorAll(rows));
  a.finished.then(() => {
    el.style.overflow = '';
    el.classList.remove('leaving');
    if (!open) el.classList.add('hidden');
    running.delete(el);
  }, () => { if (!running.has(el)) el.style.overflow = ''; });
  running.set(el, [a]);
}

// A drawer sliding out from beside its rail (the Build menu on a wide
// screen) or tucking back in: `from` is where the rail is ([x, y] px).
// Resolves like corner().
export function drawer(el, show, from = [12, 0]) {
  stop(el);
  if (still()) return Promise.resolve(true);
  const frames = [{ opacity: 0, transform: `translate(${from[0]}px, ${from[1]}px) scale(0.96)` }, { opacity: 1, transform: 'none' }];
  const anims = [el.animate(show ? frames : frames.reverse(),
    { duration: show ? MOTION.in : MOTION.out, easing: show ? MOTION.spring : MOTION.easeOut, fill: show ? 'none' : 'forwards' })];
  if (show) anims.push(...follow(el.querySelectorAll('.bm-head, .bm-tools:not(.hidden) .bm-tool')));
  // the pen frame drawn round as it comes, rubbed out as it goes (as reveal())
  const frame = frameOf(el);
  if (frame) {
    anims.push(frame.animate(show
      ? [{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }]
      : [{ strokeDasharray: '1 1', strokeDashoffset: 0 }, { strokeDasharray: '1 1', strokeDashoffset: -1 }],
    show ? { duration: MOTION.in * 1.4, easing: MOTION.easeIn } : { duration: MOTION.out, easing: MOTION.easeOut, fill: 'forwards' }));
  }
  running.set(el, anims);
  return anims[0].finished.then(() => {
    if (!show) stop(el);
    return true;
  }, () => false);
}

// A panel opening out of (show) or folding back into its button below it:
// `size` is that button's [width, height], `at` where it sits under the
// panel – 'right' (the corner) or 'center'. Resolves true when done, false
// if a new call on the same panel cut it short.
export function corner(el, show, [w, h], at = 'right') {
  stop(el);
  if (still()) return Promise.resolve(true);
  const r = el.getBoundingClientRect();
  const spare = Math.max(0, r.width - w);
  const [left, right] = at === 'center' ? [spare / 2, spare / 2] : [spare, 0];
  const small = `inset(${Math.max(0, r.height - h)}px ${right}px 0px ${left}px)`;
  const frames = [{ clipPath: small, opacity: 0.4 }, { clipPath: 'inset(0px 0px 0px 0px)', opacity: 1 }];
  const anims = [el.animate(show ? frames : frames.reverse(),
    { duration: show ? MOTION.resize : MOTION.out, easing: show ? MOTION.easeIn : 'cubic-bezier(0.5, 0, 0.8, 0.4)', fill: show ? 'none' : 'forwards' })];
  if (show) anims.push(...follow(el.querySelectorAll('.bm-head, .bm-caption, .bm-tools:not(.hidden) .bm-tool, .bm-loose')));
  const frame = frameOf(el);
  if (show && frame) {
    anims.push(frame.animate([{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }],
      { duration: MOTION.in * 1.4, easing: MOTION.easeIn }));
  }
  running.set(el, anims);
  return anims[0].finished.then(() => {
    if (!show) stop(el);
    return true;
  }, () => false);
}

// Fade something in (a button taking over from a panel).
export function fadeIn(el) {
  if (still()) return;
  stop(el);
  running.set(el, [el.animate([{ opacity: 0, transform: 'scale(0.8)' }, { opacity: 1, transform: 'none' }], { duration: MOTION.in, easing: MOTION.spring })]);
}

// Like resize(), for changes that hide contents (folding a menu away):
// `change` is applied at once so the box knows where it's going, but the
// `hold` class keeps the old contents showing (see styles.css) while it
// shrinks, and comes off at the end.
export function shrink(el, change, hold = 'folding') {
  if (still()) return change();
  stop(el);
  const before = el.getBoundingClientRect();
  change();
  const after = el.getBoundingClientRect();
  if (before.width === after.width && before.height === after.height) return;
  el.classList.add(hold);
  el.style.overflow = 'hidden';
  const a = el.animate([
    { width: `${before.width}px`, height: `${before.height}px` },
    { width: `${after.width}px`, height: `${after.height}px` },
  ], { duration: MOTION.out, easing: MOTION.easeOut });
  const done = () => {
    el.classList.remove(hold);
    if (!running.has(el) || running.get(el)[0] === a) el.style.overflow = '';
  };
  a.finished.then(done, done);
  running.set(el, [a]);
}
