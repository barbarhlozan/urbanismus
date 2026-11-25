// A photo drawn in before your eyes, as an illustrator would draw it: the
// line of the land first (the skyline and the brows of the hills, so a
// house behind a hill is seen standing behind it), then the houses, their
// roofs and windows, then the trees, the land
// round them, what moves, and last the sky (DRAW.phases). Each line goes
// down along its length at the pen's pace (DRAW.speed), the lines of a
// part one after another across the picture, and once drawn it becomes
// the brushed line it is in the finished photo (ui/photoBrush.js). What
// fills the shapes in paper is there from the start, so a line drawn
// behind a house never shows through it.
//
// Nothing of it is kept: the photo's own elements are only animated
// (Web Animations), and the pen's lines drawn on top of them taken away at
// the end, so a print made of the photo at any moment is the finished one
// once finish() has run. With the device's "reduce motion" setting on, the
// photo is just there.

import { dataOf } from './photoBrush.js';

export const DRAW = {
  // the parts in the order drawn, and how long each takes (ms): `each` a
  // line in it, but no shorter than its first figure and no longer than
  // its second; the next begins when `overlap` of this one is done
  phases: [['horizon', 300, 700], ['house', 1100, 1800], ['roof', 600, 1000], ['window', 300, 700], ['tree', 600, 1200], ['land', 900, 1600], ['life', 200, 500], ['sky', 400, 800], ['rain', 300, 600]],
  overlap: 0.85,
  each: 25,
  speed: 0.45,  // photo px the pen goes along a line in a ms
  line: [60, 420], // ms a line takes, at least and at most
  settle: 140,  // ms a drawn line takes to turn into its brushed self
  fade: 260,    // ms a shape that isn't a line (an inked dot, a figure) takes to come in
};

const NS = 'http://www.w3.org/2000/svg';
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// which part of the drawing an element is
function partOf(el) {
  if (/\bphoto-(horizon|crest)\b/.test(el.getAttribute('class') ?? '')) return 'horizon';
  const kind = el.closest('[data-draw]')?.dataset.draw ?? 'land';
  if (kind !== 'house') return kind;
  const cls = el.getAttribute('class') ?? '';
  if (/roof/.test(cls)) return 'roof';
  if (/pane|window|door|sill/.test(cls)) return 'window';
  return 'house';
}

// how a part's lines follow one another: across the picture, the land from
// the horizon down, the rain anyhow
const ORDER = {
  land: (a, b) => a.y - b.y,
  rain: (a, b) => a.r - b.r,
};
const across = (a, b) => a.x - b.x;

export function drawPhoto(svg) {
  const none = { finish() {} };
  if (!svg || still()) return none;
  // the inks the lines are drawn in: a shape filled in anything else is
  // paper (a wall, the ground's bands), there from the start, hiding what
  // is behind it as in the finished photo
  const inks = new Set([...svg.querySelectorAll('path[data-ribbon]')].map((r) => r.dataset.ink ?? r.style.fill));
  const parts = new Map(DRAW.phases.map(([k]) => [k, []]));
  const box = (el) => { try { return el.getBBox(); } catch { return { x: 0, y: 0, width: 0, height: 0 }; } };

  for (const ribbon of svg.querySelectorAll('path[data-ribbon]')) {
    const line = ribbon.previousElementSibling;
    if (!line) continue;
    const b = box(line);
    parts.get(partOf(line))?.push({ line, ribbon, x: b.x + b.width / 2, y: b.y + b.height, r: Math.random() });
  }
  // what wasn't brushed but is inked: comes in as a whole
  for (const el of svg.querySelectorAll('path, line, polyline, polygon, ellipse, circle, rect')) {
    if (el.dataset.ribbon || el.nextElementSibling?.dataset?.ribbon) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    const inked = (inks.has(cs.stroke) && parseFloat(cs.strokeWidth) > 0) || inks.has(cs.fill);
    if (!inked) continue;
    const b = box(el);
    parts.get(partOf(el))?.push({ shape: el, x: b.x + b.width / 2, y: b.y + b.height, r: Math.random() });
  }

  const pens = [], runs = [];
  let at = 0, end = 0;
  for (const [kind, shortest, longest] of DRAW.phases) {
    const items = parts.get(kind);
    if (!items.length) continue;
    items.sort(ORDER[kind] ?? across);
    const span = Math.min(longest, Math.max(shortest, items.length * DRAW.each));
    items.forEach((it, i) => {
      const t = at + (span * i) / items.length;
      if (it.shape) {
        runs.push(it.shape.animate([{ opacity: 0 }, { opacity: 1 }], { delay: t, duration: DRAW.fade, fill: 'backwards' }));
        end = Math.max(end, t + DRAW.fade);
        return;
      }
      const { line, ribbon } = it;
      const d = Math.min(DRAW.line[1], Math.max(DRAW.line[0], line.getTotalLength() / DRAW.speed));
      const all = d + DRAW.settle, done = d / all;
      // the pen's line, drawn on along its length, then gone into the brushed one
      const pen = document.createElementNS(NS, 'path');
      pen.setAttribute('d', dataOf(line));
      pen.setAttribute('pathLength', '1');
      pen.setAttribute('style', `fill:none;stroke:${ribbon.style.fill};stroke-width:${ribbon.dataset.ribbon * 0.8};stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1 1;stroke-dashoffset:1;opacity:0`);
      ribbon.before(pen);
      pens.push(pen);
      runs.push(pen.animate([
        { opacity: 1, strokeDashoffset: 1 },
        { opacity: 1, strokeDashoffset: 0, offset: done },
        { opacity: 0, strokeDashoffset: 0 },
      ], { delay: t, duration: all, easing: 'ease-in-out', fill: 'both' }));
      runs.push(ribbon.animate([{ opacity: 0 }, { opacity: 0, offset: done }, { opacity: ribbon.style.opacity || 1 }], { delay: t, duration: all, fill: 'backwards' }));
      end = Math.max(end, t + all);
    });
    at += span * DRAW.overlap;
  }

  let over = false;
  const finish = () => {
    if (over) return;
    over = true;
    clearTimeout(timer);
    for (const a of runs) a.finish();
    for (const p of pens) p.remove();
  };
  const timer = setTimeout(finish, end + 50);
  return { finish, length: end };
}
