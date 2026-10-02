// The plain marks for moving things far out (the agent canvas,
// render/agentCanvas.js): cars are squares, pedestrians an upright
// half-width rectangle standing on their point, cyclists a small triangle.

import { THEME } from '../theme.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const r2 = (n) => Math.round(n * 100) / 100;

export const carMark = () => {
  const r = THEME.agentRadius;
  return rect(-r, -r, 2 * r, 2 * r);
};

// Moving dots, each drawn around its origin: cars are squares, pedestrians
// an upright half-width rectangle standing on it, cyclists a small triangle
// – drawn by hand, so each one's corners sit a little differently (from the
// agent's id).
const rect = (x, y, w, h) => `M${r2(x)} ${r2(y)}h${r2(w)}v${r2(h)}h${r2(-w)}z`;

function triangle(r, id) {
  const j = (k) => (((Math.imul(id + 1, 0x9e3779b1) >>> (k * 5)) & 31) / 31 - 0.5) * r * 0.35;
  const pts = [[j(0), -r * 1.15 + j(1)], [r + j(2), r * 0.75 + j(3)], [-r + j(4), r * 0.75 + j(5)]];
  return `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}z`;
}

export function agentShape(kind, id = 0) {
  // a group, filled with a mark, a figure or a model by renderAgents
  const el = document.createElementNS(SVGNS, 'g');
  el.dataset.kind = kind;
  el.setAttribute('class', `agent ${kind}`);
  if (kind === 'walker' || kind === 'cyclist') el.innerHTML = `<path d="${personMark(kind, id)}"/>`;
  return el;
}

// The plain mark for a walker (upright rectangle) or cyclist (triangle).
export function personMark(kind, id) {
  const r = kind === 'cyclist' ? THEME.cyclistRadius : THEME.walkerRadius;
  return kind === 'cyclist' ? triangle(r * 1.2, id) : rect(-r / 2, -2 * r, r, 2 * r);
}
