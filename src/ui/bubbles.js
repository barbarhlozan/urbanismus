// The story told on the map (bubbles-lab.html, style D): what people say
// shows in bubbles over the building where it happens, stacked like a chat
// along a line straight up from the house: a side a speaker – one alone
// on the line, two either side of it (the first to speak on the left, its
// edge and tail at the line), a third on it, four two a side –
// the name inside only when the speaker changes, older lines above (all
// of them as strong as the newest until the talk ends: then they go, the
// oldest first, close({ fade })), and a tail on the newest only, leaning
// to the roof – someone's still talking. When the talk ends the tail goes
// first, then the bubbles.
// The narrator's lines (`narrator` in the story file), narration and the
// choices are a caption at the bottom of the screen instead.
//
// The storyteller (src/story/storyteller.js) drives it:
//
//   await bubbles.say(speaker, text, { at })   at: the building, or null for
//                                              the caption; resolves when the
//                                              player goes on
//   …{ crowd: true }      a bubble that goes by itself after a while; resolves
//                         a moment later, so the next one comes over it
//   await bubbles.choose(['…', '…'])           resolves with the index picked
//   bubbles.close({ fade, after })   the tail goes, `after` s later the
//                         bubbles, oldest first, `fade` s apart
//   bubbles.frame()       every frame: the bubbles follow their buildings
//
// Click a bubble or the caption (or Enter) to go on; a click while the line
// is still being written shows all of it first. Choices: click, 1–9, or
// ↑ ↓ and Enter. A building off screen: its bubbles wait at the edge of the
// screen on its side, their tails pointing out towards it, as if someone
// were talking from over there.

import { sketchLine, seedOf } from '../render/sketch.js';
import { smooth } from '../render/people.js';
import { mulberry32 } from '../core/random.js';

const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const KEEP = 12;     // lines kept in a stack (a longer talk: its first go, so it doesn't climb off the screen)
const EDGE = 14;     // px kept clear round the screen
const FRAME = 11;    // px: the sprite's border slice, on screen
// where each speaker's bubbles sit, by how many talk: 0 on the line up
// from the house, -1 just left of it (its right edge by the line), 1 just
// right, ±2 a step further out
const SIDES = [[0], [-1, 1], [-1, 1, 0], [-2, 2, -1, 1]];
const GAP = 7;   // px between the line and a bubble beside it
const STEP = 64; // px further out for the outer pair of four

// The bubble, drawn once per scheme: a rounded box in one pen line whose
// ends overlap where it closes, paper inside. 120×72, sliced 26 in.
let sprite = null;
function chatSprite() {
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--main').trim() || '#3a2c24', paper = css.getPropertyValue('--bg').trim() || '#f3eee2';
  if (sprite?.ink === ink && sprite.paper === paper) return sprite.url;
  const shape = (open) => {
    const rnd = mulberry32(11), N = 34, a0 = Math.PI * 0.62, e = 3.6, pts = [];
    for (let i = 0; i <= (open ? N + 3 : N - 1); i++) {
      const a = a0 + (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const j = 1 + (rnd() - 0.5) * 0.025 - (i > N ? 0.012 * (i - N) : 0);
      pts.push([60 + Math.sign(c) * Math.abs(c) ** (2 / e) * 57 * j, 36 + Math.sign(s) * Math.abs(s) ** (2 / e) * 33 * j]);
    }
    return smooth(pts, !open);
  };
  const svg = `<svg xmlns="${NS}" width="120" height="72" viewBox="0 0 120 72"><path d="${shape(false)}" fill="${paper}"/>`
    + `<path d="${shape(true)}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  sprite = { ink, paper, url: `url("data:image/svg+xml,${encodeURIComponent(svg)}")` };
  return sprite.url;
}

export class Bubbles {
  // roofOf(structure): where its roof is, in client px (main.js, from the
  // renderer and the camera)
  // avoid: what the caption keeps above (the Build menu, at the bottom)
  constructor(root, { roofOf, typing = 55, avoid = null } = {}) {
    this.roofOf = roofOf;
    this.avoid = avoid;
    this.speed = typing;
    this.layer = document.createElement('div');
    this.layer.className = 'story-bubbles';
    this.cap = document.createElement('div');
    this.cap.className = 'story-cap hidden';
    this.cap.setAttribute('aria-live', 'polite');
    this.cap.innerHTML = '<div class="cap-name"></div><div class="cap-text"></div><div class="cap-choices"></div>';
    root.append(this.layer, this.cap);
    this.capName = this.cap.querySelector('.cap-name');
    this.capText = this.cap.querySelector('.cap-text');
    this.capChoices = this.cap.querySelector('.cap-choices');
    this.list = [];
    this.count = 0;
    this.lanes = new Map(); // building id -> its speakers, in the order they first spoke
    this.shown = new Map(); // building id -> those of them in a bubble there now: its lanes
    this.last = null;       // (when the last frame was, for easing)
    this.pending = null;    // { kind: 'say' | 'choose', resolve }
    this.line = null;       // what's being written: { start, text, el?, cap? }

    this.layer.addEventListener('click', (e) => {
      if (e.target.closest('.bb')) this.next();
    });
    this.cap.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick]');
      if (pick) return this.pick(Number(pick.dataset.pick));
      if (this.pending?.kind === 'say') this.next();
    });
  }

  get open() {
    return !!this.pending || this.list.some((b) => b.dropAt == null) || !this.cap.classList.contains('hidden');
  }

  now() {
    return performance.now() / 1000;
  }

  // `title`: a heading for a caption nobody says; `instant`: all at once.
  say(speaker, text, { at = null, crowd = false, title = null, instant = false } = {}) {
    this.finish();
    this.flush();
    if (!at) return this.caption(speaker ?? title, text, { narration: !speaker, instant });
    this.hideCaption();
    for (const b of this.list) b.dim = false;
    const b = this.bubble(speaker, text, at, crowd);
    if (crowd) {
      // it goes by itself, and the next comes over it in a moment
      return new Promise((resolve) => {
        const t = setTimeout(() => { this.pending = null; resolve(); }, 900 + Math.random() * 500);
        this.pending = { kind: 'say', resolve: () => { clearTimeout(t); resolve(); } };
      });
    }
    // (a bubble comes whole, like a text message; only the caption is written out)
    this.line = { start: -1e9, text, bubble: b };
    return new Promise((resolve) => { this.pending = { kind: 'say', resolve }; });
  }

  choose(options) {
    this.finish();
    this.flush();
    for (const b of this.list) b.dim = true; // (the scene stays, faded)
    this.showCaption();
    this.cap.classList.add('choosing');
    this.capName.hidden = true;
    this.capText.textContent = '';
    this.focus = 0;
    this.capChoices.innerHTML = options.map((o, i) => `<button data-pick="${i}"><span class="cap-n">${i + 1}</span>${esc(o)}</button>`).join('');
    this.chosenAt = performance.now() + 450; // (an Enter still held from the last line doesn't pick)
    this.markFocus();
    return new Promise((resolve) => { this.pending = { kind: 'choose', resolve }; });
  }

  // fade: the bubbles go one by one, the oldest first, `fade` seconds
  // apart, as older lines do while talking (the talk left hanging a while)
  close({ fade = 0, after = 0 } = {}) {
    this.finish();
    this.line = null;
    const now = this.now();
    // (a bubble going has no tail: so the newest's goes now, at once)
    this.list.filter((b) => b.dropAt == null).forEach((b, i) => { b.dropAt = now + (fade ? after : 0) + i * fade; });
    if (!fade) { this.lanes.clear(); this.shown.clear(); } // (else each place's once its bubbles are gone: frame)
    this.hideCaption();
  }

  // Keys while it's open: Enter goes on (or picks), ↑ ↓ and 1–9 the
  // choices. True if the key was used.
  key(e) {
    if (!this.pending) return false;
    if (this.pending.kind === 'choose') {
      const n = this.capChoices.children.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        this.focus = (this.focus + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        this.markFocus();
        return true;
      }
      if (/^[1-9]$/.test(e.key) && +e.key <= n) {
        this.pick(+e.key - 1);
        return true;
      }
      if (e.key === 'Enter') {
        if (performance.now() > this.chosenAt) this.pick(this.focus);
        return true;
      }
      return false;
    }
    if (e.key === 'Enter') {
      this.next();
      return true;
    }
    return false;
  }

  // ---------- the caption ----------

  caption(name, text, { narration, instant }) {
    for (const b of this.list) b.dim = true;
    this.showCaption();
    this.cap.classList.remove('choosing');
    this.cap.classList.toggle('narration', narration);
    this.capName.textContent = name ?? '';
    this.capName.hidden = !name;
    this.capChoices.innerHTML = '';
    this.line = { start: instant || matchMedia('(prefers-reduced-motion: reduce)').matches ? -1e9 : this.now(), text, el: this.capText };
    this.write(this.line);
    return new Promise((resolve) => { this.pending = { kind: 'say', resolve }; });
  }

  showCaption() {
    this.cap.classList.remove('hidden');
    this.placeCaption();
  }

  // Up above the Build menu where they'd overlap (it changes size as it
  // opens and folds: looked at every frame while the caption shows).
  placeCaption() {
    const other = this.avoid && document.querySelector(this.avoid);
    this.cap.style.bottom = '';
    if (!other) return;
    const a = this.cap.getBoundingClientRect(), b = other.getBoundingClientRect();
    const overlap = b.width && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    if (overlap) this.cap.style.bottom = `${innerHeight - b.top + 10}px`;
  }

  hideCaption() {
    this.cap.classList.add('hidden');
    this.capChoices.innerHTML = '';
  }

  markFocus() {
    [...this.capChoices.children].forEach((b, i) => b.classList.toggle('focus', i === this.focus));
  }

  pick(i) {
    if (this.pending?.kind !== 'choose') return;
    const { resolve } = this.pending;
    this.pending = null;
    this.cap.classList.remove('choosing');
    this.capChoices.innerHTML = '';
    this.hideCaption();
    resolve(i);
  }

  // ---------- going on ----------

  next() {
    if (this.writing()) return this.finishWriting(); // first: the whole line
    this.finish();
  }

  finish() {
    const p = this.pending;
    this.pending = null;
    if (p?.kind === 'say') p.resolve();
    if (p?.kind === 'choose') p.resolve(0);
  }

  writing() {
    const l = this.line;
    return !!l && !!this.speed && (this.now() - l.start) * this.speed < l.text.length;
  }

  finishWriting() {
    if (this.line) this.line.start = -1e9;
  }

  // The last line written out in full before another takes its place.
  flush() {
    if (!this.line) return;
    this.line.start = -1e9;
    this.write(this.line);
    this.line = null;
  }

  // The line laid out whole (the bubble doesn't grow as it's written), the
  // part not written yet there, unseen.
  write(l) {
    const n = !this.speed ? l.text.length : Math.max(0, Math.min(l.text.length, Math.floor((this.now() - l.start) * this.speed) + 1));
    if (n === l.shown) return;
    l.shown = n;
    const el = l.el ?? l.bubble.el.querySelector('.bb-text');
    el.innerHTML = n >= l.text.length ? esc(l.text) : `${esc(l.text.slice(0, n))}<span class="un">${esc(l.text.slice(n))}</span>`;
  }

  // ---------- bubbles ----------

  bubble(who, text, at, crowd) {
    this.layer.style.setProperty('--chat-sprite', chatSprite());
    const el = document.createElement('div');
    el.className = 'bb pop'; // (it pops up from its tail as it comes: styles.css)
    el.innerHTML = `<div class="bb-name">${esc(who)}</div><div class="bb-text"><span class="un">${esc(text)}</span></div>`;
    // its tail in an <svg> of its own, behind its letters
    const ink = document.createElementNS(NS, 'svg');
    ink.setAttribute('class', 'ink');
    const g = document.createElementNS(NS, 'g');
    ink.appendChild(g);
    el.prepend(ink);
    this.layer.appendChild(el);
    const n = ++this.count, rnd = mulberry32(seedOf(n, 9));
    const place = at.id;
    if (!crowd) {
      if (!this.lanes.has(place)) this.lanes.set(place, []);
      const who_ = this.lanes.get(place);
      if (!who_.includes(who)) who_.push(who);
    }
    const before = [...this.list].reverse().find((o) => !o.crowd && o.dropAt == null && o.place === place);
    const b = { who, at, place, crowd, el, g, n, seed: seedOf(n, 31), born: this.now(),
      named: crowd || !before || before.who !== who,
      jitter: crowd ? [(rnd() - 0.5) * 260, 20 - rnd() * 110] : [0, 0], rel: null, fresh: true };
    if (crowd) b.line = { start: -1e9, text, bubble: b };
    // no more than KEEP lines kept at a house
    const kept = this.list.filter((o) => !o.crowd && o.dropAt == null && o.place === place);
    if (!crowd) for (const o of kept.slice(0, Math.max(0, kept.length - KEEP + 1))) this.drop(o);
    this.list.push(b);
    return b;
  }

  drop(b) {
    b.dropAt ??= this.now();
  }

  // Every frame: write, lay out, follow the buildings.
  frame() {
    const now = this.now();
    // (how far things ease this frame: most of the way in about half a second)
    this.ease = this.last == null ? 1 : 1 - Math.exp(-Math.min(0.1, now - this.last) / 0.16);
    this.last = now;
    if (this.line) this.write(this.line);
    if (!this.cap.classList.contains('hidden')) this.placeCaption();
    for (const b of this.list) {
      if (b.line) this.write(b.line);
      if (b.crowd && now - b.born > 3.8) this.drop(b);
    }
    this.list = this.list.filter((b) => {
      if (b.dropAt == null || now - b.dropAt < 0.4) return true;
      b.el.remove();
      return false;
    });
    for (const place of this.lanes.keys()) if (!this.list.some((b) => b.place === place)) { this.lanes.delete(place); this.shown.delete(place); }
    if (!this.list.length) return;
    const W = innerWidth, H = innerHeight;

    // a stack a building (a crowd's lines each their own), newest first
    const stacks = new Map();
    for (const b of [...this.list].reverse()) {
      const key = b.crowd ? `c${b.n}` : b.place;
      if (!stacks.has(key)) stacks.set(key, []);
      stacks.get(key).push(b);
    }
    for (const stack of stacks.values()) this.layStack(stack, W, H);
  }

  // One building's talk: laid out round its roof, the newest lowest. Off
  // screen, the whole stack is moved in to the edge on the building's side.
  layStack(stack, W, H) {
    const now = this.now();
    const at = stack[0].at;
    const anchor = this.roofOf(at);
    if (!anchor) {
      for (const b of stack) b.el.style.opacity = 0;
      return;
    }
    const [ax, ay] = anchor;
    // a lane each for those talking there now (in a bubble not going), in
    // the order they first spoke, the middle of them over the house: one
    // alone right over it, two either side, three in three… While the
    // talk is going away, the lanes stay as they were.
    const place = stack[0].place;
    const talking = new Set(stack.filter((b) => !b.crowd && b.dropAt == null).map((b) => b.who));
    if (talking.size) this.shown.set(place, (this.lanes.get(place) ?? []).filter((w) => talking.has(w)));
    const speakers = this.shown.get(place) ?? [];
    const lanes = Math.max(1, Math.min(4, speakers.length));
    let up = 0, belowWho = null;
    const laid = [];
    stack.forEach((b, r) => {
      b.el.classList.toggle('noname', !b.named);
      b.el.style.maxWidth = `${lanes >= 4 ? 175 : lanes === 3 ? 205 : 240}px`;
      const w = b.el.offsetWidth, h = b.el.offsetHeight;
      const side = b.crowd ? 0 : SIDES[lanes - 1][speakers.indexOf(b.who)] ?? 0;
      // (room for a tail where the speaker changes; drawn on the newest
      // only, while the talk goes on)
      const gap = b.crowd || belowWho !== b.who;
      const tail = b.crowd || (r === 0 && b.dropAt == null);
      belowWho = b.who;
      const out = Math.abs(side) > 1 ? STEP : 0;
      b.el.style.transformOrigin = side < 0 ? '100% 100%' : side > 0 ? '0 100%' : '50% 100%';
      const x = (side < 0 ? -GAP - w - out : side > 0 ? GAP + out : -w / 2) + b.jitter[0];
      const y = -h - 18 - up - (gap ? 10 : 0) + b.jitter[1];
      up += h + (gap ? 10 : 0) + 5;
      // (the stack eases into its new shape as lines come and lanes open;
      // the building it hangs on it follows at once)
      const k = this.ease ?? 1;
      b.rel = b.rel ? [b.rel[0] + (x - b.rel[0]) * k, b.rel[1] + (y - b.rel[1]) * k] : [x, y];
      laid.push({ b, r, w, h, tail });
    });

    // off screen: the stack moved in, whole, to the edge on that side
    const off = ax < EDGE || ax > W - EDGE || ay < EDGE || ay > H - EDGE;
    let dx = 0, dy = 0;
    if (off) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const { b, w, h } of laid) {
        x0 = Math.min(x0, ax + b.rel[0]); x1 = Math.max(x1, ax + b.rel[0] + w);
        y0 = Math.min(y0, ay + b.rel[1]); y1 = Math.max(y1, ay + b.rel[1] + h);
      }
      const pad = EDGE + 16; // (room for the tail)
      dx = x0 < pad ? pad - x0 : x1 > W - pad ? W - pad - x1 : 0;
      dy = y0 < pad ? pad - y0 : y1 > H - pad ? H - pad - y1 : 0;
    }

    for (const { b, r, w, h, tail } of laid) {
      let x = ax + b.rel[0] + dx, y = ay + b.rel[1] + dy;
      let fade = b.dim ? 0.35 : 1; // (faded back behind a caption or a choice)
      if (!off) {
        x = Math.max(8, Math.min(W - w - 8, x));
        if (y < 4 && r > 0) fade = 0; // an older line pushed off the top goes
      }
      b.el.style.opacity = b.dropAt != null && now >= b.dropAt ? 0 : fade;
      // (placed with `translate`, so its pop – a `transform` – grows round its own tail corner)
      b.el.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
      // the ink svg sits in the padding box, inside the border
      b.g.setAttribute('transform', `translate(${(-x - FRAME).toFixed(1)} ${(-y - FRAME).toFixed(1)})`);
      this.setInk(b, tail ? this.tail(b, x, y, w, h, ax, ay, off) : []);
    }
  }

  // The tail: from under the bubble, at the point of it nearest the house
  // and leaning towards it (eased there as the bubble moves to its lane);
  // or, off screen, out of the side facing the building, pointing to it.
  tail(b, x, y, w, h, ax, ay, off) {
    let root, dir;
    if (!off) {
      // down from under it, clear of its rounded corners, as near the
      // house as it gets; leaning more the further the house is to the side
      const k = this.ease ?? 1;
      const along = w < 52 ? w / 2 : Math.max(24, Math.min(w - 24, ax - x));
      b.along = b.along == null ? along : b.along + (along - b.along) * k;
      const tx = x + b.along;
      const lean = Math.max(-1, Math.min(1, (ax - tx) / 90));
      b.lean = b.lean == null ? lean : b.lean + (lean - b.lean) * k;
      root = [tx, y + h - 3]; // (the sprite's line)
      const l = Math.hypot(b.lean * 0.4, 1);
      dir = [(b.lean * 0.4) / l, 1 / l];
    } else {
      // out of the side facing the building (on the sprite's line, 3 in;
      // not round its rounded corners)
      const cx = x + w / 2, cy = y + h / 2, ddx = ax - cx, ddy = ay - cy, l = Math.hypot(ddx, ddy) || 1;
      dir = [ddx / l, ddy / l];
      const hw = w / 2, hh = h / 2;
      if (Math.abs(dir[0]) * hh > Math.abs(dir[1]) * hw) {
        root = [dir[0] < 0 ? x + 3 : x + w - 3, Math.max(y + 16, Math.min(y + h - 16, cy + dir[1] * (hw / Math.abs(dir[0]))))];
      } else {
        root = [Math.max(x + 22, Math.min(x + w - 22, cx + dir[0] * (hh / Math.abs(dir[1])))), dir[1] < 0 ? y + 3 : y + h - 3];
      }
    }
    const side = [-dir[1], dir[0]];
    const tip = [root[0] + dir[0] * 14, root[1] + dir[1] * 14];
    const a = [root[0] + side[0] * 6, root[1] + side[1] * 6], c = [root[0] - side[0] * 6, root[1] - side[1] * 6];
    const ia = [a[0] - dir[0] * 4, a[1] - dir[1] * 4], ic = [c[0] - dir[0] * 4, c[1] - dir[1] * 4];
    return [
      ['paper', `M${ia[0]} ${ia[1]}L${tip[0]} ${tip[1]}L${ic[0]} ${ic[1]}Z`],
      ['pen', sketchLine(a, tip, b.seed + 3, { bow: 0.8 }) + sketchLine(tip, c, b.seed + 4, { bow: 0.8 })],
    ];
  }

  // Kept as elements, their `d` changed, so the drawing-on plays once.
  setInk(b, parts) {
    while (b.g.children.length > parts.length) b.g.lastChild.remove();
    parts.forEach(([cls, d], i) => {
      let p = b.g.children[i];
      if (!p) {
        p = document.createElementNS(NS, 'path');
        p.setAttribute('pathLength', '1');
        b.g.appendChild(p);
        if (cls === 'pen' && b.fresh) p.classList.add('fresh');
      }
      p.setAttribute('class', cls === 'pen' ? `pen${p.classList.contains('fresh') ? ' fresh' : ''}` : 'paper');
      p.setAttribute('d', d);
    });
    if (parts.length) b.fresh = false;
  }
}
