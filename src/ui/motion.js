// UI motion, all in one place so everything moves alike. Panels come in
// with their pen frame drawn on stroke by stroke while the contents fade up;
// they go out quicker, the frame rubbed out as the contents fade. Folding
// boxes change size smoothly instead of jumping.
//
// Panels are hidden with the .hidden class (display: none), so an exit
// has to play before the class goes on: reveal() does both. With the
// device's "reduce motion" setting on, everything just appears and goes.

export const MOTION = {
  in: 200,     // ms: things arriving
  out: 130,    // ms: leaving is quicker, so closing never feels like waiting
  resize: 180, // ms: folding and unfolding
  easeIn: 'cubic-bezier(0.2, 0.7, 0.3, 1)',  // arrives fast, settles
  easeOut: 'cubic-bezier(0.5, 0, 0.8, 0.4)', // lingers a moment, then goes
};

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
// entrance of a panel that was already un-hidden (to measure it).
export function reveal(el, show, { from = [0, 4], force = false } = {}) {
  if (show === isShown(el) && !force) return;
  stop(el);
  el.classList.remove('leaving');
  if (show) el.classList.remove('hidden');
  if (still()) {
    el.classList.toggle('hidden', !show);
    return;
  }
  const off = `translate(${from[0]}px, ${from[1]}px)`;
  const frame = frameOf(el);
  const anims = [];
  if (show) {
    anims.push(el.animate([{ opacity: 0, transform: off }, { opacity: 1, transform: 'none' }],
      { duration: MOTION.in, easing: MOTION.easeIn }));
    // the frame is drawn a little slower than the contents arrive: a pen going round
    if (frame) anims.push(frame.animate([{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }],
      { duration: MOTION.in * 1.4, easing: MOTION.easeIn }));
  } else {
    el.classList.add('leaving');
    anims.push(el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: off }],
      { duration: MOTION.out, easing: MOTION.easeOut, fill: 'forwards' }));
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
  ], { duration: MOTION.resize, easing: MOTION.easeIn });
  // (not if a newer move has taken over: it clips too)
  const done = () => { if (!running.has(el) || running.get(el)[0] === a) el.style.overflow = ''; };
  a.finished.then(done, done);
  running.set(el, [a]);
}

// Open or close a section inside a box (a Build menu group): its height
// slides between nothing and its contents.
export function slide(el, open) {
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
    { duration: open ? MOTION.resize : MOTION.out, easing: open ? MOTION.easeIn : MOTION.easeOut });
  a.finished.then(() => {
    el.style.overflow = '';
    el.classList.remove('leaving');
    if (!open) el.classList.add('hidden');
    running.delete(el);
  }, () => { if (!running.has(el)) el.style.overflow = ''; });
  running.set(el, [a]);
}

// A panel opening out of (show) or folding back into its bottom-right
// corner, where its button sits: `size` is that button's [width, height].
// Resolves true when done, false if a new call on the same panel cut it short.
export function corner(el, show, [w, h]) {
  stop(el);
  if (still()) return Promise.resolve(true);
  const r = el.getBoundingClientRect();
  const small = `inset(${Math.max(0, r.height - h)}px 0px 0px ${Math.max(0, r.width - w)}px)`;
  const frames = [{ clipPath: small, opacity: 0.4 }, { clipPath: 'inset(0px 0px 0px 0px)', opacity: 1 }];
  const anims = [el.animate(show ? frames : frames.reverse(),
    { duration: show ? MOTION.resize : MOTION.out, easing: show ? MOTION.easeIn : MOTION.easeOut, fill: show ? 'none' : 'forwards' })];
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
  running.set(el, [el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION.in, easing: MOTION.easeIn })]);
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
