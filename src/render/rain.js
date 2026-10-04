// Rain over the map: short slanted pen strokes falling across the screen,
// each ending in a little splash where it reaches the ground. Drawn on its
// own <canvas> (#rain) over everything on the map – hundreds of strokes move
// every frame, far too many for SVG elements (see agentCanvas.js).
//
// The drops live in screen px but move with the map when it is panned, so
// the rain stays over the town rather than sliding across it. They fall on
// simulated time: when the game is paused the rain hangs still. The rain
// comes on and goes off gradually (`level`) as the weather turns; a storm is
// the same rain, harder: more drops, falling faster and slanting more.

import { THEME } from '../theme.js';

export const RAIN = {
  density: 1 / 2600,  // drops on screen at full rain, per screen px²
  fall: [0.35, 0.6],  // seconds a drop takes to fall
  length: [7, 13],    // px, the stroke
  drop: [70, 110],    // px a drop falls in its life
  slant: 0.18,        // sideways per downwards
  storm: { slant: 0.2, speed: 0.35 }, // per level of rain over 1: more slant, faster
  splash: 0.18,       // seconds a splash shows
  width: 0.7,         // stroke width, px
  alpha: 0.65,
  ease: 4,            // seconds for the rain to come on or go off
};

const between = ([a, b]) => a + Math.random() * (b - a);

export class RainCanvas {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.drops = [];
    this.level = 0;    // 0 none – 1 rain – more for a storm (config.weather.rain)
    this.pan = null;
    this.empty = true;
  }

  // One frame: `dt` simulated seconds, `target` how hard it should be
  // raining (0 not at all).
  frame(dt, camera, target = 0) {
    if (this.level !== target) {
      const step = dt / RAIN.ease;
      this.level = this.level < target ? Math.min(target, this.level + step) : Math.max(target, this.level - step);
    }
    if (!this.level && !this.drops.length) return this.clear();

    const { canvas, ctx } = this;
    const dpr = devicePixelRatio || 1;
    const W = innerWidth, H = innerHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    }

    // follow the map as it pans; on a zoom start afresh
    const pan = { x: camera.panX, y: camera.panY, zoom: camera.zoom };
    if (this.pan && this.pan.zoom !== pan.zoom) this.drops = [];
    else if (this.pan) {
      const dx = pan.x - this.pan.x, dy = pan.y - this.pan.y;
      if (dx || dy) for (const d of this.drops) { d.x += dx; d.y += dy; }
    }
    this.pan = pan;

    // new drops, so that about `density · area · level` are falling
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const want = RAIN.density * W * H * this.level;
    const over = Math.max(0, this.level - 1); // (a storm)
    const speed = 1 + RAIN.storm.speed * over;
    const life = (RAIN.fall[0] + RAIN.fall[1]) / 2 / speed + RAIN.splash;
    if (still && this.drops.length > want) this.drops.length = Math.ceil(want);
    let spawn = still ? Math.max(0, want - this.drops.length) : (want / life) * dt;
    while (spawn > 0 && (spawn >= 1 || Math.random() < spawn)) {
      spawn--;
      const fall = between(RAIN.fall) / speed, dist = between(RAIN.drop);
      // where it lands; it starts `dist` up and a little to the side of that
      const x = Math.random() * (W + 40) - 20, y = Math.random() * (H + 40) - 20 + dist * 0.5;
      this.drops.push({ x, y, dist, fall, len: between(RAIN.length), t: still ? fall * Math.random() : 0 });
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = THEME.palette.detail;
    ctx.lineWidth = RAIN.width;
    ctx.lineCap = 'round';
    ctx.globalAlpha = RAIN.alpha;
    ctx.beginPath();
    const slant = RAIN.slant + RAIN.storm.slant * over;
    const kept = [];
    for (const d of this.drops) {
      if (!still) d.t += dt;
      if (d.t < d.fall) {
        // falling: the stroke's lower end is `left` px above where it lands
        const left = d.dist * (1 - d.t / d.fall);
        const x1 = d.x + left * slant, y1 = d.y - left;
        ctx.moveTo(x1 + d.len * slant, y1 - d.len);
        ctx.lineTo(x1, y1);
      } else if (d.t < d.fall + RAIN.splash) {
        // a splash: two little ticks thrown up either side
        const k = 1 + 2 * ((d.t - d.fall) / RAIN.splash);
        ctx.moveTo(d.x - k, d.y - 0.6 * k);
        ctx.lineTo(d.x - 2 * k, d.y - 1.4 * k);
        ctx.moveTo(d.x + k, d.y - 0.6 * k);
        ctx.lineTo(d.x + 2 * k, d.y - 1.4 * k);
      } else continue;
      kept.push(d);
    }
    ctx.stroke();
    this.drops = kept;
    this.empty = false;
  }

  clear() {
    if (this.empty) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.pan = null;
    this.empty = true;
  }
}
