// The three dots over a house where someone's talking (src/story/kecy.js):
// a small bubble in one pen line, as the story's bubbles are drawn
// (ui/bubbles.js), three blots of ink in it and its tail running down to
// the roof as a single line. It waits there until the house is clicked
// (clicks go through it, to the house). Drawn on as it comes, faded as it
// goes.

import { smooth } from '../render/people.js';
import { mulberry32 } from '../core/random.js';
import { t } from '../core/text.js';

const W = 64, H = 50;   // px, the drawing
const CX = 32, CY = 16; // the bubble's middle
const LIFT = 4;         // px between the tail's end and the roof

let count = 0;

function drawing(seed) {
  const rnd = mulberry32(seed);
  // the bubble: a squashed round, a little fuller on one side, its ends
  // overlapping where the pen came back round
  const N = 26, a0 = Math.PI * (0.35 + rnd() * 0.2), pts = [];
  const lean = (rnd() - 0.5) * 0.12;
  for (let i = 0; i <= N + 2; i++) {
    const a = a0 + (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const j = 1 + (rnd() - 0.5) * 0.05 + lean * c - (i > N ? 0.03 * (i - N) : 0);
    pts.push([CX + c * 25 * j, CY + s * 13 * j * (s > 0 ? 1.05 : 1)]);
  }
  // the dots: blots, not circles, a hair off the line
  const dots = [-9, 0, 9].map((dx) => {
    const x = CX + dx + (rnd() - 0.5) * 1.4, y = CY + 1 + (rnd() - 0.5) * 1.6;
    const rx = 1.5 + rnd() * 0.5, ry = 1.9 + rnd() * 0.6, tilt = (rnd() - 0.5) * 40;
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" transform="rotate(${tilt.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }).join('');
  // the tail: in from both sides to a point, then on down as one line
  const bx = CX + (rnd() - 0.5) * 3, by = CY + 13;
  const tail = `M${bx - 5} ${by - 1.5} Q${bx - 1} ${by + 1} ${bx} ${by + 6} M${bx + 5} ${by - 1.5} Q${bx + 1} ${by + 1} ${bx} ${by + 6} L${(bx + (rnd() - 0.5) * 1.2).toFixed(1)} ${H - 1}`;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">`
    + `<path class="paper" d="${smooth(pts.slice(0, N), true)}"/>`
    + `<path class="pen fresh" pathLength="1" d="${smooth(pts, false)}"/>`
    + `<path class="paper" d="M${bx - 5} ${by - 3} L${bx + 5} ${by - 3} L${bx} ${by + 5} Z"/>`
    + `<path class="pen fresh" pathLength="1" d="${tail}"/>`
    + `<g class="blots">${dots}</g></svg>`;
}

export class KecDots {
  // roofOf(structure): its roof in client px, or null (ui/bubbles.js)
  constructor(layer, { roofOf }) {
    this.layer = layer;
    this.roofOf = roofOf;
    this.el = null;
    this.s = null;
  }

  show(s) {
    this.hide();
    this.s = s;
    const el = this.el = document.createElement('div');
    el.className = 'kec-dots';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', t('kecy.dots'));
    el.innerHTML = drawing(++count * 7919 + (s.no ?? 0));
    this.layer.appendChild(el);
    this.frame();
  }

  hide() {
    const el = this.el;
    this.el = this.s = null;
    if (!el) return;
    el.classList.add('going');
    setTimeout(() => el.remove(), 400);
  }

  frame() {
    if (!this.el) return;
    const at = this.roofOf(this.s);
    if (!at) {
      this.el.style.visibility = 'hidden';
      return;
    }
    this.el.style.visibility = '';
    this.el.style.transform = `translate(${(at[0] - W / 2).toFixed(1)}px, ${(at[1] - H - LIFT).toFixed(1)}px)`;
  }
}
