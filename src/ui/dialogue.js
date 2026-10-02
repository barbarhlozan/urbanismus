// The dialogue window, bottom left: who is speaking, their line written out
// a letter at a time, and the choices when there are some. The storyteller
// (src/story/storyteller.js) drives it:
//
//   await dialogue.say(speaker, text)    resolves when the player goes on
//                                        (speaker null: narration, no name)
//   await dialogue.choose(['…', '…'])    resolves with the index picked
//   dialogue.close()
//
// It sits bottom left, and moves up out of the way of `avoid` (the Build
// menu) where the window is too narrow for both side by side.
//
// Click the window (or Enter) to go on; a click while the line is still
// being written shows all of it first. Choices: click, or ↑ ↓ and Enter.
// The town carries on behind it.

import { reveal, cascade } from './motion.js';
import { sketchFrame } from './sketchFrame.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Dialogue {
  constructor(root, { typing = 55, avoid = null } = {}) {
    this.typing = typing;
    this.avoid = avoid;
    this.el = document.createElement('div');
    this.el.className = 'dialogue hidden';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `
      <div class="dlg-speaker"></div>
      <div class="dlg-text"></div>
      <div class="dlg-choices"></div>
      <div class="dlg-more" aria-hidden="true">›</div>`;
    root.appendChild(this.el);
    sketchFrame(this.el);
    this.speakerEl = this.el.querySelector('.dlg-speaker');
    this.textEl = this.el.querySelector('.dlg-text');
    this.choicesEl = this.el.querySelector('.dlg-choices');
    this.pending = null; // { kind: 'say' | 'choose', resolve }
    this.typer = null;

    const place = () => this.place();
    addEventListener('resize', place);
    this.watching = new ResizeObserver(place);
    this.watching.observe(this.el);

    this.el.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick]');
      if (pick) return this.pick(Number(pick.dataset.pick));
      if (this.pending?.kind === 'say') this.next();
    });
  }

  get open() {
    return !this.el.classList.contains('hidden') && !this.el.classList.contains('leaving');
  }

  // `title`: a heading where the speaker's name goes, for a line nobody
  // says; `instant`: no writing out, all at once.
  say(speaker, text, { title = null, instant = false } = {}) {
    this.finish(); // (anything still waiting goes on)
    const name = speaker ?? title;
    this.speakerEl.textContent = name ?? '';
    this.speakerEl.hidden = !name;
    this.el.classList.toggle('narration', !speaker);
    this.choicesEl.innerHTML = '';
    this.show();
    this.write(text, instant);
    return new Promise((resolve) => { this.pending = { kind: 'say', resolve }; });
  }

  choose(options) {
    this.finish();
    this.stopTyping();
    this.show();
    this.focus = 0;
    this.choicesEl.innerHTML = options.map((o, i) => `<button data-pick="${i}"><span class="dlg-n">${i + 1}</span>${esc(o)}</button>`).join('');
    this.el.classList.add('choosing');
    this.chosenAt = performance.now() + 450; // (an Enter still held from the last line doesn't pick)
    this.markFocus();
    cascade(this.choicesEl.children);
    return new Promise((resolve) => { this.pending = { kind: 'choose', resolve }; });
  }

  close() {
    this.finish();
    this.stopTyping();
    this.el.classList.remove('choosing');
    reveal(this.el, false, { from: [0, 10] });
  }

  // Keys while it's open: Enter goes on (or picks), ↑ ↓ move between the
  // choices. True if the key was used.
  key(e) {
    if (!this.open || !this.pending) return false;
    if (this.pending.kind === 'choose') {
      const n = this.choicesEl.children.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        this.focus = (this.focus + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        this.markFocus();
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

  // ---------- inside ----------

  show() {
    this.place();
    if (this.open) return;
    reveal(this.el, true, { from: [0, 14] });
  }

  // Up above the Build menu if they'd overlap (it changes size as it opens
  // and folds, so it's watched while the window is open).
  place() {
    const other = document.querySelector(this.avoid);
    if (!other) return;
    if (!this.watched) {
      this.watched = true;
      this.watching.observe(other);
    }
    this.el.style.bottom = '';
    const a = this.el.getBoundingClientRect(), b = other.getBoundingClientRect();
    const overlap = b.width && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    if (overlap) this.el.style.bottom = `${innerHeight - b.top + 10}px`;
  }

  write(text, instant = false) {
    this.stopTyping();
    this.full = text;
    this.el.classList.add('typing');
    if (instant || !this.typing || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.textEl.textContent = text;
      this.el.classList.remove('typing');
      return;
    }
    // the whole line is laid out at once (the box doesn't grow as it's
    // written): the part not written yet is there, unseen
    let shown = 0;
    const start = performance.now();
    const step = () => {
      const n = Math.min(text.length, Math.floor(((performance.now() - start) / 1000) * this.typing) + 1);
      if (n !== shown) {
        shown = n;
        this.textEl.innerHTML = `${esc(text.slice(0, n))}<span class="dlg-unwritten">${esc(text.slice(n))}</span>`;
      }
      if (n < text.length) this.typer = requestAnimationFrame(step);
      else this.stopTyping();
    };
    step();
  }

  stopTyping() {
    if (this.typer) cancelAnimationFrame(this.typer);
    this.typer = null;
    if (this.el.classList.contains('typing') && this.full != null) this.textEl.textContent = this.full;
    this.el.classList.remove('typing');
  }

  next() {
    if (this.el.classList.contains('typing')) return this.stopTyping(); // first: the whole line
    this.finish();
  }

  pick(i) {
    if (this.pending?.kind !== 'choose') return;
    const { resolve } = this.pending;
    this.pending = null;
    this.el.classList.remove('choosing');
    this.choicesEl.innerHTML = '';
    resolve(i);
  }

  // Let whatever is waiting go on.
  finish() {
    const p = this.pending;
    this.pending = null;
    if (p?.kind === 'say') p.resolve();
    if (p?.kind === 'choose') p.resolve(0);
  }

  markFocus() {
    [...this.choicesEl.children].forEach((b, i) => b.classList.toggle('focus', i === this.focus));
  }
}
